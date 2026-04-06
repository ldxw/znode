#!/usr/bin/env bash
# wait-for-it.sh
set -e
TIMEOUT=30
QUIET=0

usage() {
  echo "Usage: $0 host:port [-t timeout] [-- command args]"
  exit 1
}

wait_for() {
  local host="$1"
  local port="$2"
  local timeout="$3"
  local start_ts=$(date +%s)
  while ! nc -z "$host" "$port" >/dev/null 2>&1; do
    sleep 1
    local now_ts=$(date +%s)
    local elapsed=$((now_ts - start_ts))
    if [ "$elapsed" -ge "$timeout" ]; then
      echo "Timeout reached waiting for $host:$port"
      return 1
    fi
    if [ "$QUIET" -eq 0 ]; then
      echo "Waiting for $host:$port..."
    fi
  done
}

HOST_PORT="$1"
shift
if [[ "$HOST_PORT" =~ : ]]; then
  HOST="${HOST_PORT%%:*}"
  PORT="${HOST_PORT##*:}"
else
  echo "Error: host:port must be provided"
  usage
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t)
      TIMEOUT="$2"
      shift 2
      ;;
    -q)
      QUIET=1
      shift
      ;;
    --)
      shift
      break
      ;;
    *)
      break
      ;;
  esac
done

wait_for "$HOST" "$PORT" "$TIMEOUT"

if [ $# -gt 0 ]; then
  exec "$@"
fi
