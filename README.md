<p align="center">
  <img src="https://socialify.git.ci/379949990/jarvis-outpost-sync/image?description=1&amp;font=KoHo&amp;language=1&amp;logo=https%3A%2F%2Fobsidian.md%2Fimages%2Fobsidian-logo-gradient.svg&amp;name=1&amp;owner=1&amp;pattern=Plus&amp;theme=Auto" alt="Jarvis Outpost Sync" width="100%" />
</p>

<p align="center">
  <strong>Jarvis Outpost Sync</strong> — read-only sync from your self-hosted Jarvis Outpost API into a local Obsidian vault.<br/>
  Pairing · Incremental pull · No default server · Device token on this machine only
</p>

<p align="center">
  <a href="https://github.com/379949990/jarvis-outpost-sync/releases"><img alt="release" src="https://img.shields.io/github/v/release/379949990/jarvis-outpost-sync?include_prereleases&amp;style=flat-square" /></a>
  <img alt="obsidian" src="https://img.shields.io/badge/Obsidian-1.13.0%2B-7c3aed?style=flat-square" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" />
</p>

---

## What it does

Jarvis Outpost Sync is an Obsidian **read-only** client for a **self-hosted** Jarvis Outpost control plane:

1. You set the **API base URL** yourself (nothing is hard-coded; no default server)
2. You pair with a one-time code from the Jarvis PWA → the plugin stores a **device token** in local plugin data
3. On sync, it pulls vault content from the jail-scoped vault API into your open vault folder
4. Status bar shows idle / syncing / last result

It does **not** write back to the server vault through this plugin. Authoring stays in Obsidian or on the host.

Plugin id: `jarvis-outpost-sync`.

---

## Install

1. Community plugins → search **Jarvis Outpost Sync** *(after directory publish)*, or
2. [BRAT](https://github.com/TfTHacker/obsidian42-brat): add `379949990/jarvis-outpost-sync`, or
3. Manual: put `main.js`, `manifest.json`, and `styles.css` from [Releases](https://github.com/379949990/jarvis-outpost-sync/releases) into `.obsidian/plugins/jarvis-outpost-sync/`

Requires Obsidian **1.13.0+**.

This repository is the **public distribution** surface (manifest, releases, community README). Application source is maintained separately and is not published here.

---

## Usage

| Action | How |
| --- | --- |
| Open settings | Settings → Jarvis Outpost Sync |
| API address | Your Outpost origin, e.g. `https://your-host.example` (no trailing slash) |
| Pair | Generate a pair code in the Jarvis PWA → paste into the plugin |
| Sync now | Command **Jarvis：立即同步** or the ribbon / status affordance |
| Status | Status bar shows idle / syncing / errors |

Token refresh uses the Outpost device-token refresh endpoint. Revoke pairing from the host if the device should lose access.

---

## Notes & limits

- **Read-only** sync into the vault you opened in Obsidian
- You must run your own Outpost API; this plugin does not ship a cloud backend
- Device token stays in this machine’s plugin `data.json`
- Do not install lookalike plugins with a different id
- The server administrator can disable new pairing

---

## License

MIT · [@379949990](https://github.com/379949990)
