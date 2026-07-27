import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { accessProtectionStatus, defaultSlug, monthlyDeploymentUsage, projectDomains, renderLanding, selectAccount, slugify, validateDomain } from "../src/cli.js";

const execFileAsync = promisify(execFile);
const cli = resolve("src/cli.js");

test("slugify creates URL-safe slugs", () => assert.equal(slugify("Quarterly Plan v2.html"), "quarterly-plan-v2"));

test("default slugs are unguessable and do not collide", () => {
  const first = defaultSlug("Quarterly Plan.html");
  const second = defaultSlug("Quarterly Plan.html");
  assert.match(first, /^quarterly-plan-[a-f0-9]{32}$/);
  assert.notEqual(first, second);
});

test("dry-run accepts one HTML file", async () => {
  const root = await mkdtemp(join(tmpdir(), "micro-hoster-test-"));
  const html = join(root, "Plan.html");
  await writeFile(html, "<!doctype html><title>Plan</title><h1>Ready</h1>");
  const { stdout } = await execFileAsync(process.execPath, [cli, "publish", html, "--project", "neutral-test-host", "--slug", "team-plan", "--dry-run", "--json"], { env: { ...process.env, MICRO_HOSTER_HOME: join(root, "state") } });
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.slug, "team-plan");
  assert.equal(result.files, 5);
});

test("dry-run accepts a static app folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "micro-hoster-test-"));
  const app = join(root, "app");
  await mkdir(app);
  await writeFile(join(app, "index.html"), "<!doctype html><script src=\"app.js\"></script>");
  await writeFile(join(app, "app.js"), "document.body.append('works')");
  const { stdout } = await execFileAsync(process.execPath, [cli, "publish", app, "--project", "neutral-test-host", "--dry-run", "--json"], { env: { ...process.env, MICRO_HOSTER_HOME: join(root, "state") } });
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.files, 6);
});

test("publisher rejects secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "micro-hoster-test-"));
  await writeFile(join(root, "index.html"), "ok");
  await writeFile(join(root, ".env"), "SECRET=do-not-publish");
  await assert.rejects(execFileAsync(process.execPath, [cli, "publish", root, "--project", "neutral-test-host", "--dry-run"], { env: { ...process.env, MICRO_HOSTER_HOME: join(root, "state") } }), /Refusing to publish possible secret/);
});

test("publisher scans allowed text filenames for credential content", async () => {
  const root = await mkdtemp(join(tmpdir(), "micro-hoster-test-"));
  await writeFile(join(root, "index.html"), "ok");
  await writeFile(join(root, "config.js"), "const access_token = \"fake-but-sensitive-credential-value\";");
  await assert.rejects(execFileAsync(process.execPath, [cli, "publish", root, "--project", "neutral-test-host", "--dry-run"], { env: { ...process.env, MICRO_HOSTER_HOME: join(root, "state") } }), /detected assigned credential/);
});

test("publisher rejects Pages Functions", async () => {
  const root = await mkdtemp(join(tmpdir(), "micro-hoster-test-"));
  await writeFile(join(root, "index.html"), "ok");
  await mkdir(join(root, "functions"));
  await writeFile(join(root, "functions", "hello.js"), "export const onRequest = () => new Response('hi')");
  await assert.rejects(execFileAsync(process.execPath, [cli, "publish", root, "--project", "neutral-test-host", "--dry-run"], { env: { ...process.env, MICRO_HOSTER_HOME: join(root, "state") } }), /forbidden path/);
});

test("publisher rejects credential-store folders even when they are the input root", async () => {
  const root = await mkdtemp(join(tmpdir(), "micro-hoster-test-"));
  const store = join(root, ".micro-hoster");
  await mkdir(store);
  await writeFile(join(store, "index.html"), "ok");
  await assert.rejects(execFileAsync(process.execPath, [cli, "publish", store, "--project", "neutral-test-host", "--dry-run"], { env: { ...process.env, MICRO_HOSTER_HOME: join(root, "state") } }), /forbidden path/);
});

test("monthly cost guard reports the conservative free-tier buffer", () => {
  const deployments = Array.from({ length: 399 }, (_, index) => ({ deployedAt: `2026-07-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z` }));
  const result = monthlyDeploymentUsage({ deployments }, new Date("2026-07-21T00:00:00.000Z"));
  assert.equal(result.used, 399);
  assert.equal(result.localLimit, 400);
  assert.equal(result.cloudflareFreeLimit, 500);
  assert.equal(result.remaining, 1);
  assert.equal(result.paidServicesAllowed, false);
});

test("publisher refuses deployment when the local monthly ceiling is reached", async () => {
  const root = await mkdtemp(join(tmpdir(), "micro-hoster-test-"));
  const state = join(root, "state");
  const html = join(root, "plan.html");
  const deployments = Array.from({ length: 400 }, (_, index) => ({ deployedAt: `${new Date().toISOString().slice(0, 7)}-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z` }));
  await mkdir(state);
  await writeFile(html, "<!doctype html><title>Plan</title>");
  await writeFile(join(state, "manifest.json"), JSON.stringify({ version: 1, publications: [], deployments }));
  await assert.rejects(execFileAsync(process.execPath, [cli, "publish", html, "--project", "neutral-test-host", "--dry-run"], { env: { ...process.env, MICRO_HOSTER_HOME: state } }), /Cost guard stopped this deployment/);
});

test("fresh installations require an explicit neutral project", async () => {
  const root = await mkdtemp(join(tmpdir(), "micro-hoster-test-"));
  const html = join(root, "plan.html");
  await writeFile(html, "<!doctype html><title>Plan</title>");
  await assert.rejects(execFileAsync(process.execPath, [cli, "publish", html, "--dry-run"], { env: { ...process.env, MICRO_HOSTER_HOME: join(root, "state"), MICRO_HOSTER_PROJECT: "" } }), /No Pages project is configured/);
});

test("landing page does not enumerate retained publications", () => {
  const html = renderLanding();
  assert.doesNotMatch(html, /Shared artifacts|quarterly-plan|<li>|<a /);
  assert.match(html, /unlisted shared content/);
});

test("custom domains and Wrangler project-domain output are normalized", () => {
  assert.equal(validateDomain("Plans.Example.com."), "plans.example.com");
  assert.throws(() => validateDomain("https://plans.example.com/path"), /without a scheme/);
  assert.deepEqual(projectDomains({ "Project Domains": "neutral.pages.dev, Plans.Example.com" }, "neutral"), ["neutral.pages.dev", "plans.example.com"]);
});

test("Cloudflare Access redirects are recognized", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/plans.example.com" } });
  try {
    const result = await accessProtectionStatus("https://plans.example.com/");
    assert.equal(result.protected, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an unrelated redirect to cloudflareaccess.com is not accepted as protection", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 302, headers: { location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/unrelated.example.com" } });
  try {
    const result = await accessProtectionStatus("https://plans.example.com/");
    assert.equal(result.protected, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a pages.dev redirect to an Access-protected custom domain is accepted", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("neutral.pages.dev")) return new Response(null, { status: 301, headers: { location: "https://plans.example.com/" } });
    return new Response(null, { status: 302, headers: { location: "https://team.cloudflareaccess.com/cdn-cgi/access/login/plans.example.com" } });
  };
  try {
    const result = await accessProtectionStatus("https://neutral.pages.dev/");
    assert.equal(result.protected, true);
    assert.deepEqual(result.redirects, ["plans.example.com", "team.cloudflareaccess.com"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Cloudflare account selection is explicit when multiple accounts exist", () => {
  const accounts = [
    { id: "account-1", name: "Personal" },
    { id: "account-2", name: "Studio" },
  ];

  assert.deepEqual(selectAccount(accounts, "account-2"), accounts[1]);
  assert.deepEqual(selectAccount(accounts, "personal"), accounts[0]);
  assert.throws(() => selectAccount(accounts), /Multiple Cloudflare accounts are available/);
  assert.throws(() => selectAccount(accounts, "missing"), /was not found/);
});

test("agent manifests package the same canonical skill", async () => {
  const codexRoot = resolve("plugins/micro-hoster");
  const codexManifest = JSON.parse(await readFile(join(codexRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const kimiManifest = JSON.parse(await readFile(resolve(".kimi-plugin/plugin.json"), "utf8"));
  const codexMarketplace = JSON.parse(await readFile(resolve(".agents/plugins/marketplace.json"), "utf8"));
  const claudeManifest = JSON.parse(await readFile(resolve(".claude-plugin/plugin.json"), "utf8"));
  const claudeMarketplace = JSON.parse(await readFile(resolve(".claude-plugin/marketplace.json"), "utf8"));
  const packageManifest = JSON.parse(await readFile(resolve("package.json"), "utf8"));
  const canonicalSkill = await readFile(resolve("skills/share-on-pages/SKILL.md"), "utf8");
  const bundledCodexSkill = await readFile(join(resolve(codexRoot, codexManifest.skills), "share-on-pages", "SKILL.md"), "utf8");

  assert.equal(codexMarketplace.plugins[0].source.path, "./plugins/micro-hoster");
  assert.equal(resolve(kimiManifest.skills), resolve("skills"));
  assert.equal(canonicalSkill.replaceAll("\r\n", "\n"), bundledCodexSkill.replaceAll("\r\n", "\n"));
  assert.equal(kimiManifest.name, codexManifest.name);
  assert.equal(claudeManifest.name, codexManifest.name);
  assert.equal(claudeMarketplace.plugins[0].source, "./");
  assert.equal(claudeMarketplace.plugins[0].version, packageManifest.version);
  assert.equal(kimiManifest.version, packageManifest.version);
  assert.equal(codexManifest.version, packageManifest.version);
  assert.match(canonicalSkill, /^---\r?\nname: share-on-pages/m);
});
