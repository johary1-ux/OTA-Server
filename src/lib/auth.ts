import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config';

const HEADER = 'x-ota-publish-key';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function requirePublishKey(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const provided = req.header(HEADER);
  if (!provided || !safeEqual(provided, config.publishKey)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
