import crypto from 'node:crypto';
import fs from 'node:fs';

/**
 * Expo Updates v1 expects asset hashes encoded as URL-safe base64
 * (RFC 4648 §5) of the raw SHA-256 digest, with `=` padding stripped.
 */
export function sha256UrlSafeBase64(buf: Buffer): string {
  return crypto
    .createHash('sha256')
    .update(buf)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** Hex SHA-256 — used as the on-disk asset filename / cache key. */
export function sha256Hex(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export async function sha256FileHex(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(filePath);
    s.on('data', (chunk) => h.update(chunk));
    s.on('error', reject);
    s.on('end', () => resolve(h.digest('hex')));
  });
}

export async function sha256FileUrlSafeBase64(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(filePath);
    s.on('data', (chunk) => h.update(chunk));
    s.on('error', reject);
    s.on('end', () =>
      resolve(
        h
          .digest('base64')
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, ''),
      ),
    );
  });
}
