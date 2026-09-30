import os from 'node:os';
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import type { Channel, IpcContract } from '../shared/ipc';
import * as db from './db';

function handle<C extends Channel>(
  channel: C,
  fn: (
    ...args: Parameters<IpcContract[C]>
  ) => ReturnType<IpcContract[C]> | Promise<ReturnType<IpcContract[C]>>,
) {
  ipcMain.handle(channel, (_event, ...args) =>
    fn(...(args as Parameters<IpcContract[C]>)),
  );
}

export function registerIpc() {
  handle('app:info', () => ({
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    dbPath: db.dbPath(),
  }));

  handle('settings:get', () => db.load().settings);

  handle('settings:update', async (patch) => {
    await db.update((d) => {
      d.settings = { ...d.settings, ...patch };
    });
    return db.load().settings;
  });

  handle('settings:chooseRootDir', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose runner root folder',
      defaultPath: db.load().settings.rootDir,
      properties: ['openDirectory', 'createDirectory'],
    };
    const res = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    return res.canceled ? null : (res.filePaths[0] ?? null);
  });
}
