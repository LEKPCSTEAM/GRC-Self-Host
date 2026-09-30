# GRC-Self-Host — Design

Personal desktop app for creating, running, monitoring and removing many GitHub Actions
self-hosted runners on **one machine**, quickly.

## Scope

- Single user, single machine. OS: **Windows + Linux** (macOS out of scope; keep the OS
  adapter interface so it can be added later).
- github.com only.
- Features: bulk install/register, start/stop/restart, status + logs, maintenance
  (labels, delete, drift repair).
- No automated tests.

## GitHub access

- Multiple **connections**, one fine-grained PAT each, encrypted with Electron
  `safeStorage`. Tokens live only in the main process; the renderer never sees them.
  On Linux without a keyring backend (`basic_text`), warn the user.
- GitHub REST API is called directly from the main process via `@octokit/rest`.
- Targets: repository **or** organization (org targets may choose a runner group).

## Runners

- Persistent runners only.
- Per-runner mode: **child** (default; app spawns `run.cmd`/`run.sh`) or **service**
  (Windows: `config.cmd --runasservice`; Linux: `svc.sh` + systemd).
- Mode can be switched later. On Windows this re-registers with `--replace` (same name).
- Service install/uninstall elevates per action (UAC / `pkexec`). Windows service
  account defaults to `NT AUTHORITY\NETWORK SERVICE`, optionally a user account.
- After every job, `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` (set in the runner's `.env`)
  runs a cleanup script that deletes `_work/<repo>/` and `_work/_temp/`. Registration
  files, `_actions` and `_tool` are kept. A "Clean now" action runs the same script.
- Child crash policy: auto-restart with backoff (1s, 5s, 30s, ...). More than 5 crashes
  in 10 minutes → stop and mark **Crashed**. Desktop notification (can be disabled).
  Services are restarted by the OS.
- Runners self-update as usual.

## Files and data

- One global root (default `C:\actions-runner` / `~/actions-runner`, changeable in
  Settings). Changing it does not move existing runners; each runner stores its own path.
  - `<root>/runners/<name>/`
  - `<root>/cache/<version>.zip|tar.gz` — keep the 2 newest versions.
- Download the latest release from `actions/runner`, verify SHA256 (from the release
  body); on mismatch fail and never extract.
- Naming: `{prefix}-{nn}`, prefix defaults to hostname.
- App DB: JSON file in `userData/`, atomic writes (temp + rename), `schemaVersion`.
  The DB is the source of truth — the app manages only runners it created.

## Status and maintenance

- Status merges local (process/service alive) and GitHub (online/offline/busy), polled
  every 15s per connection.
- Runners on GitHub that are not in the DB appear under "Other runners on GitHub",
  read-only, removable one at a time with a second confirmation. Stale-cleanup only
  touches DB runners.
- Drift (folder / `.runner` / service missing, or deleted on GitHub) → **Broken** with a
  reason; actions **Repair** (re-register with `--replace`) and **Forget** (remove from DB
  and delete folder).
- Delete flow: stop → uninstall service → `config remove --token <removal token>` →
  delete folder. Fallback: `DELETE /runners/{id}` + delete folder; still failing →
  "pending removal" queue retried later. Busy runners need confirmation.
- Logs: tail `_diag/Runner_*.log` and `Worker_*.log` for both modes; delete `_diag`
  files older than 7 days (configurable).

## App and UI

- TypeScript + React + Tailwind + shadcn/ui. English UI.
- Sidebar: Runners / Connections / Presets / Settings.
- Runners table grouped by target, multi-select, bulk action bar, filter by status/label.
- Shortcuts: `Ctrl+N` create, `Ctrl+A` select all, `Ctrl+K` command palette.
- Create form: connection, target, count, prefix, labels, runner group (org), mode,
  autostart, cleanup options; save as **preset**. Creates run 4 in parallel.
- Close window → tray. Quit with busy child runners → "Wait for jobs / Stop now /
  Cancel" (services unaffected). Launch at login; per-runner autostart.

## Release

- GitHub Actions matrix (windows + ubuntu), draft release on tag `v*`.
- Makers: Squirrel (Windows), deb (Linux). Unsigned. No app auto-update.

## Code layout

```
src/
  shared/            types and the IPC contract, used by all three processes
  main/
    main.ts          app lifecycle, window, tray
    ipc.ts           IPC handlers
    db.ts            JSON DB
    secrets.ts       safeStorage wrapper
    github.ts        Octokit per connection
    runner/
      download.ts    release lookup, SHA256, cache
      install.ts     extract, config, .env hook, cleanup scripts
      supervisor.ts  child process + backoff
      service/       windows.ts, linux.ts (OS adapters)
      status.ts      local + GitHub merge, drift detection
      logs.ts        _diag tail + retention
      manager.ts     orchestration, bulk ops
  preload/preload.ts contextBridge exposing the typed API
  renderer/          React app
```

## Phases

1. Foundation — TS, React, Tailwind, shadcn, process split, typed IPC, JSON DB,
   Settings (root path), window/tray skeleton.
2. Connections — PAT storage, validation, list repos/orgs/runner groups.
3. Create + run (child mode) — download/verify/extract/config, cleanup hook, bulk create,
   presets, start/stop/restart.
4. Status + logs — polling merge, runners table, bulk actions, log viewer, retention,
   crash backoff, notifications.
5. Service mode — Windows/Linux adapters, elevation, mode switching.
6. Maintenance — delete flow, pending removal, Broken/Repair/Forget, other runners,
   label edit, Clean now.
7. Polish + release — shortcuts, command palette, launch at login, autostart, quit
   dialog, CI workflow, makers.
