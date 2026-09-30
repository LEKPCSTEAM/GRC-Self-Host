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
  shared/              types and the IPC contract, used by all three processes
  main/
    main.ts            app lifecycle, window, tray, quit confirmation
    ipc.ts             IPC handlers
    db.ts              JSON DB
    secrets.ts         safeStorage wrapper
    github.ts          Octokit per connection
    login.ts           launch at login (Squirrel Update.exe / XDG autostart)
    runner/
      exec.ts          spawn helpers, tree kill, graceful interrupt, elevated batches
      download.ts      release lookup, SHA256, cache
      layout.ts        runner folder: configure/remove steps, .env + cleanup hook, Clean now
      service.ts       Windows sc / Linux systemd + svc.sh
      supervisor.ts    child process, output parsing, crash backoff
      processes.ts     find Runner.Listener processes left by a previous session
      logs.ts          _diag tail + retention
      manager.ts       orchestration, bulk ops, polling, drift detection
  preload/preload.ts   contextBridge exposing the typed API
  renderer/            React app
```

## Implementation notes

Findings from testing against real runners (v2.337.0) on Windows:

- **Graceful stop.** Killing a runner leaves its GitHub session behind; the next start
  retries "A session for this runner already exists" for ~2 minutes. Child runners are
  therefore stopped with Ctrl+Break sent to their hidden console (a small PowerShell
  helper attaches to it), or SIGINT to the process group on Linux; the tree is killed only
  if the runner has not exited after 30s. Ctrl+C is not used because an inherited
  "ignore Ctrl+C" flag can disable it.
- **`run.cmd` by absolute path.** With `NoDefaultCurrentDirectoryInExePath` set, a bare
  `run.cmd` resolves through PATH (nvm ships one).
- **Secrets never on the command line.** The registration/removal token and the Windows
  service password are passed as `ACTIONS_RUNNER_INPUT_*` environment variables.
  Elevated steps run from one temporary PowerShell / bash script (deleted afterwards), so
  a batch of N services costs one UAC / polkit prompt.
- **Managed `.env` keys** (other lines are kept; rewritten at app start):
  - `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` → the cleanup hook.
  - `PSExecutionPolicyPreference=RemoteSigned` (Windows, with cleanup on): the runner runs
    `.ps1` hooks via `powershell -command`, which the default Restricted policy blocks.
  - `DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=1` (Settings → Runner environment; default on
    for Thai systems): under th-TH the runner's Worker crashes in
    `SecretMasker`/`PowerShellPreAmpersandEscape` with ArgumentOutOfRangeException before
    any step runs. Jobs inherit the variable.
- **Cleanup** empties `GITHUB_WORKSPACE` and `RUNNER_TEMP` (plus `_actions` / `_tool` when
  enabled) and keeps `_work/_PipelineMapping` and the per-repo folders.
- **Busy detection** comes from the listener output ("Running job: …", "Job … completed
  with result") and from the GitHub API.
- Runners found running at startup (e.g. after the app was killed) are adopted and can
  be stopped, but their output is not available.

## Not verified yet

- Linux (child, systemd service, pkexec) — code paths exist but were not run.
- Windows service with a user account (only NETWORK SERVICE was tested).
- Organization targets and runner groups (tested with a repository only).
- Quit confirmation while a child runner is busy, and launch at login (packaged app).
