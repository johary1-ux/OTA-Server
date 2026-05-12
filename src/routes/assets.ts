import fs from 'node:fs';
import { Router } from 'express';
import { readAssetByHash } from '../lib/storage';

const HEX_RE = /^[a-f0-9]{64}$/i;

export const assetsRouter = Router();

assetsRouter.get('/assets/:hash', async (req, res) => {
  const { hash } = req.params;
  if (!HEX_RE.test(hash)) {
    res.status(400).json({ error: 'Invalid asset hash' });
    return;
  }

  const asset = await readAssetByHash(hash.toLowerCase());
  if (!asset) {
    res.status(404).json({ error: 'Asset not found' });
    return;
  }

  res.setHeader('content-type', asset.contentType);
  res.setHeader('cache-control', 'public, max-age=31536000, immutable');
  fs.createReadStream(asset.filePath).pipe(res);
});
