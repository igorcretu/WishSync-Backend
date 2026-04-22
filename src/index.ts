import express from 'express';
import cors from 'cors';
import path from 'path';
import { config } from './config';
import authRoutes from './routes/auth';
import wishRoutes from './routes/wishes';
import circleRoutes from './routes/circles';
import occasionRoutes from './routes/occasions';
import inviteRoutes from './routes/invites';
import historyRoutes from './routes/history';
import { startScheduler } from './lib/scheduler';

const app = express();

const allowedOrigins = [config.frontendUrl, 'http://localhost:5173'];
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// serve uploaded images
app.use('/uploads', express.static(path.join(config.uploadsDir)));

app.use('/api/auth', authRoutes);
app.use('/api/wishes', wishRoutes);
app.use('/api/circles', circleRoutes);
app.use('/api/occasions', occasionRoutes);
app.use('/api', inviteRoutes);      // handles /api/circles/:id/invites and /api/invites/:token
app.use('/api', historyRoutes);     // handles /api/history and /api/wishes/:id/purchase

app.get('/api/health', (_, res) => res.json({ ok: true }));

app.listen(config.port, () => {
  console.log(`WishSync API running on port ${config.port}`);
  startScheduler();
});
