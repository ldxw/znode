#!/usr/bin/env node
/**
 * 语言包完整性校验
 *
 * 规则：所有语言包（en/zh/vi/fil）的键集合必须完全一致。
 * 新增文案后请运行：npm run check:locales
 *
 * 为什么要有这个：页面用 `t.段?.键 || "英文兜底"` 的写法，缺键时静默落到 JSX 里的
 * 兜底字符串 —— 不报错、不显示 key、控制台也没警告，很容易漏翻而没人发现。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCALES_DIR = path.resolve(__dirname, '../src/i18n/locales');

/** 展平成 leaf 键（只比较叶子，对象中间层不算） */
function leafKeys(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      leafKeys(v, p, out);
    } else {
      out[p] = v;
    }
  }
  return out;
}

const files = fs.readdirSync(LOCALES_DIR).filter((f) => f.endsWith('.json'));
if (files.length === 0) {
  console.error(`未在 ${LOCALES_DIR} 找到任何语言包`);
  process.exit(1);
}

const packs = {};
for (const f of files) {
  const name = f.replace(/\.json$/, '');
  packs[name] = leafKeys(JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, f), 'utf-8')));
}

const allKeys = new Set();
for (const keys of Object.values(packs)) {
  for (const k of Object.keys(keys)) allKeys.add(k);
}

let failed = false;
const names = Object.keys(packs).sort();

console.log(`语言包: ${names.join(', ')}  |  基准键数: ${allKeys.size}\n`);

for (const name of names) {
  const own = new Set(Object.keys(packs[name]));
  const missing = [...allKeys].filter((k) => !own.has(k));
  const status = missing.length === 0 ? 'OK' : `缺 ${missing.length}`;
  console.log(`  ${name.padEnd(6)} ${String(own.size).padStart(5)} 键   ${status}`);
  if (missing.length > 0) {
    failed = true;
    for (const k of missing.slice(0, 20)) console.log(`      - ${k}`);
    if (missing.length > 20) console.log(`      ... 另有 ${missing.length - 20} 个`);
  }
}

if (failed) {
  console.error('\n语言包不一致：请把上面的键补进对应语言包后重试。');
  process.exit(1);
}

console.log('\n所有语言包键集合一致。');
