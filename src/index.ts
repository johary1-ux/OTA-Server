import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { MulterError } from 'multer';
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

  const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    const ctx = { method: req.method, url: req.url };

    if (res.headersSent) {
      logger.error({ err, ...ctx }, 'Error after headers were sent — destroying response');
      res.destroy(err as Error);
      return;
    }

    // Multer: client sent something we can't accept (oversize, too many files, etc.)
    if (err instanceof MulterError) {
      logger.warn({ ...ctx, code: err.code, field: err.field }, 'Multer error');
      res.status(400).json({
        error: 'Upload failed',
        code: err.code,
        field: err.field,
        message: err.message,
      });
      return;
    }

    // express.json() / express.urlencoded() parse error
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      logger.warn({ ...ctx, err }, 'Body parse failed');
      res.status(400).json({ error: 'Malformed request body' });
      return;
    }

    if ((err as { type?: string }).type === 'entity.too.large') {
      logger.warn({ ...ctx }, 'Request body too large');
      res.status(413).json({ error: 'Request body too large' });
      return;
    }

    logger.error({ err, ...ctx }, 'Unhandled error');
    res.status(500).json({
      error: 'Internal Server Error',
      ...(config.nodeEnv !== 'production' && err instanceof Error
        ? { detail: err.message }
        : {}),
    });
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

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — shutting down');
    server.close(() => process.exit(1));
    setTimeout(() => process.exit(1), 5_000).unref();
  });
}

main().catch((err) => {
  logger.error({ err }, 'Fatal startup error');
  process.exit(1);
});
