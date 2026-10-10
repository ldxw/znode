/**
 * 激活码（ActivationCode）
 *
 * 一张码绑定一个用户等级；用户在前台兑换后升到该等级。
 * 可限制使用次数与有效期。全部为后台接口（兑换在 /api/levels/redeem）。
 */

import { Router, Response } from 'express';
import prisma from '../lib/prisma.js';
import { adminMiddleware, AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();

/** 去掉容易看错的字符（0/O/1/I/L） */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(len = 12): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

function serializeCode(code: any) {
  return {
    id: code.id,
    code: code.code,
    purpose: code.purpose,
    levelId: code.levelId,
    levelName: code.level?.name || '',
    maxUses: code.maxUses ?? null,
    usedCount: code.usedCount,
    remaining: code.maxUses != null ? Math.max(0, code.maxUses - code.usedCount) : null,
    expiresAt: code.expiresAt,
    expired: code.expiresAt ? code.expiresAt.getTime() < Date.now() : false,
    isActive: code.isActive,
    note: code.note || '',
    createdAt: code.createdAt,
    useCount: code._count?.uses ?? undefined,
  };
}

// ==================== 列表 ====================
router.get('/admin', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    // 默认只看升级码；邀请码页传 ?purpose=register
    const purpose = String(req.query.purpose || 'activate').toLowerCase() === 'register' ? 'REGISTER' : 'ACTIVATE';
    const [codes, levels] = await Promise.all([
      prisma.activationCode.findMany({
        where: { purpose },
        include: { level: { select: { name: true } }, _count: { select: { uses: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.userLevel.findMany({ orderBy: [{ order: 'asc' }] }),
    ]);
    res.json({
      codes: codes.map(serializeCode),
      levels: levels.map((l) => ({ id: l.id, name: l.name, order: l.order, isActive: l.isActive })),
    });
  } catch (error) {
    console.error('Get activation codes error:', error);
    res.status(500).json({ error: 'Failed to get activation codes' });
  }
});

// ==================== 新建（支持批量） ====================
router.post('/', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const levelId = String(req.body?.levelId || '').trim();
    if (!levelId) return res.status(400).json({ error: 'Level is required' });

    // 用途：升级码（默认）或注册邀请码
    const purpose = String(req.body?.purpose || 'activate').toLowerCase() === 'register' ? 'REGISTER' as const : 'ACTIVATE' as const;

    const level = await prisma.userLevel.findUnique({ where: { id: levelId } });
    if (!level) return res.status(400).json({ error: 'Level not found' });

    const count = Math.min(Math.max(Number(req.body?.count) || 1, 1), 200);
    const prefix = String(req.body?.prefix || '').trim().toUpperCase();
    const custom = String(req.body?.code || '').trim();
    const maxUses = req.body?.maxUses === '' || req.body?.maxUses == null ? null : Number(req.body.maxUses);
    const expiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;
    const note = req.body?.note || null;
    const isActive = req.body?.isActive !== false;

    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      return res.status(400).json({ error: 'Invalid expiry date' });
    }

    // 单个 + 自定义码
    if (count === 1 && custom) {
      const exists = await prisma.activationCode.findUnique({ where: { code: custom } });
      if (exists) return res.status(400).json({ error: 'This code already exists' });
      const created = await prisma.activationCode.create({
        data: { code: custom, purpose, levelId, maxUses, expiresAt, note, isActive },
        include: { level: { select: { name: true } } },
      });
      return res.json({ message: 'Code created', codes: [serializeCode(created)] });
    }

    // 批量：生成不重复的码
    const wanted = new Set<string>();
    let guard = 0;
    while (wanted.size < count && guard < count * 50) {
      wanted.add(prefix + randomCode(prefix ? 12 : 16));
      guard++;
    }
    const existing = await prisma.activationCode.findMany({
      where: { code: { in: [...wanted] } },
      select: { code: true },
    });
    for (const e of existing) wanted.delete(e.code);

    await prisma.activationCode.createMany({
      data: [...wanted].map((code) => ({ code, purpose, levelId, maxUses, expiresAt, note, isActive })),
    });

    const created = await prisma.activationCode.findMany({
      where: { code: { in: [...wanted] } },
      include: { level: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ message: `${created.length} codes created`, codes: created.map(serializeCode) });
  } catch (error) {
    console.error('Create activation code error:', error);
    res.status(500).json({ error: 'Failed to create activation codes' });
  }
});

// ==================== 修改 ====================
router.put('/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.activationCode.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Code not found' });

    const data: any = {};
    if (req.body?.levelId !== undefined) {
      const level = await prisma.userLevel.findUnique({ where: { id: String(req.body.levelId) } });
      if (!level) return res.status(400).json({ error: 'Level not found' });
      data.levelId = level.id;
    }
    if (req.body?.maxUses !== undefined) {
      data.maxUses = req.body.maxUses === '' || req.body.maxUses == null ? null : Number(req.body.maxUses);
    }
    if (req.body?.expiresAt !== undefined) {
      if (!req.body.expiresAt) data.expiresAt = null;
      else {
        const d = new Date(req.body.expiresAt);
        if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'Invalid expiry date' });
        data.expiresAt = d;
      }
    }
    if (req.body?.isActive !== undefined) data.isActive = req.body.isActive === true;
    if (req.body?.note !== undefined) data.note = req.body.note || null;

    const updated = await prisma.activationCode.update({
      where: { id },
      data,
      include: { level: { select: { name: true } } },
    });
    res.json({ message: 'Code updated', code: serializeCode(updated) });
  } catch (error) {
    console.error('Update activation code error:', error);
    res.status(500).json({ error: 'Failed to update code' });
  }
});

// ==================== 启用/停用 ====================
router.patch('/:id/toggle', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.activationCode.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Code not found' });

    const next = typeof req.body?.isActive === 'boolean' ? req.body.isActive : !existing.isActive;
    await prisma.activationCode.update({ where: { id }, data: { isActive: next } });
    res.json({ message: next ? 'Code enabled' : 'Code disabled', isActive: next });
  } catch (error) {
    console.error('Toggle activation code error:', error);
    res.status(500).json({ error: 'Failed to toggle code' });
  }
});

// ==================== 删除 ====================
router.delete('/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.activationCode.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Code not found' });

    await prisma.activationCode.delete({ where: { id } });
    res.json({ message: 'Code deleted' });
  } catch (error) {
    console.error('Delete activation code error:', error);
    res.status(500).json({ error: 'Failed to delete code' });
  }
});

// ==================== 使用记录 ====================
router.get('/:id/uses', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const uses = await prisma.activationCodeUse.findMany({
      where: { codeId: id },
      orderBy: { usedAt: 'desc' },
      take: 200,
    });
    res.json({
      uses: uses.map((u) => ({ id: u.id, userId: u.userId, userEmail: u.userEmail || '', usedAt: u.usedAt })),
    });
  } catch (error) {
    console.error('Get code uses error:', error);
    res.status(500).json({ error: 'Failed to get code uses' });
  }
});

export default router;
