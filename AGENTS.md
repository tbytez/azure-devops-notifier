# Azure DevOps Notifier

Chrome extension (Manifest V3) that polls Azure DevOps Services (`dev.azure.com`) for pull request activity and shows notifications in the browser. Local-only: no server, no telemetry.

## Commands

- `npm run dev -- --host 127.0.0.1 --port 8933` — Vite dev server for the React UI.
- `npm test` — Node built-in test runner (`node --test test/`), no network. Requires Node 22.18+ (native TypeScript stripping for `test/theme.test.mjs` → `ui/src/lib/theme-core.ts`).
- `npm run build` — `tsc --noEmit` + Vite build → `ui-build/` (dashboard.html, popup.html, bundled local assets incl. Source Sans 3).
- `npm run check` — builds, then validates JS/manifest least-privilege, icons, no inline/remote resources in `src/` HTML and `ui-build/` HTML.
- `npm run package` — builds first (`prepackage`), then writes `dist/azure-devops-notifier-<version>.zip` via system `zip` (manifest + `src/` + `assets/` + `ui-build/` only).
- `node tools/generate-icons.mjs` — regenerates the shared teal branch SVG and PNG icons from the official Lucide GitBranch icon using resvg.
- `node tools/generate-sound.mjs` — regenerates `assets/sounds/notification.wav` (stdlib-only WAV writer: PCM16 mono 22050Hz, ~1.25s soft-decaying bell — 523.25Hz fundamental with inharmonic partials).

## Install / run

1. `chrome://extensions` → enable Developer mode → **Load unpacked** → select this repo root (`ui-build/` must exist — run `npm run build` first).
2. Click the toolbar icon → **Set up**, or open the dashboard via the extension's Options page.
3. Demo/preview without Chrome: `npm run dev -- --host 127.0.0.1 --port 8933` and open `http://127.0.0.1:8933/dashboard.html?demo=1` — fixture data, isolated `localStorage` key, no network.

## Architecture

- `manifest.json` — MV3, `storage` + `alarms` + `offscreen` permissions, `notifications` as optional permission, host permission only `https://dev.azure.com/*`, CSP `script-src 'self'; object-src 'self'`, `minimum_chrome_version` 116 (needed for `runtime.getContexts` offscreen audio). Popup/options point at `ui-build/*.html`.
- `ui/` — React 19 + TypeScript + Tailwind + shadcn/ui (New York) sources; Vite root `ui/`, output `ui-build/`. Shared bridge/store/theme under `ui/src/lib/`; dashboard under `ui/src/dashboard/`, popup under `ui/src/popup/`. `ui/public/theme-init.js` runs before the app bundle to apply the saved/system theme without inline scripts.
- `src/background.js` — service worker: chrome alarms drive polling (survives worker suspension), badge/title updates, desktop notifications, message routing.
- `src/handler.js` — single message contract, all mutations serialized through one promise queue shared with polling.
- `src/sync.js` — poll engine: own-PR discovery (selected projects, creator = connected identity), per-watch fetch with bounded concurrency (3), snapshot diff → notifications, backoff on outages.
- `src/core.js` — pure diff engine: comments/threads/reviews/reviewers/commits/lifecycle/checks/policies → events with deterministic ids.
- `src/api.js` — Azure DevOps REST adapter, GET only, Basic auth from PAT, timeouts, sanitized errors, pagination.
- `src/state.js` — versioned `chrome.storage.local` state (one key), sanitization, public payload (never includes the PAT).
- `src/urls.js` — canonical PR URL parsing/validation and watch keys.
- `src/demo.js` — `?demo=1` fixture adapter, isolated storage, no credentials/network.
- Notification sound (`settings.soundEnabled`, default **off**) — one chime per polling batch that produced new notifications, after state is saved; the first baseline sync stays quiet and the sound is independent of desktop notifications/permission. `src/sound.js` manages a lazily created `chrome.offscreen` document (`AUDIO_PLAYBACK`, `src/offscreen.html` + `src/offscreen.js` + shared `src/audio-player.js` playing the fixed bundled WAV); `TEST_SOUND` is a user-triggered, non-mutating message that works even when the toggle is off.
- `src/ui/` — legacy vanilla dashboard/popup retained as fallback/reference; the shipped UI is the React app in `ui-build/`. `src/ui/bridge.js` selects extension vs demo vs unavailable bridge and is shared by both UIs.

## PAT scopes

Create a PAT at `dev.azure.com/{org}/_usersSettings/tokens` with **Code (Read)** and **Project and Team (Read)**. The token is stored only in `chrome.storage.local` (local to this Chrome profile, not synced, not OS-keychain encrypted) and is sent only to `dev.azure.com` as an HTTPS Basic-auth header. Never commit a real PAT.

Azure DevOps Services only — Azure DevOps Server (on-prem) is not supported.
