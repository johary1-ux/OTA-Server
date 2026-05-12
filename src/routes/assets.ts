import fs from 'node:fs';
import { Router } from 'express';
import { logger } from '../lib/logger';
import { readAssetByHash } from '../lib/storage';

const HEX_RE = /^[a-f0-9]{64}$/i;

export const assetsRouter = Router();

assetsRouter.get('/assets/:hash', async (req, res, next) => {
  try {
    const { hash } = req.params;
    if (!HEX_RE.test(hash)) {
      res.status(400).json({ error: 'Invalid asset hash. Expected hex SHA-256 (64 chars).' });
      return;
    }

    const asset = await readAssetByHash(hash.toLowerCase());
    if (!asset) {
      res.status(404).json({ error: 'Asset not found' });
      return;
    }

    res.setHeader('content-type', asset.contentType);
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');

    const stream = fs.createReadStream(asset.filePath);
    stream.on('error', (err) => {
      logger.error({ err, hash, filePath: asset.filePath }, 'Asset stream error');
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to read asset' });
        return;
      }
      res.destroy(err);
    });
    // If the client aborts, abandon the stream so we don't keep the fd open.
    req.on('close', () => stream.destroy());

    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});
