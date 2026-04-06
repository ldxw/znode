#!/usr/bin/env bash
# 用于等待服务端口可用
set -e

TIMEOUT=30
HOST_PORT="$1"
shift
HOST="${HOST_PORT%%:*}"
PORT="${HOST_PORT##*:}"

while ! nc -z "$HOST" "$PORT" >/dev/null 2>&1; do
  echo "等待 $HOST:$PORT 可用..."
  sleep 1
done

# 执行后续命令
exec "$@"
