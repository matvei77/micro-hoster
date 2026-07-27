#!/usr/bin/env node

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.3.0";
const MAX_FILES = 20_000;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_SECRET_SCAN_SIZE = 5 * 1024 * 1024;
const CLOUDFLARE_FREE_MONTHLY_BUILDS = 500;
const LOCAL_MONTHLY_DEPLOYMENT_LIMIT = 400;
const LEGACY_DEFAULT_PROJECT = "micro-hoster";
const DEFAULT_VISIBILITY = "unlisted";
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER_BIN = join(PACKAGE_ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const FORBIDDEN_SEGMENTS = new Set([".git", ".wrangler", ".micro-hoster", ".aws", ".ssh", ".gnupg", ".azure", ".gcloud", "node_modules", "functions"]);
const FORBIDDEN_FILES = [
  /^\.env(?:\..+)?$/i,
  /^\.dev\.vars$/i,
  /^\.npmrc$/i,
  /^\.account-binding\.json$/i,
  /^credentials?(?:\.json)?$/i,
  /^secrets?(?:\.|$)/i,
  /^_worker\.js$/i,
  /(?:^|\.)pem$/i,
  /(?:^|\.)key$/i,
  /\.(?:p12|pfx|jks|keystore|kdbx)$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)$/i,
];
const TEXT_FILE_EXTENSIONS = new Set([".html", ".htm", ".css", ".js", ".mjs", ".cjs", ".json", ".txt", ".md", ".xml", ".svg", ".yaml", ".yml", ".toml", ".ini", ".conf", ".config", ".map", ".csv", ".tsv", ".properties", ".sql", ".sh", ".ps1", ".bat", ".cmd"]);
const SECRET_PATTERNS = [
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "AWS access key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "Stripe live key", pattern: /\b[rs]k_live_[0-9A-Za-z]{16,}\b/ },
  { name: "npm token", pattern: /\bnpm_[A-Za-z0-9]{20,}\b/ },
  { name: "Cloudflare API token", pattern: /\b(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*[:=]\s*["']?[^\s"']{12,}/i },
  { name: "assigned credential", pattern: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^"']{12,}["']/i },
];

function usage() {
  return `micro-hoster ${VERSION}

Publish generated HTML and static micro-apps to one Cloudflare Pages project.

Usage:
  micro-hoster login [--account <id-or-exact-name>] [--json]
  micro-hoster configure --project <name> [--domain <hostname>] [--visibility <unlisted|access>] [--adopt-existing] [--account <id-or-exact-name>] [--json]
  micro-hoster publish <file-or-folder> [--slug <slug>] [--title <title>] [--project <name>] [--domain <hostname>] [--visibility <unlisted|access>] [--account <id-or-exact-name>] [--dry-run] [--json]
  micro-hoster status [--project <name>] [--account <id-or-exact-name>] [--json]
  micro-hoster list [--project <name>] [--account <id-or-exact-name>] [--json]
  micro-hoster help

Environment:
  MICRO_HOSTER_HOME       Local content store (default: ~/.micro-hoster)
  MICRO_HOSTER_PROJECT    Explicit Pages project name
  MICRO_HOSTER_DOMAIN     Attached custom hostname used for share links
  CLOUDFLARE_ACCOUNT_ID   Cloudflare account to use when the login has multiple accounts

Micro Hoster uses your local Wrangler login and deploys only to your selected Cloudflare account.
Fresh installations have no shared project or domain. Run configure before publishing.
Unlisted links are public and non-indexed, not private. Access mode requires verified Cloudflare Access protection.`;
}

function fail(message, code = 1) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function parseArgs(argv) {
  const [command = "help", ...rest] = argv;
  const options = {};
  const positional = [];
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    if (["adopt-existing", "dry-run", "json"].includes(key)) {
      options[key] = true;
      continue;
    }
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) fail(`Missing value for --${key}`);
    options[key] = next;
    index += 1;
  }
  return { command, positional, options };
}

function slugify(value) {
  return value.toLowerCase().replace(/\.[a-z0-9]+$/i, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}

function defaultSlug(source) {
  const prefix = (slugify(basename(source)) || "share").slice(0, 30).replace(/-$/, "");
  const suffix = randomBytes(16).toString("hex");
  return `${prefix}-${suffix}`;
}

function validateSlug(slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 63) fail("Slug must be 1-63 lowercase letters, numbers, or single hyphens.");
}

function validateDomain(domain) {
  if (!domain) return null;
  const normalized = String(domain).trim().toLowerCase().replace(/\.$/, "");
  if (normalized.includes("://") || normalized.includes("/") || normalized.length > 253) fail("Domain must be a hostname without a scheme, path, or trailing slash.");
  const labels = normalized.split(".");
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) fail("Domain must be a valid hostname such as plans.example.com.");
  return normalized;
}

function validateVisibility(visibility) {
  if (!["unlisted", "access"].includes(visibility)) fail("Visibility must be either unlisted or access.");
  return visibility;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function assertSafeRelativePath(relPath) {
  const parts = relPath.split(/[\\/]/);
  for (const part of parts) if (FORBIDDEN_SEGMENTS.has(part.toLowerCase())) fail(`Refusing to publish forbidden path: ${relPath}`);
  const name = parts.at(-1);
  if (FORBIDDEN_FILES.some((pattern) => pattern.test(name))) fail(`Refusing to publish possible secret or server code: ${relPath}`);
}

async function assertNoDetectedSecrets(file) {
  if (file.size > MAX_SECRET_SCAN_SIZE || !TEXT_FILE_EXTENSIONS.has(extname(file.path).toLowerCase())) return;
  const content = await readFile(file.path, "utf8");
  for (const detector of SECRET_PATTERNS) {
    if (detector.pattern.test(content)) fail(`Refusing to publish detected ${detector.name} content: ${file.relative}`);
  }
}

async function inventory(root) {
  const files = [];
  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = join(current, entry.name);
      const relPath = relative(root, absolute);
      assertSafeRelativePath(relPath);
      if (entry.isSymbolicLink()) fail(`Refusing to publish symbolic link: ${relPath}`);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile()) {
        const info = await stat(absolute);
        if (info.size > MAX_FILE_SIZE) fail(`${relPath} is larger than Cloudflare Pages' 25 MiB per-file limit.`);
        const file = { path: absolute, relative: relPath, size: info.size };
        await assertNoDetectedSecrets(file);
        files.push(file);
      }
    }
  }
  await walk(root);
  return files;
}

async function prepareInput(source, destination) {
  const absolute = resolve(source);
  let info;
  try {
    info = await lstat(absolute);
  } catch (error) {
    if (error.code === "ENOENT") fail(`Input does not exist: ${absolute}`);
    throw error;
  }
  if (info.isSymbolicLink()) fail("The input path may not be a symbolic link.");
  await mkdir(destination, { recursive: true });
  if (info.isFile()) {
    if (![".html", ".htm"].includes(extname(absolute).toLowerCase())) fail("A single-file publication must be an .html or .htm file. Use a folder for a micro-app.");
    assertSafeRelativePath(basename(absolute));
    if (info.size > MAX_FILE_SIZE) fail("The HTML file exceeds Cloudflare Pages' 25 MiB limit.");
    await cp(absolute, join(destination, "index.html"));
  } else if (info.isDirectory()) {
    assertSafeRelativePath(basename(absolute));
    const sourceFiles = await inventory(absolute);
    if (!sourceFiles.some((file) => file.relative.replaceAll("\\", "/").toLowerCase() === "index.html")) fail("A folder publication must contain index.html at its root.");
    for (const file of sourceFiles) {
      const output = join(destination, file.relative);
      await mkdir(dirname(output), { recursive: true });
      await cp(file.path, output);
    }
  } else fail("Input must be an HTML file or a folder containing index.html.");
  return absolute;
}

function baseStateRoot() {
  return resolve(process.env.MICRO_HOSTER_HOME || join(homedir(), ".micro-hoster"));
}

function configPath() {
  return join(baseStateRoot(), "config.json");
}

function safeStateSegment(value) {
  const segment = String(value).replace(/[^a-z0-9._-]+/gi, "-").replace(/^-|-$/g, "");
  if (!segment) fail("Could not derive a safe local state path for the selected Cloudflare account.");
  return segment;
}

async function loadConfig() {
  try {
    const config = JSON.parse(await readFile(configPath(), "utf8"));
    return {
      version: 1,
      accountId: String(config.accountId || ""),
      project: config.project ? String(config.project) : null,
      domain: config.domain ? validateDomain(config.domain) : null,
      visibility: validateVisibility(config.visibility || DEFAULT_VISIBILITY),
    };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    fail(`Could not read the local configuration: ${error.message}`);
  }
}

async function saveConfig(config) {
  await mkdir(baseStateRoot(), { recursive: true });
  await writeFile(configPath(), `${JSON.stringify(config, null, 2)}\n`);
}

function resolveConfiguredSettings(config, options, identity = null) {
  if (config?.accountId && identity && config.accountId !== identity.account.id) {
    fail(`The saved configuration belongs to a different Cloudflare account. Re-run configure for ${identity.account.name}.`);
  }
  const project = options.project || process.env.MICRO_HOSTER_PROJECT || config?.project || null;
  if (!project) fail("No Pages project is configured. Run `micro-hoster configure --project <unique-project-name>` first.");
  validateSlug(project);
  const domain = validateDomain(options.domain || process.env.MICRO_HOSTER_DOMAIN || config?.domain || null);
  const visibility = validateVisibility(options.visibility || config?.visibility || DEFAULT_VISIBILITY);
  if (visibility === "access" && !domain) fail("Access mode requires an attached custom domain. Re-run configure with --domain plans.example.com.");
  return { project, domain, visibility, configured: Boolean(config && config.project === project) };
}

async function readLegacyBinding(baseRoot) {
  try {
    return JSON.parse(await readFile(join(baseRoot, ".account-binding.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    fail(`Could not read the local account binding: ${error.message}`);
  }
}

async function resolveStateRoot(account, project, { bindLegacy = false } = {}) {
  const baseRoot = baseStateRoot();
  const scopedRoot = join(baseRoot, "accounts", safeStateSegment(account.id), "projects", project);
  if (await pathExists(join(scopedRoot, "manifest.json"))) return scopedRoot;

  const legacyManifestPath = join(baseRoot, "manifest.json");
  if (!(await pathExists(legacyManifestPath))) return scopedRoot;

  const binding = await readLegacyBinding(baseRoot);
  if (binding) return binding.accountId === account.id && binding.project === project ? baseRoot : scopedRoot;

  const legacyManifest = await loadManifest(baseRoot);
  const legacyProjects = [...new Set(legacyManifest.deployments.map((item) => item.project).filter(Boolean))];
  if (legacyProjects.length > 1 || (legacyProjects.length === 1 && legacyProjects[0] !== project)) return scopedRoot;
  if (bindLegacy) {
    await writeFile(join(baseRoot, ".account-binding.json"), `${JSON.stringify({ version: 1, accountId: account.id, project }, null, 2)}\n`);
  }
  return baseRoot;
}

async function loadManifest(root) {
  try {
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    manifest.publications ??= [];
    manifest.deployments ??= manifest.publications.map((item) => ({ deployedAt: item.publishedAt, project: LEGACY_DEFAULT_PROJECT, slug: item.slug }));
    return manifest;
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, publications: [], deployments: [] };
    fail(`Could not read local manifest: ${error.message}`);
  }
}

function monthlyDeploymentUsage(manifest, now = new Date()) {
  const month = now.toISOString().slice(0, 7);
  const used = manifest.deployments.filter((item) => String(item.deployedAt).startsWith(month)).length;
  return {
    policy: "static-pages-only",
    month,
    used,
    localLimit: LOCAL_MONTHLY_DEPLOYMENT_LIMIT,
    cloudflareFreeLimit: CLOUDFLARE_FREE_MONTHLY_BUILDS,
    remaining: Math.max(0, LOCAL_MONTHLY_DEPLOYMENT_LIMIT - used),
    paidServicesAllowed: false,
  };
}

function enforceCostGuard(costGuard) {
  if (costGuard.used >= costGuard.localLimit) {
    fail(`Cost guard stopped this deployment: ${costGuard.used}/${costGuard.localLimit} local deployments used in ${costGuard.month}. The limit can only be changed deliberately in source code after reviewing Cloudflare billing.`);
  }
}

function renderLanding(title = "Shared content") {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive,nosnippet"><title>${escapeHtml(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:680px;margin:64px auto;padding:0 24px;color:#171717}h1{font-size:2rem;font-weight:500}p{color:#555}</style>
</head><body><h1>${escapeHtml(title)}</h1><p>This host contains unlisted shared content. Open the exact link you were given.</p></body></html>`;
}

async function buildBundle(root, candidate, manifest) {
  const buildRoot = await mkdtemp(join(tmpdir(), "micro-hoster-build-"));
  await cp(candidate.preparedPath, join(buildRoot, candidate.slug), { recursive: true });
  for (const item of manifest.publications) {
    if (item.slug === candidate.slug) continue;
    const stored = join(root, "sites", item.slug);
    if (await pathExists(stored)) await cp(stored, join(buildRoot, item.slug), { recursive: true });
  }
  await writeFile(join(buildRoot, "index.html"), renderLanding());
  await writeFile(join(buildRoot, "404.html"), renderLanding("Not found"));
  await writeFile(join(buildRoot, "robots.txt"), "User-agent: *\nDisallow: /\n");
  await writeFile(join(buildRoot, "_headers"), "/*\n  X-Robots-Tag: noindex, nofollow, noarchive, nosnippet\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Frame-Options: DENY\n  Content-Security-Policy: frame-ancestors 'none'\n");
  const files = await inventory(buildRoot);
  if (files.length > MAX_FILES) fail(`Deployment has ${files.length} files; the Pages Free limit is ${MAX_FILES}.`);
  return { buildRoot, files };
}

function runWrangler(args, { quiet = false, accountId = null } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const env = { ...process.env, NO_COLOR: "1" };
    if (accountId) env.CLOUDFLARE_ACCOUNT_ID = accountId;
    const child = spawn(process.execPath, [WRANGLER_BIN, ...args], { cwd: PACKAGE_ROOT, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; if (!quiet) process.stderr.write(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk; if (!quiet) process.stderr.write(chunk); });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else {
        const error = new Error((stderr || stdout || `Wrangler exited with code ${code}`).trim());
        error.exitCode = code || 1;
        rejectPromise(error);
      }
    });
  });
}

function selectAccount(accounts, selector = null) {
  if (!accounts.length) fail("Wrangler is authenticated, but no Cloudflare accounts are available for this user.");
  if (selector) {
    const normalized = selector.toLowerCase();
    const matches = accounts.filter((account) => account.id === selector || String(account.name).toLowerCase() === normalized);
    if (matches.length === 1) return { id: matches[0].id, name: matches[0].name };
    const available = accounts.map((account) => `${account.name} (${account.id})`).join(", ");
    if (!matches.length) fail(`Cloudflare account "${selector}" was not found. Available accounts: ${available}`);
    fail(`Cloudflare account name "${selector}" is ambiguous. Use an account ID instead: ${available}`);
  }
  if (accounts.length === 1) return { id: accounts[0].id, name: accounts[0].name };
  const available = accounts.map((account) => `${account.name} (${account.id})`).join(", ");
  fail(`Multiple Cloudflare accounts are available: ${available}. Re-run with --account <id-or-exact-name> or set CLOUDFLARE_ACCOUNT_ID.`);
}

async function ensureAuthenticated(selector = null) {
  let stdout;
  try {
    ({ stdout } = await runWrangler(["whoami", "--json"], { quiet: true }));
  } catch {
    fail("Cloudflare is not authenticated. Run `micro-hoster login`, complete Cloudflare's browser login, then retry.", 2);
  }
  const identity = JSON.parse(stdout);
  const account = selectAccount(Array.isArray(identity.accounts) ? identity.accounts : [], selector || process.env.CLOUDFLARE_ACCOUNT_ID || null);
  return { account, authType: identity.authType || null, email: identity.email || null };
}

function projectArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.projects)) return payload.projects;
  return [];
}

function projectDomains(item, project) {
  const raw = item?.["Project Domains"] || item?.domains || item?.subdomain || `${project}.pages.dev`;
  const values = Array.isArray(raw) ? raw : String(raw).split(",");
  return [...new Set(values.map((value) => String(value).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "")).filter(Boolean))];
}

function pagesDomain(domains, project) {
  return domains.find((domain) => domain.endsWith(".pages.dev")) || `${project}.pages.dev`;
}

async function listProjects(accountId) {
  const { stdout } = await runWrangler(["pages", "project", "list", "--json"], { quiet: true, accountId });
  return projectArray(JSON.parse(stdout));
}

async function ensureProject(project, quiet, accountId, { allowExisting = false } = {}) {
  const projects = await listProjects(accountId);
  const existing = projects.find((item) => item.name === project || item["Project Name"] === project);
  if (existing) {
    if (!allowExisting) fail(`Pages project "${project}" already exists. Refusing to adopt it implicitly; run configure with --adopt-existing after confirming it is safe to replace.`);
    const domains = projectDomains(existing, project);
    return { created: false, domains, pagesDomain: pagesDomain(domains, project) };
  }
  await runWrangler(["pages", "project", "create", project, "--production-branch", "main"], { quiet, accountId });
  const refreshed = await listProjects(accountId);
  const created = refreshed.find((item) => item.name === project || item["Project Name"] === project);
  const domains = projectDomains(created, project);
  return { created: true, domains, pagesDomain: pagesDomain(domains, project) };
}

function selectShareDomain(projectResult, configuredDomain) {
  if (!configuredDomain) return projectResult.pagesDomain;
  if (!projectResult.domains.includes(configuredDomain)) {
    fail(`Custom domain "${configuredDomain}" is not attached to this Pages project. Add it in Cloudflare Pages > Custom domains, wait for activation, then retry.`);
  }
  return configuredDomain;
}

function extractDeploymentUrl(output) {
  const matches = output.match(/https:\/\/[^\s]+\.pages\.dev/gi) || [];
  if (!matches.length) fail("Deployment succeeded but Wrangler did not return a pages.dev URL.");
  return matches.at(-1).replace(/[),.;]+$/, "");
}

async function verifyUrl(url) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
      if (response.ok) return response.status;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000 * (attempt + 1)));
  }
  fail(`Cloudflare returned a deployment URL, but verification failed: ${lastError?.message}`);
}

async function accessProtectionStatus(url) {
  let current = url;
  const redirects = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
    const location = response.headers.get("location");
    if (!location || response.status < 300 || response.status >= 400) return { protected: false, status: response.status, redirects };
    const next = new URL(location, current);
    redirects.push(next.hostname);
    const protectedHost = new URL(current).hostname;
    const expectedLoginPath = `/cdn-cgi/access/login/${protectedHost}`;
    if (next.hostname.endsWith(".cloudflareaccess.com") && next.pathname === expectedLoginPath) {
      return { protected: true, status: response.status, redirects };
    }
    current = next.href;
  }
  return { protected: false, status: null, redirects };
}

async function requireAccessProtection(url, label) {
  const result = await accessProtectionStatus(url);
  if (!result.protected) {
    fail(`${label} is not protected by Cloudflare Access. Publication was stopped before deployment. Protect the custom domain, the production pages.dev hostname, and preview deployments, then retry.`);
  }
  return result;
}

async function deploymentUrls(project, accountId) {
  const { stdout } = await runWrangler(["pages", "deployment", "list", "--project-name", project, "--json"], { quiet: true, accountId });
  const items = JSON.parse(stdout);
  return (Array.isArray(items) ? items : []).map((item) => item.Deployment || item.url).filter(Boolean);
}

async function preflightAccessProtection(projectResult, project, shareDomain, accountId) {
  await requireAccessProtection(`https://${shareDomain}/`, "The custom share domain");
  await requireAccessProtection(`https://${projectResult.pagesDomain}/`, "The production pages.dev hostname");
  const urls = await deploymentUrls(project, accountId);
  if (!urls.length) {
    fail("Access mode needs an existing harmless deployment before it can verify preview-host protection. Initialize this project in unlisted mode, configure Access, then switch to access mode.");
  }
  await requireAccessProtection(urls[0], "The hashed deployment hostname");
}

async function commitPublication(root, preparedPath, publication, manifest) {
  const sitesRoot = join(root, "sites");
  await mkdir(sitesRoot, { recursive: true });
  const target = join(sitesRoot, publication.slug);
  const incoming = join(sitesRoot, `.${publication.slug}.incoming-${process.pid}`);
  await rm(incoming, { recursive: true, force: true });
  await cp(preparedPath, incoming, { recursive: true });
  await rm(target, { recursive: true, force: true });
  await rename(incoming, target);
  await writeFile(join(root, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function configure(options) {
  if (!options.project) fail("configure requires --project <unique-project-name>.");
  validateSlug(options.project);
  const identity = await ensureAuthenticated(options.account || null);
  const current = await loadConfig();
  const projects = await listProjects(identity.account.id);
  const existing = projects.find((item) => item.name === options.project || item["Project Name"] === options.project);
  const alreadyConfigured = current?.accountId === identity.account.id && current?.project === options.project;
  if (existing && !alreadyConfigured && !options["adopt-existing"]) {
    fail(`Pages project "${options.project}" already exists. Re-run with --adopt-existing only if this tool is allowed to replace its production deployment.`);
  }
  const domain = validateDomain(options.domain || null);
  const visibility = validateVisibility(options.visibility || DEFAULT_VISIBILITY);
  if (visibility === "access" && !domain) fail("Access mode requires --domain <hostname>.");
  const domains = existing ? projectDomains(existing, options.project) : [];
  const domainAttached = domain ? domains.includes(domain) : null;
  const config = { version: 1, accountId: identity.account.id, project: options.project, domain, visibility };
  await saveConfig(config);
  return {
    ok: true,
    configured: true,
    account: identity.account,
    project: options.project,
    projectExists: Boolean(existing),
    domain,
    domainAttached,
    visibility,
    accessRequired: visibility === "access",
    stateRoot: baseStateRoot(),
  };
}

async function publish(positional, options) {
  if (positional.length !== 1) fail("publish requires exactly one HTML file or folder.");
  const source = positional[0];
  const slug = options.slug || defaultSlug(source);
  validateSlug(slug);
  const title = options.title || basename(source, extname(source));
  const workRoot = await mkdtemp(join(tmpdir(), "micro-hoster-input-"));
  const preparedPath = join(workRoot, "content");
  let buildRoot;
  try {
    const absoluteSource = await prepareInput(source, preparedPath);
    const identity = options["dry-run"] ? null : await ensureAuthenticated(options.account || null);
    const config = await loadConfig();
    const settings = resolveConfiguredSettings(config, options, identity);
    const { project, domain, visibility } = settings;
    const root = options["dry-run"]
      ? (process.env.MICRO_HOSTER_HOME ? baseStateRoot() : join(workRoot, "dry-run-state"))
      : await resolveStateRoot(identity.account, project, { bindLegacy: true });
    const manifest = await loadManifest(root);
    const costGuard = monthlyDeploymentUsage(manifest);
    enforceCostGuard(costGuard);
    const publication = { slug, title, publishedAt: new Date().toISOString(), source: basename(absoluteSource) };
    manifest.publications = manifest.publications.filter((item) => item.slug !== slug);
    manifest.publications.push(publication);
    const bundle = await buildBundle(root, { slug, preparedPath }, manifest);
    buildRoot = bundle.buildRoot;
    const bytes = bundle.files.reduce((sum, file) => sum + file.size, 0);
    if (options["dry-run"]) return { ok: true, dryRun: true, project, domain, visibility, slug, title, files: bundle.files.length, bytes, costGuard };
    const projectResult = await ensureProject(project, options.json, identity.account.id, { allowExisting: settings.configured });
    const shareDomain = selectShareDomain(projectResult, domain);
    if (visibility === "access") await preflightAccessProtection(projectResult, project, shareDomain, identity.account.id);
    const deployed = await runWrangler(["pages", "deploy", buildRoot, "--project-name", project, "--branch", "main", "--commit-message", `Publish ${slug}`, "--commit-dirty=true"], { quiet: options.json, accountId: identity.account.id });
    const deploymentUrl = extractDeploymentUrl(`${deployed.stdout}\n${deployed.stderr}`);
    const shareUrl = `https://${shareDomain}/${encodeURIComponent(slug)}/`;
    let httpStatus;
    let protectedByAccess = false;
    if (visibility === "access") {
      const shareProtection = await requireAccessProtection(shareUrl, "The published share link");
      await requireAccessProtection(deploymentUrl, "The new hashed deployment hostname");
      httpStatus = shareProtection.status;
      protectedByAccess = true;
    } else {
      httpStatus = await verifyUrl(shareUrl);
    }
    manifest.deployments.push({ deployedAt: publication.publishedAt, project, slug });
    await commitPublication(root, preparedPath, publication, manifest);
    return { ok: true, account: identity.account, project, projectCreated: projectResult.created, domain: shareDomain, visibility, protectedByAccess, environment: "production", slug, title, files: bundle.files.length, bytes, deploymentUrl, shareUrl, verified: true, httpStatus, costGuard: { ...monthlyDeploymentUsage(manifest), usedBeforeDeployment: costGuard.used } };
  } finally {
    await rm(workRoot, { recursive: true, force: true });
    if (buildRoot) await rm(buildRoot, { recursive: true, force: true });
  }
}

async function status(options = {}) {
  let authenticated = false;
  let identity = null;
  try { identity = await ensureAuthenticated(options.account || null); authenticated = true; }
  catch (error) { if (error.exitCode !== 2) throw error; }
  const config = await loadConfig();
  const candidateProject = options.project || process.env.MICRO_HOSTER_PROJECT || config?.project || null;
  if (!candidateProject) {
    const legacyManifest = await loadManifest(baseStateRoot());
    return { ok: true, authenticated, configured: false, account: identity?.account || null, authType: identity?.authType || null, email: identity?.email || null, stateRoot: baseStateRoot(), project: null, domain: null, visibility: null, publications: legacyManifest.publications.length, legacyStateDetected: legacyManifest.publications.length > 0 };
  }
  const settings = resolveConfiguredSettings(config, options, identity);
  const { project, domain, visibility } = settings;
  const root = identity ? await resolveStateRoot(identity.account, project) : baseStateRoot();
  const manifest = await loadManifest(root);
  return { ok: true, authenticated, configured: settings.configured, account: identity?.account || null, authType: identity?.authType || null, email: identity?.email || null, stateRoot: root, publications: manifest.publications.length, project, domain, visibility, costGuard: monthlyDeploymentUsage(manifest) };
}

async function login(options = {}) {
  await runWrangler(["login"]);
  return status(options);
}

async function listPublications(options = {}) {
  const identity = await ensureAuthenticated(options.account || null);
  const config = await loadConfig();
  const settings = resolveConfiguredSettings(config, options, identity);
  const { project } = settings;
  const root = await resolveStateRoot(identity.account, project);
  const manifest = await loadManifest(root);
  return { ok: true, account: identity.account, project, domain: settings.domain, visibility: settings.visibility, publications: [...manifest.publications].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)) };
}

function printResult(result, json) {
  if (json) { process.stdout.write(`${JSON.stringify(result)}\n`); return; }
  if (result.shareUrl) process.stdout.write(`\nShare link: ${result.shareUrl}\nVisibility: ${result.visibility}${result.protectedByAccess ? " (Cloudflare Access verified)" : " (public, unlisted)"}\nVerified: HTTP ${result.httpStatus}\n`);
  else if (result.dryRun) process.stdout.write(`Ready to publish ${result.files} files (${result.bytes} bytes) to ${result.project}/${result.slug}.\n`);
  else if (result.configured && Object.hasOwn(result, "projectExists")) {
    process.stdout.write(`Configured project: ${result.project}\nVisibility: ${result.visibility}\nDomain: ${result.domain || "(pages.dev until a custom domain is configured)"}\n`);
    if (result.domain && !result.domainAttached) process.stdout.write("The custom domain is not attached yet. Add it in Cloudflare Pages before publishing.\n");
  }
  else if (Array.isArray(result.publications)) {
    if (!result.publications.length) process.stdout.write("No local publications yet.\n");
    else for (const item of result.publications) process.stdout.write(`${item.slug}\t${item.title}\t${item.publishedAt}\n`);
  } else {
    process.stdout.write(`Authenticated: ${result.authenticated ? "yes" : "no"}\n`);
    if (result.account) process.stdout.write(`Cloudflare account: ${result.account.name} (${result.account.id})\n`);
    process.stdout.write(`Configured: ${result.configured ? "yes" : "no"}\nProject: ${result.project || "(run configure)"}\nDomain: ${result.domain || "(not configured)"}\nVisibility: ${result.visibility || "(not configured)"}\nLocal publications: ${result.publications}\nState: ${result.stateRoot}\n`);
    if (result.legacyStateDetected) process.stdout.write("Existing publications were found but are not configured under the new neutral visibility model.\n");
  }
}

async function main() {
  const { command, positional, options } = parseArgs(process.argv.slice(2));
  if (["help", "--help", "-h"].includes(command)) { process.stdout.write(`${usage()}\n`); return; }
  if (["--version", "version"].includes(command)) { process.stdout.write(`${VERSION}\n`); return; }
  let result;
  if (command === "login") result = await login(options);
  else if (command === "configure") result = await configure(options);
  else if (command === "publish") result = await publish(positional, options);
  else if (command === "status") result = await status(options);
  else if (command === "list") result = await listPublications(options);
  else fail(`Unknown command: ${command}\n\n${usage()}`);
  printResult(result, options.json);
}

if (process.argv[1] && basename(process.argv[1]).toLowerCase() === "cli.js") {
  main().catch((error) => { process.stderr.write(`micro-hoster: ${error.message}\n`); process.exitCode = error.exitCode || 1; });
}

export { accessProtectionStatus, defaultSlug, inventory, monthlyDeploymentUsage, prepareInput, projectDomains, renderLanding, selectAccount, slugify, validateDomain, validateSlug };
