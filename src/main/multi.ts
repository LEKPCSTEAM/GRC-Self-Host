import fs from 'node:fs';
import path from 'node:path';
import type {
  CreateRequest,
  MultiTargetPreview,
  MultiTargetResult,
  Preset,
  Target,
} from '../shared/types';
import * as db from './db';
import * as gh from './github';
import * as manager from './runner/manager';

function presetById(id: string): Preset {
  const preset = db.load().presets.find((item) => item.id === id);
  if (!preset) throw new Error('Preset not found');
  if (!db.load().connections.some((item) => item.id === preset.connectionId))
    throw new Error('Preset connection is missing');
  return preset;
}

function validateTargets(preset: Preset, targets: Target[]): void {
  if (
    !targets.length ||
    targets.length > 10 ||
    preset.count * targets.length > 100
  )
    throw new Error('Choose up to 10 targets and 100 runners total');
  const keys = targets.map(
    (target) => `${target.kind}:${gh.targetKey(target).toLowerCase()}`,
  );
  if (new Set(keys).size !== keys.length)
    throw new Error('Choose each target once');
}

function request(
  preset: Preset,
  target: Target,
): Omit<CreateRequest, 'servicePassword' | 'acknowledgePublicRisk'> {
  return {
    connectionId: preset.connectionId,
    target,
    count: preset.count,
    prefix: preset.prefix,
    labels: preset.labels,
    mode: preset.mode,
    autostart: preset.autostart,
    cleanup: preset.cleanup,
    serviceAccount: preset.serviceAccount,
    runnerGroup:
      target.kind === 'org' && gh.sameTarget(target, preset.target)
        ? preset.runnerGroup
        : undefined,
  };
}

export async function preview(
  presetId: string,
  targets: Target[],
): Promise<MultiTargetPreview> {
  const preset = presetById(presetId);
  validateTargets(preset, targets);
  const root = path.join(db.load().settings.rootDir, 'runners');
  const reserved = new Set<string>();
  const output: MultiTargetPreview['targets'] = [];
  for (const target of targets) {
    const req = request(preset, target);
    manager.previewCreate(req);
    const taken = new Set(
      db.load().runners.map((runner) => runner.name.toLowerCase()),
    );
    for (const foreign of manager.snapshot().foreign) {
      if (gh.sameTarget(foreign.target, target))
        taken.add(foreign.name.toLowerCase());
    }
    try {
      for (const name of fs.readdirSync(root)) taken.add(name.toLowerCase());
    } catch {
      /* Root not created yet. */
    }
    for (const name of reserved) taken.add(name);
    const runners: { name: string; path: string }[] = [];
    for (let n = 1; runners.length < preset.count; n++) {
      const name = `${preset.prefix}-${String(n).padStart(2, '0')}`;
      if (taken.has(name.toLowerCase())) continue;
      runners.push({ name, path: path.join(root, name) });
      reserved.add(name.toLowerCase());
    }
    const [checks, visibility] = await Promise.all([
      manager.preflight(req),
      target.kind === 'repo'
        ? gh
            .repoVisibility(preset.connectionId, target.owner, target.repo)
            .catch(() => 'unknown' as const)
        : Promise.resolve(undefined),
    ]);
    output.push({ target, runners, checks, visibility });
  }
  return {
    targets: output,
    total: output.reduce((sum, item) => sum + item.runners.length, 0),
  };
}

export async function create(
  presetId: string,
  plan: MultiTargetPreview,
  acknowledgePublicRisk: boolean,
  servicePassword?: string,
): Promise<MultiTargetResult[]> {
  const preset = presetById(presetId);
  validateTargets(
    preset,
    plan.targets.map((item) => item.target),
  );
  const results: MultiTargetResult[] = [];
  for (const item of plan.targets) {
    try {
      const ids = await manager.create({
        ...request(preset, item.target),
        expectedNames: item.runners.map((runner) => runner.name),
        acknowledgePublicRisk,
        servicePassword:
          preset.mode === 'service' ? servicePassword : undefined,
      });
      results.push({ target: item.target, ids });
    } catch (error) {
      results.push({
        target: item.target,
        ids: [],
        error: (error as Error).message,
      });
    }
  }
  return results;
}
