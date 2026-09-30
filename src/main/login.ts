import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';

export const HIDDEN_ARG = '--hidden';

/** Start the app (hidden in the tray) when the user logs in. Packaged builds only. */
export function applyLaunchAtLogin(enabled: boolean) {
  if (!app.isPackaged) return;
  if (process.platform === 'win32') {
    // Squirrel installs into a versioned folder; start through Update.exe so the path stays valid.
    const updateExe = path.resolve(
      path.dirname(process.execPath),
      '..',
      'Update.exe',
    );
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: updateExe,
      args: [
        '--processStart',
        `"${path.basename(process.execPath)}"`,
        '--process-start-args',
        `"${HIDDEN_ARG}"`,
      ],
    });
    return;
  }
  const file = path.join(
    os.homedir(),
    '.config',
    'autostart',
    'grc-self-host.desktop',
  );
  if (!enabled) {
    fs.rmSync(file, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    [
      '[Desktop Entry]',
      'Type=Application',
      'Name=GRC Self-Host',
      `Exec="${process.execPath}" ${HIDDEN_ARG}`,
      'X-GNOME-Autostart-enabled=true',
      '',
    ].join('\n'),
  );
}
