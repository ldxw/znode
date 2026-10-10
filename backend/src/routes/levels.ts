/**
 * 用户等级（UserLevel）
 *
 * 用户端：看自己的等级、看有哪些等级、用激活码兑换升级。
 * 后台端：增删改启停等级。
 */

import { Router, Response } from 'express';
import prisma from '../lib/prisma.js';
import { authMiddleware, adminMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { resolveUserLevel } from '../lib/levels.js';

const router = Router();

function serializeLevel(level: any, memberCount?: number) {
  return {
    id: level.id,
    name: level.name,
    description: level.description || '',
    order: level.order,
    isDefault: level.isDefault,
    isActive: level.isActive,
    perks: Array.isArray(level.perks) ? level.perks : [],
    createdAt: level.createdAt,
    ...(typeof memberCount === 'number' ? { memberCount } : {}),
  };
}

/** 保证同一时间只有一个默认等级 */
async function ensureSingleDefault(keepId: string) {
  await prisma.userLevel.updateMany({
    where: { isDefault: true, NOT: { id: keepId } },
    data: { isDefault: false },
  });
}

// ==================== 用户端 ====================

/** 我的等级 + 全部启用等级 */
router.get('/', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const [mine, levels] = await Promise.all([
      resolveUserLevel(req.user!.id),
      prisma.userLevel.findMany({
        where: { isActive: true },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);
    res.json({
      myLevelId: mine?.id || null,
      levels: levels.map((l) => serializeLevel(l)),
    });
  } catch (error) {
    console.error('Get levels error:', error);
    res.status(500).json({ error: 'Failed to get levels' });
  }
});

/** 用激活码兑换等级 */
router.post('/redeem', authMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user!.id;
    const raw = String(req.body?.code || '').trim();
    if (!raw) return res.status(400).json({ error: 'Activation code is required' });

    const code = await prisma.activationCode.findUnique({ where: { code: raw } });
    if (!code) return res.status(404).json({ error: 'Invalid activation code' });
    if (code.purpose !== 'ACTIVATE') {
      return res.status(400).json({ error: 'This code is not an activation code' });
    }
    if (!code.isActive) return res.status(400).json({ error: 'This activation code is disabled' });
    if (code.expiresAt && code.expiresAt.getTime() < Date.now()) {
      return res.status(400).json({ error: 'This activation code has expired' });
    }
    if (code.maxUses != null && code.usedCount >= code.maxUses) {
      return res.status(400).json({ error: 'This activation code has been fully used' });
    }

    const [target, current] = await Promise.all([
      prisma.userLevel.findUnique({ where: { id: code.levelId } }),
      resolveUserLevel(userId),
    ]);
    if (!target) return res.status(400).json({ error: 'The level of this code no longer exists' });
    if (!target.isActive) return res.status(400).json({ error: 'The level of this code is disabled' });
    if (current && current.order >= target.order) {
      return res.status(400).json({
        error: `Your current level (${current.name}) is already equal or higher`,
        currentLevel: serializeLevel(current),
      });
    }

    // 原子消费：并发下也不会超出 maxUses
    try {
      await prisma.$transaction(async (tx) => {
        const consumed = await tx.activationCode.updateMany({
          where: {
            id: code.id,
            isActive: true,
            ...(code.maxUses != null ? { usedCount: { lt: code.maxUses } } : {}),
          },
          data: { usedCount: { increment: 1 } },
        });
        if (consumed.count === 0) throw new Error('CODE_USED_UP');
        await tx.activationCodeUse.create({
          data: { codeId: code.id, userId, userEmail: req.user!.email },
        });
        await tx.user.update({ where: { id: userId }, data: { levelId: target.id } });
      });
    } catch (e: any) {
      if (e?.message === 'CODE_USED_UP') {
        return res.status(400).json({ error: 'This activation code has been fully used' });
      }
      throw e;
    }

    res.json({
      message: 'Level upgraded',
      level: serializeLevel(target),
    });
  } catch (error) {
    console.error('Redeem code error:', error);
    res.status(500).json({ error: 'Failed to redeem code' });
  }
});

// ==================== 后台端 ====================

router.get('/admin', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const levels = await prisma.userLevel.findMany({
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    const counts = await prisma.user.groupBy({
      by: ['levelId'],
      _count: { _all: true },
    });
    const map = new Map<string, number>();
    for (const c of counts) if (c.levelId) map.set(c.levelId, c._count._all);

    const defaultLevel = levels.find((l) => l.isDefault);
    // 没有 levelId 的用户算在默认等级名下
    const unassigned = counts.find((c) => !c.levelId)?._count._all || 0;
    if (defaultLevel) map.set(defaultLevel.id, (map.get(defaultLevel.id) || 0) + unassigned);

    res.json({ levels: levels.map((l) => serializeLevel(l, map.get(l.id) || 0)) });
  } catch (error) {
    console.error('Get levels (admin) error:', error);
    res.status(500).json({ error: 'Failed to get levels' });
  }
});

router.post('/', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Level name is required' });

    const count = await prisma.userLevel.count();
    const level = await prisma.userLevel.create({
      data: {
        name,
        description: req.body?.description || null,
        order: typeof req.body?.order === 'number' ? req.body.order : count,
        isDefault: req.body?.isDefault === true,
        isActive: req.body?.isActive !== false,
        perks: Array.isArray(req.body?.perks) ? req.body.perks : [],
      },
    });
    if (level.isDefault) await ensureSingleDefault(level.id);

    res.json({ message: 'Level created', level: serializeLevel(level, 0) });
  } catch (error) {
    console.error('Create level error:', error);
    res.status(500).json({ error: 'Failed to create level' });
  }
});

router.put('/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.userLevel.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Level not found' });

    const data: any = {};
    if (req.body?.name !== undefined) {
      const n = String(req.body.name).trim();
      if (!n) return res.status(400).json({ error: 'Level name is required' });
      data.name = n;
    }
    if (req.body?.description !== undefined) data.description = req.body.description || null;
    if (typeof req.body?.order === 'number') data.order = req.body.order;
    if (req.body?.isDefault !== undefined) data.isDefault = req.body.isDefault === true;
    if (req.body?.isActive !== undefined) data.isActive = req.body.isActive === true;
    if (req.body?.perks !== undefined) data.perks = Array.isArray(req.body.perks) ? req.body.perks : [];

    const level = await prisma.userLevel.update({ where: { id }, data });
    if (level.isDefault) await ensureSingleDefault(level.id);

    res.json({ message: 'Level updated', level: serializeLevel(level) });
  } catch (error) {
    console.error('Update level error:', error);
    res.status(500).json({ error: 'Failed to update level' });
  }
});

router.patch('/:id/toggle', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.userLevel.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Level not found' });

    const next = typeof req.body?.isActive === 'boolean' ? req.body.isActive : !existing.isActive;
    if (!next && existing.isDefault) {
      return res.status(400).json({ error: 'The default level cannot be disabled' });
    }
    await prisma.userLevel.update({ where: { id }, data: { isActive: next } });
    res.json({ message: next ? 'Level enabled' : 'Level disabled', isActive: next });
  } catch (error) {
    console.error('Toggle level error:', error);
    res.status(500).json({ error: 'Failed to toggle level' });
  }
});

router.delete('/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.userLevel.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Level not found' });
    if (existing.isDefault) {
      return res.status(400).json({ error: 'The default level cannot be deleted' });
    }

    // 用户会因 onDelete: SetNull 回到默认等级；绑定该等级的激活码会一并删除
    await prisma.userLevel.delete({ where: { id } });
    res.json({ message: 'Level deleted' });
  } catch (error) {
    console.error('Delete level error:', error);
    res.status(500).json({ error: 'Failed to delete level' });
  }
});

export default router;
