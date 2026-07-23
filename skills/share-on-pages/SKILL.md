---
name: share-on-pages
description: Publish a generated HTML file or prebuilt static micro-app to the user's own Cloudflare Pages account and return a verified public share link. Use when the user says to share, host, publish, or deploy an HTML plan, visual explanation, prototype, report, or static app.
---

# Share on Pages

Use the installed `micro-hoster` command. It uses the current user's local Wrangler authentication and creates or reuses a Direct Upload Pages project in the Cloudflare account they select. Treat publication as a public external write.

## First use

1. If `micro-hoster` is missing, direct the user to the installation options at `https://github.com/matvei77/micro-hoster#install-from-github`.
2. Run `micro-hoster login` so the user authenticates directly with Cloudflare in their browser.
3. Run `micro-hoster status`. If multiple Cloudflare accounts are available, ask which account to use and pass `--account <id-or-exact-name>` to `status` and `publish`.
4. Never ask the user to paste a Cloudflare token, account secret, or OAuth credential into chat.

## Publish

1. Resolve the exact artifact path. For a folder, require a prebuilt static output with `index.html` at its root.
2. Confirm the artifact contains no confidential information, credentials, personal data, or material the user did not authorize for public sharing. If uncertain, stop and ask.
3. Run `micro-hoster publish <absolute-path> --json`. Add `--slug <short-slug>`, `--title <title>`, `--project <name>`, and `--account <id-or-exact-name>` when useful.
4. Explain that Micro Hoster will create the named Direct Upload Pages project in the selected user's Cloudflare account if it does not exist.
5. Parse the final JSON object. Require `verified: true`, an HTTP 2xx `httpStatus`, and a `shareUrl` on `pages.dev`.
6. Return the share link. Mention that it is public. If publication fails, report the exact error and do not claim a link works.

## Constraints

- Publish only static HTML, CSS, JavaScript, images, fonts, and other browser assets.
- Do not bypass the publisher's secret, server-code, symlink, file-count, or file-size checks.
- Do not bypass or modify the monthly cost guard without telling the user exactly why and obtaining explicit approval.
- Never enable a paid Cloudflare service, plan, limit increase, or usage-based feature as part of this workflow.
- Use a folder rather than a single HTML file when the page relies on local sibling assets.
- Never describe a Pages link as private or access-controlled.
