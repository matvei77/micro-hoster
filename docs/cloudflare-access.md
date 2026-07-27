# Protect a Micro Hoster project with Cloudflare Access

Use this mode when the published material must not be public. `noindex`, random URLs, and an unlisted landing page do not provide access control.

## Recommended access model

Use Cloudflare Access with your team identity provider or email one-time PIN. A shared password is weaker, difficult to revoke per person, and would require adding server-side code that Micro Hoster intentionally does not deploy.

## Clone and URL ownership

Micro Hoster is software, not a shared hosting service. A clone contains no Cloudflare account ID, login credential, Pages project, deployment domain, custom domain, or Access policy.

Each owner signs in to their own Cloudflare account and chooses their own project. Cloudflare assigns that project a separate `<project>.pages.dev` hostname, or a suffixed variant if the requested hostname is unavailable. A clone cannot publish to the maintainer's `micro-hoster.pages.dev` project unless the maintainer separately gives that person access to the relevant Cloudflare account.

Each owner can attach a domain they control, such as `plans.example.com`, and protect it with their own Cloudflare Access policy. None of that configuration is inherited from the repository.

## Safe setup order

1. Configure a unique project in unlisted mode:

   ```powershell
   micro-hoster configure --project my-team-plans --visibility unlisted
   ```

2. Publish only harmless placeholder content. Cloudflare needs an existing project and deployment before every hostname can be checked.

3. In **Workers & Pages > your Pages project > Custom domains**, attach the custom hostname you control, for example `plans.example.com`.

4. In the DNS zone for `example.com`, add or confirm this proxied record:

   | Type | Name | Target | Proxy status |
   | --- | --- | --- | --- |
   | CNAME | `plans` | `<project>.pages.dev` | Proxied |

   Add the domain through the Pages dashboard before manually creating the CNAME. A DNS record by itself does not attach the hostname to the Pages project.

5. Wait until the Pages custom domain is active and HTTPS works. Do this before enabling Access or a redirect on that hostname; either can interfere with Pages certificate validation if enabled too early.

6. In **Cloudflare Zero Trust > Access > Applications**, create a self-hosted Access application for `plans.example.com`. Add an Allow policy for the exact team emails, verified email domain, or identity-provider group that should have access.

7. In the Pages project's **Settings > General > Access policy**, enable Access for preview deployments. Confirm the resulting Access coverage protects:

   - `<project>.pages.dev`;
   - `*.<project>.pages.dev`, including hashed deployment URLs.

8. In **Rules > Redirect Rules > Bulk Redirects**, create an account-level redirect from the production Pages hostname to the protected custom hostname:

   | Source URL | Target URL | Status | Options |
   | --- | --- | --- | --- |
   | `https://<project>.pages.dev/` | `https://plans.example.com/` | 301 | Preserve query string, Subpath matching, Include subdomains, Preserve path suffix |

   The redirect makes the custom hostname canonical. It does not remove the Pages hostname or replace Access protection for the preview wildcard.

9. Confirm in a signed-out or private browser window:

   - `https://plans.example.com/` opens the Access login;
   - `https://<project>.pages.dev/` redirects to an Access-protected hostname;
   - an existing `https://<hash>.<project>.pages.dev/` deployment opens the Access login.

10. Switch Micro Hoster to Access mode:

   ```powershell
   micro-hoster configure --project my-team-plans --domain plans.example.com --visibility access
   micro-hoster status
   ```

11. Publish the intended plan. The CLI repeats all three unauthenticated checks before deploying and verifies the newly generated hashed deployment hostname afterward.

## What this does and does not remove

The custom domain and the `pages.dev` hostnames are routes to the same Pages project. Attaching `plans.example.com` does not make `<project>.pages.dev` disappear. Cloudflare Access supplies the authentication boundary, while the redirect makes the protected custom domain the normal public-facing URL.

Do not delete the active production deployment merely to remove its `pages.dev` URL. The custom domain serves that same deployment. Protect or redirect the alternate hostname instead.

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
