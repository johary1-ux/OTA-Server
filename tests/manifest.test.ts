import crypto from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  buildManifest,
  buildManifestMultipart,
  hashHexToManifestHash,
} from '../src/lib/manifest-builder';
import type { StoredUpdate } from '../src/types';

function makeStoredUpdate(overrides: Partial<StoredUpdate> = {}): StoredUpdate {
  const bundleBuf = Buffer.from('console.log("hi from bundle");', 'utf8');
  const assetBuf = Buffer.from('PNGDATA-imaginary', 'utf8');
  const bundleHex = crypto.createHash('sha256').update(bundleBuf).digest('hex');
  const assetHex = crypto.createHash('sha256').update(assetBuf).digest('hex');

  return {
    id: '11111111-2222-3333-4444-555555555555',
    createdAt: '2026-05-12T10:00:00.000Z',
    channel: 'production',
    platform: 'ios',
    runtimeVersion: '19.37.0',
    commit: 'abcdef0',
    message: 'fix: clipping bug',
    launchAsset: {
      key: 'bundle',
      hash: bundleHex,
      contentType: 'application/javascript',
      fileExtension: 'bundle',
      fileName: 'main.jsbundle',
    },
    assets: [
      {
        key: 'logo.png',
        hash: assetHex,
        contentType: 'image/png',
        fileExtension: 'png',
        fileName: 'logo.png',
      },
    ],
    metadata: {},
    extra: {},
    ...overrides,
  };
}

describe('hashHexToManifestHash', () => {
  it('produces URL-safe base64 with no padding', () => {
    // Use a digest that we know produces both `+` and `/` and trailing `=`
    // in standard base64 so we can verify the substitutions.
    const hex = 'fb'.repeat(32); // 64 hex chars = 32 bytes
    const out = hashHexToManifestHash(hex);
    expect(out).not.toMatch(/[+/=]/);
    // Round-trip back to bytes to confirm encoding correctness
    const padded = out.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const decoded = Buffer.from(padded + pad, 'base64').toString('hex');
    expect(decoded).toBe(hex);
  });

  it('matches Expo expectation for a known SHA-256', () => {
    // sha256("hello world") = b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
    const hex = crypto.createHash('sha256').update('hello world').digest('hex');
    const expoHash = hashHexToManifestHash(hex);
    // Same value computed directly from the source bytes
    const direct = crypto
      .createHash('sha256')
      .update('hello world')
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(expoHash).toBe(direct);
  });
});

describe('buildManifest', () => {
  it('returns all required Expo Updates v1 fields', () => {
    const update = makeStoredUpdate();
    const manifest = buildManifest({
      update,
      publicBaseUrl: 'https://ota.example.com',
    });

    expect(manifest.id).toBe(update.id);
    expect(manifest.createdAt).toBe(update.createdAt);
    expect(manifest.runtimeVersion).toBe('19.37.0');
    expect(manifest.launchAsset).toMatchObject({
      key: 'bundle',
      contentType: 'application/javascript',
      fileExtension: 'bundle',
    });
    expect(manifest.launchAsset.url).toBe(
      `https://ota.example.com/assets/${update.launchAsset.hash}`,
    );
    expect(manifest.launchAsset.hash).toBe(hashHexToManifestHash(update.launchAsset.hash));
    expect(manifest.assets).toHaveLength(1);
    expect(manifest.assets[0]?.contentType).toBe('image/png');
    expect(manifest.metadata).toEqual({});
    expect(manifest.extra).toMatchObject({
      channel: 'production',
      commit: 'abcdef0',
      message: 'fix: clipping bug',
    });
  });

  it('trims trailing slashes from the public base URL', () => {
    const update = makeStoredUpdate();
    const manifest = buildManifest({
      update,
      publicBaseUrl: 'https://ota.example.com/',
    });
    expect(manifest.launchAsset.url.startsWith('https://ota.example.com/assets/')).toBe(true);
    expect(manifest.launchAsset.url).not.toContain('//assets');
  });

  it('omits commit/message from extra when absent', () => {
    const update = makeStoredUpdate({ commit: undefined, message: undefined });
    const manifest = buildManifest({ update, publicBaseUrl: 'https://x' });
    expect(manifest.extra).not.toHaveProperty('commit');
    expect(manifest.extra).not.toHaveProperty('message');
    expect(manifest.extra.channel).toBe('production');
  });
});

describe('buildManifestMultipart', () => {
  it('produces a multipart/mixed body with a manifest part', () => {
    const update = makeStoredUpdate();
    const manifest = buildManifest({ update, publicBaseUrl: 'https://x' });
    const { body, contentType } = buildManifestMultipart(manifest);

    expect(contentType).toMatch(/^multipart\/mixed; boundary=----expo-ota-[a-f0-9]{24}$/);

    const boundary = contentType.split('boundary=')[1] ?? '';
    expect(boundary).not.toBe('');

    const text = body.toString('utf8');
    expect(text).toContain(`--${boundary}\r\n`);
    expect(text).toContain('content-disposition: inline; name="manifest"');
    expect(text).toContain('content-type: application/json; charset=utf-8');
    expect(text.trimEnd().endsWith(`--${boundary}--`)).toBe(true);

    // The manifest JSON should be embedded verbatim
    expect(text).toContain(`"id":"${update.id}"`);
    expect(text).toContain('"runtimeVersion":"19.37.0"');
  });

  it('appends extra parts after the manifest part', () => {
    const update = makeStoredUpdate();
    const manifest = buildManifest({ update, publicBaseUrl: 'https://x' });
    const { body } = buildManifestMultipart(manifest, [
      { name: 'directive', contentType: 'application/json', body: '{"type":"noUpdateAvailable"}' },
    ]);
    const text = body.toString('utf8');
    expect(text).toContain('name="directive"');
    expect(text).toContain('{"type":"noUpdateAvailable"}');
    // Order: manifest part appears before directive part
    expect(text.indexOf('name="manifest"')).toBeLessThan(text.indexOf('name="directive"'));
  });
});
