---
name: share-on-pages
description: Publish a generated HTML file or prebuilt static micro-app to Cloudflare Pages and return a verified team share link. Use when the user says to share, host, publish, or deploy an HTML plan, visual explanation, prototype, report, or static app, especially requests like "give me a link to share with the team."
---

# Share on Pages

Use the installed `micro-hoster` command. Treat publication as a public external write.

## Publish

1. Resolve the exact artifact path. For a folder, require a prebuilt static output with `index.html` at its root.
2. Confirm the artifact contains no confidential information, credentials, personal data, or material the user did not authorize for public sharing. If uncertain, stop and ask.
3. Run `micro-hoster publish <absolute-path> --json`. Add `--slug <short-slug>` and `--title <title>` when useful. Do not add Pages Functions or other Cloudflare services.
4. Parse the final JSON object. Require `verified: true`, an HTTP 2xx `httpStatus`, and a `shareUrl` on `pages.dev`.
5. Return the share link. Mention that it is public. If publication fails, report the exact error and do not claim a link works.

## Authentication

If `micro-hoster` is not installed, ask the user to run:

```powershell
npm install --global github:matvei77/micro-hoster
```

If the command reports that Cloudflare is not authenticated, ask the user to run `npx wrangler login`. Retry only after login succeeds.

## Constraints

- Publish only static HTML, CSS, JavaScript, images, fonts, and other browser assets.
- Do not bypass the publisher's secret, server-code, symlink, file-count, or file-size checks.
- Do not bypass or modify the monthly cost guard without telling the user exactly why and obtaining explicit approval.
- Never enable a paid Cloudflare service, plan, limit increase, or usage-based feature as part of this workflow.
- Use a folder rather than a single HTML file when the page relies on local sibling assets.
- Never describe a Pages link as private or access-controlled.
