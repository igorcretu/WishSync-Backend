import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

function safeUser(u: any) {
  return { id: u.id, name: u.name, nickname: u.nickname, color: u.color, initial: u.initial, birthday: u.birthday };
}

// GET /api/circles
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const memberships = await db.circleMember.findMany({
    where: { userId },
    include: {
      circle: {
        include: {
          members: { include: { user: true } },
        },
      },
    },
  });
  const circles = memberships.map(m => ({
    id: m.circle.id,
    name: m.circle.name,
    type: m.circle.type,
    members: m.circle.members.map(cm => ({
      userId: cm.userId,
      joinedAt: cm.joinedAt,
      user: safeUser(cm.user),
    })),
  }));
  res.json(circles);
});

// POST /api/circles
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const schema = z.object({
    name: z.string().min(1),
    type: z.enum(['couple', 'friends']),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const circle = await db.circle.create({
    data: {
      name: parsed.data.name,
      type: parsed.data.type,
      createdById: userId,
      members: { create: { userId } },
    },
    include: { members: { include: { user: true } } },
  });
  res.status(201).json({
    id: circle.id,
    name: circle.name,
    type: circle.type,
    members: circle.members.map(m => ({ userId: m.userId, joinedAt: m.joinedAt, user: safeUser(m.user) })),
  });
});

// DELETE /api/circles/:id — leave if member, delete entirely if creator or last member
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const circle = await db.circle.findUnique({
    where: { id: req.params.id },
    include: { members: true },
  });
  if (!circle) { res.status(404).json({ error: 'Circle not found' }); return; }
  if (!circle.members.some(m => m.userId === userId)) {
    res.status(403).json({ error: 'Not a member' }); return;
  }
  if (circle.createdById === userId || circle.members.length <= 1) {
    await db.circle.delete({ where: { id: req.params.id } });
  } else {
    await db.circleMember.delete({ where: { circleId_userId: { circleId: req.params.id, userId } } });
  }
  res.status(204).send();
});

// PATCH /api/circles/:id — rename (creator only)
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const schema = z.object({ name: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0].message }); return; }
  const circle = await db.circle.findUnique({ where: { id: req.params.id }, include: { members: { include: { user: true } } } });
  if (!circle) { res.status(404).json({ error: 'Circle not found' }); return; }
  if (circle.createdById !== userId) { res.status(403).json({ error: 'Only the creator can rename a circle' }); return; }
  const updated = await db.circle.update({ where: { id: req.params.id }, data: { name: parsed.data.name } });
  res.json({
    id: updated.id,
    name: updated.name,
    type: updated.type,
    members: circle.members.map(m => ({ userId: m.userId, joinedAt: m.joinedAt, user: safeUser(m.user) })),
  });
});

// DELETE /api/circles/:id/members/:memberId — remove a member (creator only)
router.delete('/:id/members/:memberId', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const { id: circleId, memberId } = req.params;
  const circle = await db.circle.findUnique({ where: { id: circleId }, include: { members: true } });
  if (!circle) { res.status(404).json({ error: 'Circle not found' }); return; }
  if (circle.createdById !== userId) { res.status(403).json({ error: 'Only the creator can remove members' }); return; }
  if (!circle.members.some(m => m.userId === memberId)) { res.status(404).json({ error: 'Member not found' }); return; }
  if (memberId === userId) { res.status(400).json({ error: 'Use DELETE /api/circles/:id to leave yourself' }); return; }
  await db.circleMember.delete({ where: { circleId_userId: { circleId, userId: memberId } } });
  res.status(204).send();
});

// GET /api/circles/:circleId/members/:userId/wishes
// View another member's wish list — includes reservation status but never reveals who reserved
router.get('/:circleId/members/:memberId/wishes', requireAuth, async (req: Request, res: Response) => {
  const currentUserId = (req as AuthRequest).userId;
  const { circleId, memberId } = req.params;

  // verify both users are in the circle
  const [viewerMember, targetMember] = await Promise.all([
    db.circleMember.findUnique({ where: { circleId_userId: { circleId, userId: currentUserId } } }),
    db.circleMember.findUnique({ where: { circleId_userId: { circleId, userId: memberId } } }),
  ]);
  if (!viewerMember || !targetMember) {
    res.status(403).json({ error: 'Not in the same circle' });
    return;
  }
  // can't use this route to view your own wishes (use GET /api/wishes)
  if (memberId === currentUserId) {
    res.status(400).json({ error: 'Use GET /api/wishes for your own list' });
    return;
  }

  const wishes = await db.wish.findMany({
    where: { userId: memberId },
    include: {
      reservation: true,
      reactions: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const result = wishes.map(w => {
    const counts = { heart: 0, eyes: 0, gift: 0 };
    for (const r of w.reactions) {
      if (r.type in counts) counts[r.type as keyof typeof counts]++;
    }
    // reservation: null, { byMe: true }, or { byMe: false }
    // never expose who reserved it to prevent the wish owner from finding out
    let reservation: null | { byMe: boolean } = null;
    if (w.reservation) {
      reservation = { byMe: w.reservation.userId === currentUserId };
    }
    return {
      id: w.id,
      title: w.title,
      imagePath: w.imagePath,
      imageTint: w.imageTint,
      imageLabel: w.imageLabel,
      price: w.price,
      originalPrice: w.originalPrice,
      currency: w.currency,
      store: w.store,
      storeUrl: w.storeUrl,
      category: w.category,
      priority: w.priority,
      occasion: w.occasion,
      notes: w.notes,
      discount: w.discount,
      reservation,
      reactions: counts,
    };
  });

  res.json(result);
});

export default router;
