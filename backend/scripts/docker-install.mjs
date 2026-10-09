#!/usr/bin/env node
/**
 * ZNode Docker 部署的首次初始化。
 *
 * 为什么要它：应用自带的网页安装向导会在运行时执行 `npx prisma db push`，
 * 而运行时镜像里【没有 Prisma CLI】（那是刻意的瘦身，省约 121M）。
 * 所以 Docker 部署的首次初始化统一走这里：
 *   1) 补齐应用需要的 .env（密钥、DATABASE_URL、站点地址），保留已有值
 *   2) 建好管理员账号（已存在则跳过）
 *
 * 用法（在 compose 里）：
 *   docker compose --profile init run --rm install
 * 管理员密码由本脚本随机生成并【打印到你的终端】；之后不再显示，请立即记录。
 * 也可以用 ADMIN_PASSWORD 环境变量自己指定。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const ENV_PATH = process.env.INSTALL_ENV_PATH || '/app/.env';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const SITE_URL = (process.env.SITE_URL || '').trim().replace(/\/$/, '');
const DATABASE_URL = process.env.DATABASE_URL || '';
const PROVIDED_PW = process.env.ADMIN_PASSWORD || '';

if (!DATABASE_URL) {
  console.error('✗ DATABASE_URL 未设置（compose 的 .env 里必须有它）');
  process.exit(1);
}

// ---------- 1) 补齐 /app/.env ----------
let env = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';

const setKey = (key, value) => {
  const re = new RegExp(`^${key}=.*$`, 'm');
  if (re.test(env)) env = env.replace(re, `${key}=${value}`);
  else env += (env === '' || env.endsWith('\n') ? '' : '\n') + `${key}=${value}\n`;
};

// 只在「缺失或为空」时才写，避免覆盖用户自己的配置
const ensureKey = (key, gen) => {
  const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!m || !m[1].trim()) {
    setKey(key, gen());
    console.log(`  已写入 ${key}`);
  } else {
    console.log(`  ${key} 已存在，保留`);
  }
};

console.log('== 1) 检查 /app/.env ==');
ensureKey('JWT_SECRET', () => crypto.randomBytes(64).toString('hex'));
ensureKey('SESSION_SECRET', () => crypto.randomBytes(32).toString('hex'));
ensureKey('NODE_ENV', () => 'production');
ensureKey('PORT', () => process.env.PORT || '3002');
ensureKey('DATABASE_URL', () => DATABASE_URL);
if (SITE_URL) {
  ensureKey('FRONTEND_URL', () => SITE_URL);
  ensureKey('API_URL', () => SITE_URL);
}
fs.writeFileSync(ENV_PATH, env, 'utf-8');
// 本脚本以 root 运行（要写挂载进来的文件），而应用在容器里以 node 用户运行：
// 权限必须给到 world-readable，否则应用读不到自己的配置，表现为
//   EACCES: permission denied, open '/app/.env'
// （此时登录等接口仍然能用——连接串在环境变量里——但「已安装」判定和 SPA 取数据会失败。）
try {
  fs.chmodSync(ENV_PATH, 0o644);
  const st = fs.statSync(ENV_PATH);
  console.log(`  ${ENV_PATH} 已写入（${st.size} 字节，权限 644）`);
} catch (e) {
  console.log(`  ${ENV_PATH} 已写入（${e.message}）`);
}

// ---------- 2) 建管理员 ----------
console.log('== 2) 检查管理员账号 ==');
const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

try {
  const existing = await prisma.user.findFirst({ where: { role: 'ADMIN' } });
  if (existing) {
    console.log(`  已存在管理员 ${existing.email}，跳过创建`);
  } else {
    const generated = !PROVIDED_PW;
    const pw = PROVIDED_PW || crypto.randomBytes(9).toString('base64url');
    await prisma.user.create({
      data: {
        email: ADMIN_EMAIL,
        password: await bcrypt.hash(pw, 12),
        name: 'Admin',
        role: 'ADMIN',
        emailVerified: new Date(),
      },
    });
    console.log('');
    console.log('  ✅ 管理员已创建');
    console.log('     邮箱：' + ADMIN_EMAIL);
    if (generated) {
      console.log('     密码：' + pw);
      console.log('');
      console.log('  ⚠️  这串密码只在这里显示一次，请立刻记录到你的密码管理器。');
      console.log('     之后要重置，可用应用里的「忘记密码」，或删掉该账号后重跑本脚本。');
    } else {
      console.log('     密码：使用你通过 ADMIN_PASSWORD 指定的值（本脚本不回显）');
    }
    console.log('');
  }
} catch (e) {
  console.error('✗ 创建管理员失败：' + e.message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
