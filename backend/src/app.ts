import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { env } from './config/env';
import { authRouter } from './routes/auth.routes';
import { teamRouter } from './routes/team.routes';
import { workItemRouter } from './routes/workItem.routes';
import { errorHandler } from './middleware/errorHandler';
import { ApiError } from './utils/errors';

export const app = express();

// Security & Parsing Middleware
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'If-Match'],
  })
);

app.use(express.json());

// Healthcheck endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: env.NODE_ENV,
  });
});

// Mount API v1 Routers
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/teams', teamRouter);
app.use('/api/v1/work-items', workItemRouter);

// 404 Fallback
app.use((_req: Request, _res: Response, next: NextFunction) => {
  next(ApiError.notFound('Requested API endpoint does not exist'));
});

// Global Error Handler
app.use(errorHandler);
