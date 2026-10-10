/**
 * MOFH（MyOwnFreeHost）多账号支持层
 *
 * 背景：原来 mofh_config 里只有一套 apiUsername/apiPassword，全站共用。
 * 改成 accounts[] 数组后，可以配多套分销凭据，建站时按策略挑一个用。
 *
 * 向后兼容：老配置（没有 accounts 字段）会自动归一化成「一个账号」，
 * id 由 apiUsername 派生（稳定、可重现），所以升级后不用重填凭据。
 */

import crypto from 'crypto';
import prisma from './prisma.js';

export type MOFHStrategy = 'least-loaded' | 'round-robin';

export interface MOFHAccount {
  id: string;
  name: string;
  apiUsername: string;
  apiPassword: string;
  enabled: boolean;
  /** 该账号下的默认套餐（不同分销商的套餐列表是独立的，所以可以按账号覆盖） */
  defaultPackage?: string;
  /** 该账号对应的用户面板地址（不同分销商也不同） */
  cpanelUrl?: string;
  /** 该账号要求用户使用的域名服务器（不同分销商各有一套） */
  customNameservers?: string;
  /** 允许使用该账号的用户等级 id 列表（空/未设置 = 所有等级都能用） */
  allowedLevelIds?: string[];
  note?: string;
}

export interface MOFHConfigFile {
  enabled?: boolean;
  strategy?: MOFHStrategy;
  defaultPackage?: string;
  cpanelUrl?: string;
  customNameservers?: string;
  accounts?: MOFHAccount[];
  /** 旧字段，仅用于兼容老配置 */
  apiUsername?: string;
  apiPassword?: string;
}

export interface ResolvedMOFHConfig {
  enabled: boolean;
  strategy: MOFHStrategy;
  defaultPackage: string;
  cpanelUrl: string;
  customNameservers?: string;
  /** 凭据完整的账号（含未启用的） */
  accounts: MOFHAccount[];
  /** 凭据完整且 enabled 的账号 */
  enabledAccounts: MOFHAccount[];
}

export const MOFH_API_BASE = 'https://panel.myownfreehost.net';

/** 老配置没有 id 时，由 apiUsername 派生一个稳定 id */
export function deriveAccountId(apiUsername: string): string {
  return 'a' + crypto.createHash('sha1').update(apiUsername).digest('hex').slice(0, 12);
}

const PICKS: MOFHStrategy[] = ['least-loaded', 'round-robin'];

/** 把数据库里的原始 JSON 归一化成可用的配置结构 */
export function normalizeConfig(raw: MOFHConfigFile | null | undefined): ResolvedMOFHConfig {
  const src = raw || {};

  let accounts: MOFHAccount[] = Array.isArray(src.accounts) ? [...src.accounts] : [];

  // 向后兼容：没有 accounts 但有老的顶层凭据 → 合成一个账号
  if (accounts.length === 0 && src.apiUsername && src.apiPassword) {
    accounts = [{
      id: deriveAccountId(src.apiUsername),
      name: '默认账号',
      apiUsername: src.apiUsername,
      apiPassword: src.apiPassword,
      enabled: true,
    }];
  }

  // 清洗：补 id/name/enabled，丢掉凭据不全的条目
  accounts = accounts
    .filter((a) => a && a.apiUsername && a.apiPassword)
    .map((a) => ({
      id: a.id || deriveAccountId(a.apiUsername),
      name: a.name || a.apiUsername,
      apiUsername: a.apiUsername,
      apiPassword: a.apiPassword,
      enabled: a.enabled !== false,
      defaultPackage: a.defaultPackage || undefined,
      cpanelUrl: a.cpanelUrl || undefined,
      customNameservers: a.customNameservers || undefined,
      note: a.note || undefined,
    }));

  const strategy = PICKS.includes(src.strategy as MOFHStrategy)
    ? (src.strategy as MOFHStrategy)
    : 'least-loaded';

  return {
    enabled: src.enabled === true,
    strategy,
    defaultPackage: src.defaultPackage || '',
    cpanelUrl: src.cpanelUrl || '',
    customNameservers: src.customNameservers,
    accounts,
    enabledAccounts: accounts.filter((a) => a.enabled),
  };
}

/** 从数据库读配置并归一化 */
export async function loadMOFHConfig(): Promise<ResolvedMOFHConfig> {
  const setting = await prisma.setting.findUnique({ where: { key: 'mofh_config' } });
  if (!setting) return normalizeConfig(null);
  try {
    return normalizeConfig(JSON.parse(setting.value) as MOFHConfigFile);
  } catch {
    return normalizeConfig(null);
  }
}

/** 配置可用（开关打开 + 至少一个启用账号）才返回配置，否则 null —— 等价于原来的 getMOFHConfig() */
export async function getUsableMOFHConfig(): Promise<ResolvedMOFHConfig | null> {
  const cfg = await loadMOFHConfig();
  if (!cfg.enabled || cfg.enabledAccounts.length === 0) return null;
  return cfg;
}

export function getAccount(cfg: ResolvedMOFHConfig, id?: string | null): MOFHAccount | null {
  if (!id) return null;
  return cfg.accounts.find((a) => a.id === id) || null;
}

/**
 * 某个等级能用的 MOFH 账号。
 *
 * 账号上 `allowedLevelIds` 为空/未设置 = 所有等级都能用；
 * levelId 为空（用户没有等级）时，只返回「不限制等级」的账号。
 */
export function accountsForLevel(cfg: ResolvedMOFHConfig, levelId?: string | null): MOFHAccount[] {
  return cfg.enabledAccounts.filter((a) => {
    const allow = a.allowedLevelIds;
    if (!allow || allow.length === 0) return true;
    if (!levelId) return false;
    return allow.includes(levelId);
  });
}

/** 该等级能否使用这个账号（建站时的服务端校验用） */
export function accountAllowedForLevel(account: MOFHAccount, levelId?: string | null): boolean {
  const allow = account.allowedLevelIds;
  if (!allow || allow.length === 0) return true;
  if (!levelId) return false;
  return allow.includes(levelId);
}

/**
 * 挑一个账号用来建站。
 *
 * - least-loaded：按已建站数量挑最空的那个（老数据 mofhAccountId 为空，
 *   视为由第一个账号创建，一并计入它的负载）
 * - round-robin：用「已建站总数 % 启用账号数」轮转，无需额外存状态
 */
export async function pickAccount(
  cfg: ResolvedMOFHConfig,
  preferredId?: string | null,
): Promise<MOFHAccount | null> {
  const list = cfg.enabledAccounts;
  if (list.length === 0) return null;

  // 指定了账号就用它（例如域名的 NS 已经指向某个分销商，必须建在那家）
  if (preferredId) {
    const preferred = list.find((a) => a.id === preferredId);
    if (preferred) return preferred;
  }

  if (list.length === 1) return list[0];

  const grouped = await prisma.hosting.groupBy({
    by: ['mofhAccountId'],
    where: { status: { not: 'DELETED' } },
    _count: { _all: true },
  });

  const counts = new Map<string, number>();
  let legacy = 0;
  let total = 0;
  for (const row of grouped) {
    const n = row._count._all;
    total += n;
    if (row.mofhAccountId) counts.set(row.mofhAccountId, n);
    else legacy += n;
  }

  if (cfg.strategy === 'round-robin') {
    return list[total % list.length];
  }

  // least-loaded：老数据算在第一个账号头上
  const loadOf = (a: MOFHAccount, index: number) =>
    (counts.get(a.id) || 0) + (index === 0 ? legacy : 0);

  let best = list[0];
  let bestLoad = loadOf(list[0], 0);
  for (let i = 1; i < list.length; i++) {
    const load = loadOf(list[i], i);
    if (load < bestLoad) {
      best = list[i];
      bestLoad = load;
    }
  }
  return best;
}

/** 建站时实际使用的套餐：账号级覆盖 > 全局默认 */
export function packageForAccount(cfg: ResolvedMOFHConfig, account: MOFHAccount): string {
  return account.defaultPackage || cfg.defaultPackage || '';
}

/** 用户面板地址：账号级覆盖 > 全局默认 */
export function cpanelUrlForAccount(cfg: ResolvedMOFHConfig, account?: MOFHAccount | null): string {
  return account?.cpanelUrl || cfg.cpanelUrl || '';
}

/**
 * 按主机（vpUsername）解析它所属账号的用户面板地址。
 * 多账号下不同分销商的用户面板域名不同，所以登录 cPanel 前必须认准账号。
 */
export async function cpanelUrlForVpUsername(vpUsername?: string | null): Promise<string> {
  const cfg = await loadMOFHConfig();
  if (vpUsername) {
    try {
      const h = await prisma.hosting.findFirst({
        where: { vpUsername },
        select: { mofhAccountId: true },
      });
      if (h?.mofhAccountId) {
        return cpanelUrlForAccount(cfg, getAccount(cfg, h.mofhAccountId));
      }
    } catch {
      // 查不到就退回全局配置
    }
  }
  return cpanelUrlForAccount(cfg, null);
}

/** 把逗号分隔的域名服务器字符串解析成数组 */
export function parseNameservers(value?: string | null): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((ns) => ns.trim().toLowerCase())
    .filter((ns) => ns.length > 0);
}

/** 某账号要求用户使用的域名服务器：账号级 > 全局 */
export function nameserversForAccount(cfg: ResolvedMOFHConfig, account?: MOFHAccount | null): string[] {
  const own = parseNameservers(account?.customNameservers);
  if (own.length > 0) return own;
  return parseNameservers(cfg.customNameservers);
}

/** 所有启用账号的域名服务器并集（自定义域名校验时用：指向任何一家都算合法） */
export function allNameservers(cfg: ResolvedMOFHConfig): string[] {
  const out = new Set<string>();
  for (const ns of parseNameservers(cfg.customNameservers)) out.add(ns);
  for (const account of cfg.enabledAccounts) {
    for (const ns of parseNameservers(account.customNameservers)) out.add(ns);
  }
  return [...out];
}

/**
 * 域名的 NS 已经指向哪个分销账号 —— 建站必须建在那一家，
 * 否则 MOFH 那边域名对不上（不同分销商的 NS 是各自独立的）。
 */
export function accountByNameservers(
  cfg: ResolvedMOFHConfig,
  currentNS: string[],
): MOFHAccount | null {
  if (!currentNS || currentNS.length === 0) return null;
  const lower = currentNS.map((ns) => ns.toLowerCase().replace(/\.$/, ''));
  for (const account of cfg.enabledAccounts) {
    const own = parseNameservers(account.customNameservers);
    if (own.length === 0) continue;
    const hit = lower.some((ns) =>
      own.some((required) => ns === required || ns.endsWith('.' + required)),
    );
    if (hit) return account;
  }
  return null;
}

function authHeader(account: MOFHAccount): string {
  return `Basic ${Buffer.from(`${account.apiUsername}:${account.apiPassword}`).toString('base64')}`;
}

/** MOFH JSON API 请求（建站/暂停/恢复等） */
export async function mofhJsonRequest(
  endpoint: string,
  data: Record<string, string>,
  account: MOFHAccount,
): Promise<Response> {
  return fetch(`${MOFH_API_BASE}/json-api/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(account),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(data).toString(),
  });
}

/** MOFH XML API 请求（getuserdomains 等，要求 api_user/api_key 放在 body 里） */
export async function mofhXmlRequest(
  endpoint: string,
  data: Record<string, string>,
  account: MOFHAccount,
): Promise<Response> {
  const fullData = {
    api_user: account.apiUsername,
    api_key: account.apiPassword,
    ...data,
  };
  return fetch(`${MOFH_API_BASE}/xml-api/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(account),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(fullData).toString(),
  });
}

interface ListPkgsResponse {
  package?: Array<{ name: string }>;
  cpanelresult?: {
    error?: string;
    data?: { reason?: string } | Array<{ reason?: string }>;
  };
}

/** MOFH 认证失败也返回 HTTP 200，必须看响应体里的 cpanelresult.error */
function extractCpanelError(body: ListPkgsResponse): string | null {
  if (!body?.cpanelresult?.error) return null;
  const d = body.cpanelresult.data;
  if (Array.isArray(d)) return d[0]?.reason || body.cpanelresult.error;
  return d?.reason || body.cpanelresult.error;
}

/** 把 MOFH 的原始报错翻译成人能看懂的 */
export function friendlyMOFHError(raw: string): string {
  const lower = raw.toLowerCase();
  if (lower.includes('ip') || lower.includes('whitelist')) return 'IP address not whitelisted on MOFH';
  if (lower.includes('username')) return 'Invalid API credentials';
  if (lower.includes('password') || lower.includes('key')) return 'Invalid API password/key';
  return raw;
}

/** 测试单个账号连通性（列套餐） */
export async function testAccount(account: MOFHAccount): Promise<{
  success: boolean;
  message: string;
  error?: string;
  packagesCount?: number;
  apiVersion?: string;
}> {
  let apiVersion: string | undefined;
  try {
    const versionResponse = await fetch(`${MOFH_API_BASE}/json-api/version.php`);
    if (!versionResponse.ok) {
      return { success: false, message: 'Cannot connect to MOFH API server' };
    }
    apiVersion = ((await versionResponse.json()) as { version: string }).version;
  } catch {
    return { success: false, message: 'Cannot connect to MOFH API server' };
  }

  try {
    const resp = await fetch(`${MOFH_API_BASE}/json-api/listpkgs.php`, {
      headers: { Authorization: authHeader(account) },
    });
    const body = (await resp.json()) as ListPkgsResponse;

    const err = extractCpanelError(body);
    if (err) {
      return {
        success: false,
        message: friendlyMOFHError(err),
        error: err,
        apiVersion,
      };
    }
    if (!body.package) {
      return { success: false, message: 'Invalid response from MOFH API', apiVersion };
    }
    return {
      success: true,
      message: 'MOFH API connection successful!',
      apiVersion,
      packagesCount: body.package.length,
    };
  } catch (e) {
    return {
      success: false,
      message: 'Failed to connect to MOFH API',
      error: e instanceof Error ? e.message : String(e),
      apiVersion,
    };
  }
}

/** 取某账号下的套餐名列表 */
export async function fetchPackages(account: MOFHAccount): Promise<string[]> {
  const resp = await fetch(`${MOFH_API_BASE}/json-api/listpkgs.php`, {
    headers: { Authorization: authHeader(account) },
  });
  if (!resp.ok) return [];
  const body = (await resp.json()) as ListPkgsResponse;
  if (extractCpanelError(body)) return [];
  return body.package?.map((p) => p.name) || [];
}

export { extractCpanelError };
