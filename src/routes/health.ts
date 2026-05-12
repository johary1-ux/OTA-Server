import { Router } from 'express';

const startedAt = Date.now();

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.round((Date.now() - startedAt) / 1000),
    version: process.env.npm_package_version ?? '0.1.0',
  });
});
