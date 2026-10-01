import { app, shell } from 'electron';
import type { AppReleaseInfo } from '../shared/types';

const RELEASE_URL =
  'https://github.com/LEKPCSTEAM/GRC-Self-Host/releases/latest';
const API_URL =
  'https://api.github.com/repos/LEKPCSTEAM/GRC-Self-Host/releases/latest';
const TTL_MS = 60 * 60_000;
let cached: { at: number; value: AppReleaseInfo | null } | undefined;

function isNewer(latest: string, current: string): boolean {
  const a = latest.replace(/^v/, '').split('.').map(Number);
  const b = current.replace(/^v/, '').split('.').map(Number);
  if (a.some(Number.isNaN) || b.some(Number.isNaN)) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

export async function latest(): Promise<AppReleaseInfo | null> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const response = await fetch(API_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'grc-self-host',
    },
  });
  if (response.status === 404) {
    cached = { at: Date.now(), value: null };
    return null;
  }
  if (!response.ok)
    throw new Error(`Release check failed (HTTP ${response.status})`);
  const data = (await response.json()) as {
    tag_name: string;
    name?: string;
    body?: string;
  };
  const current = app.getVersion();
  const value: AppReleaseInfo = {
    current,
    latest: data.tag_name.replace(/^v/, ''),
    title: data.name || data.tag_name,
    notes: (data.body ?? '').slice(0, 20_000),
    checkedAt: new Date().toISOString(),
    available: isNewer(data.tag_name, current),
  };
  cached = { at: Date.now(), value };
  return value;
}

export async function openDownload(): Promise<void> {
  await shell.openExternal(RELEASE_URL);
}
