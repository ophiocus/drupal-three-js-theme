#!/bin/bash
# ddev-watchdog.sh — passive observer that catches DDEV stopping
# "without reason." Polls project state every $POLL_INTERVAL_S
# seconds, writes a heartbeat line every $HEARTBEAT_EVERY ticks,
# and on any transition out of `running` dumps rich diagnostics
# (docker state, container statuses, memory, dmesg, last container
# logs) to .local/ddev-watchdog.log so the post-mortem evidence
# is already on disk when we come back to investigate.
#
# Does NOT auto-restart DDEV — auto-restart would mask the cause
# we're trying to identify. To inspect the log:
#   tail -F .local/ddev-watchdog.log
#
# To stop the watchdog:
#   pkill -f ddev-watchdog.sh
#
# Side effect worth knowing: an active script process keeps WSL2
# from auto-shutting-down its distro for being idle (one of the
# common silent causes of "ddev stopped overnight"). If running
# the watchdog itself makes the problem disappear, that IS the
# diagnosis — and the right fix is then a WSL2-keepalive in user
# config, not this script.

set -u

PROJECT_DIR="${PROJECT_DIR:-/home/csant/tecnocratica/projects/drupal-three-js-theme}"
LOG_DIR="${PROJECT_DIR}/.local"
LOG="${LOG_DIR}/ddev-watchdog.log"
PID_FILE="${LOG_DIR}/ddev-watchdog.pid"

POLL_INTERVAL_S=${POLL_INTERVAL_S:-30}
# Heartbeat every N ticks (10 × 30s = once every 5 min by default).
HEARTBEAT_EVERY=${HEARTBEAT_EVERY:-10}

mkdir -p "$LOG_DIR"

# Single-instance lock — refuse to start if another watchdog is
# already polling for this project. Reading a stale PID file
# (process not actually alive) is treated as no-lock-held.
if [ -f "$PID_FILE" ]; then
  existing=$(cat "$PID_FILE" 2>/dev/null || true)
  if [ -n "$existing" ] && kill -0 "$existing" 2>/dev/null; then
    echo "watchdog already running as pid $existing; exiting." >&2
    exit 1
  fi
fi
echo $$ > "$PID_FILE"
trap 'rm -f "$PID_FILE"' EXIT

ts() { date -Iseconds; }

log() { printf '[%s] %s\n' "$(ts)" "$*" >> "$LOG"; }

dump_block() {
  local label="$1"
  shift
  printf '[%s] --- %s ---\n' "$(ts)" "$label" >> "$LOG"
  ( "$@" ) 2>&1 | sed 's/^/  /' >> "$LOG"
}

# Returns one of: running | stopped | unhealthy | unreachable.
# - running:    ddev describe reports status_desc=running
# - stopped:    project is known to ddev but containers are down
# - unhealthy:  status_desc reports something other than running/stopped
# - unreachable: ddev itself didn't respond (binary missing, WSL hiccup)
probe_state() {
  if ! command -v ddev >/dev/null 2>&1; then
    echo "unreachable"
    return
  fi
  local out
  out=$(cd "$PROJECT_DIR" && ddev describe -j 2>/dev/null) || {
    echo "unreachable"
    return
  }
  local status
  status=$(printf '%s' "$out" | jq -r '.raw.status_desc // "unknown"' 2>/dev/null) || status="unknown"
  case "$status" in
    running) echo "running" ;;
    stopped) echo "stopped" ;;
    "") echo "unknown" ;;
    *) echo "unhealthy:$status" ;;
  esac
}

snapshot_diagnostics() {
  local reason="$1"
  log "DIAGNOSTIC SNAPSHOT triggered by: $reason"
  dump_block "uname / uptime" uname -a
  dump_block "uptime" uptime
  dump_block "free -h" free -h
  dump_block "df -h /" df -h /
  dump_block "docker info (head)" bash -c 'docker info 2>&1 | head -30'
  dump_block "docker ps -a" docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.RunningFor}}\t{{.Image}}'
  dump_block "ddev describe -j (filtered)" bash -c "cd '$PROJECT_DIR' && ddev describe -j 2>&1 | jq '.raw | {status_desc, router_status, services: (.services // {} | to_entries | map({(.key): .value.status}) | add)}' 2>&1"
  dump_block "dmesg -T (tail 30)" bash -c 'dmesg -T 2>&1 | tail -30'
  dump_block "ddev logs web (tail 25)" bash -c "cd '$PROJECT_DIR' && ddev logs -s web 2>&1 | tail -25"
  dump_block "ddev logs db (tail 25)" bash -c "cd '$PROJECT_DIR' && ddev logs -s db 2>&1 | tail -25"
  dump_block "ddev logs restheart (tail 25)" bash -c "cd '$PROJECT_DIR' && ddev logs -s restheart 2>&1 | tail -25"
  log "END DIAGNOSTIC SNAPSHOT"
}

log "watchdog starting pid=$$ project=$PROJECT_DIR poll=${POLL_INTERVAL_S}s heartbeat-every=${HEARTBEAT_EVERY} ticks"
last_state=""
tick=0

while true; do
  state=$(probe_state)
  if [ "$state" != "$last_state" ]; then
    log "state transition: '${last_state:-<initial>}' -> '${state}'"
    # Snapshot whenever we LEAVE running, or arrive at unreachable.
    if [ -n "$last_state" ] && { [ "$state" != "running" ] || [ "$last_state" = "unreachable" ]; }; then
      snapshot_diagnostics "transition to $state"
    fi
    last_state="$state"
  fi
  tick=$((tick + 1))
  if [ $((tick % HEARTBEAT_EVERY)) -eq 0 ]; then
    log "heartbeat state=$state tick=$tick"
  fi
  sleep "$POLL_INTERVAL_S"
done
