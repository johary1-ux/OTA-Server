import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../lib/config';
import { logger } from '../lib/logger';
import { sha256FileHex } from '../lib/hash';
import { requirePublishKey } from '../lib/auth';
import {
  persistAsset,
  setLatest,
  writeUpdate,
} from '../lib/storage';
import type {
  Channel,
  Platform,
  StoredAsset,
  StoredUpdate,
} from '../types';

const VALID_CHANNELS: Channel[] = ['development', 'staging', 'production'];
const VALID_PLATFORMS: Platform[] = ['ios', 'android'];

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, config.uploadsTmp),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${uuidv4()}${ext}`);
    },
  }),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100 MB per file
    files: 250,
  },
});

const publishLimiter = rateLimit({
  windowMs: config.publishRate.windowMs,
  max: config.publishRate.max,
  standardHeaders: true,
  legacyHeaders: false,
});

function fileExt(originalName: string): string {
  return path.extname(originalName).replace(/^\./, '');
}

export const publishRouter = Router();

publishRouter.post(
  '/api/publish',
  publishLimiter,
  requirePublishKey,
  upload.fields([
    { name: 'bundle', maxCount: 1 },
    { name: 'assets', maxCount: 200 },
    { name: 'assets[]', maxCount: 200 },
  ]),
  async (req, res) => {
    const files = req.files as Record<string, Express.Multer.File[]> | undefined;
    const bundleFile = files?.bundle?.[0];
    const assetFiles = [...(files?.assets ?? []), ...(files?.['assets[]'] ?? [])];

    const channel = String(req.body.channel ?? '');
    const runtimeVersion = String(req.body.runtimeVersion ?? '');
    const platform = String(req.body.platform ?? '');
    const commit = req.body.commit ? String(req.body.commit) : undefined;
    const message = req.body.message ? String(req.body.message) : undefined;

    if (!VALID_CHANNELS.includes(channel as Channel)) {
      res.status(400).json({ error: `Invalid channel: ${channel}` });
      return;
    }
    if (!runtimeVersion) {
      res.status(400).json({ error: 'Missing runtimeVersion' });
      return;
    }
    if (!VALID_PLATFORMS.includes(platform as Platform)) {
      res.status(400).json({ error: `Invalid platform: ${platform}` });
      return;
    }
    if (!bundleFile) {
      res.status(400).json({ error: 'Missing bundle file' });
      return;
    }

    const id = uuidv4();
    const createdAt = new Date().toISOString();

    const bundleHash = await sha256FileHex(bundleFile.path);
    await persistAsset({
      tmpPath: bundleFile.path,
      hashHex: bundleHash,
      contentType: 'application/javascript',
      fileExtension: 'bundle',
    });

    const launchAsset: StoredAsset = {
      key: 'bundle',
      hash: bundleHash,
      contentType: 'application/javascript',
      fileExtension: 'bundle',
      fileName: bundleFile.originalname,
    };

    const storedAssets: StoredAsset[] = [];
    for (const asset of assetFiles) {
      const hashHex = await sha256FileHex(asset.path);
      const ext = fileExt(asset.originalname);
      const contentType = asset.mimetype || 'application/octet-stream';
      await persistAsset({
        tmpPath: asset.path,
        hashHex,
        contentType,
        fileExtension: ext,
      });
      storedAssets.push({
        key: asset.originalname,
        hash: hashHex,
        contentType,
        fileExtension: ext,
        fileName: asset.originalname,
      });
    }

    const update: StoredUpdate = {
      id,
      createdAt,
      channel: channel as Channel,
      platform: platform as Platform,
      runtimeVersion,
      commit,
      message,
      launchAsset,
      assets: storedAssets,
      metadata: {},
      extra: {},
    };

    await writeUpdate(update);
    await setLatest(channel as Channel, runtimeVersion, platform as Platform, id);

    logger.info(
      {
        id,
        channel,
        runtimeVersion,
        platform,
        assets: storedAssets.length,
        commit,
      },
      'Published new update',
    );

    res.status(200).json({
      id,
      url: `${config.publicBaseUrl.replace(/\/+$/, '')}/assets/${bundleHash}`,
      hash: bundleHash,
    });
  },
);
