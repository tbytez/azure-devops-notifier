# Azure DevOps Notifier

A local-first Chrome extension for Azure DevOps pull request activity. Automatically follow PRs you create or are asked to review, watch any PR by URL, and choose which changes trigger alerts.

## Setup

Requires Chrome 116+ and Node.js 22.18+.

1. Clone, install dependencies, and build:
   ```sh
   git clone https://github.com/tbytez/azure-devops-notifier.git
   cd azure-devops-notifier
   npm ci
   npm run build
   ```
2. Open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and choose this repository's folder.
3. Open the extension and select **Set up**. Enter your Azure DevOps organization and a Personal Access Token with **Code (Read)** and **Project and Team (Read)**.
4. Choose projects to discover your PRs and review requests automatically, or leave them unchecked and add individual PR URLs manually.
5. Configure activity types and the polling interval in **Settings**. You can also set preferences per watched PR.

For a prebuilt version, download the ZIP from [Releases](https://github.com/tbytez/azure-devops-notifier/releases), extract it, and start at step 2.

## Updates

The extension checks GitHub Releases every 12 hours and shows a download link in the dashboard and popup when a newer version exists. Settings → **Extension updates** → **Check now** runs it manually. This check is read-only and anonymous: it fetches `releases/latest` from `api.github.com` and nothing is sent out.

To update, download the latest ZIP, extract it over your existing extension folder, and click **Reload** on `chrome://extensions`. Your setup (organization, PAT, watches, history) carries over because the extension pins a fixed `key` in the manifest, which keeps its ID stable no matter where the folder lives.

Note: upgrading to **v0.1.2** changes the extension ID once (the `key` is new in this version), so this one update requires setup again. Every update after that keeps your setup.

Desktop notifications are enabled by default, subject to Chrome permission and OS notification settings. Sound is optional and off by default; enable **Play notification sound**, save settings, or use **Test sound** to preview it. Light/dark mode is available in the dashboard and popup.

Checks run every 1-10 minutes while Chrome is running. The first successful check for review assignments in each selected project starts watching existing assignments quietly. Later assignments trigger an alert when the Reviewers category is enabled. Each reviewer needs their own connected extension. Supports Azure DevOps Services (`dev.azure.com`), not on-premises Azure DevOps Server.

## Privacy

No backend or telemetry. Your PAT, preferences, and history stay in `chrome.storage.local` in this Chrome profile. The extension does not encrypt the PAT separately; it is sent only to Azure DevOps over HTTPS. Never commit tokens or share them in issues.

## Development

```sh
npm test          # Automated tests
npm run check     # Type-check, build, and extension validation
npm run package   # Build and create a ZIP in dist/
```

For a fixture-only UI demo, run `npm run dev -- --host 127.0.0.1 --port 8933` and open `http://127.0.0.1:8933/dashboard.html?demo=1`. Demo data is fictional and does not connect to Azure DevOps.
