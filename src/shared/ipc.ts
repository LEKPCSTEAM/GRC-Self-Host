import type {
  AppInfo,
  BulkAction,
  BulkResult,
  CleanupOptions,
  Connection,
  CreateRequest,
  LogChunk,
  LogKind,
  Preset,
  RunnerGroup,
  RunnerMode,
  Settings,
  Snapshot,
  Target,
  TargetOption,
} from './types';

/** Every renderer → main call. The handler signature is what main implements. */
export interface IpcContract {
  'app:info': () => AppInfo;

  'settings:get': () => Settings;
  'settings:update': (patch: Partial<Settings>) => Settings;
  'settings:chooseRootDir': () => string | null;

  'connections:list': () => Connection[];
  'connections:add': (name: string, token: string) => Connection;
  'connections:update': (
    id: string,
    patch: { name?: string; token?: string },
  ) => Connection;
  'connections:remove': (id: string) => void;
  /** Warning to show when tokens cannot be encrypted on this machine. */
  'connections:storageWarning': () => string | null;
  'connections:targets': (id: string) => TargetOption[];
  'connections:runnerGroups': (id: string, org: string) => RunnerGroup[];

  'presets:list': () => Preset[];
  'presets:save': (preset: Omit<Preset, 'id'> & { id?: string }) => Preset;
  'presets:remove': (id: string) => void;

  'runners:snapshot': () => Snapshot;
  'runners:create': (req: CreateRequest) => string[];
  'runners:bulk': (ids: string[], action: BulkAction) => BulkResult[];
  'runners:remove': (ids: string[]) => BulkResult[];
  'runners:repair': (id: string, servicePassword?: string) => void;
  'runners:forget': (id: string) => void;
  'runners:setMode': (
    id: string,
    mode: RunnerMode,
    serviceAccount?: string,
    servicePassword?: string,
  ) => void;
  'runners:setLabels': (
    ids: string[],
    add: string[],
    remove: string[],
  ) => BulkResult[];
  'runners:setOptions': (
    id: string,
    patch: { autostart?: boolean; cleanup?: CleanupOptions },
  ) => void;
  'runners:openFolder': (id: string) => void;
  'runners:removeForeign': (
    connectionId: string,
    target: Target,
    githubId: number,
  ) => void;

  'logs:read': (
    id: string,
    kind: LogKind,
    file?: string,
    offset?: number,
  ) => LogChunk;
}

export type Channel = keyof IpcContract;

/** Allowlist enforced by the preload; keep in sync with IpcContract. */
export const CHANNELS = [
  'app:info',
  'settings:get',
  'settings:update',
  'settings:chooseRootDir',
  'connections:list',
  'connections:add',
  'connections:update',
  'connections:remove',
  'connections:storageWarning',
  'connections:targets',
  'connections:runnerGroups',
  'presets:list',
  'presets:save',
  'presets:remove',
  'runners:snapshot',
  'runners:create',
  'runners:bulk',
  'runners:remove',
  'runners:repair',
  'runners:forget',
  'runners:setMode',
  'runners:setLabels',
  'runners:setOptions',
  'runners:openFolder',
  'runners:removeForeign',
  'logs:read',
] as const satisfies readonly Channel[];

/** Every main → renderer push. */
export interface EventContract {
  snapshot: Snapshot;
  /** Menu / tray / shortcut request for the renderer to handle. */
  command: 'create' | 'palette';
}

export type EventName = keyof EventContract;

export const EVENTS = [
  'snapshot',
  'command',
] as const satisfies readonly EventName[];

export interface GrcApi {
  invoke<C extends Channel>(
    channel: C,
    ...args: Parameters<IpcContract[C]>
  ): Promise<Awaited<ReturnType<IpcContract[C]>>>;
  /** Returns an unsubscribe function. */
  on<E extends EventName>(
    event: E,
    listener: (payload: EventContract[E]) => void,
  ): () => void;
}
