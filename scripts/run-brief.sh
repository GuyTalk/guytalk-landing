#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# GuyTalk Brief Generator — launchd runner
# Runs at 7am daily. Generates the draft, opens it in browser, notifies you.
# Logs go to: logs/brief-YYYY-MM-DD.log
# ─────────────────────────────────────────────────────────────────────────────

PROJECT_DIR="/Users/jakewilliams/Projects/GuyTalk"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/brief-$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

{
  echo ""
  echo "════════════════════════════════════════════"
  echo "  GuyTalk Brief — $(date '+%A, %B %d at %I:%M %p')"
  echo "════════════════════════════════════════════"
} >> "$LOG_FILE"

# ── Locate node (handles Homebrew, nvm, system installs) ──────────────────────
find_node() {
  # Homebrew on Apple Silicon
  [ -x "/opt/homebrew/bin/node" ]  && echo "/opt/homebrew/bin/node" && return
  # Homebrew on Intel
  [ -x "/usr/local/bin/node" ]     && echo "/usr/local/bin/node"    && return
  # nvm default
  NVM_DIR="$HOME/.nvm"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh" --no-use
    DEFAULT=$(cat "$NVM_DIR/alias/default" 2>/dev/null)
    CANDIDATE="$NVM_DIR/versions/node/$DEFAULT/bin/node"
    [ -x "$CANDIDATE" ] && echo "$CANDIDATE" && return
  fi
  # PATH fallback
  command -v node 2>/dev/null && return
}

NODE=$(find_node)

if [ -z "$NODE" ]; then
  MSG="node not found — install via brew install node"
  echo "❌ ERROR: $MSG" >> "$LOG_FILE"
  osascript -e "display notification \"$MSG\" with title \"GuyTalk Brief\" subtitle \"Generator failed at 7am\""
  exit 1
fi

echo "   node: $NODE" >> "$LOG_FILE"

# ── Run the generator ─────────────────────────────────────────────────────────
cd "$PROJECT_DIR" || exit 1

# Capture output and exit code; tee to log (API keys never appear in output)
"$NODE" scripts/generate-brief.js 2>&1 | tee -a "$LOG_FILE"
GEN_EXIT=${PIPESTATUS[0]}

# ── On success: publish to website + send email ───────────────────────────────
if [ "$GEN_EXIT" -eq 0 ]; then
  LATEST_DIR=$(ls -d "$PROJECT_DIR/brief/issue-"??? 2>/dev/null | sort | tail -1)

  if [ -n "$LATEST_DIR" ]; then
    ISSUE=$(basename "$LATEST_DIR")
    HTML="$LATEST_DIR/index.html"

    # Open in browser for a quick visual review
    open "$HTML"
    echo "" >> "$LOG_FILE"
    echo "   ✓ Generated: $HTML" >> "$LOG_FILE"

    # ── QA check — must pass before we push or notify ────────────────────────
    echo "" >> "$LOG_FILE"
    echo "   ── QA ────────────────────────────────────────────" >> "$LOG_FILE"
    "$NODE" "$PROJECT_DIR/scripts/qa-brief.js" 2>&1 | tee -a "$LOG_FILE"
    QA_EXIT=${PIPESTATUS[0]}

    if [ "$QA_EXIT" -ne 0 ]; then
      echo "" >> "$LOG_FILE"
      echo "   ✗ QA failed — skipping push + review email." >> "$LOG_FILE"
      echo "     Fix the issues above, then run manually:" >> "$LOG_FILE"
      echo "     npm run brief:qa && git add -A && git commit -m 'fix ${ISSUE}' && git push origin HEAD:pending --force-with-lease" >> "$LOG_FILE"
      osascript -e "display notification \"${ISSUE}: QA issues found — fix before pushing\" with title \"GuyTalk Brief ⚠\" subtitle \"Review email NOT sent\""
    else
      echo "   ✓ QA passed" >> "$LOG_FILE"

      # ── Editorial pass status (fail-open warning) ───────────────────────────
      # The Claude editor runs inside generate-brief.js. If it didn't run
      # (key missing / Anthropic down), the brief still ships but is flagged here.
      EDITOR_REVIEWED=$("$NODE" -e 'try{const d=require(process.argv[1]);process.stdout.write(d.editor&&d.editor.reviewed?"yes":"no")}catch(e){process.stdout.write("unknown")}' "$PROJECT_DIR/brief/data/${ISSUE}.json" 2>/dev/null)
      if [ "$EDITOR_REVIEWED" != "yes" ]; then
        echo "   ⚠  EDITORIAL PASS DID NOT RUN — brief shipping on Claude draft only." >> "$LOG_FILE"
        osascript -e "display notification \"${ISSUE} shipped WITHOUT editor pass — check ANTHROPIC_API_KEY\" with title \"GuyTalk Brief ⚠\" subtitle \"Not editorially reviewed\""
      else
        echo "   ✓ Editorial pass reviewed this brief" >> "$LOG_FILE"
      fi

      # ── Refresh the homepage from the new brief (replaces the old sed href bump) ──
      # update-homepage.js rewrites the "From the brief" preview, the phone-mockup
      # slides, and the group-chat block from the latest issue JSON, and repoints
      # every /brief/issue-NNN/ link. Fail-open: leaves index.html unchanged on any error.
      "$NODE" "$PROJECT_DIR/scripts/update-homepage.js" 2>&1 | tee -a "$LOG_FILE"

      # ── Stage to `pending` (NOT public) → publishes only on Jake's approval ──
      # The brief is pushed to the `pending` branch, which Vercel does NOT deploy
      # to production. api/approve.js fast-forwards main → pending on approval —
      # that is the moment it goes live. Nothing reaches guytalkmedia.com until
      # Jake taps approve.
      echo "" >> "$LOG_FILE"
      echo "   📤 Staging to pending branch (not public yet)..." >> "$LOG_FILE"

      cd "$PROJECT_DIR" || exit 1

      git add brief/ assets/ briefs/ index.html 2>&1 | tee -a "$LOG_FILE"
      git commit -m "Brief: ${ISSUE} — $(date '+%B %d, %Y')" 2>&1 | tee -a "$LOG_FILE"
      GIT_EXIT=${PIPESTATUS[0]}

      if [ "$GIT_EXIT" -eq 0 ]; then
        # Push the new commit to `pending` (disposable staging branch; force-with-lease
        # is safe because pending only ever mirrors the latest brief on top of main).
        git push origin HEAD:pending --force-with-lease 2>&1 | tee -a "$LOG_FILE"
        PUSH_EXIT=${PIPESTATUS[0]}

        if [ "$PUSH_EXIT" -eq 0 ]; then
          echo "   ✓ Staged to pending — NOT public until approved." >> "$LOG_FILE"

          # ── Send review email to Jake's phone ──────────────────────────────
          echo "   📱 Sending review notification..." >> "$LOG_FILE"
          "$NODE" "$PROJECT_DIR/scripts/notify-review.js" 2>&1 | tee -a "$LOG_FILE"

          osascript -e "display notification \"${ISSUE} staged — review email sent. Tap approve to publish + send.\" with title \"GuyTalk Brief ✓\" subtitle \"Not public until you approve\""

        else
          echo "   ✗ Git push failed" >> "$LOG_FILE"
          osascript -e "display notification \"${ISSUE} generated but push failed — check logs\" with title \"GuyTalk Brief ⚠\" subtitle \"Git push error\""
        fi
      else
        echo "   ✗ Git commit failed (nothing to commit?)" >> "$LOG_FILE"
        osascript -e "display notification \"${ISSUE} generated, nothing to commit\" with title \"GuyTalk Brief ✓\" subtitle \"Already up to date\""
      fi
    fi
  fi

# ── On failure: notify with log location ─────────────────────────────────────
else
  osascript -e "display notification \"Generator failed — check logs/brief-$(date +%Y-%m-%d).log\" with title \"GuyTalk Brief ✗\" subtitle \"Fix before publishing\""
  echo "" >> "$LOG_FILE"
  echo "   ✗ Generator exited with code $GEN_EXIT" >> "$LOG_FILE"
fi

echo "   Finished: $(date '+%I:%M %p')" >> "$LOG_FILE"
