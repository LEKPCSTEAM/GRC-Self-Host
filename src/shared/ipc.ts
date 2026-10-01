import type {
  AppInfo,
  AppReleaseInfo,
  BulkAction,
  BulkOptionsPatch,
  BulkResult,
  CleanupOptions,
  Connection,
  CreateRequest,
  CreatePreview,
  PreflightCheck,
  LogChunk,
  LogKind,
  JournalEvent,
  JobReport,
  MaintenanceTask,
  MultiTargetPreview,
  MultiTargetResult,
  ImportPreview,
  Preset,
  RunnerGroup,
  RunnerMode,
  RestorePreview,
  RestoreResult,
  Settings,
  Snapshot,
  Target,
  TargetOption,
  WatchTarget,
  VersionReport,
  DiskReport,
  SupportPreview,
} from './types';

/** Every renderer → main call. The handler signature is what main implements. */
export interface IpcContract {
  'app:info': () => AppInfo;
  'app:release': () => AppReleaseInfo | null;
  'app:openRelease': () => void;

  'settings:get': () => Settings;
  'settings:update': (patch: Partial<Settings>) => Settings;
  'settings:chooseRootDir': () => string | null;
  'backup:export': () => string | null;
  'backup:preview': () => RestorePreview | null;
  'backup:restore': (id: string) => RestoreResult;

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
  'watch:list': () => WatchTarget[];
  'watch:add': (connectionId: string, target: Target) => WatchTarget;
  'watch:remove': (id: string) => void;
  'connections:repoVisibility': (
    id: string,
    owner: string,
    repo: string,
  ) => 'public' | 'private';

  'presets:list': () => Preset[];
  'presets:save': (preset: Omit<Preset, 'id'> & { id?: string }) => Preset;
  'presets:remove': (id: string) => void;

  'runners:snapshot': () => Snapshot;
  'runners:create': (req: CreateRequest) => string[];
  'runners:previewCreate': (
    req: Omit<CreateRequest, 'servicePassword' | 'acknowledgePublicRisk'>,
  ) => CreatePreview;
  'runners:preflight': (
    req: Omit<CreateRequest, 'servicePassword' | 'acknowledgePublicRisk'>,
  ) => PreflightCheck[];
  'runners:bulk': (
    ids: string[],
    action: BulkAction,
    skipBusy?: boolean,
  ) => BulkResult[];
  'runners:stopAfterJob': (id: string, enabled: boolean) => void;
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
  'runners:setOptionsBulk': (
    ids: string[],
    patch: BulkOptionsPatch,
  ) => BulkResult[];
  'runners:openFolder': (id: string) => void;
  'runners:openGithub': (id: string, destination: 'target' | 'runner') => void;
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
  'history:list': () => JournalEvent[];
  'history:clearState': () => void;
  'versions:check': () => VersionReport;
  'disk:report': () => DiskReport;
  'support:preview': (days: number) => SupportPreview;
  'support:export': (id: string) => string | null;
  'jobs:list': (runnerId: string) => JobReport;
  'jobs:open': (jobId: number) => void;
  'maintenance:list': () => MaintenanceTask[];
  'maintenance:schedule': (
    action: 'clean' | 'restart',
    ids: string[],
    runAt: string,
    skipBusy: boolean,
  ) => MaintenanceTask;
  'maintenance:cancel': (id: string) => void;
  'multi:preview': (presetId: string, targets: Target[]) => MultiTargetPreview;
  'multi:create': (
    presetId: string,
    preview: MultiTargetPreview,
    acknowledgePublicRisk: boolean,
    servicePassword?: string,
  ) => MultiTargetResult[];
  'import:chooseDir': () => string | null;
  'import:preview': (
    connectionId: string,
    target: Target,
    dir: string,
  ) => ImportPreview;
  'import:commit': (id: string) => string;
}

export type Channel = keyof IpcContract;

/** Allowlist enforced by the preload; keep in sync with IpcContract. */
export const CHANNELS = [
  'app:info',
  'app:release',
  'app:openRelease',
  'settings:get',
  'settings:update',
  'settings:chooseRootDir',
  'backup:export',
  'backup:preview',
  'backup:restore',
  'connections:list',
  'connections:add',
  'connections:update',
  'connections:remove',
  'connections:storageWarning',
  'connections:targets',
  'connections:runnerGroups',
  'watch:list',
  'watch:add',
  'watch:remove',
  'connections:repoVisibility',
  'presets:list',
  'presets:save',
  'presets:remove',
  'runners:snapshot',
  'runners:create',
  'runners:previewCreate',
  'runners:preflight',
  'runners:bulk',
  'runners:stopAfterJob',
  'runners:remove',
  'runners:repair',
  'runners:forget',
  'runners:setMode',
  'runners:setLabels',
  'runners:setOptions',
  'runners:setOptionsBulk',
  'runners:openFolder',
  'runners:openGithub',
  'runners:removeForeign',
  'logs:read',
  'history:list',
  'history:clearState',
  'versions:check',
  'disk:report',
  'support:preview',
  'support:export',
  'jobs:list',
  'jobs:open',
  'maintenance:list',
  'maintenance:schedule',
  'maintenance:cancel',
  'multi:preview',
  'multi:create',
  'import:chooseDir',
  'import:preview',
  'import:commit',
] as const satisfies readonly Channel[];

/** Every main → renderer push. */
export interface EventContract {
  snapshot: Snapshot;
  /** Menu / tray / shortcut request for the renderer to handle. */
  command: 'create' | 'palette' | 'problems';
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
