import crypto from 'node:crypto';
import type { ExpoManifest, ManifestAsset, StoredAsset, StoredUpdate } from '../types';

/**
 * Convert a hex-encoded SHA-256 digest to the URL-safe base64 (no padding)
 * form required by the Expo Updates v1 manifest `hash` field.
 */
export function hashHexToManifestHash(hex: string): string {
  return Buffer.from(hex, 'hex')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function assetUrl(baseUrl: string, hashHex: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/assets/${hashHex}`;
}

function toManifestAsset(stored: StoredAsset, baseUrl: string): ManifestAsset {
  return {
    hash: hashHexToManifestHash(stored.hash),
    key: stored.key,
    contentType: stored.contentType,
    fileExtension: stored.fileExtension,
    url: assetUrl(baseUrl, stored.hash),
  };
}

export interface BuildManifestInput {
  update: StoredUpdate;
  publicBaseUrl: string;
}

export function buildManifest({ update, publicBaseUrl }: BuildManifestInput): ExpoManifest {
  return {
    id: update.id,
    createdAt: update.createdAt,
    runtimeVersion: update.runtimeVersion,
    launchAsset: toManifestAsset(update.launchAsset, publicBaseUrl),
    assets: update.assets.map((a) => toManifestAsset(a, publicBaseUrl)),
    metadata: update.metadata ?? {},
    extra: {
      ...update.extra,
      channel: update.channel,
      ...(update.commit ? { commit: update.commit } : {}),
      ...(update.message ? { message: update.message } : {}),
    },
  };
}

export interface MultipartResult {
  body: Buffer;
  contentType: string;
}

/**
 * Build a multipart/mixed body containing the Expo manifest part.
 * Per Expo Updates v1, additional parts (directive, extensions) may be added
 * later — this helper accepts an optional list of pre-formatted extra parts.
 */
export function buildManifestMultipart(
  manifest: ExpoManifest,
  extraParts: Array<{ name: string; contentType: string; body: string | Buffer }> = [],
): MultipartResult {
  const boundary = `----expo-ota-${crypto.randomBytes(12).toString('hex')}`;
  const CRLF = '\r\n';
  const chunks: Buffer[] = [];

  const writePart = (
    name: string,
    contentType: string,
    body: string | Buffer,
  ): void => {
    const headers =
      `--${boundary}${CRLF}` +
      `content-disposition: inline; name="${name}"${CRLF}` +
      `content-type: ${contentType}${CRLF}${CRLF}`;
    chunks.push(Buffer.from(headers, 'utf8'));
    chunks.push(typeof body === 'string' ? Buffer.from(body, 'utf8') : body);
    chunks.push(Buffer.from(CRLF, 'utf8'));
  };

  writePart('manifest', 'application/json; charset=utf-8', JSON.stringify(manifest));
  for (const p of extraParts) writePart(p.name, p.contentType, p.body);

  chunks.push(Buffer.from(`--${boundary}--${CRLF}`, 'utf8'));

  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/mixed; boundary=${boundary}`,
  };
}
