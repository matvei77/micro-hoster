---
name: share-on-pages
description: Publish a generated HTML file or prebuilt static micro-app to the user's own Cloudflare Pages account and return a verified unlisted or Access-protected share link. Use when the user says to share, host, publish, or deploy an HTML plan, visual explanation, prototype, report, or static app.
---

# Share on Pages

Use the installed `micro-hoster` command. It uses the current user's local Wrangler authentication and their explicitly configured Direct Upload Pages project. A repository clone does not inherit the maintainer's Cloudflare account, Pages project, deployment hostname, custom domain, or Access policy. Treat publication as an external write.

## First use

1. If `micro-hoster` is missing, direct the user to the installation options at `https://github.com/matvei77/micro-hoster#quick-start`.
2. Run `micro-hoster login` so the user authenticates directly with Cloudflare in their browser.
3. Run `micro-hoster status --json`. If `configured` is false, explain that this installation needs its own project, then ask for a unique project name and whether the user wants public-unlisted or Cloudflare Access-protected sharing.
4. Configure public-unlisted mode with `micro-hoster configure --project <unique-name> --visibility unlisted`. Explain that unlisted links are still public.
5. For confidential material, follow `https://github.com/matvei77/micro-hoster/blob/main/docs/cloudflare-access.md`: use a custom domain already attached to the user's Pages project and fully protect the custom domain, production `pages.dev` hostname, and preview wildcard with Cloudflare Access. Only then run `micro-hoster configure --project <name> --domain <hostname> --visibility access`.
6. If multiple Cloudflare accounts are available, ask which account to use and pass `--account <id-or-exact-name>`.
7. Never ask the user to paste a Cloudflare token, account secret, OAuth credential, or shared password into chat.
8. Never add `--adopt-existing` unless the user explicitly confirms that Micro Hoster may replace that existing Pages project's production deployment.

## Account, project, and domain ownership

- Never infer a Pages project from this repository's name, the maintainer's `micro-hoster.pages.dev` hostname, or a public example. Each installation must use an explicitly selected project in the authenticated user's Cloudflare account.
- Cloudflare assigns each project its own `<project>.pages.dev` hostname or a suffixed variant if the requested hostname is unavailable. Do not describe that hostname as shared infrastructure operated by the repository maintainer.
- Route only domains the user controls to projects they are authorized to manage. A CNAME alone does not attach a custom hostname to a Pages project or grant deployment access; the hostname must also be added in that project's Pages settings.
- Attaching a custom domain does not remove the project's `pages.dev` or hashed deployment hostnames. For confidential material, require Access coverage for every route and verify it in a signed-out request before publishing.

## Publish

1. Resolve the exact artifact path. For a folder, require a prebuilt static output with `index.html` at its root.
2. Check the configured visibility with `micro-hoster status --json`.
3. In unlisted mode, confirm the artifact contains no confidential information, credentials, personal data, or material the user did not authorize for public sharing. If uncertain, stop and ask.
4. In Access mode, still check for inappropriate content; access control reduces exposure but does not make unsafe content acceptable.
5. Run `micro-hoster publish <absolute-path> --json`. Add `--slug <short-slug>`, `--title <title>`, and `--account <id-or-exact-name>` when useful.
6. Parse the final JSON object. Require `verified: true` and a `shareUrl`.
7. For Access mode, also require `visibility: "access"` and `protectedByAccess: true`. If either is missing, do not describe the link as private.
8. For unlisted mode, explicitly say the link is public and unlisted.
9. Return the link only after the relevant verification passes. If publication fails, report the exact error and do not claim a link works.

## Constraints

- Publish only static HTML, CSS, JavaScript, images, fonts, and other browser assets.
- Do not bypass the publisher's secret, server-code, symlink, file-count, or file-size checks.
- Never describe `noindex`, `robots.txt`, random URLs, or unlisted mode as privacy or authentication.
- Access mode must protect the custom domain, the production `pages.dev` path, and hashed preview/deployment hostnames.
- Do not bypass or modify the monthly cost guard without telling the user exactly why and obtaining explicit approval.
- Never enable a paid Cloudflare service, plan, limit increase, or usage-based feature as part of this workflow.
- Use a folder rather than a single HTML file when the page relies on local sibling assets.
