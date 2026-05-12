export type Channel = 'development' | 'staging' | 'production';
export type Platform = 'ios' | 'android';

export interface ManifestAsset {
  hash: string;
  key: string;
  contentType: string;
  fileExtension: string;
  url: string;
}

export interface ExpoManifest {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  launchAsset: ManifestAsset;
  assets: ManifestAsset[];
  metadata: Record<string, unknown>;
  extra: Record<string, unknown>;
}

/**
 * Shape of the `latest.json` pointer file stored at
 * {OTA_BUNDLES_PATH}/{channel}/{runtimeVersion}/{platform}/latest.json
 */
export interface LatestPointer {
  id: string;
}

export interface StoredAsset {
  key: string;
  hash: string;
  contentType: string;
  fileExtension: string;
  fileName: string;
}

/**
 * Metadata persisted alongside each published update at
 * {OTA_BUNDLES_PATH}/{channel}/{runtimeVersion}/{platform}/{id}/update.json
 */
export interface StoredUpdate {
  id: string;
  createdAt: string;
  channel: Channel;
  platform: Platform;
  runtimeVersion: string;
  commit?: string;
  message?: string;
  launchAsset: StoredAsset;
  assets: StoredAsset[];
  metadata: Record<string, unknown>;
  extra: Record<string, unknown>;
}

export interface ManifestRequestHeaders {
  channel: Channel;
  runtimeVersion: string;
  platform: Platform;
  protocolVersion: string;
}
