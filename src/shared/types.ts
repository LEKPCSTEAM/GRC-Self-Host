export interface Settings {
  /** Default root for new runners: `<rootDir>/runners/<name>` and `<rootDir>/cache`. */
  rootDir: string;
  diagRetentionDays: number;
  notifications: boolean;
  launchAtLogin: boolean;
  /**
   * Run runners with DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1. The runner's worker
   * crashes under some cultures (e.g. th-TH) while masking secrets.
   */
  invariantCulture: boolean;
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
  /** Running a job, from local output or GitHub. */
  busy: boolean;
  jobName?: string;
  /** Why the runner is considered broken, if it is. */
  broken?: string;
  lastError?: string;
  /** Child process started outside this app session (after a crash or restart). */
  orphan?: boolean;
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
}

export interface Snapshot {
  runners: RunnerView[];
  foreign: ForeignRunner[];
  /** Child runners are busy and the user asked to quit after they finish. */
  quitPending: boolean;
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
  error?: string;
}
