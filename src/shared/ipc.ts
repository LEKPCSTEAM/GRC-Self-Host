import type { AppInfo, Settings } from './types';

/** Every renderer → main call. The handler signature is what main implements. */
export interface IpcContract {
  'app:info': () => AppInfo;
  'settings:get': () => Settings;
  'settings:update': (patch: Partial<Settings>) => Settings;
  'settings:chooseRootDir': () => string | null;
}

export type Channel = keyof IpcContract;

/** Allowlist enforced by the preload; keep in sync with IpcContract. */
export const CHANNELS = [
  'app:info',
  'settings:get',
  'settings:update',
  'settings:chooseRootDir',
] as const satisfies readonly Channel[];

export interface GrcApi {
  invoke<C extends Channel>(
    channel: C,
    ...args: Parameters<IpcContract[C]>
  ): Promise<Awaited<ReturnType<IpcContract[C]>>>;
}
