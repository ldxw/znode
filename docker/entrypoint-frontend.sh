#!/bin/ash

# ----------------------------
# 运行时替换前端占位符 API_URL
# ----------------------------
if [ -n "$API_URL" ]; then
  echo "🔧 替换前端 API 地址为: $API_URL"
  # 遍历所有 JS 文件替换占位符 __API_URL__
  find /usr/share/nginx/html/assets -type f -name '*.js' -exec sed -i "s|__API_URL__|$API_URL|g" {} \;
else
  echo "⚠️ 未设置 API_URL，前端将使用占位符或默认值"
fi

# ----------------------------
# 启动 Nginx
# ----------------------------
nginx -g "daemon off;"
