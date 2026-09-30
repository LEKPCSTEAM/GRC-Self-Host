import fs from 'node:fs';
import path from 'node:path';

// Squirrel points the "Installed apps" entry at <install root>/app.ico and,
// when that file is missing, downloads Electron's logo from its default
// iconUrl. Writing our own icon there during the install/update hook (which
// runs before the uninstall entry is created) keeps the app's icon instead.
// Must be imported before electron-squirrel-startup, which quits on these events.
const cmd = process.argv[1];
if (
  process.platform === 'win32' &&
  (cmd === '--squirrel-install' || cmd === '--squirrel-updated')
) {
  try {
    fs.copyFileSync(
      path.join(process.resourcesPath, 'icon.ico'),
      path.resolve(path.dirname(process.execPath), '..', 'app.ico'),
    );
  } catch {
    // Cosmetic only; never block the install.
  }
}
