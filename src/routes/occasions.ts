import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

const occasionSchema = z.object({
  circleId: z.string().uuid(),
  title: z.string().min(1),
  date: z.string().min(1),
  personId: z.string().uuid().optional(),
  color: z.enum(['peach', 'blush', 'butter', 'sage']).default('peach'),
  icon: z.string().emoji().max(8).default('🎁'),
});

async function getMyCircleIds(userId: string): Promise<string[]> {
  const memberships = await db.circleMember.findMany({ where: { userId }, select: { circleId: true } });
  return memberships.map(m => m.circleId);
}

// GET /api/occasions
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const circleIds = await getMyCircleIds(userId);
  const occasions = await db.occasion.findMany({
    where: { circleId: { in: circleIds } },
    orderBy: { date: 'asc' },
  });
  res.json(occasions);
});

// POST /api/occasions
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const parsed = occasionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const member = await db.circleMember.findUnique({
    where: { circleId_userId: { circleId: parsed.data.circleId, userId } },
  });
  if (!member) {
    res.status(403).json({ error: 'Not a member of this circle' });
    return;
  }
  const occasion = await db.occasion.create({ data: parsed.data });
  res.status(201).json(occasion);
});

// PATCH /api/occasions/:id
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const occasion = await db.occasion.findUnique({ where: { id: req.params.id } });
  if (!occasion) {
    res.status(404).json({ error: 'Occasion not found' });
    return;
  }
  const member = await db.circleMember.findUnique({
    where: { circleId_userId: { circleId: occasion.circleId, userId } },
  });
  if (!member) {
    res.status(403).json({ error: 'Not a member of this circle' });
    return;
  }
  const parsed = occasionSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const updated = await db.occasion.update({ where: { id: req.params.id }, data: parsed.data });
  res.json(updated);
});

// DELETE /api/occasions/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const occasion = await db.occasion.findUnique({ where: { id: req.params.id } });
  if (!occasion) {
    res.status(404).json({ error: 'Occasion not found' });
    return;
  }
  const member = await db.circleMember.findUnique({
    where: { circleId_userId: { circleId: occasion.circleId, userId } },
  });
  if (!member) {
    res.status(403).json({ error: 'Not a member of this circle' });
    return;
  }
  await db.occasion.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

export default router;
