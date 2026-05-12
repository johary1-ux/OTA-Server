import { Router } from 'express';
import { config } from '../lib/config';
import { logger } from '../lib/logger';
import { buildManifest, buildManifestMultipart } from '../lib/manifest-builder';
import { readLatestUpdate } from '../lib/storage';
import type { Channel, Platform } from '../types';

const VALID_CHANNELS: Channel[] = ['development', 'staging', 'production'];
const VALID_PLATFORMS: Platform[] = ['ios', 'android'];

/** Same regex as publish — must stay in sync. */
const RUNTIME_VERSION_RE = /^[A-Za-z0-9._-]{1,64}$/;

export const manifestRouter = Router();

manifestRouter.get('/api/manifest', async (req, res, next) => {
  try {
    const channel = (req.header('expo-channel-name') ?? '').trim();
    const runtimeVersion = (req.header('expo-runtime-version') ?? '').trim();
    const platform = (req.header('expo-platform') ?? '').trim();
    const protocolVersion = (req.header('expo-protocol-version') ?? '1').trim();

    if (!channel || !VALID_CHANNELS.includes(channel as Channel)) {
      res.status(400).json({
        error: `Invalid or missing expo-channel-name. Expected one of: ${VALID_CHANNELS.join(', ')}`,
      });
      return;
    }
    if (!runtimeVersion || !RUNTIME_VERSION_RE.test(runtimeVersion)) {
      res.status(400).json({
        error: 'Invalid or missing expo-runtime-version',
      });
      return;
    }
    if (!platform || !VALID_PLATFORMS.includes(platform as Platform)) {
      res.status(400).json({
        error: `Invalid or missing expo-platform. Expected one of: ${VALID_PLATFORMS.join(', ')}`,
      });
      return;
    }
    if (protocolVersion !== '1') {
      res.status(400).json({
        error: `Unsupported expo-protocol-version: ${protocolVersion}. Only v1 is supported.`,
      });
      return;
    }

    const update = await readLatestUpdate(
      channel as Channel,
      runtimeVersion,
      platform as Platform,
    );

    if (!update) {
      logger.info(
        { channel, runtimeVersion, platform },
        'No update available — returning 204',
      );
      res.status(204).end();
      return;
    }

    if (!config.publicBaseUrl) {
      logger.error(
        'OTA_PUBLIC_BASE_URL is not configured — asset URLs would be relative. Refusing to serve manifest.',
      );
      res.status(500).json({
        error: 'Server misconfiguration: OTA_PUBLIC_BASE_URL is not set.',
      });
      return;
    }

    const manifest = buildManifest({ update, publicBaseUrl: config.publicBaseUrl });
    const { body, contentType } = buildManifestMultipart(manifest);

    res.setHeader('expo-protocol-version', '1');
    res.setHeader('expo-sfv-version', '0');
    res.setHeader('cache-control', 'private, max-age=0');
    res.setHeader('content-type', contentType);
    res.status(200).send(body);
  } catch (err) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr?.name === 'SyntaxError') {
      logger.error({ err }, 'Corrupted latest.json or update.json on disk');
      res.status(500).json({ error: 'Manifest store is corrupted on the server.' });
      return;
    }
    next(err);
  }
});
