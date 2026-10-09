#!/bin/ash

# ----------------------------
# 运行时替换前端占位符 API_URL
# ----------------------------
# 没设 API_URL 时替换成空串：前端请求走当前域名（同域反代），不会残留 __API_URL__
API_URL="${API_URL:-}"

if [ -n "$API_URL" ]; then
  echo "🔧 前端 API 地址: $API_URL"
else
  echo "ℹ️  未设置 API_URL，前端请求走当前域名（同域反代）"
fi

if [ -d /usr/share/nginx/html/assets ]; then
  grep -rl '__API_URL__' /usr/share/nginx/html/assets 2>/dev/null | while read -r f; do
    sed -i "s|__API_URL__|$API_URL|g" "$f"
  done
fi

# ----------------------------
# 启动 Nginx
# ----------------------------
nginx -g "daemon off;"
