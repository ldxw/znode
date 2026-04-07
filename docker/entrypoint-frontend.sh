#!/bin/sh
if [ -n "$API_URL" ]; then
  echo "替换前端 API 地址为: $API_URL"
  find /usr/share/nginx/html/assets -type f -name "*.js" \
       -exec sed -i "s|http://localhost:3002|$API_URL|g" {} \;
fi

# 启动 Nginx
nginx -g "daemon off;"
