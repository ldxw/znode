# ZNode

基于 React + Node.js 的现代化免费主机管理面板，对接 [MyOwnFreeHost (MOFH)](https://myownfreehost.net) API，实现主机自动开通。

> [English](README.md) · **简体中文**

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vite-7-646CFF?style=flat-square&logo=vite" alt="Vite">
  <img src="https://img.shields.io/badge/Node.js-22-339933?style=flat-square&logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/Prisma-6-2D3748?style=flat-square&logo=prisma" alt="Prisma">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License">
</p>

## Docker 部署

预构建镜像由 `docker-build.yml` 工作流（手动触发）发布到 GHCR：

| 镜像 | 说明 |
| --- | --- |
| `ghcr.io/ldxw/znode-frontend` | nginx，托管构建好的前端 SPA（默认同域反代到 API） |
| `ghcr.io/ldxw/znode-backend` | 后端 API（镜像内**不含 Prisma CLI**，原因见下） |
| `ghcr.io/ldxw/znode-backend-migrate` | 一次性镜像，只负责跑 `prisma db push` |

```shell
cd docker
cp .env.example .env    # 填 MYSQL_*、SITE_URL、FRONTEND_URL、TZ、DATABASE_URL ...（文件内有逐项注释）
mkdir -p data/mysql     # MySQL 的 bind mount 指向这里，up 之前目录必须先存在
docker compose pull
docker compose up -d

# 仅首次部署，按顺序执行：
#   1) 建表 / 更新表结构
docker compose --profile migrate run --rm migrate
#   2) 写入容器内的 /app/.env，并创建管理员账号
docker compose --profile init run --rm install
#   3) 重启后端，让它读到刚写好的 .env
docker compose up -d --force-recreate backend
```

第 2 步会打印管理员密码，**只显示一次**，请立刻保存。想自己指定密码，就在 `.env` 里设置
`ADMIN_PASSWORD`（设了之后第 2 步就不会再打印）。

完成后打开站点，用管理员账号登录即可。

### 为什么需要 `init` 这一步

后端镜像**不带 Prisma CLI**（这是镜像能小约 121 MB 的原因），所以应用自带的网页安装向导
（内部会调 `npx prisma db push`）在容器里跑不起来。一次性 `init` 服务就是来干这件事的：它会写好
容器内的 `/app/.env`（JWT/session 密钥、数据库地址、站点地址），并创建管理员账号。

有两个坑，都是在真机部署时踩出来的：

- 应用判断自己是否「已安装」，看的是**容器内的 `/app/.env` 文件**，不是环境变量 —— 所以
  `docker/.env` 要 bind mount 到 `/app/.env`。文件不在，它就会一直弹安装向导。
- 用 `sed -i` 改 `docker/.env` 会**替换文件的 inode**，而 bind mount 挂的还是旧的那个
  inode，容器读到的永远是旧内容。改完 `.env` 请重建后端：
  `docker compose up -d --force-recreate backend`。

### 更新表结构

升级到 Prisma schema 有变化的版本后，先跑一次一次性迁移服务（**要在启动新后端之前**）：

```shell
cd docker
docker compose --profile migrate run --rm migrate
```

不跑的话表是缺的，API 会直接报数据库错误。

## 本 fork 增加了什么

本仓库是 [bixacloud/znode](https://github.com/bixacloud/znode) 的 fork，在上游功能之外额外提供：

- **多 MOFH 分销账号** —— 可同时配置多个 MOFH 分销商账号，每个账号各自有默认套餐、cPanel 面板地址、
  域名服务器和备注。老的单账号配置会自动迁移成「默认账号」，原有凭据不用重填。
- **建站套餐** —— 自建套餐目录（规格、特性、库存上限、推荐标记、排序），每个套餐绑定到
  「某个分销账号下的某个 MOFH 套餐」。用户建站时选套餐，套餐可按分销账号分组展示。
- **前台自选账号** —— 配置了多个分销账号时，由用户自己选主机建在哪家，而不是交给分配策略决定。
- **用户等级** —— 分层用户等级，可以指定每个等级能用哪些建站套餐和哪些分销账号；用户用激活码升级。
- **激活码与邀请码** —— 同一张表、两种用途：*升级码*（把用户升到某个等级）与 *邀请码*
  （注册时必须持有，可同时指定注册后的初始等级）。都支持限次数、设有效期，并记录每张码的使用明细。
- **注册开关** —— 可以完全关闭注册，和/或要求注册必须持有邀请码。
- **全站 Cloudflare Turnstile** —— 登录、注册、邮箱验证、创建托管、托管设置、申请 SSL、创建工单、
  回复工单，均在**服务端**强制校验；每一项都能单独开关。
- **完整中文语言包**，且四个语言包始终保持键集合一致 —— 用 `npm run check:locales` 校验。

详细变更见 [CHANGELOG.md](CHANGELOG.md)，英文文档见 [README.md](README.md)。

## 功能

**用户端**

- 🌐 免费主机账号，支持自有域名或子域名
- 🔒 免费 SSL 证书（Let's Encrypt 与 Google Trust）
- 📊 实时统计仪表板
- 🎫 工单系统
- 📚 知识库
- 🔐 两步验证（TOTP）
- 🎚️ 用户等级，可用激活码解锁
- 📋 建站套餐选择（含指定由哪个分销账号提供）
- 🌍 多语言（English、Tiếng Việt、中文、Filipino）

**管理端**

- 👥 用户与主机管理
- 📧 邮件系统（SMTP、模板、日志）
- 💾 备份与恢复（本地、FTP、SFTP、Google Drive）
- 🎨 落地页编辑器（GrapesJS）
- 📦 从 Bixa（PHP）导入数据
- 🏢 多个 MOFH 分销账号，支持账号级覆盖配置
- 📦 建站套餐目录（规格、特性、库存、推荐、排序）
- 🎚️ 用户等级、激活码与邀请码
- 🚪 注册开关（关闭注册 / 需要邀请码）
- 🛡️ 按服务开关的 Cloudflare Turnstile
- ⚙️ OAuth、SSL、域名与站点设置

**开发者工具** —— CDN 查询、代码美化、Base64、颜色工具、CSS Grid 生成器

## 环境要求

- **VPS**，Ubuntu 22+ 或 Debian 12+
- **CloudPanel 2.x**（负责管理 Nginx、SSL、Node.js）
- **MySQL/MariaDB** 8.0+
- **Node.js** 22+（由 CloudPanel 自动安装）

## 安装

### 快速开始（推荐）

**1. 在 CloudPanel 上创建一个 Node.js 站点**

- Add Site → Node.js → 填入你的域名
- 在 Databases 里加一个 MySQL 数据库

**2. 运行安装脚本**

```bash
cd ~/htdocs/yourdomain.com
bash <(curl -fsSL https://raw.githubusercontent.com/bixacloud/znode/main/install.sh)
```

脚本会自动：

- 询问你偏好的语言
- 从 GitHub 下载最新 release
- 查找可用端口（3002–3100）
- 安装依赖并构建前后端
- 配置 PM2 并启动服务

**3. 在 CloudPanel 上更新端口**

把站点的端口改成安装脚本提示的那个。

**4. 在浏览器里完成初始化**

打开 `https://yourdomain.com`，安装向导会引导你完成：

- 数据库连接
- 管理员账号创建
- 站点名称与设置

### 手动安装

<details>
<summary>点开查看</summary>

```bash
cd ~/htdocs/yourdomain.com

# 下载最新 release
curl -fsSL https://api.github.com/repos/bixacloud/znode/releases/latest \
  | grep "browser_download_url.*tar.gz" | cut -d '"' -f 4 \
  | xargs curl -fsSL -o /tmp/znode.tar.gz
tar xzf /tmp/znode.tar.gz -C .

# 前端
npm install
VITE_API_URL=https://yourdomain.com npx vite build

# 后端
cd backend
npm install
cat > .env <<EOF
PORT=3002
NODE_ENV=production
FRONTEND_URL="https://yourdomain.com"
API_URL="https://yourdomain.com"
EOF
npx prisma generate
npx tsc

# 启动
pm2 start ecosystem.config.cjs
pm2 save
```

打开 `https://yourdomain.com` 完成初始化。

</details>

## 技术栈

| 层 | 技术 |
|-------|-------------|
| 前端 | React 19、TypeScript、Vite 7、Tailwind CSS 4、shadcn/ui |
| 后端 | Node.js 22、Express 4、Prisma 6、MySQL |
| 认证 | JWT、Passport（Google、GitHub、Discord、Facebook、Microsoft） |
| 基础设施 | PM2、Nginx（CloudPanel）、Let's Encrypt |

## 目录结构

```
znode/
├── src/                    # 前端（React）
│   ├── components/         # UI 组件
│   ├── contexts/           # Auth、Language、Site 上下文
│   ├── i18n/locales/       # 翻译文件
│   ├── pages/              # 页面 + 后台页面
│   └── services/           # API 客户端
├── backend/                # 后端（Express）
│   ├── src/routes/         # API 路由
│   ├── src/lib/            # 工具（邮件、SSL、备份、MOFH、等级）
│   ├── src/strategies/     # OAuth 策略
│   └── prisma/schema.prisma
├── docker/                 # Docker Compose 部署
├── install.sh              # 自动安装脚本
└── public/                 # 静态资源
```

## 常用命令

```bash
pm2 restart znode-backend                                   # 重启
pm2 logs znode-backend                                      # 看日志
VITE_API_URL=https://yourdomain.com npx vite build          # 重新构建前端
cd backend && npx tsc && pm2 restart znode-backend          # 重新构建后端
cd backend && npx prisma db push                            # 更新数据库表结构
```

## 环境变量

安装向导会自动生成 `.env`。主要变量：

| 变量 | 说明 |
|----------|-------------|
| `PORT` | 后端监听端口 |
| `DATABASE_URL` | MySQL 连接串 |
| `JWT_SECRET` | JWT 签名密钥（自动生成） |
| `SESSION_SECRET` | Session 密钥（自动生成） |
| `FRONTEND_URL` | 你的域名地址 |
| `API_URL` | API 基础地址（与前端相同） |

## 维护

```bash
npm run check:locales          # 校验 en/zh/vi/fil 四个语言包键集合是否完全一致
cd backend && npx prisma generate   # 改过 schema 之后重新生成 Prisma Client
```

改过 schema 之后，在运行中的部署上要跑一次性迁移服务来应用（见上文「更新表结构」）。

## License

GPL V3
