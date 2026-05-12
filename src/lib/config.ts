import 'dotenv/config';
import path from 'node:path';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} must be a number`);
  return n;
}

const bundlesPath = path.resolve(
  process.env.OTA_BUNDLES_PATH ?? path.join(process.cwd(), 'data', 'bundles'),
);
const logsPath = path.resolve(
  process.env.OTA_LOGS_PATH ?? path.join(process.cwd(), 'data', 'logs'),
);
const uploadsTmp = path.resolve(
  process.env.OTA_UPLOADS_TMP ?? path.join(process.cwd(), 'data', 'tmp'),
);

export const config = {
  port: int('PORT', 3000),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  bundlesPath,
  logsPath,
  uploadsTmp,
  publishKey: required('OTA_PUBLISH_KEY', 'change-me'),
  publicBaseUrl: (process.env.OTA_PUBLIC_BASE_URL ?? '').replace(/\/+$/, ''),
  corsOrigins: (process.env.OTA_CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  publishRate: {
    windowMs: int('OTA_PUBLISH_RATE_WINDOW_MS', 60_000),
    max: int('OTA_PUBLISH_RATE_MAX', 10),
  },
} as const;

export type AppConfig = typeof config;
