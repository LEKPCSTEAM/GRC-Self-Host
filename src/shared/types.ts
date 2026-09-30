export interface Settings {
  /** Default root for new runners: `<rootDir>/runners/<name>` and `<rootDir>/cache`. */
  rootDir: string;
  diagRetentionDays: number;
  notifications: boolean;
}

export interface AppInfo {
  version: string;
  platform: NodeJS.Platform;
  arch: string;
  hostname: string;
  dbPath: string;
}
