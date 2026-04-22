import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';
import db from '../db';
import { signToken, requireAuth, AuthRequest } from '../middleware/auth';
import { sendWelcome } from '../lib/email';
import { config } from '../config';

const router = Router();

const avatarStorage = multer.diskStorage({
  destination: (_, __, cb) => {
    const dir = path.join(config.uploadsDir, 'avatars');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const uploadAvatar = multer({ storage: avatarStorage, limits: { fileSize: 3 * 1024 * 1024 } });

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  nickname: z.string().min(1),
  birthday: z.string().optional(),
  color: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

function safeUser(user: any) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    nickname: user.nickname,
    color: user.color,
    initial: user.initial,
    birthday: user.birthday,
    avatarPath: user.avatarPath ?? null,
    notifBirthdays: user.notifBirthdays ?? true,
    notifPriceDrops: user.notifPriceDrops ?? true,
    notifNewWishes: user.notifNewWishes ?? false,
    notifReactions: user.notifReactions ?? true,
  };
}

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { password, name, nickname, birthday, color } = parsed.data;
  const email = parsed.data.email.toLowerCase();

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: 'Email already in use' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const initial = (nickname[0] || name[0]).toUpperCase();

  const user = await db.user.create({
    data: {
      email,
      passwordHash,
      name,
      nickname,
      initial,
      birthday: birthday || null,
      color: color || '#F2C2C9',
    },
  });

  // fire and forget — don't fail registration if email fails
  sendWelcome(email, name).catch(() => {});

  res.status(201).json({ token: signToken(user.id), user: safeUser(user) });
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }
  const { password } = parsed.data;
  const email = parsed.data.email.toLowerCase();

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: 'Invalid email or password' });
    return;
  }

  res.json({ token: signToken(user.id), user: safeUser(user) });
});

// GET /api/auth/me
router.get('/me', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(safeUser(user));
});

// PATCH /api/auth/me
router.patch('/me', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const schema = z.object({
    name: z.string().min(1).optional(),
    nickname: z.string().min(1).optional(),
    color: z.string().optional(),
    birthday: z.string().optional(),
    notifBirthdays: z.boolean().optional(),
    notifPriceDrops: z.boolean().optional(),
    notifNewWishes: z.boolean().optional(),
    notifReactions: z.boolean().optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const data: Record<string, any> = {};
  if (parsed.data.name) data.name = parsed.data.name;
  if (parsed.data.nickname) {
    data.nickname = parsed.data.nickname;
    data.initial = parsed.data.nickname[0].toUpperCase();
  }
  if (parsed.data.color) data.color = parsed.data.color;
  if (parsed.data.birthday !== undefined) data.birthday = parsed.data.birthday;
  if (parsed.data.notifBirthdays !== undefined) data.notifBirthdays = parsed.data.notifBirthdays;
  if (parsed.data.notifPriceDrops !== undefined) data.notifPriceDrops = parsed.data.notifPriceDrops;
  if (parsed.data.notifNewWishes !== undefined) data.notifNewWishes = parsed.data.notifNewWishes;
  if (parsed.data.notifReactions !== undefined) data.notifReactions = parsed.data.notifReactions;

  if (parsed.data.currentPassword && parsed.data.newPassword) {
    const existing = await db.user.findUnique({ where: { id: userId } });
    if (!existing) { res.status(404).json({ error: 'User not found' }); return; }
    const valid = await bcrypt.compare(parsed.data.currentPassword, existing.passwordHash);
    if (!valid) { res.status(400).json({ error: 'Current password is incorrect' }); return; }
    data.passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  }

  const user = await db.user.update({ where: { id: userId }, data });
  res.json(safeUser(user));
});

// POST /api/auth/me/avatar
router.post('/me/avatar', requireAuth, uploadAvatar.single('avatar'), async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  if (user.avatarPath) {
    fs.unlink(path.join(config.uploadsDir, user.avatarPath), () => {});
  }
  const avatarPath = `avatars/${req.file.filename}`;
  const updated = await db.user.update({ where: { id: userId }, data: { avatarPath } });
  res.json(safeUser(updated));
});

// DELETE /api/auth/me/avatar
router.delete('/me/avatar', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  if (user.avatarPath) {
    fs.unlink(path.join(config.uploadsDir, user.avatarPath), () => {});
  }
  const updated = await db.user.update({ where: { id: userId }, data: { avatarPath: null } });
  res.json(safeUser(updated));
});

// DELETE /api/auth/me — delete account and all data
router.delete('/me', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const schema = require('zod').z.object({ password: require('zod').z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Password required' }); return; }
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  const valid = await bcrypt.compare(parsed.data.password, user.passwordHash);
  if (!valid) { res.status(400).json({ error: 'Incorrect password' }); return; }
  // Cascade: Prisma schema should handle related records; if not, delete manually
  await db.user.delete({ where: { id: userId } });
  res.status(204).send();
});

export default router;
