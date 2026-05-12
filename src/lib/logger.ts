import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { config } from './config';

fs.mkdirSync(config.logsPath, { recursive: true });

const isProd = config.nodeEnv === 'production';

const transport = isProd
  ? pino.transport({
      target: 'pino-roll',
      options: {
        file: path.join(config.logsPath, 'ota'),
        frequency: 'daily',
        extension: '.log',
        mkdir: true,
      },
    })
  : pino.transport({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard' },
    });

export const logger = pino(
  {
    level: config.logLevel,
    base: { service: 'beautybay-ota' },
  },
  transport,
);
