# Protect a Micro Hoster project with Cloudflare Access

Use this mode when the published material must not be public. `noindex`, random URLs, and an unlisted landing page do not provide access control.

## Recommended access model

Use Cloudflare Access with your team identity provider or email one-time PIN. A shared password is weaker, difficult to revoke per person, and would require adding server-side code that Micro Hoster intentionally does not deploy.

## Safe setup order

1. Configure a unique project in unlisted mode:

   ```powershell
   micro-hoster configure --project my-team-plans --visibility unlisted
   ```

2. Publish only harmless placeholder content. Cloudflare needs an existing project and deployment before every hostname can be checked.

3. In Cloudflare Pages, attach the custom hostname you control, for example `plans.example.com`. Wait until it is active before enabling Access on that hostname; Access can interfere with Pages certificate validation if enabled too early.

4. In Cloudflare Zero Trust, create a self-hosted Access application for the custom hostname. Add an Allow policy for the exact team emails, verified email domain, or identity-provider group that should have access.

5. Protect Pages deployment hostnames:

   - enable the Pages access policy for preview deployments;
   - protect `<project>.pages.dev`;
   - confirm the preview wildcard `*.<project>.pages.dev` is also protected.

6. Redirect the production `<project>.pages.dev` hostname and subpaths to the protected custom hostname using a Cloudflare account-level Bulk Redirect. Keep the preview wildcard protected by Access.

7. Confirm in a signed-out or private browser window:

   - `https://plans.example.com/` opens the Access login;
   - `https://<project>.pages.dev/` redirects to an Access-protected hostname;
   - an existing `https://<hash>.<project>.pages.dev/` deployment opens the Access login.

8. Switch Micro Hoster to Access mode:

   ```powershell
   micro-hoster configure --project my-team-plans --domain plans.example.com --visibility access
   micro-hoster status
   ```

9. Publish the intended plan. The CLI repeats all three unauthenticated checks before deploying and verifies the newly generated hashed deployment hostname afterward.

## Existing public deployments

Changing the current production deployment does not erase historical deployment URLs. Protect the wildcard hostname before treating old deployments as private. Delete deployments that should no longer exist:

```powershell
npx wrangler pages deployment list --project-name my-team-plans
npx wrangler pages deployment delete <deployment-id> --project-name my-team-plans
```

Deletion is destructive. Verify the exact project and deployment IDs before running it.

## Current Cloudflare documentation

- Custom domains and disabling the `pages.dev` hostname: <https://developers.cloudflare.com/pages/configuration/custom-domains/>
- Protecting Pages preview deployments: <https://developers.cloudflare.com/pages/configuration/preview-deployments/>
- Pages and Access known issues: <https://developers.cloudflare.com/pages/platform/known-issues/>
- Redirecting `pages.dev` to a custom domain: <https://developers.cloudflare.com/pages/how-to/redirect-to-custom-domain/>
