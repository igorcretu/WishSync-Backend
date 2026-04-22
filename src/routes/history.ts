import { Router, Request, Response } from 'express';
import db from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/history — items I bought or had bought for me
router.get('/history', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const items = await db.purchasedItem.findMany({
    where: {
      OR: [
        { purchasedBy: userId },
        { wish: { userId } },
      ],
    },
    include: {
      buyer: { select: { id: true, name: true, nickname: true } },
      wish: { include: { user: { select: { id: true, name: true, nickname: true } } } },
    },
    orderBy: { purchasedAt: 'desc' },
  });

  res.json(items.map(h => ({
    id: h.id,
    title: h.wish.title,
    for: h.wish.user.nickname,
    by: h.buyer.nickname,
    date: h.purchasedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    price: h.wish.price,
    imageTint: h.wish.imageTint,
    imageLabel: h.wish.imageLabel,
    imagePath: h.wish.imagePath,
  })));
});

// POST /api/wishes/:id/purchase — mark a wish as purchased (must have it reserved)
router.post('/wishes/:id/purchase', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const wish = await db.wish.findUnique({
    where: { id: req.params.id },
    include: { reservation: true, purchase: true },
  });
  if (!wish) {
    res.status(404).json({ error: 'Wish not found' });
    return;
  }
  if (wish.purchase) {
    res.status(409).json({ error: 'Already marked as purchased' });
    return;
  }
  if (!wish.reservation || wish.reservation.userId !== userId) {
    res.status(403).json({ error: 'You must reserve the wish before marking it purchased' });
    return;
  }
  const item = await db.purchasedItem.create({ data: { wishId: wish.id, purchasedBy: userId } });
  res.status(201).json({ id: item.id });
});

export default router;
