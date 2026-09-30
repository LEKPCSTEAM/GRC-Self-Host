import path from 'node:path';
import { app, BrowserWindow, dialog, Menu, nativeImage, Tray } from 'electron';
import started from 'electron-squirrel-startup';
import trayIcon from '../../assets/tray.png?inline';
import type { EventContract, EventName } from '../shared/ipc';
import * as db from './db';
import { registerIpc } from './ipc';
import { HIDDEN_ARG } from './login';
import * as manager from './runner/manager';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) app.quit();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
/** Set once the quit is confirmed; lets windows close and before-quit pass. */
let quitting = false;
let quitWaitTimer: NodeJS.Timeout | undefined;

function send<E extends EventName>(event: E, payload: EventContract[E]) {
  mainWindow?.webContents.send(`event:${event}`, payload);
}

function createWindow(show: boolean) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    icon: nativeImage.createFromDataURL(trayIcon),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow.setMenuBarVisibility(false);
  if (show) mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Closing the window keeps the app (and its child runners) alive in the tray.
  mainWindow.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    if (show) mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
}

function showWindow() {
  if (!mainWindow) createWindow(true);
  mainWindow?.show();
  mainWindow?.focus();
}

function updateTrayMenu() {
  const pending = manager.snapshot().quitPending;
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', click: showWindow },
      {
        label: 'Create runners…',
        click: () => {
          showWindow();
          send('command', 'create');
        },
      },
      { type: 'separator' },
      pending
        ? { label: 'Cancel pending quit', click: cancelPendingQuit }
        : { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray?.setToolTip(
    pending
      ? 'GRC Self-Host — quitting after running jobs finish'
      : 'GRC Self-Host',
  );
}

function createTray() {
  tray = new Tray(
    nativeImage.createFromDataURL(trayIcon).resize({ width: 16, height: 16 }),
  );
  tray.on('click', showWindow);
  updateTrayMenu();
}

// ------------------------------------------------------------------ quit

async function finalQuit() {
  clearInterval(quitWaitTimer);
  quitting = true;
  await manager.stopAllChildren();
  manager.dispose();
  app.quit();
}

function cancelPendingQuit() {
  clearInterval(quitWaitTimer);
  manager.setQuitPending(false);
  updateTrayMenu();
}

async function confirmQuit() {
  const busy = manager.busyChildren();
  if (!busy.length) return finalQuit();

  showWindow();
  const opts: Electron.MessageBoxOptions = {
    type: 'warning',
    buttons: ['Wait for jobs', 'Stop now', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    message: `${busy.length} runner(s) are running a job`,
    detail: `${busy.map((r) => r.name).join(', ')}\n\nRunners in child mode stop when the app quits. Service runners keep running.`,
  };
  const { response } = mainWindow
    ? await dialog.showMessageBox(mainWindow, opts)
    : await dialog.showMessageBox(opts);
  if (response === 2) return;
  if (response === 1) return finalQuit();

  manager.setQuitPending(true);
  updateTrayMenu();
  mainWindow?.hide();
  quitWaitTimer = setInterval(() => {
    if (!manager.busyChildren().length) void finalQuit();
  }, 2_000);
}

// ------------------------------------------------------------------ startup

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(async () => {
    db.load();
    registerIpc();
    manager.onSnapshot((s) => send('snapshot', s));
    createTray();
    createWindow(!process.argv.includes(HIDDEN_ARG));
    await manager.init();
  });

  app.on('before-quit', (e) => {
    if (quitting) return;
    e.preventDefault();
    if (!manager.snapshot().quitPending) void confirmQuit();
  });

  // The tray keeps the app running; only an explicit Quit exits.
  app.on('window-all-closed', () => {});
}
