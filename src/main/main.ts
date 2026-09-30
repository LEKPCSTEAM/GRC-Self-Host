import path from 'node:path';
import { app, BrowserWindow, Menu, nativeImage, Tray } from 'electron';
import started from 'electron-squirrel-startup';
import trayIcon from '../../assets/tray.png?inline';
import * as db from './db';
import { registerIpc } from './ipc';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) app.quit();

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 900,
    minHeight: 560,
    show: false,
    icon: nativeImage.createFromDataURL(trayIcon),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.once('ready-to-show', () => mainWindow?.show());

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
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }
}

function showWindow() {
  if (!mainWindow) createWindow();
  mainWindow?.show();
  mainWindow?.focus();
}

function createTray() {
  tray = new Tray(
    nativeImage.createFromDataURL(trayIcon).resize({ width: 16, height: 16 }),
  );
  tray.setToolTip('GRC Self-Host');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', showWindow);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);

  app.whenReady().then(() => {
    db.load();
    registerIpc();
    createTray();
    createWindow();
  });

  // TODO(phase 7): confirm quit while child runners are busy.
  app.on('before-quit', () => {
    quitting = true;
  });

  // The tray keeps the app running; only an explicit Quit exits.
  app.on('window-all-closed', () => {});
}
