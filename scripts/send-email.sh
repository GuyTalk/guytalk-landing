#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# GuyTalk Email Sender — launchd runner (10am daily)
# Sends the latest brief to all active Beehiiv subscribers via Gmail.
# Logs go to: logs/brief-YYYY-MM-DD.log
# ─────────────────────────────────────────────────────────────────────────────

PROJECT_DIR="/Users/jakewilliams/Projects/GuyTalk"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/brief-$(date +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

{
  echo ""
  echo "────────────────────────────────────────────"
  echo "  GuyTalk Email — $(date '+%I:%M %p')"
  echo "────────────────────────────────────────────"
} >> "$LOG_FILE"

# ── Locate node ───────────────────────────────────────────────────────────────
find_node() {
  [ -x "/opt/homebrew/bin/node" ]  && echo "/opt/homebrew/bin/node" && return
  [ -x "/usr/local/bin/node" ]     && echo "/usr/local/bin/node"    && return
  NVM_DIR="$HOME/.nvm"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    . "$NVM_DIR/nvm.sh" --no-use
    DEFAULT=$(cat "$NVM_DIR/alias/default" 2>/dev/null)
    CANDIDATE="$NVM_DIR/versions/node/$DEFAULT/bin/node"
    [ -x "$CANDIDATE" ] && echo "$CANDIDATE" && return
  fi
  command -v node 2>/dev/null
}

NODE=$(find_node)

if [ -z "$NODE" ]; then
  MSG="node not found — email not sent"
  echo "❌ $MSG" >> "$LOG_FILE"
  osascript -e "display notification \"$MSG\" with title \"GuyTalk Email ✗\""
  exit 1
fi

echo "   node: $NODE" >> "$LOG_FILE"

# ── Send email ────────────────────────────────────────────────────────────────
cd "$PROJECT_DIR" || exit 1

"$NODE" "$PROJECT_DIR/scripts/send-brief.js" 2>&1 | tee -a "$LOG_FILE"
EMAIL_EXIT=${PIPESTATUS[0]}

if [ "$EMAIL_EXIT" -eq 0 ]; then
  osascript -e "display notification \"Email sent to subscribers\" with title \"GuyTalk Email ✓\" subtitle \"10am send complete\""
else
  osascript -e "display notification \"Email failed — check logs/brief-$(date +%Y-%m-%d).log\" with title \"GuyTalk Email ✗\" subtitle \"Check GMAIL_APP_PASSWORD\""
fi

echo "   Finished: $(date '+%I:%M %p')" >> "$LOG_FILE"
