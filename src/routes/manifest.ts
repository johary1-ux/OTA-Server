import { Router } from 'express';
import { config } from '../lib/config';
import { logger } from '../lib/logger';
import { buildManifest, buildManifestMultipart } from '../lib/manifest-builder';
import { readLatestUpdate } from '../lib/storage';
import type { Channel, Platform } from '../types';

const VALID_CHANNELS: Channel[] = ['development', 'staging', 'production'];
const VALID_PLATFORMS: Platform[] = ['ios', 'android'];

export const manifestRouter = Router();

manifestRouter.get('/api/manifest', async (req, res) => {
  const channel = req.header('expo-channel-name');
  const runtimeVersion = req.header('expo-runtime-version');
  const platform = req.header('expo-platform');
  const protocolVersion = req.header('expo-protocol-version') ?? '1';

  if (!channel || !VALID_CHANNELS.includes(channel as Channel)) {
    res.status(400).json({ error: 'Invalid or missing expo-channel-name' });
    return;
  }
  if (!runtimeVersion) {
    res.status(400).json({ error: 'Missing expo-runtime-version' });
    return;
  }
  if (!platform || !VALID_PLATFORMS.includes(platform as Platform)) {
    res.status(400).json({ error: 'Invalid or missing expo-platform' });
    return;
  }
  if (protocolVersion !== '1') {
    res.status(400).json({ error: `Unsupported expo-protocol-version: ${protocolVersion}` });
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

  const manifest = buildManifest({ update, publicBaseUrl: config.publicBaseUrl });
  const { body, contentType } = buildManifestMultipart(manifest);

  res.setHeader('expo-protocol-version', '1');
  res.setHeader('expo-sfv-version', '0');
  res.setHeader('cache-control', 'private, max-age=0');
  res.setHeader('content-type', contentType);
  res.status(200).send(body);
});
