#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "0.1.0";
const MAX_FILES = 20_000;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const CLOUDFLARE_FREE_MONTHLY_BUILDS = 500;
const LOCAL_MONTHLY_DEPLOYMENT_LIMIT = 400;
const DEFAULT_PROJECT = "micro-hoster";
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WRANGLER_BIN = join(PACKAGE_ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
const FORBIDDEN_SEGMENTS = new Set([".git", ".wrangler", "node_modules", "functions"]);
const FORBIDDEN_FILES = [/^\.env(?:\..+)?$/i, /^\.dev\.vars$/i, /^\.npmrc$/i, /^_worker\.js$/i, /(?:^|\.)pem$/i, /(?:^|\.)key$/i, /^id_(?:rsa|dsa|ecdsa|ed25519)$/i];

function usage() {
  return `micro-hoster ${VERSION}

Publish generated HTML and static micro-apps to one Cloudflare Pages project.

Usage:
  micro-hoster publish <file-or-folder> [--slug <slug>] [--title <title>] [--project <name>] [--dry-run] [--json]
  micro-hoster status [--json]
  micro-hoster list [--json]
  micro-hoster help

Environment:
  MICRO_HOSTER_HOME       Local content store (default: ~/.micro-hoster)
  MICRO_HOSTER_PROJECT    Pages project name (default: micro-hoster)
  CLOUDFLARE_ACCOUNT_ID   Recommended when the login has multiple accounts

Only static assets are supported. Never publish secrets or private material: Pages links are public.`;
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
    if (["dry-run", "json"].includes(key)) {
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
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
  return `${slugify(basename(source)) || "share"}-${stamp}`;
}

function validateSlug(slug) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 63) fail("Slug must be 1-63 lowercase letters, numbers, or single hyphens.");
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
  for (const part of parts) if (FORBIDDEN_SEGMENTS.has(part)) fail(`Refusing to publish forbidden path: ${relPath}`);
  const name = parts.at(-1);
  if (FORBIDDEN_FILES.some((pattern) => pattern.test(name))) fail(`Refusing to publish possible secret or server code: ${relPath}`);
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
        files.push({ path: absolute, relative: relPath, size: info.size });
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

function stateRoot() {
  return resolve(process.env.MICRO_HOSTER_HOME || join(homedir(), ".micro-hoster"));
}

async function loadManifest(root) {
  try {
    const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
    manifest.publications ??= [];
    manifest.deployments ??= manifest.publications.map((item) => ({ deployedAt: item.publishedAt, project: DEFAULT_PROJECT, slug: item.slug }));
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

function renderIndex(publications) {
  const cards = [...publications].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).map((item) => `<li><a href="/${encodeURIComponent(item.slug)}/">${escapeHtml(item.title)}</a><time datetime="${escapeHtml(item.publishedAt)}">${escapeHtml(item.publishedAt.slice(0, 10))}</time></li>`).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Micro Hoster</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:760px;margin:64px auto;padding:0 24px;color:#171717}h1{font-size:2rem}ul{list-style:none;padding:0;border-top:1px solid #ddd}li{display:flex;justify-content:space-between;gap:24px;padding:14px 0;border-bottom:1px solid #ddd}a{color:#0645ad}time{color:#666}</style>
</head><body><h1>Shared artifacts</h1><ul>${cards}</ul></body></html>`;
}

async function buildBundle(root, candidate, manifest) {
  const buildRoot = await mkdtemp(join(tmpdir(), "micro-hoster-build-"));
  await cp(candidate.preparedPath, join(buildRoot, candidate.slug), { recursive: true });
  for (const item of manifest.publications) {
    if (item.slug === candidate.slug) continue;
    const stored = join(root, "sites", item.slug);
    if (await pathExists(stored)) await cp(stored, join(buildRoot, item.slug), { recursive: true });
  }
  await writeFile(join(buildRoot, "index.html"), renderIndex(manifest.publications));
  await writeFile(join(buildRoot, "_headers"), "/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n");
  const files = await inventory(buildRoot);
  if (files.length > MAX_FILES) fail(`Deployment has ${files.length} files; the Pages Free limit is ${MAX_FILES}.`);
  return { buildRoot, files };
}

function runWrangler(args, { quiet = false } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [WRANGLER_BIN, ...args], { cwd: PACKAGE_ROOT, env: { ...process.env, NO_COLOR: "1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
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

async function ensureAuthenticated() {
  try {
    const { stdout } = await runWrangler(["whoami", "--json"], { quiet: true });
    return JSON.parse(stdout);
  } catch {
    fail("Cloudflare is not authenticated. Run `npx wrangler login` in the micro-hoster repository, then retry.", 2);
  }
}

function projectArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.result)) return payload.result;
  if (Array.isArray(payload?.projects)) return payload.projects;
  return [];
}

function projectDomain(item, project) {
  const raw = item?.["Project Domains"] || item?.domains?.[0] || item?.subdomain || `${project}.pages.dev`;
  return String(raw).split(",")[0].trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

async function ensureProject(project, quiet) {
  const { stdout } = await runWrangler(["pages", "project", "list", "--json"], { quiet: true });
  const projects = projectArray(JSON.parse(stdout));
  const existing = projects.find((item) => item.name === project || item["Project Name"] === project);
  if (existing) return { created: false, domain: projectDomain(existing, project) };
  await runWrangler(["pages", "project", "create", project, "--production-branch", "main"], { quiet });
  const refreshed = await runWrangler(["pages", "project", "list", "--json"], { quiet: true });
  const created = projectArray(JSON.parse(refreshed.stdout)).find((item) => item.name === project || item["Project Name"] === project);
  return { created: true, domain: projectDomain(created, project) };
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

async function publish(positional, options) {
  if (positional.length !== 1) fail("publish requires exactly one HTML file or folder.");
  const source = positional[0];
  const slug = options.slug || defaultSlug(source);
  validateSlug(slug);
  const title = options.title || basename(source, extname(source));
  const project = options.project || process.env.MICRO_HOSTER_PROJECT || DEFAULT_PROJECT;
  validateSlug(project);
  const root = stateRoot();
  const workRoot = await mkdtemp(join(tmpdir(), "micro-hoster-input-"));
  const preparedPath = join(workRoot, "content");
  let buildRoot;
  try {
    const absoluteSource = await prepareInput(source, preparedPath);
    const manifest = await loadManifest(root);
    const costGuard = monthlyDeploymentUsage(manifest);
    enforceCostGuard(costGuard);
    const publication = { slug, title, publishedAt: new Date().toISOString(), source: absoluteSource };
    manifest.publications = manifest.publications.filter((item) => item.slug !== slug);
    manifest.publications.push(publication);
    const bundle = await buildBundle(root, { slug, preparedPath }, manifest);
    buildRoot = bundle.buildRoot;
    const bytes = bundle.files.reduce((sum, file) => sum + file.size, 0);
    if (options["dry-run"]) return { ok: true, dryRun: true, project, slug, title, files: bundle.files.length, bytes, costGuard };
    await ensureAuthenticated();
    const projectResult = await ensureProject(project, options.json);
    const deployed = await runWrangler(["pages", "deploy", buildRoot, "--project-name", project, "--branch", "main", "--commit-message", `Publish ${slug}`, "--commit-dirty=true"], { quiet: options.json });
    const deploymentUrl = extractDeploymentUrl(`${deployed.stdout}\n${deployed.stderr}`);
    const shareUrl = `https://${projectResult.domain}/${encodeURIComponent(slug)}/`;
    const httpStatus = await verifyUrl(shareUrl);
    manifest.deployments.push({ deployedAt: publication.publishedAt, project, slug });
    await commitPublication(root, preparedPath, publication, manifest);
    return { ok: true, project, projectCreated: projectResult.created, environment: "production", slug, title, files: bundle.files.length, bytes, deploymentUrl, shareUrl, verified: true, httpStatus, costGuard: { ...monthlyDeploymentUsage(manifest), usedBeforeDeployment: costGuard.used } };
  } finally {
    await rm(workRoot, { recursive: true, force: true });
    if (buildRoot) await rm(buildRoot, { recursive: true, force: true });
  }
}

async function status() {
  const root = stateRoot();
  const manifest = await loadManifest(root);
  let authenticated = false;
  let identity = null;
  try { identity = await ensureAuthenticated(); authenticated = true; }
  catch (error) { if (error.exitCode !== 2) throw error; }
  return { ok: true, authenticated, identity, stateRoot: root, publications: manifest.publications.length, defaultProject: process.env.MICRO_HOSTER_PROJECT || DEFAULT_PROJECT, costGuard: monthlyDeploymentUsage(manifest) };
}

async function listPublications() {
  const manifest = await loadManifest(stateRoot());
  return { ok: true, publications: [...manifest.publications].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)) };
}

function printResult(result, json) {
  if (json) { process.stdout.write(`${JSON.stringify(result)}\n`); return; }
  if (result.shareUrl) process.stdout.write(`\nShare link: ${result.shareUrl}\nVerified: HTTP ${result.httpStatus}\n`);
  else if (result.dryRun) process.stdout.write(`Ready to publish ${result.files} files (${result.bytes} bytes) to ${result.project}/${result.slug}.\n`);
  else if (Array.isArray(result.publications)) {
    if (!result.publications.length) process.stdout.write("No local publications yet.\n");
    else for (const item of result.publications) process.stdout.write(`${item.slug}\t${item.title}\t${item.publishedAt}\n`);
  } else process.stdout.write(`Authenticated: ${result.authenticated ? "yes" : "no"}\nLocal publications: ${result.publications}\nState: ${result.stateRoot}\n`);
}

async function main() {
  const { command, positional, options } = parseArgs(process.argv.slice(2));
  if (["help", "--help", "-h"].includes(command)) { process.stdout.write(`${usage()}\n`); return; }
  if (["--version", "version"].includes(command)) { process.stdout.write(`${VERSION}\n`); return; }
  let result;
  if (command === "publish") result = await publish(positional, options);
  else if (command === "status") result = await status();
  else if (command === "list") result = await listPublications();
  else fail(`Unknown command: ${command}\n\n${usage()}`);
  printResult(result, options.json);
}

if (process.argv[1] && basename(process.argv[1]).toLowerCase() === "cli.js") {
  main().catch((error) => { process.stderr.write(`micro-hoster: ${error.message}\n`); process.exitCode = error.exitCode || 1; });
}

export { defaultSlug, inventory, monthlyDeploymentUsage, prepareInput, slugify, validateSlug };
