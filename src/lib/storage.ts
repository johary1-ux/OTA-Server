import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config';
import type {
  Channel,
  LatestPointer,
  Platform,
  StoredUpdate,
} from '../types';

/** Layout root. */
function root(): string {
  return config.bundlesPath;
}

function channelDir(channel: Channel, runtimeVersion: string, platform: Platform): string {
  return path.join(root(), channel, runtimeVersion, platform);
}

function updateDir(
  channel: Channel,
  runtimeVersion: string,
  platform: Platform,
  id: string,
): string {
  return path.join(channelDir(channel, runtimeVersion, platform), id);
}

function latestPointerPath(
  channel: Channel,
  runtimeVersion: string,
  platform: Platform,
): string {
  return path.join(channelDir(channel, runtimeVersion, platform), 'latest.json');
}

function assetsDir(): string {
  return path.join(root(), '_assets');
}

function assetPath(hashHex: string): string {
  return path.join(assetsDir(), hashHex);
}

function assetMetaPath(hashHex: string): string {
  return `${assetPath(hashHex)}.meta.json`;
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJson<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function writeJsonAtomic(p: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, p);
}

export async function ensureDirs(): Promise<void> {
  await fs.mkdir(root(), { recursive: true });
  await fs.mkdir(assetsDir(), { recursive: true });
  await fs.mkdir(config.uploadsTmp, { recursive: true });
}

export async function readLatestUpdate(
  channel: Channel,
  runtimeVersion: string,
  platform: Platform,
): Promise<StoredUpdate | null> {
  const pointer = await readJson<LatestPointer>(
    latestPointerPath(channel, runtimeVersion, platform),
  );
  if (!pointer) return null;
  const updatePath = path.join(
    updateDir(channel, runtimeVersion, platform, pointer.id),
    'update.json',
  );
  return readJson<StoredUpdate>(updatePath);
}

export async function readUpdateById(
  channel: Channel,
  runtimeVersion: string,
  platform: Platform,
  id: string,
): Promise<StoredUpdate | null> {
  const updatePath = path.join(
    updateDir(channel, runtimeVersion, platform, id),
    'update.json',
  );
  return readJson<StoredUpdate>(updatePath);
}

export interface PersistedAssetInput {
  /** Absolute path to the temp file uploaded by multer. */
  tmpPath: string;
  hashHex: string;
  contentType: string;
  fileExtension: string;
}

/**
 * Move an uploaded temp file into the content-addressable `_assets/` store.
 * Idempotent: if the file is already present, the temp file is just removed.
 */
export async function persistAsset(input: PersistedAssetInput): Promise<void> {
  await fs.mkdir(assetsDir(), { recursive: true });
  const dest = assetPath(input.hashHex);
  if (await exists(dest)) {
    await fs.unlink(input.tmpPath).catch(() => undefined);
  } else {
    try {
      await fs.rename(input.tmpPath, dest);
    } catch (err) {
      // EXDEV: temp on a different volume — fall back to copy+unlink.
      if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
        await fs.copyFile(input.tmpPath, dest);
        await fs.unlink(input.tmpPath);
      } else {
        throw err;
      }
    }
  }
  await writeJsonAtomic(assetMetaPath(input.hashHex), {
    contentType: input.contentType,
    fileExtension: input.fileExtension,
  });
}

export interface AssetReadResult {
  filePath: string;
  contentType: string;
}

export async function readAssetByHash(hashHex: string): Promise<AssetReadResult | null> {
  const file = assetPath(hashHex);
  if (!(await exists(file))) return null;
  const meta = await readJson<{ contentType: string }>(assetMetaPath(hashHex));
  return {
    filePath: file,
    contentType: meta?.contentType ?? 'application/octet-stream',
  };
}

export async function writeUpdate(update: StoredUpdate): Promise<void> {
  const dir = updateDir(update.channel, update.runtimeVersion, update.platform, update.id);
  await fs.mkdir(dir, { recursive: true });
  await writeJsonAtomic(path.join(dir, 'update.json'), update);
}

/** Atomically point latest.json at the given update id. */
export async function setLatest(
  channel: Channel,
  runtimeVersion: string,
  platform: Platform,
  id: string,
): Promise<void> {
  await writeJsonAtomic(latestPointerPath(channel, runtimeVersion, platform), { id });
}

export const __paths = {
  root,
  channelDir,
  updateDir,
  latestPointerPath,
  assetsDir,
  assetPath,
  assetMetaPath,
};
