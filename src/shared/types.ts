export interface Settings {
  /** Default root for new runners: `<rootDir>/runners/<name>` and `<rootDir>/cache`. */
  rootDir: string;
  diagRetentionDays: number;
  notifications: boolean;
  quietHours?: { start: string; end: string };
  launchAtLogin: boolean;
  /**
   * Run runners with DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1. The runner's worker
   * crashes under some cultures (e.g. th-TH) while masking secrets.
   */
  invariantCulture: boolean;
  language?: 'en' | 'th';
  theme?: 'system' | 'light' | 'dark';
}

export interface AppInfo {
  version: string;
  platform: NodeJS.Platform;
  arch: string;
  hostname: string;
  dbPath: string;
}

// ---------------------------------------------------------------- GitHub

/** A repository (`owner/repo`) or an organization (`owner`). */
export type Target =
  | { kind: 'repo'; owner: string; repo: string }
  | { kind: 'org'; owner: string };

export interface Connection {
  id: string;
  name: string;
  /** GitHub login the token belongs to. */
  login: string;
  createdAt: string;
}

export interface TargetOption {
  target: Target;
  label: string;
}

export interface RunnerGroup {
  id: number;
  name: string;
}

// ---------------------------------------------------------------- Runners

export type RunnerMode = 'child' | 'service';

export interface CleanupOptions {
  /** Clear the job workspace and `_temp` after every job. */
  enabled: boolean;
  /** Also clear `_work/_actions` (downloaded actions). */
  actions: boolean;
  /** Also clear `_work/_tool` (setup-* tool cache). */
  tool: boolean;
}

export interface BulkOptionsPatch {
  autostart?: boolean;
  cleanup?: Partial<CleanupOptions>;
}

export interface RunnerRecord {
  id: string;
  name: string;
  connectionId: string;
  target: Target;
  dir: string;
  mode: RunnerMode;
  /** Custom labels only; GitHub adds `self-hosted`, OS and arch itself. */
  labels: string[];
  runnerGroup?: string;
  /** Child mode only: start when the app starts. */
  autostart: boolean;
  cleanup: CleanupOptions;
  /** Windows service logon account; empty means NETWORK SERVICE. */
  serviceAccount?: string;
  /** GitHub runner id, known once configured. */
  githubId?: number;
  version?: string;
  createdAt: string;
  /** Deleted locally but GitHub deregistration still has to be retried. */
  pendingRemoval?: boolean;
}

export interface Preset {
  id: string;
  name: string;
  connectionId: string;
  target: Target;
  count: number;
  prefix: string;
  labels: string[];
  runnerGroup?: string;
  mode: RunnerMode;
  autostart: boolean;
  cleanup: CleanupOptions;
  serviceAccount?: string;
}

export interface RestorePreview {
  id: string;
  file: string;
  settingsChanged: boolean;
  newConnections: number;
  newPresets: number;
  newRunners: number;
  newWatchedTargets: number;
  conflicts: string[];
  warnings: string[];
}

export interface RestoreResult {
  connections: number;
  presets: number;
  runners: number;
  watchedTargets: number;
}

export type LocalState =
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'crashed'
  | 'busy-op';

export type GithubState = 'online' | 'offline' | 'missing' | 'unknown';

export interface RunnerStatus {
  local: LocalState;
  /** Description of the operation in progress, e.g. "Downloading 45%". */
  op?: string;
  github: GithubState;
  /** Last attempted and successful GitHub runner poll. */
  githubCheckedAt?: string;
  githubSyncedAt?: string;
  githubError?: string;
  /** Running a job, from local output or GitHub. */
  busy: boolean;
  jobName?: string;
  /** Why the runner is considered broken, if it is. */
  broken?: string;
  lastError?: string;
  creationFailed?: boolean;
  /** Child process started outside this app session (after a crash or restart). */
  orphan?: boolean;
  stopAfterJob?: boolean;
}

export interface RunnerView extends RunnerRecord {
  status: RunnerStatus;
}

/** A runner registered on GitHub in a watched target that this app does not manage. */
export interface ForeignRunner {
  connectionId: string;
  target: Target;
  githubId: number;
  name: string;
  os: string;
  status: string;
  busy: boolean;
  labels: string[];
  readOnly?: boolean;
}

export interface WatchTarget {
  id: string;
  connectionId: string;
  target: Target;
  checkedAt?: string;
  error?: string;
}

export interface Snapshot {
  runners: RunnerView[];
  foreign: ForeignRunner[];
  watched: WatchTarget[];
  operations: BatchOperation[];
  /** Child runners are busy and the user asked to quit after they finish. */
  quitPending: boolean;
}

export interface BatchOperation {
  id: string;
  action: string;
  startedAt: string;
  finishedAt?: string;
  items: {
    id: string;
    name: string;
    state: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped';
    error?: string;
  }[];
}

export interface JournalEvent {
  id: string;
  at: string;
  type: 'command' | 'state';
  action: string;
  runnerId: string;
  runnerName: string;
  outcome: string;
  error?: string;
}

export interface VersionReport {
  latest: string;
  checkedAt: string;
  runners: {
    id: string;
    installed?: string;
    updateIssue?: string;
  }[];
}

export interface DiskReport {
  checkedAt: string;
  cacheBytes: number;
  totalBytes: number;
  runners: {
    id: string;
    workBytes: number;
    diagBytes: number;
    cleanBytes: number;
    cleanPaths: { path: string; bytes: number }[];
    omittedPaths: number;
  }[];
}

export interface SupportPreview {
  id: string;
  days: number;
  runnerCount: number;
  files: { runner: string; file: string; bytes: number }[];
  sample: string;
  truncated: boolean;
}

export interface AppReleaseInfo {
  current: string;
  latest: string;
  title: string;
  notes: string;
  checkedAt: string;
  available: boolean;
}

export interface RunnerJob {
  id: number;
  name: string;
  status: string;
  conclusion?: string;
  startedAt?: string;
  completedAt?: string;
  workflow?: string;
}

export interface JobReport {
  checkedAt: string;
  jobs: RunnerJob[];
  scannedRuns: number;
  message?: string;
}

export interface MaintenanceTask {
  id: string;
  createdAt: string;
  runAt: string;
  action: 'clean' | 'restart';
  runnerIds: string[];
  skipBusy: boolean;
  state: 'scheduled' | 'running' | 'completed' | 'cancelled';
  finishedAt?: string;
  results?: BulkResult[];
  error?: string;
}

export interface MultiTargetPreview {
  targets: {
    target: Target;
    runners: { name: string; path: string }[];
    checks: PreflightCheck[];
    visibility?: 'public' | 'private' | 'unknown';
  }[];
  total: number;
}

export interface MultiTargetResult {
  target: Target;
  ids: string[];
  error?: string;
}

export interface ImportPreview {
  id: string;
  dir: string;
  name: string;
  githubId: number;
  version?: string;
  mode: RunnerMode;
  local: string;
  github: string;
  labels: string[];
  checks: PreflightCheck[];
}

export interface CreateRequest {
  connectionId: string;
  target: Target;
  count: number;
  prefix: string;
  labels: string[];
  runnerGroup?: string;
  mode: RunnerMode;
  autostart: boolean;
  cleanup: CleanupOptions;
  serviceAccount?: string;
  /** Never persisted. */
  servicePassword?: string;
  /** User acknowledged the public or unverified repository warning. */
  acknowledgePublicRisk?: boolean;
  /** Names shown in the last preview; abort if allocation changed meanwhile. */
  expectedNames?: string[];
}

export interface CreatePreview {
  runners: { name: string; path: string }[];
  target: Target;
  mode: RunnerMode;
  labels: string[];
  requiresAdmin: boolean;
  collisions: string[];
}

export interface PreflightCheck {
  name: string;
  status: 'pass' | 'fail' | 'unknown';
  message: string;
}

export interface LogChunk {
  files: string[];
  file: string | null;
  text: string;
  /** Pass back as `offset` to receive only new text. */
  offset: number;
}

export type LogKind = 'console' | 'runner' | 'worker';

export type BulkAction = 'start' | 'stop' | 'restart' | 'clean';

export interface BulkResult {
  id: string;
  ok: boolean;
  skipped?: boolean;
  error?: string;
}
