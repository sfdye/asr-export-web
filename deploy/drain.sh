#!/usr/bin/env bash
# Drain hook: waits for in-flight export jobs to finish before the service
# stops. Wired as the systemd ExecStop (see deploy/asr-export.service), so
# `systemctl restart`, reboot and shutdown all drain instead of killing a
# running export. Run directly as: deploy/drain.sh [timeout-seconds]
#
# Exit 0: drained (or the app is already down — nothing to wait for).
# Exit 1: still active after the timeout; systemd then terminates the app,
# and the interrupted job is reported as failed on next boot.
set -uo pipefail

TIMEOUT=${1:-1800} # 30 min: a full export takes minutes, not hours
DEADLINE=$(( $(date +%s) + TIMEOUT ))

while :; do
  body=$(curl -fsS -m 5 http://localhost:3000/api/health 2>/dev/null) || exit 0
  active=$(printf '%s' "$body" | grep -o '"activeJobs":[0-9]*' | head -1 | grep -o '[0-9]*$')
  if [ "${active:-1}" = "0" ]; then
    [ -t 1 ] && echo "[drain] no active jobs"
    exit 0
  fi
  if [ "$(date +%s)" -ge "$DEADLINE" ]; then
    echo "[drain] ${active} active job(s) still running after ${TIMEOUT}s — giving up" >&2
    exit 1
  fi
  sleep 5
done
