#!/usr/bin/env bash
# autocompact.sh — manage auto-compaction settings in the ACTIVE account's
# settings.json ($CLAUDE_CONFIG_DIR, falling back to ~/.claude). State is
# per-account, so each config directory keeps its own values.
#
# Usage:
#   autocompact.sh                      show current values (same as `status`)
#   autocompact.sh status               show current values
#   autocompact.sh <tokens>             set autoCompactWindow: 400000 | 400k | 0.5m | 1m
#   autocompact.sh <pct>% --window <N>  set autoCompactWindow to pct of an N-token window
#   autocompact.sh on | off             enable / disable auto-compaction
#
# autoCompactWindow is an integer clamped to [100000, 1000000]. It does NOT
# hot-reload — changes take effect in new sessions.
set -euo pipefail

CFG_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SETTINGS="$CFG_DIR/settings.json"
MIN=100000
MAX=1000000

command -v jq >/dev/null 2>&1 || { echo "autocompact: jq is required" >&2; exit 1; }

if [ ! -f "$SETTINGS" ]; then
  mkdir -p "$CFG_DIR"
  printf '{}\n' > "$SETTINGS"
fi

write_json() { # <jq-filter>
  local tmp
  tmp="$(mktemp "$CFG_DIR/.autocompact.XXXXXX")"  # same filesystem as settings.json, so mv is atomic
  if jq --indent 2 "$1" "$SETTINGS" > "$tmp"; then
    mv "$tmp" "$SETTINGS"
  else
    rm -f "$tmp"
    echo "autocompact: failed to update $SETTINGS" >&2
    exit 1
  fi
}

show_status() {
  local w e
  w="$(jq -r '.autoCompactWindow // "unset"' "$SETTINGS")"
  e="$(jq -r 'if has("autoCompactEnabled") then (.autoCompactEnabled|tostring) else "default(on)" end' "$SETTINGS")"
  echo "autoCompactWindow:  $w"
  echo "autoCompactEnabled: $e"
  echo "(account: $SETTINGS — applies to new sessions)"
}

# token spec (400000 | 400k | 1m | 0.5m | 400_000) -> integer, or "ERR"
parse_tokens() {
  local s; s="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -d '_, ')"
  case "$s" in
    *k)        s="${s%k}"; case "$s" in ''|*[!0-9.]*) echo ERR; return;; esac; awk -v n="$s" 'BEGIN{printf "%d", n*1000}';;
    *m)        s="${s%m}"; case "$s" in ''|*[!0-9.]*) echo ERR; return;; esac; awk -v n="$s" 'BEGIN{printf "%d", n*1000000}';;
    ''|*[!0-9.]*) echo ERR;;
    *)         awk -v n="$s" 'BEGIN{printf "%d", n}';;
  esac
}

[ $# -ge 1 ] || { show_status; exit 0; }

cmd="$1"; shift || true
case "$cmd" in
  status) show_status; exit 0;;
  on)  write_json '.autoCompactEnabled = true';  echo "auto-compaction → ENABLED";  show_status; exit 0;;
  off) write_json '.autoCompactEnabled = false'; echo "auto-compaction → DISABLED"; show_status; exit 0;;
esac

# remaining: a value (tokens or percentage), with an optional --window for %
val="$cmd"
window=""
while [ $# -ge 1 ]; do
  case "$1" in
    --window) window="${2:-}"; shift; [ $# -ge 1 ] && shift || true;;
    *) shift;;
  esac
done

case "$val" in
  *%)
    pct="${val%\%}"
    case "$pct" in ''|*[!0-9.]*) echo "autocompact: bad percentage '$val'" >&2; exit 2;; esac
    [ -n "$window" ] || window="${CLAUDE_CONTEXT_WINDOW:-}"
    if [ -z "$window" ]; then
      echo "autocompact: a percentage needs the active context-window size." >&2
      echo "  Re-run as: autocompact.sh ${val} --window <tokens>   (e.g. --window 1000000)" >&2
      exit 2
    fi
    win="$(parse_tokens "$window")"
    [ "$win" = "ERR" ] && { echo "autocompact: bad --window '$window'" >&2; exit 2; }
    tokens="$(awk -v p="$pct" -v w="$win" 'BEGIN{printf "%d", (p*w)/100}')"
    ;;
  *)
    tokens="$(parse_tokens "$val")"
    ;;
esac

case "$tokens" in ''|ERR|*[!0-9]*) echo "autocompact: could not parse '$val'" >&2; exit 2;; esac

note=""
if [ "$tokens" -lt "$MIN" ]; then tokens=$MIN; note=" (clamped up to min $MIN)"; fi
if [ "$tokens" -gt "$MAX" ]; then tokens=$MAX; note=" (clamped down to max $MAX)"; fi

write_json ".autoCompactWindow = $tokens"
echo "autoCompactWindow → $tokens$note"
show_status
