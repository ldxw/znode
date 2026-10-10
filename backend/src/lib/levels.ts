/**
 * 用户等级（UserLevel）公共逻辑
 *
 * 等级决定用户能用哪些建站套餐（HostingPlan.allowedLevelIds）
 * 和哪些 MOFH 分销账号（MOFHAccount.allowedLevelIds）。
 * 两侧的空列表都表示「不限制」。
 */

import prisma from './prisma.js';

/** 注册默认归属的等级 */
export async function getDefaultLevel() {
  return prisma.userLevel.findFirst({
    where: { isDefault: true, isActive: true },
    orderBy: { order: 'asc' },
  });
}

/** 用户实际生效的等级 id（没单独设过就落到默认等级） */
export async function resolveUserLevelId(userId?: string | null): Promise<string | null> {
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { levelId: true },
    });
    if (user?.levelId) return user.levelId;
  }
  const def = await getDefaultLevel();
  return def?.id || null;
}

/** 用户实际生效的等级对象 */
export async function resolveUserLevel(userId?: string | null) {
  const id = await resolveUserLevelId(userId);
  if (!id) return null;
  return prisma.userLevel.findUnique({ where: { id } });
}

/**
 * 等级是否被允许。
 * allowedLevelIds 为空/非数组 = 所有等级都可用；
 * 用户没有等级时，只有「不限制」的资源对他可见。
 */
export function levelAllows(allowedLevelIds: unknown, levelId?: string | null): boolean {
  const allow = Array.isArray(allowedLevelIds) ? (allowedLevelIds as string[]).filter(Boolean) : [];
  if (allow.length === 0) return true;
  if (!levelId) return false;
  return allow.includes(levelId);
}

/** 把 Json 字段安全读成 string[] */
export function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? (value as unknown[]).map(String).filter(Boolean) : [];
}
