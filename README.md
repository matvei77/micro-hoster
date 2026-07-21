# Micro Hoster

Micro Hoster turns a local HTML file or static micro-app folder into a verified Cloudflare Pages share link. It is deliberately a single-user tool: one Pages project, one local content store, and one command.

## Setup

```powershell
.\scripts\install.ps1
npx wrangler login
micro-hoster status
```

Wrangler opens Cloudflare's browser login. If the account has multiple Cloudflare accounts, set `CLOUDFLARE_ACCOUNT_ID` before publishing.

## Publish

```powershell
micro-hoster publish C:\path\to\plan.html
micro-hoster publish C:\path\to\built-app --slug campaign-review --title "Campaign review"
```

An HTML file is published as `index.html`. A folder must contain `index.html` at its root and should be a prebuilt static output folder such as `dist`.

For agents, add `--json`. The JSON contains `shareUrl`, `verified`, and `httpStatus`. Every publication is retained in the local content store and included in later deployments, so previously returned slug links remain stable.

## Safety and cost boundary

- All links are public. Never publish confidential data or credentials.
- The publisher blocks `.env`, `.dev.vars`, private-key-like files, symlinks, `_worker.js`, and `functions/`.
- It enforces the Cloudflare Pages Free limits of 20,000 files and 25 MiB per file.
- It publishes static assets only. It does not create Pages Functions, Workers, KV, D1, R2, custom domains, or other billable resources.
- Cloudflare documents static asset requests as free and unlimited. Account-level plan settings remain outside this tool's control.
- It records successful deployments locally and stops at 400 per calendar month, leaving a 100-deployment buffer below Cloudflare's documented Free-plan allowance of 500 builds per month. There is no command-line override; raising the limit requires a deliberate source-code change.
- It never opts into a paid Cloudflare service or paid-limit increase. If a future feature could incur charges, it must be implemented behind a new explicit acknowledgement step.

The default Pages project is `micro-hoster`. Override it with `MICRO_HOSTER_PROJECT` or `--project`. Local retained content lives in `%USERPROFILE%\.micro-hoster`; override it with `MICRO_HOSTER_HOME`.

## Agent integration

The reusable skill source is in `integrations/skills/share-on-pages`. The installer exposes it globally to Codex, Claude Code, and Kimi Code while all three use the same source of truth. Invoke it as `$share-on-pages` in Codex, `/share-on-pages` in Claude Code, or `/skill:share-on-pages` in Kimi Code.
