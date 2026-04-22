import { Router, Request, Response } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, AuthRequest } from '../middleware/auth';
import { sendInvite } from '../lib/email';
import { config } from '../config';

const router = Router();

// POST /api/circles/:circleId/invites — generate invite link
router.post('/circles/:circleId/invites', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const { circleId } = req.params;

  const member = await db.circleMember.findUnique({
    where: { circleId_userId: { circleId, userId } },
    include: { circle: true },
  });
  if (!member) {
    res.status(403).json({ error: 'Not a member of this circle' });
    return;
  }

  const schema = z.object({ email: z.string().email().optional() });
  const parsed = schema.safeParse(req.body);
  const email = parsed.success ? parsed.data.email : undefined;

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const invite = await db.invite.create({
    data: { circleId, invitedById: userId, expiresAt },
    include: { invitedBy: true, circle: true },
  });

  const inviteUrl = `${config.frontendUrl}/invite/${invite.id}`;

  if (email) {
    sendInvite(email, invite.invitedBy.name, invite.circle.name, inviteUrl).catch(() => {});
  }

  res.status(201).json({ inviteUrl, expiresAt });
});

// GET /api/invites/:token — preview invite (no auth required, so user can see before logging in)
router.get('/invites/:token', async (req: Request, res: Response) => {
  const invite = await db.invite.findUnique({
    where: { id: req.params.token },
    include: { circle: true, invitedBy: true },
  });
  if (!invite) {
    res.status(404).json({ error: 'Invite not found' });
    return;
  }
  if (invite.used) {
    res.status(410).json({ error: 'Invite already used' });
    return;
  }
  if (invite.expiresAt < new Date()) {
    res.status(410).json({ error: 'Invite expired' });
    return;
  }
  res.json({
    circleName: invite.circle.name,
    circleType: invite.circle.type,
    inviterName: invite.invitedBy.name,
  });
});

// POST /api/invites/:token/accept — requires auth
router.post('/invites/:token/accept', requireAuth, async (req: Request, res: Response) => {
  const userId = (req as AuthRequest).userId;
  const invite = await db.invite.findUnique({
    where: { id: req.params.token },
    include: { circle: { include: { members: true } } },
  });
  if (!invite) {
    res.status(404).json({ error: 'Invite not found' });
    return;
  }
  if (invite.used) {
    res.status(410).json({ error: 'Invite already used' });
    return;
  }
  if (invite.expiresAt < new Date()) {
    res.status(410).json({ error: 'Invite expired' });
    return;
  }

  const alreadyMember = invite.circle.members.some(m => m.userId === userId);
  if (alreadyMember) {
    res.status(409).json({ error: 'Already a member of this circle' });
    return;
  }

  // for couple circles, enforce max 2 members
  if (invite.circle.type === 'couple' && invite.circle.members.length >= 2) {
    res.status(409).json({ error: 'Couple circle is already full' });
    return;
  }

  await db.$transaction([
    db.circleMember.create({ data: { circleId: invite.circleId, userId } }),
    db.invite.update({ where: { id: invite.id }, data: { used: true, usedById: userId } }),
  ]);

  res.json({ circleId: invite.circleId, circleName: invite.circle.name });
});

export default router;
