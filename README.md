# ZNode

A modern free hosting management panel built with React + Node.js. Integrates with [MyOwnFreeHost (MOFH)](https://myownfreehost.net) API for automated hosting provisioning.

> **English** · [简体中文](README.zh.md)

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react" alt="React 19">
  <img src="https://img.shields.io/badge/TypeScript-5.6-3178C6?style=flat-square&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/Vite-7-646CFF?style=flat-square&logo=vite" alt="Vite">
  <img src="https://img.shields.io/badge/Node.js-22-339933?style=flat-square&logo=node.js" alt="Node.js">
  <img src="https://img.shields.io/badge/Prisma-6-2D3748?style=flat-square&logo=prisma" alt="Prisma">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License">
</p>

## Docker deployment

Prebuilt images are published to GHCR by the `docker-build.yml` workflow (manual trigger):

| Image | What it is |
| --- | --- |
| `ghcr.io/ldxw/znode-frontend` | nginx serving the built SPA (same-domain reverse proxy to the API by default) |
| `ghcr.io/ldxw/znode-backend` | the API (no Prisma CLI inside — see below) |
| `ghcr.io/ldxw/znode-backend-migrate` | one-shot image that only runs `prisma db push` |

```shell
cd docker
cp .env.example .env    # fill in MYSQL_*, SITE_URL, FRONTEND_URL, TZ, DATABASE_URL ... (comments explain each)
mkdir -p data/mysql     # the MySQL bind mount points here; the directory must exist before `up`
docker compose pull
docker compose up -d

# First run only — in this order:
#   1) create/update the database tables
docker compose --profile migrate run --rm migrate
#   2) write the container's /app/.env and create the admin account
docker compose --profile init run --rm install
#   3) restart the backend so it picks up the freshly written .env
docker compose up -d --force-recreate backend
```

The admin password is printed by step 2 and shown **only once** — save it right away. To pick it
yourself, set `ADMIN_PASSWORD` in `.env` instead (then step 2 will not echo it).

After that, open your site, log in with the admin account, and you are done.

### Why the `init` step exists

The backend image ships **without the Prisma CLI** (that is what makes it ~121 MB smaller), so the
application's own web installer — which shells out to `npx prisma db push` — cannot run inside it.
The one-shot `init` service does that work instead: it fills in the container's `/app/.env`
(JWT/session secrets, database URL, site URL) and creates the admin account.

Two things that trip people up, both learned the hard way on a real deployment:

- The app decides whether it is *installed* by reading **`/app/.env` inside the container**, not the
  environment variables — that is why `docker/.env` is bind-mounted to `/app/.env`. If it is missing,
  the app shows its setup wizard even though everything else is configured.
- Editing `docker/.env` with `sed -i` **replaces the file's inode**, and a bind-mounted file keeps
  pointing at the old one. The container therefore keeps reading stale content; recreate the backend
  (`docker compose up -d --force-recreate backend`) after editing.

### Applying schema changes

After upgrading to a version whose Prisma schema changed, run the one-shot migration service once
(do this **before** starting the new backend):

```shell
cd docker
docker compose --profile migrate run --rm migrate
```

If you skip it, the tables will be missing and the API will report database errors.

## What this fork adds

This repository is a fork of [bixacloud/znode](https://github.com/bixacloud/znode). On top of the
upstream feature set it adds:

- **Multi-reseller MOFH support** — configure several MOFH reseller accounts side by side, each with
  its own default package, cPanel URL, nameservers and note. Old single-account configs are migrated
  to a "default account" automatically, so existing credentials keep working.
- **Hosting plans** — build your own plan catalogue (specs, features, stock limit, featured flag,
  ordering) and bind each plan to a MOFH package on a specific reseller account. Users pick a plan
  when they sign up; plans can be grouped by reseller account.
- **Front-end account selection** — when more than one reseller account is configured the user picks
  which one their hosting is created under, instead of leaving it to the assignment strategy.
- **User levels** — tiered user levels; each level can be granted hosting plans and reseller
  accounts. Users upgrade by redeeming a code.
- **Activation codes and invite codes** — one code table, two purposes: *activation* (upgrade a
  user's level) and *invitation* (required to sign up, optionally granting a starting level).
  Both support stock limits, expiry dates and a per-code usage log.
- **Registration controls** — close sign-ups entirely, and/or require an invitation code.
- **Cloudflare Turnstile everywhere** — captcha is enforced server-side for login, registration,
  email verification, creating hosting, hosting settings, SSL requests, opening and replying to
  tickets; each service has its own toggle.
- **Full Chinese translations** plus all four locale files kept in sync — run `npm run check:locales`
  to verify.

See [CHANGELOG.md](CHANGELOG.md) for the details, and [README.zh.md](README.zh.md) for the Chinese
version of this document.

## Features

**For Users**
- 🌐 Free hosting accounts with custom or subdomain
- 🔒 Free SSL certificates (Let's Encrypt & Google Trust)
- 📊 Dashboard with real-time stats
- 🎫 Support ticket system
- 📚 Knowledge base
- 🔐 Two-factor authentication (TOTP)
- 🎚️ User levels, unlocked with an activation code
- 📋 Hosting plans to pick from — including which reseller account serves them
- 🌍 Multilingual (English, Tiếng Việt, 中文, Filipino)

**For Admins**
- 👥 User & hosting management
- 📧 Email system (SMTP, templates, logs)
- 💾 Backup & restore (local, FTP, SFTP, Google Drive)
- 🎨 Landing page builder (GrapesJS)
- 📦 Data import from Bixa (PHP)
- 🏢 Multiple MOFH reseller accounts, with per-account overrides
- 📦 Hosting plan catalogue (specs, features, stock, featured, ordering)
- 🎚️ User levels, activation codes and invite codes
- 🚪 Registration switches (close sign-ups / require an invite code)
- 🛡️ Cloudflare Turnstile toggles per service
- ⚙️ OAuth, SSL, domain, and site settings

**Developer Tools** — CDN search, code beautifier, Base64, color tools, CSS grid generator

## Requirements

- **VPS** with Ubuntu 22+ or Debian 12+
- **CloudPanel 2.x** (manages Nginx, SSL, Node.js)
- **MySQL/MariaDB** 8.0+
- **Node.js** 22+ (auto-installed by CloudPanel)

## Installation

### Quick Start (Recommended)

**1. Create a Node.js site on CloudPanel**

- Add Site → Node.js → enter your domain
- Add a MySQL database under Databases

**2. Run the installer**

```bash
cd ~/htdocs/yourdomain.com
bash <(curl -fsSL https://raw.githubusercontent.com/bixacloud/znode/main/install.sh)
```

The script will:
- Ask your preferred language
- Download the latest release from GitHub
- Find an available port (3002–3100)
- Install dependencies & build frontend + backend
- Configure PM2 and start the server

**3. Update the port on CloudPanel**

Set the site's port to match the one shown by the installer.

**4. Complete setup in your browser**

Open `https://yourdomain.com` — the setup wizard will guide you through:
- Database connection
- Admin account creation
- Site name & settings

### Manual Installation

<details>
<summary>Click to expand</summary>

```bash
cd ~/htdocs/yourdomain.com

# Download latest release
curl -fsSL https://api.github.com/repos/bixacloud/znode/releases/latest \
  | grep "browser_download_url.*tar.gz" | cut -d '"' -f 4 \
  | xargs curl -fsSL -o /tmp/znode.tar.gz
tar xzf /tmp/znode.tar.gz -C .

# Frontend
npm install
VITE_API_URL=https://yourdomain.com npx vite build

# Backend
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

# Start
pm2 start ecosystem.config.cjs
pm2 save
```

Open `https://yourdomain.com` to complete setup.

</details>

## Tech Stack

| Layer | Technologies |
|-------|-------------|
| Frontend | React 19, TypeScript, Vite 7, Tailwind CSS 4, shadcn/ui |
| Backend | Node.js 22, Express 4, Prisma 6, MySQL |
| Auth | JWT, Passport (Google, GitHub, Discord, Facebook, Microsoft) |
| Infra | PM2, Nginx (CloudPanel), Let's Encrypt |

## Project Structure

```
znode/
├── src/                    # Frontend (React)
│   ├── components/         # UI components
│   ├── contexts/           # Auth, Language, Site contexts
│   ├── i18n/locales/       # Translation files
│   ├── pages/              # Pages + admin pages
│   └── services/           # API client
├── backend/                # Backend (Express)
│   ├── src/routes/         # API routes
│   ├── src/lib/            # Utilities (email, SSL, backup)
│   ├── src/strategies/     # OAuth strategies
│   └── prisma/schema.prisma
├── install.sh              # Automated installer
└── public/                 # Static assets
```

## Commands

```bash
pm2 restart znode-backend                                   # Restart
pm2 logs znode-backend                                      # View logs
VITE_API_URL=https://yourdomain.com npx vite build          # Rebuild frontend
cd backend && npx tsc && pm2 restart znode-backend          # Rebuild backend
cd backend && npx prisma db push                            # Update DB schema
```

## Environment Variables

The setup wizard creates `.env` automatically. Key variables:

| Variable | Description |
|----------|-------------|
| `PORT` | Backend server port |
| `DATABASE_URL` | MySQL connection string |
| `JWT_SECRET` | JWT signing key (auto-generated) |
| `SESSION_SECRET` | Session key (auto-generated) |
| `FRONTEND_URL` | Your domain URL |
| `API_URL` | API base URL (same as frontend) |

## Maintenance

```bash
npm run check:locales          # verify en/zh/vi/fil keep exactly the same key set
cd backend && npx prisma generate   # regenerate the Prisma client after editing the schema
```

After a schema change, apply it on a running deployment with the one-shot migration service
(see *Applying schema changes* above).



## License

GPL V3
