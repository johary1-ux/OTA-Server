import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { config } from './lib/config';
import { logger } from './lib/logger';
import { ensureDirs } from './lib/storage';
import { healthRouter } from './routes/health';
import { manifestRouter } from './routes/manifest';
import { publishRouter } from './routes/publish';
import { assetsRouter } from './routes/assets';

async function main(): Promise<void> {
  await ensureDirs();

  const app = express();

  // helmet: keep default protections, but the manifest endpoint returns
  // multipart/mixed so we leave content-type handling to our route.
  app.use(helmet({ contentSecurityPolicy: false }));

  app.use(
    cors({
      origin: config.corsOrigins.length > 0 ? config.corsOrigins : false,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: [
        'content-type',
        'expo-channel-name',
        'expo-runtime-version',
        'expo-platform',
        'expo-protocol-version',
        'expo-current-update-id',
        'expo-embedded-update-id',
        'expo-expect-signature',
        'x-ota-publish-key',
      ],
      exposedHeaders: [
        'expo-protocol-version',
        'expo-sfv-version',
      ],
    }),
  );

  // Lightweight access log
  app.use((req, _res, next) => {
    logger.debug({ method: req.method, url: req.url }, 'request');
    next();
  });

  app.use(healthRouter);
  app.use(manifestRouter);
  app.use(publishRouter);
  app.use(assetsRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not Found' });
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    logger.error({ err }, 'Unhandled error');
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal Server Error' });
  };
  app.use(errorHandler);

  const server = app.listen(config.port, () => {
    logger.info(
      {
        port: config.port,
        nodeEnv: config.nodeEnv,
        bundlesPath: config.bundlesPath,
        publicBaseUrl: config.publicBaseUrl || '(unset)',
      },
      'OTA server listening',
    );
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(
        { port: config.port },
        `Port ${config.port} is already in use. Run "npm run kill-port" or change PORT in .env.`,
      );
      process.exit(1);
    }
    logger.error({ err }, 'Server error');
    process.exit(1);
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, 'Shutting down');
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
