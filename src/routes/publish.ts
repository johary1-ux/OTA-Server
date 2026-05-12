import fs from 'node:fs/promises';
import path from 'node:path';
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import multer, { MulterError } from 'multer';
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

const BUNDLE_FIELDS = new Set(['bundle', 'bundle[]']);
const ASSET_FIELDS = new Set(['assets', 'assets[]', 'asset', 'asset[]']);

/** Regex for a safe runtimeVersion (semver-like or short identifier). */
const RUNTIME_VERSION_RE = /^[A-Za-z0-9._-]{1,64}$/;

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
    fields: 50,
    fieldSize: 1 * 1024 * 1024, // 1 MB per text field
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

async function safeUnlink(p: string): Promise<void> {
  try {
    await fs.unlink(p);
  } catch {
    // file already gone, ignore
  }
}

async function cleanupTempFiles(files: Express.Multer.File[]): Promise<void> {
  await Promise.all(files.map((f) => safeUnlink(f.path)));
}

/**
 * Multer wrapper that converts MulterError to a 400 JSON response.
 * Anything non-Multer falls through to the global error handler.
 * Uses `upload.any()` so we accept any field name and sort files by name
 * server-side — this gives us robustness against varied client conventions
 * (`assets`, `assets[]`, `asset`, …).
 */
function uploadMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  upload.any()(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      logger.warn(
        { code: err.code, field: err.field, message: err.message },
        'Upload rejected by multer',
      );
      res.status(400).json({
        error: 'Upload failed',
        code: err.code,
        field: err.field,
        message: err.message,
      });
      return;
    }
    if (err) {
      next(err);
      return;
    }
    next();
  });
}

export const publishRouter = Router();

publishRouter.post(
  '/api/publish',
  publishLimiter,
  requirePublishKey,
  uploadMiddleware,
  async (req, res, next) => {
    const allFiles = (req.files as Express.Multer.File[] | undefined) ?? [];

    const bundleFile = allFiles.find((f) => BUNDLE_FIELDS.has(f.fieldname));
    const assetFiles = allFiles.filter((f) => ASSET_FIELDS.has(f.fieldname));
    const stragglers = allFiles.filter(
      (f) => !BUNDLE_FIELDS.has(f.fieldname) && !ASSET_FIELDS.has(f.fieldname),
    );

    // Any file uploaded under an unexpected field is logged and discarded
    // (rather than rejected) so a slightly malformed client doesn't fail
    // an entire publish.
    if (stragglers.length > 0) {
      for (const s of stragglers) {
        logger.warn(
          { field: s.fieldname, fileName: s.originalname },
          'Ignoring unexpected file field',
        );
      }
      await cleanupTempFiles(stragglers);
    }

    try {
      const channel = String(req.body.channel ?? '').trim();
      const runtimeVersion = String(req.body.runtimeVersion ?? '').trim();
      const platform = String(req.body.platform ?? '').trim();
      const commit = req.body.commit ? String(req.body.commit).trim() : undefined;
      const message = req.body.message ? String(req.body.message) : undefined;

      if (!VALID_CHANNELS.includes(channel as Channel)) {
        res.status(400).json({
          error: `Invalid channel: "${channel}". Expected one of: ${VALID_CHANNELS.join(', ')}`,
        });
        await cleanupTempFiles(allFiles);
        return;
      }
      if (!runtimeVersion || !RUNTIME_VERSION_RE.test(runtimeVersion)) {
        res.status(400).json({
          error: `Invalid runtimeVersion: "${runtimeVersion}". Must match ${RUNTIME_VERSION_RE}.`,
        });
        await cleanupTempFiles(allFiles);
        return;
      }
      if (!VALID_PLATFORMS.includes(platform as Platform)) {
        res.status(400).json({
          error: `Invalid platform: "${platform}". Expected one of: ${VALID_PLATFORMS.join(', ')}`,
        });
        await cleanupTempFiles(allFiles);
        return;
      }
      if (!bundleFile) {
        res.status(400).json({
          error:
            'Missing "bundle" file field. Send the JS bundle as a multipart file part named "bundle".',
        });
        await cleanupTempFiles(allFiles);
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
          assetCount: storedAssets.length,
          commit,
        },
        'Published new update',
      );

      res.status(200).json({
        id,
        url: `${config.publicBaseUrl.replace(/\/+$/, '')}/assets/${bundleHash}`,
        hash: bundleHash,
      });
    } catch (err) {
      // Any leftover temp files at this point — clean them up.
      // (persistAsset already removed the ones it consumed.)
      await cleanupTempFiles(allFiles);
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr?.code === 'ENOSPC') {
        logger.error({ err }, 'Out of disk space while publishing');
        res.status(507).json({ error: 'Insufficient storage on the server.' });
        return;
      }
      if (nodeErr?.code === 'EACCES' || nodeErr?.code === 'EPERM') {
        logger.error({ err, path: nodeErr.path }, 'Permission denied while publishing');
        res.status(500).json({ error: 'Server cannot write to its storage directory.' });
        return;
      }
      next(err);
    }
  },
);
