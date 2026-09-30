import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isWin, run } from './exec';

const KEEP_VERSIONS = 2;
const RELEASE_TTL_MS = 10 * 60_000;

export interface RunnerPackage {
  version: string;
  file: string;
}

interface Release {
  version: string;
  assetName: string;
  url: string;
  sha256: string;
}

function platformId(): string {
  const os = isWin ? 'win' : 'linux';
  const arch = { x64: 'x64', arm64: 'arm64', arm: 'arm' }[
    process.arch as string
  ];
  if (!arch) throw new Error(`Unsupported architecture: ${process.arch}`);
  return `${os}-${arch}`;
}

let releaseCache: { at: number; release: Release } | undefined;

async function latestRelease(): Promise<Release> {
  if (releaseCache && Date.now() - releaseCache.at < RELEASE_TTL_MS) {
    return releaseCache.release;
  }
  const res = await fetch(
    'https://api.github.com/repos/actions/runner/releases/latest',
    {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'grc-self-host',
      },
    },
  );
  if (!res.ok)
    throw new Error(`Cannot look up runner releases (HTTP ${res.status})`);
  const body = (await res.json()) as {
    tag_name: string;
    body: string;
    assets: { name: string; browser_download_url: string; digest?: string }[];
  };
  const version = body.tag_name.replace(/^v/, '');
  const id = platformId();
  const ext = isWin ? 'zip' : 'tar.gz';
  const assetName = `actions-runner-${id}-${version}.${ext}`;
  const asset = body.assets.find((a) => a.name === assetName);
  if (!asset) throw new Error(`Release ${version} has no ${assetName}`);

  // Prefer the asset digest; fall back to the hash GitHub publishes in the release notes.
  const sha256 =
    asset.digest?.replace(/^sha256:/, '') ??
    new RegExp(
      `<!-- BEGIN SHA ${id} -->([0-9a-f]{64})<!-- END SHA ${id} -->`,
    ).exec(body.body)?.[1];
  if (!sha256) throw new Error(`No SHA256 published for ${assetName}`);

  const release = {
    version,
    assetName,
    url: asset.browser_download_url,
    sha256,
  };
  releaseCache = { at: Date.now(), release };
  return release;
}

const inflight = new Map<string, Promise<RunnerPackage>>();

/** Returns the latest runner package in `<rootDir>/cache`, downloading and verifying it if needed. */
export function ensurePackage(
  rootDir: string,
  onProgress?: (pct: number) => void,
): Promise<RunnerPackage> {
  const key = path.resolve(rootDir).toLowerCase();
  let p = inflight.get(key);
  if (!p) {
    p = download(rootDir, onProgress).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

async function download(
  rootDir: string,
  onProgress?: (pct: number) => void,
): Promise<RunnerPackage> {
  const rel = await latestRelease();
  const cacheDir = path.join(rootDir, 'cache');
  const file = path.join(cacheDir, rel.assetName);
  if (fs.existsSync(file)) return { version: rel.version, file };

  await fs.promises.mkdir(cacheDir, { recursive: true });
  const res = await fetch(rel.url, {
    headers: { 'User-Agent': 'grc-self-host' },
  });
  if (!res.ok || !res.body)
    throw new Error(`Download failed (HTTP ${res.status})`);
  const total = Number(res.headers.get('content-length') ?? 0);
  const hash = crypto.createHash('sha256');
  const part = `${file}.part`;
  let received = 0;
  let lastPct = -1;

  const body = Readable.fromWeb(
    res.body as import('node:stream/web').ReadableStream,
  );
  body.on('data', (chunk: Buffer) => {
    hash.update(chunk);
    received += chunk.length;
    const pct = total ? Math.floor((received / total) * 100) : 0;
    if (pct !== lastPct) {
      lastPct = pct;
      onProgress?.(pct);
    }
  });
  await pipeline(body, fs.createWriteStream(part));

  const actual = hash.digest('hex');
  if (actual.toLowerCase() !== rel.sha256.toLowerCase()) {
    await fs.promises.rm(part, { force: true });
    throw new Error(
      `Checksum mismatch for ${rel.assetName}: expected ${rel.sha256}, got ${actual}. The file was discarded.`,
    );
  }
  await fs.promises.rename(part, file);
  await prune(cacheDir);
  return { version: rel.version, file };
}

async function prune(cacheDir: string) {
  const files = await Promise.all(
    (await fs.promises.readdir(cacheDir))
      .filter((f) => f.startsWith('actions-runner-') && !f.endsWith('.part'))
      .map(async (f) => {
        const full = path.join(cacheDir, f);
        return { full, mtime: (await fs.promises.stat(full)).mtimeMs };
      }),
  );
  files.sort((a, b) => b.mtime - a.mtime);
  for (const f of files.slice(KEEP_VERSIONS)) {
    await fs.promises.rm(f.full, { force: true });
  }
}

export async function extract(archive: string, dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
  // Windows' bundled bsdtar reads zip files; avoid a GNU tar (e.g. from Git) earlier on PATH.
  const tar = isWin
    ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar';
  const res = await run({ file: tar, args: ['-xf', archive, '-C', dir] });
  if (res.code !== 0) throw new Error(`Extract failed: ${res.output.trim()}`);
}
