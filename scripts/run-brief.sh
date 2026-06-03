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
      echo "     npm run brief:qa && git add -A && git commit -m 'fix ${ISSUE}' && git push" >> "$LOG_FILE"
      osascript -e "display notification \"${ISSUE}: QA issues found — fix before pushing\" with title \"GuyTalk Brief ⚠\" subtitle \"Review email NOT sent\""
    else
      echo "   ✓ QA passed" >> "$LOG_FILE"

      # ── Auto-update landing page brief-story links ──────────────────────────
      PREV_ISSUE=$(ls -d "$PROJECT_DIR/brief/issue-"??? 2>/dev/null | sort | tail -2 | head -1 | xargs basename 2>/dev/null)
      if [ -n "$PREV_ISSUE" ] && [ "$PREV_ISSUE" != "$ISSUE" ]; then
        sed -i '' "s|brief/${PREV_ISSUE}/|brief/${ISSUE}/|g" "$PROJECT_DIR/index.html" 2>/dev/null
        echo "   ✓ index.html updated: ${PREV_ISSUE} → ${ISSUE}" >> "$LOG_FILE"
      fi

      # ── Auto-publish: commit + push → Vercel deploys automatically ──────────
      echo "" >> "$LOG_FILE"
      echo "   📤 Publishing to website..." >> "$LOG_FILE"

      cd "$PROJECT_DIR" || exit 1

      git add brief/ assets/ briefs/ index.html 2>&1 | tee -a "$LOG_FILE"
      git commit -m "Brief: ${ISSUE} — $(date '+%B %d, %Y')" 2>&1 | tee -a "$LOG_FILE"
      GIT_EXIT=${PIPESTATUS[0]}

      if [ "$GIT_EXIT" -eq 0 ]; then
        git push origin main 2>&1 | tee -a "$LOG_FILE"
        PUSH_EXIT=${PIPESTATUS[0]}

        if [ "$PUSH_EXIT" -eq 0 ]; then
          echo "   ✓ Pushed — Vercel deploying..." >> "$LOG_FILE"

          # ── Send review email to Jake's phone ──────────────────────────────
          echo "   📱 Sending review notification..." >> "$LOG_FILE"
          "$NODE" "$PROJECT_DIR/scripts/notify-review.js" 2>&1 | tee -a "$LOG_FILE"

          osascript -e "display notification \"${ISSUE} live — review email sent to your phone\" with title \"GuyTalk Brief ✓\" subtitle \"Tap approve to send to subscribers\""

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
