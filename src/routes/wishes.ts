import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import db from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { config } from '../config';
import { tryAmazon, scrapeHttp, scrapeBrowser } from '../lib/scraper';

const router = Router();

async function notifyCircleOfNewWish(userId: string, wishTitle: string) {
  const { sendNewWishNotification } = await import('../lib/email');
  const memberships = await db.circleMember.findMany({
    where: { userId },
    include: { circle: { include: { members: { include: { user: true } } } } },
  });
  for (const m of memberships) {
    const others = m.circle.members.filter(cm => cm.userId !== userId && cm.user.email && cm.user.notifNewWishes);
    if (others.length === 0) continue;
    const adder = await db.user.findUnique({ where: { id: userId } });
    if (!adder) continue;
    await sendNewWishNotification(
      others.map(o => o.user.email),
      adder.name,
      wishTitle,
      m.circle.name
    );
  }
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => {
    const dir = path.join(config.uploadsDir, 'wishes');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const wishSchema = z.object({
  title: z.string().min(1),
  imageTint: z.string().optional(),
  imageLabel: z.string().optional(),
  price: z.number().min(0),
  originalPrice: z.number().min(0).optional(),
  currency: z.string().default('$'),
  store: z.string().min(1),
  storeUrl: z.string().url().or(z.literal('')).optional().transform(v => v || undefined),
  category: z.string().min(1),
  priority: z.enum(['must', 'love', 'nice']),
  occasion: z.string().min(1),
  notes: z.string().default(''),
  discount: z.boolean().default(false),
});

function formatWish(wish: any, reactions: any[]) {
  const counts = { heart: 0, eyes: 0, gift: 0 };
  for (const r of reactions) {
    if (r.type in counts) counts[r.type as keyof typeof counts]++;
  }
  return {
    id: wish.id,
    title: wish.title,
    imagePath: wish.imagePath,
    imageTint: wish.imageTint,
    imageLabel: wish.imageLabel,
    price: wish.price,
    originalPrice: wish.originalPrice,
    currency: wish.currency,
    store: wish.store,
    storeUrl: wish.storeUrl,
    category: wish.category,
    priority: wish.priority,
    occasion: wish.occasion,
    notes: wish.notes,
    discount: wish.discount,
    reactions: counts,
    createdAt: wish.createdAt,
  };
}

// GET /api/wishes — my own wishes
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const wishes = await db.wish.findMany({
    where: { userId },
    include: { reactions: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(wishes.map(w => formatWish(w, w.reactions)));
});

// POST /api/wishes
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const parsed = wishSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const wish = await db.wish.create({
    data: { ...parsed.data, userId },
    include: { reactions: true },
  });
  res.status(201).json(formatWish(wish, wish.reactions));

  // notify circle members of new wish (fire and forget)
  notifyCircleOfNewWish(userId, wish.title).catch(() => {});
});

// GET /api/wishes/scrape?url=...
router.get('/scrape', requireAuth, async (req: Request, res: Response) => {
  const url = String(req.query.url ?? '');
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    res.status(400).json({ error: 'Invalid URL' });
    return;
  }

  // Layer 0: Amazon — tries real HTTP fetch first, falls back to URL extraction
  const amazon = await tryAmazon(url);
  if (amazon) {
    res.json(amazon);
    return;
  }

  // Layer 1: HTTP scrape — fast, covers ~75% of sites
  // Parses OG tags, JSON-LD, __NEXT_DATA__ (Next.js), microdata, heuristic price scan
  const http = await scrapeHttp(url);
  if (http?.title && (http.price || http.image)) {
    res.json(http);
    return;
  }

  // Layer 2: Puppeteer — real Chromium, handles JS-rendered and bot-protected sites
  // Falls back gracefully if chromium isn't installed in the container
  const browser = await scrapeBrowser(url);
  if (browser?.title) {
    res.json({ ...browser, _note: 'browser' });
    return;
  }

  // Return whatever partial data we have, or empty
  res.json(http ?? { title: null, image: null, price: null, store: null });
});

// PATCH /api/wishes/:id
router.patch('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const wish = await db.wish.findUnique({ where: { id: req.params.id } });
  if (!wish || wish.userId !== userId) {
    res.status(404).json({ error: 'Wish not found' });
    return;
  }
  const parsed = wishSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const updated = await db.wish.update({
    where: { id: req.params.id },
    data: parsed.data,
    include: { reactions: true },
  });
  res.json(formatWish(updated, updated.reactions));
});

// DELETE /api/wishes/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const wish = await db.wish.findUnique({ where: { id: req.params.id } });
  if (!wish || wish.userId !== userId) {
    res.status(404).json({ error: 'Wish not found' });
    return;
  }
  // delete image file if it exists
  if (wish.imagePath) {
    const fullPath = path.join(config.uploadsDir, wish.imagePath);
    fs.unlink(fullPath, () => {});
  }
  await db.wish.delete({ where: { id: req.params.id } });
  res.status(204).send();
});

// POST /api/wishes/:id/image
router.post('/:id/image', requireAuth, upload.single('image'), async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const wish = await db.wish.findUnique({ where: { id: req.params.id } });
  if (!wish || wish.userId !== userId) {
    res.status(404).json({ error: 'Wish not found' });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  // delete old image
  if (wish.imagePath) {
    fs.unlink(path.join(config.uploadsDir, wish.imagePath), () => {});
  }
  const imagePath = `wishes/${req.file.filename}`;
  await db.wish.update({ where: { id: req.params.id }, data: { imagePath } });
  res.json({ imagePath });
});

// POST /api/wishes/:id/reserve
router.post('/:id/reserve', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const wish = await db.wish.findUnique({ where: { id: req.params.id }, include: { reservation: true } });
  if (!wish) {
    res.status(404).json({ error: 'Wish not found' });
    return;
  }
  // can't reserve your own wish
  if (wish.userId === userId) {
    res.status(403).json({ error: 'Cannot reserve your own wish' });
    return;
  }
  // already reserved by someone else
  if (wish.reservation && wish.reservation.userId !== userId) {
    res.status(409).json({ error: 'Already reserved by someone else' });
    return;
  }
  // toggle off if already reserved by me
  if (wish.reservation?.userId === userId) {
    await db.reservation.delete({ where: { wishId: wish.id } });
    res.json({ reserved: false });
    return;
  }
  await db.reservation.create({ data: { wishId: wish.id, userId } });
  res.json({ reserved: true });

  // send confirmation email (fire and forget)
  (async () => {
    const [reserver, owner] = await Promise.all([
      db.user.findUnique({ where: { id: userId } }),
      db.user.findUnique({ where: { id: wish.userId } }),
    ]);
    if (!reserver) return;
    const { sendReservationConfirm } = await import('../lib/email');
    await sendReservationConfirm(reserver.email, reserver.name, wish.title, owner?.name ?? 'them');
  })().catch(() => {});
});

// POST /api/wishes/:id/reactions/:type
router.post('/:id/reactions/:type', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const { id, type } = req.params;
  if (!['heart', 'eyes', 'gift'].includes(type)) {
    res.status(400).json({ error: 'Invalid reaction type' });
    return;
  }
  const wish = await db.wish.findUnique({ where: { id } });
  if (!wish) {
    res.status(404).json({ error: 'Wish not found' });
    return;
  }
  const existing = await db.reaction.findUnique({ where: { wishId_userId_type: { wishId: id, userId, type } } });
  if (existing) {
    await db.reaction.delete({ where: { wishId_userId_type: { wishId: id, userId, type } } });
    res.json({ active: false });
  } else {
    await db.reaction.create({ data: { wishId: id, userId, type } });
    res.json({ active: true });

    // notify wish owner if opted in (fire and forget)
    if (wish.userId !== userId) {
      (async () => {
        const [owner, reactor] = await Promise.all([
          db.user.findUnique({ where: { id: wish.userId } }),
          db.user.findUnique({ where: { id: userId } }),
        ]);
        if (owner?.email && owner.notifReactions && reactor) {
          const { sendReactionNotification } = await import('../lib/email');
          await sendReactionNotification(owner.email, reactor.name, wish.title, type);
        }
      })().catch(() => {});
    }
  }
});

// GET /api/activity — recent reservations and purchases in my circles
router.get('/activity', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const circleIds = await db.circleMember.findMany({ where: { userId }, select: { circleId: true } });
  const memberUserIds = await db.circleMember.findMany({
    where: { circleId: { in: circleIds.map(c => c.circleId) }, userId: { not: userId } },
    select: { userId: true },
  });
  const otherIds = [...new Set(memberUserIds.map(m => m.userId))];

  const [reservations, purchases] = await Promise.all([
    db.reservation.findMany({
      where: { userId: { in: otherIds } },
      include: { user: { select: { name: true, nickname: true, color: true, initial: true } }, wish: { select: { title: true, userId: true } } },
      orderBy: { reservedAt: 'desc' },
      take: 10,
    }),
    db.purchasedItem.findMany({
      where: { purchasedBy: { in: otherIds } },
      include: { buyer: { select: { name: true, nickname: true, color: true, initial: true } }, wish: { select: { title: true, userId: true } } },
      orderBy: { purchasedAt: 'desc' },
      take: 10,
    }),
  ]);

  // only show reservations for wishes NOT owned by the requester (privacy)
  const items = [
    ...reservations
      .filter(r => r.wish.userId !== userId)
      .map(r => ({ type: 'reserve' as const, person: r.user, wishTitle: r.wish.title, at: r.reservedAt })),
    ...purchases
      .map(p => ({ type: 'purchase' as const, person: p.buyer, wishTitle: p.wish.title, at: p.purchasedAt })),
  ]
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 8)
    .map(i => ({ ...i, at: i.at.toISOString() }));

  res.json(items);
});

export default router;
