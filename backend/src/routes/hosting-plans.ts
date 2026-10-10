/**
 * 建站套餐（HostingPlan）
 *
 * 一个套餐 = 前台展示名 + 资源规格 + 特性列表 + 绑定到某个 MOFH 账号下的某个 MOFH 套餐。
 * 用户在前台选套餐，等于同时选定了「哪个分销账号的凭据」和「该账号下的哪个 MOFH 套餐」。
 *
 * 与 PremiumPlan（升级套餐，带价格/推广链接）是两回事，不要混。
 */

import { Router, Response } from 'express';
import prisma from '../lib/prisma.js';
import { adminMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import { loadMOFHConfig, getAccount, type ResolvedMOFHConfig } from '../lib/mofh.js';

const router = Router();

interface PlanSpecs {
  disk?: string;
  bandwidth?: string;
  domains?: number;
  databases?: number;
  emailAccounts?: number;
  subdomains?: number;
  inodes?: string;
}

interface PlanPayload {
  name?: string;
  description?: string;
  mofhAccountId?: string | null;
  mofhPackage?: string;
  specs?: PlanSpecs;
  features?: string[];
  maxAccounts?: number | null;
  isActive?: boolean;
  isFeatured?: boolean;
  order?: number;
  translations?: Record<string, unknown> | null;
}

async function usedCountByPlan(): Promise<Map<string, number>> {
  const rows = await prisma.hosting.groupBy({
    by: ['planId'],
    where: { status: { not: 'DELETED' } },
    _count: { _all: true },
  });
  const map = new Map<string, number>();
  for (const r of rows) {
    if (r.planId) map.set(r.planId, r._count._all);
  }
  return map;
}

function serializePlan(
  plan: any,
  cfg: ResolvedMOFHConfig,
  used: number,
) {
  const account = plan.mofhAccountId ? getAccount(cfg, plan.mofhAccountId) : null;
  const remaining = typeof plan.maxAccounts === 'number' ? Math.max(0, plan.maxAccounts - used) : null;
  return {
    id: plan.id,
    name: plan.name,
    description: plan.description || '',
    mofhAccountId: plan.mofhAccountId || '',
    mofhAccountName: account?.name || '',
    mofhPackage: plan.mofhPackage,
    specs: plan.specs || {},
    features: Array.isArray(plan.features) ? plan.features : [],
    maxAccounts: plan.maxAccounts ?? null,
    used,
    remaining,
    isActive: plan.isActive,
    isFeatured: plan.isFeatured,
    order: plan.order,
    translations: plan.translations || null,
    createdAt: plan.createdAt,
  };
}

// ==================== 前台：可选套餐列表 ====================
router.get('/', async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [plans, cfg, used] = await Promise.all([
      prisma.hostingPlan.findMany({
        where: { isActive: true },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      }),
      loadMOFHConfig(),
      usedCountByPlan(),
    ]);

    // 库存用完的下架（maxAccounts 有值时）
    const visible = plans.filter((p) => {
      if (typeof p.maxAccounts !== 'number') return true;
      return (used.get(p.id) || 0) < p.maxAccounts;
    });

    res.json({ plans: visible.map((p) => serializePlan(p, cfg, used.get(p.id) || 0)) });
  } catch (error) {
    console.error('Get hosting plans error:', error);
    res.status(500).json({ error: 'Failed to get hosting plans' });
  }
});

// ==================== 后台：全部套餐 ====================
router.get('/admin', adminMiddleware, async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const [plans, cfg, used] = await Promise.all([
      prisma.hostingPlan.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }),
      loadMOFHConfig(),
      usedCountByPlan(),
    ]);
    res.json({
      plans: plans.map((p) => serializePlan(p, cfg, used.get(p.id) || 0)),
      accounts: cfg.accounts.map((a) => ({ id: a.id, name: a.name, enabled: a.enabled })),
    });
  } catch (error) {
    console.error('Get hosting plans (admin) error:', error);
    res.status(500).json({ error: 'Failed to get hosting plans' });
  }
});

// ==================== 后台：新建 ====================
router.post('/', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const body = req.body as PlanPayload;
    const name = (body.name || '').trim();
    const mofhPackage = (body.mofhPackage || '').trim();

    if (!name) return res.status(400).json({ error: 'Plan name is required' });
    if (!mofhPackage) return res.status(400).json({ error: 'MOFH package is required' });

    // 绑定了账号就校验该账号存在
    if (body.mofhAccountId) {
      const cfg = await loadMOFHConfig();
      if (!getAccount(cfg, body.mofhAccountId)) {
        return res.status(400).json({ error: '指定的 MOFH 账号不存在' });
      }
    }

    const count = await prisma.hostingPlan.count();
    const plan = await prisma.hostingPlan.create({
      data: {
        name,
        description: body.description || null,
        mofhAccountId: body.mofhAccountId || null,
        mofhPackage,
        specs: (body.specs || {}) as any,
        features: (body.features || []) as any,
        maxAccounts: typeof body.maxAccounts === 'number' ? body.maxAccounts : null,
        isActive: body.isActive !== false,
        isFeatured: body.isFeatured === true,
        order: typeof body.order === 'number' ? body.order : count,
        translations: (body.translations || null) as any,
      },
    });

    res.json({ message: 'Plan created', plan: serializePlan(plan, await loadMOFHConfig(), 0) });
  } catch (error) {
    console.error('Create hosting plan error:', error);
    res.status(500).json({ error: 'Failed to create plan' });
  }
});

// ==================== 后台：修改 ====================
router.put('/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const body = req.body as PlanPayload;

    const existing = await prisma.hostingPlan.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Plan not found' });

    if (body.mofhAccountId) {
      const cfg = await loadMOFHConfig();
      if (!getAccount(cfg, body.mofhAccountId)) {
        return res.status(400).json({ error: '指定的 MOFH 账号不存在' });
      }
    }

    const data: any = {};
    if (body.name !== undefined) {
      const n = (body.name || '').trim();
      if (!n) return res.status(400).json({ error: 'Plan name is required' });
      data.name = n;
    }
    if (body.mofhPackage !== undefined) {
      const p = (body.mofhPackage || '').trim();
      if (!p) return res.status(400).json({ error: 'MOFH package is required' });
      data.mofhPackage = p;
    }
    if (body.description !== undefined) data.description = body.description || null;
    if (body.mofhAccountId !== undefined) data.mofhAccountId = body.mofhAccountId || null;
    if (body.specs !== undefined) data.specs = (body.specs || {}) as any;
    if (body.features !== undefined) data.features = (body.features || []) as any;
    if (body.maxAccounts !== undefined) {
      data.maxAccounts = typeof body.maxAccounts === 'number' ? body.maxAccounts : null;
    }
    if (body.isActive !== undefined) data.isActive = body.isActive === true;
    if (body.isFeatured !== undefined) data.isFeatured = body.isFeatured === true;
    if (body.order !== undefined && typeof body.order === 'number') data.order = body.order;
    if (body.translations !== undefined) data.translations = (body.translations || null) as any;

    const plan = await prisma.hostingPlan.update({ where: { id }, data });
    const used = (await usedCountByPlan()).get(id) || 0;
    res.json({ message: 'Plan updated', plan: serializePlan(plan, await loadMOFHConfig(), used) });
  } catch (error) {
    console.error('Update hosting plan error:', error);
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// ==================== 后台：开启/关闭 ====================
router.patch('/:id/toggle', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.hostingPlan.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Plan not found' });

    const next = typeof req.body?.isActive === 'boolean' ? req.body.isActive : !existing.isActive;
    await prisma.hostingPlan.update({ where: { id }, data: { isActive: next } });
    res.json({ message: next ? 'Plan enabled' : 'Plan disabled', isActive: next });
  } catch (error) {
    console.error('Toggle hosting plan error:', error);
    res.status(500).json({ error: 'Failed to toggle plan' });
  }
});

// ==================== 后台：删除 ====================
router.delete('/:id', adminMiddleware, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.hostingPlan.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Plan not found' });

    // 已建站的托管保留，只把引用置空（不删用户的东西）
    const affected = await prisma.hosting.updateMany({
      where: { planId: id },
      data: { planId: null },
    });
    await prisma.hostingPlan.delete({ where: { id } });

    res.json({ message: 'Plan deleted', unlinkedHostings: affected.count });
  } catch (error) {
    console.error('Delete hosting plan error:', error);
    res.status(500).json({ error: 'Failed to delete plan' });
  }
});

export default router;
