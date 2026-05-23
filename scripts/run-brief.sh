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

# ── On success: open brief in browser and notify ──────────────────────────────
if [ "$GEN_EXIT" -eq 0 ]; then
  LATEST_DIR=$(ls -d "$PROJECT_DIR/brief/issue-"??? 2>/dev/null | sort | tail -1)

  if [ -n "$LATEST_DIR" ]; then
    ISSUE=$(basename "$LATEST_DIR")
    HTML="$LATEST_DIR/index.html"

    open "$HTML"

    osascript -e "display notification \"${ISSUE} draft ready — review before pushing\" with title \"GuyTalk Brief ✓\" subtitle \"Opened in browser\""
    echo "" >> "$LOG_FILE"
    echo "   ✓ Opened: $HTML" >> "$LOG_FILE"
  fi

# ── On failure: notify with log location ─────────────────────────────────────
else
  osascript -e "display notification \"Generator failed — check logs/brief-$(date +%Y-%m-%d).log\" with title \"GuyTalk Brief ✗\" subtitle \"Fix before publishing\""
  echo "" >> "$LOG_FILE"
  echo "   ✗ Generator exited with code $GEN_EXIT" >> "$LOG_FILE"
fi

echo "   Finished: $(date '+%I:%M %p')" >> "$LOG_FILE"
