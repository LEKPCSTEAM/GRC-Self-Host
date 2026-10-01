import type { Target } from '../../shared/types';

export const targetKey = (t: Target) =>
  t.kind === 'repo' ? `${t.owner}/${t.repo}` : t.owner;

export const targetLabel = (t: Target) =>
  t.kind === 'repo' ? targetKey(t) : `${t.owner} (org)`;

export const sameTarget = (a: Target, b: Target) =>
  a.kind === b.kind &&
  targetKey(a).toLowerCase() === targetKey(b).toLowerCase();

export const splitList = (s: string) =>
  s
    .split(/[,\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
  return `${(bytes / 1024 ** unit).toFixed(1)} ${['B', 'KiB', 'MiB', 'GiB', 'TiB'][unit]}`;
}
