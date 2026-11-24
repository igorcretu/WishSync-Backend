import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthRequest extends Request {
  userId: string;
}

export function signToken(userId: string): string {
  return jwt.sign({ sub: userId }, config.jwtSecret, { expiresIn: '365d' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers.authorization;
  if (!auth?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const payload = jwt.verify(auth.slice(7), config.jwtSecret) as { sub: string };
    (req as AuthRequest).userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}
