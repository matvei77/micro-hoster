# An HTML plan beats a text document, until you try to share it with your team

We stopped writing plans as documents a while ago. A plan is now a page: interactive, with the images, video, and diagrams that made the argument in the first place.

Then sharing it undoes all of that.

Export to PDF and you throw away the half worth reading. Sending the HTML files is annoying and clunky. Serve it off your laptop through a temporary tunnel, and you have quietly made yourself the server: slow for anyone far away, worse the moment three people open it at once, and gone when you close the lid.

So the question stopped being how to send a plan and became how to make publishing one as easy as asking an LLM to write it.

Cloudflare Pages gives you a stable link and static hosting with nothing to keep alive. That infrastructure has existed for years. The last step was making agents publish to it without a human deployment handoff. Install Micro Hoster once, configure it with your Cloudflare account, and the agent that wrote the plan can ship it. "Share this" ends with a link.

## It does not use our hosting account

This distinction matters enough to state plainly.

Micro Hoster is software, not a shared hosting service. The public repository contains no Cloudflare credentials, account ID, Pages project, or deployment domain. A fresh clone cannot publish until its owner signs in to their own Cloudflare account and selects a project:

```powershell
npm install --global github:matvei77/micro-hoster
micro-hoster login
micro-hoster configure --project my-team-plans --visibility unlisted
```

Cloudflare gives that project its own address, normally `<project>.pages.dev` or a suffixed variant if the name is unavailable. Someone cloning the repository does not inherit our `micro-hoster.pages.dev` hostname and cannot publish to our Pages project.

Every installation has its own Cloudflare account, project, deployment history, URL, and local content store. The owner can instead attach a domain they control, such as `plans.example.com`, and make that the link the tool returns.

They can follow the same setup procedure, but only for a project and domain they control. Pointing an arbitrary CNAME at somebody else's `pages.dev` hostname does not attach that domain to the Pages project or grant deployment access; the custom hostname must also be added from inside the project.

## A custom domain is not automatically private

After attaching the custom hostname to your own Pages project, this DNS record routes it to the project:

```text
CNAME  plans  <project>.pages.dev  Proxied
```

That creates another route to the same deployment. It does not disable `<project>.pages.dev`, and it does not protect hashed deployment URLs such as `<hash>.<project>.pages.dev`.

For confidential plans, the complete setup is:

1. Attach the custom hostname in the Pages project's **Custom domains** settings.
2. Add or confirm the proxied CNAME and wait until the custom domain is active with working HTTPS.
3. Create a Cloudflare Access application for the custom hostname and allow only the intended team emails, verified email domain, or identity-provider group.
4. Enable the Pages access policy for preview deployments.
5. Protect both `<project>.pages.dev` and `*.<project>.pages.dev`.
6. Add a Cloudflare Bulk Redirect from `<project>.pages.dev` to the protected custom hostname, preserving paths and query strings.
7. Test the custom domain, production `pages.dev` hostname, and an existing hashed deployment URL while signed out.
8. Switch Micro Hoster to its fail-closed Access mode:

   ```powershell
   micro-hoster configure --project my-team-plans --domain plans.example.com --visibility access
   ```

Access mode checks all three hostname paths before publishing and refuses the deployment if any route is still public.

## The unglamorous parts are the product

An agent with deploy rights is a liability if you get the boundaries wrong.

Unlisted links are still public. The tool generates random default links and adds `noindex` controls, but neither replaces authentication.

It refuses `.env` files, private keys, credential-store folders, symlinks, Pages Functions, and common credential patterns. It still cannot know that an otherwise harmless-looking plan is confidential. You have to make that decision.

It publishes static assets only. It does not provision Workers, KV, databases, custom domains, or other infrastructure that can quietly begin billing you.

It stops at 400 locally recorded deployments per calendar month, preserving a buffer below the Pages Free allowance. That counter is a local safety guard, not a Cloudflare billing control.

Your Cloudflare account, your login, your project, your domain. The repository ships no credentials and no shared deployment account, because a shared account is how a useful publishing tool turns into a security incident.

We have been running it internally. It is MIT on GitHub. Clone it, point your agent at it, and change whatever does not fit your setup:

<https://github.com/matvei77/micro-hoster>
