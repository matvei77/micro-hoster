# Micro Hoster

Micro Hoster turns a local HTML file or prebuilt static app into a verified Cloudflare Pages link. It is a single-user tool: every installation uses that user's own Wrangler login, Cloudflare account, explicitly configured Direct Upload Pages project, and local content store.

The public repository does not include a Cloudflare account ID, API token, OAuth credential, shared deployment account, Pages project, or deployment domain. A fresh installation cannot publish until its owner chooses a project.

## Quick start

Install the CLI directly from GitHub:

```powershell
npm install --global github:matvei77/micro-hoster
micro-hoster login
micro-hoster configure --project my-team-plans --visibility unlisted
micro-hoster status
```

`micro-hoster login` opens Cloudflare's browser login through the bundled Wrangler CLI. Credentials remain in Wrangler's user-level credential store and are never copied into this repository.

If the login belongs to multiple Cloudflare accounts, choose one explicitly:

```powershell
micro-hoster status --account "Personal account"
micro-hoster publish C:\path\to\plan.html --account "Personal account"
```

An account ID also works. For persistent selection, set `CLOUDFLARE_ACCOUNT_ID`.

Project names are deliberately not shared by this repository. Choose a unique neutral name for your own account. If that Pages project already exists, Micro Hoster refuses to use it unless you explicitly add `--adopt-existing`.

## Install the agent skill

The same `share-on-pages` workflow is packaged for Codex, Claude Code, Kimi Code, and OpenCode.

### Codex

```powershell
codex plugin marketplace add matvei77/micro-hoster
codex plugin add micro-hoster@personal
```

Start a new thread after installation. To update:

```powershell
codex plugin marketplace upgrade personal
codex plugin add micro-hoster@personal
```

### Claude Code

```powershell
claude plugin marketplace add matvei77/micro-hoster
claude plugin install micro-hoster@micro-hoster
```

Restart Claude Code after installation or updates.

### Kimi Code

Run this inside Kimi Code:

```text
/plugins install https://github.com/matvei77/micro-hoster
/new
```

Kimi installs the plugin from `.kimi-plugin/plugin.json` and applies it to new sessions.

### OpenCode

OpenCode discovers the Claude-compatible global skill installed by the shared repository installer. This avoids presenting a documentation-only workflow as an executable OpenCode hook plugin.

### One installer for all supported agents

Windows:

```powershell
git clone https://github.com/matvei77/micro-hoster.git
Set-Location micro-hoster
.\scripts\install.ps1
micro-hoster login
```

macOS or Linux:

```sh
git clone https://github.com/matvei77/micro-hoster.git
cd micro-hoster
./scripts/install.sh
micro-hoster login
```

The installers link one canonical skill source into Codex, Claude Code, and Kimi Code. OpenCode automatically discovers the Claude-compatible global skill. Existing skill directories that are not owned by this repository are never overwritten.

## Publish

```powershell
micro-hoster publish C:\path\to\plan.html
micro-hoster publish C:\path\to\built-app --slug campaign-review --title "Campaign review"
micro-hoster publish C:\path\to\built-app --account "Studio"
```

An HTML file is published as `index.html`. A folder must contain `index.html` at its root and should be a prebuilt static output folder such as `dist`.

On first publication, Micro Hoster creates the configured Direct Upload Pages project in the selected user's Cloudflare account. Later publications reuse it. There is no repository-wide default project or domain.

For agents and scripts, add `--json`. Successful output includes the selected account, project, `shareUrl`, `verified`, and `httpStatus`.

Every publication is retained in the user's local content store and included in later deployments, so previously returned slug links remain stable. State is partitioned by Cloudflare account and Pages project to prevent cross-account mixing. The default store is `~/.micro-hoster`; override it with `MICRO_HOSTER_HOME`.

## Visibility modes

### Unlisted

```powershell
micro-hoster configure --project my-team-plans --visibility unlisted
```

Unlisted is the default. Links remain public, but the host does not display a directory of publications, default slugs include a random 128-bit suffix, missing paths return a real 404 page, and `robots.txt` plus `X-Robots-Tag` ask search engines not to index the site. This is obscurity, not access control.

### Custom domain with Cloudflare Access

First initialize the project in unlisted mode with harmless content. Then attach a custom hostname such as `plans.example.com` in Cloudflare Pages and configure Cloudflare Access for:

- the custom hostname;
- the production `<project>.pages.dev` hostname or its redirect to the protected custom hostname;
- preview and hashed deployment hostnames under `*.<project>.pages.dev`.

After all three paths are protected:

```powershell
micro-hoster configure --project my-team-plans --domain plans.example.com --visibility access
micro-hoster publish C:\path\to\private-plan.html
```

Access mode performs unauthenticated preflight checks and refuses to deploy unless all three hostname paths lead to a Cloudflare Access challenge. It checks the new hashed deployment again after publishing.

Cloudflare Access normally uses an identity provider or email one-time PIN rather than a shared password. See [docs/cloudflare-access.md](docs/cloudflare-access.md) for the safe setup order and cleanup guidance.

## Safety and cost boundary

- Unlisted links are public. Use verified Access mode for confidential material.
- The publisher blocks common credential filenames and formats, scans text assets for high-confidence credential patterns, and rejects symlinks, `_worker.js`, and `functions/`. This is a safety net, not a complete secret scanner.
- A fresh installation has no project or domain. Existing projects require explicit adoption.
- The public landing page does not enumerate retained publications.
- It enforces the Cloudflare Pages limits of 20,000 files and 25 MiB per file.
- It publishes static assets only. It does not create Pages Functions, Workers, KV, D1, R2, custom domains, or other usage-based resources.
- It records successful deployments locally and stops at 400 per calendar month, retaining a conservative buffer below the documented Pages Free build allowance. This local counter is not a Cloudflare billing control.
- It never opts into a paid Cloudflare service, plan, limit increase, or usage-based feature.

## Repository layout

- `skills/share-on-pages` — canonical cross-agent skill source
- `plugins/micro-hoster` — Codex plugin bundle
- `.agents/plugins/marketplace.json` — Codex marketplace
- `.claude-plugin` — Claude Code plugin and marketplace
- `.kimi-plugin/plugin.json` — Kimi Code plugin
- `docs/cloudflare-access.md` — custom-domain and Access setup
- `scripts/install.ps1` and `scripts/install.sh` — shared local installers
