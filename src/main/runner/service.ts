import os from 'node:os';
import path from 'node:path';
import { isWin, run, type Step } from './exec';
import { readServiceName } from './layout';

export type ServiceState = 'running' | 'stopped' | 'missing';

const sc = (...args: string[]): Step => ({ file: 'sc.exe', args });
const systemctl = (...args: string[]): Step => ({ file: 'systemctl', args });

export async function serviceState(dir: string): Promise<ServiceState> {
  const name = readServiceName(dir);
  if (!name) return 'missing';
  if (isWin) {
    const res = await run(sc('query', name), 15_000);
    // 1060: the service does not exist.
    if (res.code === 1060 || /1060/.test(res.output)) return 'missing';
    return /STATE\s*:\s*\d+\s+(RUNNING|START_PENDING)/.test(res.output)
      ? 'running'
      : 'stopped';
  }
  const res = await run(
    systemctl('show', '-p', 'LoadState,ActiveState', '--value', name),
    15_000,
  );
  const [load, active] = res.output.trim().split(/\s+/);
  if (load === 'not-found') return 'missing';
  return active === 'active' || active === 'activating' ? 'running' : 'stopped';
}

// All steps below need administrator rights; run them through runElevated().

export function startSteps(dir: string): Step[] {
  const name = readServiceName(dir);
  if (!name) return [];
  return [isWin ? sc('start', name) : systemctl('start', name)];
}

export function stopSteps(dir: string): Step[] {
  const name = readServiceName(dir);
  if (!name) return [];
  return [isWin ? sc('stop', name) : systemctl('stop', name)];
}

/** Linux only: Windows services are installed by `configure --runasservice`. */
export function linuxInstallSteps(dir: string): Step[] {
  const svc = path.join(dir, 'svc.sh');
  return [
    { file: svc, args: ['install', os.userInfo().username], cwd: dir },
    { file: svc, args: ['start'], cwd: dir },
  ];
}

export function linuxUninstallSteps(dir: string): Step[] {
  const svc = path.join(dir, 'svc.sh');
  return [
    { file: svc, args: ['stop'], cwd: dir },
    { file: svc, args: ['uninstall'], cwd: dir },
  ];
}

/** Windows: force-delete a service left behind after a failed `remove`. */
export function windowsDeleteSteps(dir: string): Step[] {
  const name = readServiceName(dir);
  return name ? [sc('stop', name), sc('delete', name)] : [];
}
