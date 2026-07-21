import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { monthlyDeploymentUsage, slugify } from "../src/cli.js";

const execFileAsync = promisify(execFile);
const cli = resolve("src/cli.js");

test("slugify creates URL-safe slugs", () => assert.equal(slugify("Quarterly Plan v2.html"), "quarterly-plan-v2"));

test("dry-run accepts one HTML file", async () => {
  const root = await mkdtemp(join(tmpdir(), "micro-hoster-test-"));
  const html = join(root, "Plan.html");
  await writeFile(html, "<!doctype html><title>Plan</title><h1>Ready</h1>");
  const { stdout } = await execFileAsync(process.execPath, [cli, "publish", html, "--slug", "team-plan", "--dry-run", "--json"], { env: { ...process.env, MICRO_HOSTER_HOME: join(root, "state") } });
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.slug, "team-plan");
  assert.equal(result.files, 3);
});

test("dry-run accepts a static app folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "micro-hoster-test-"));
  const app = join(root, "app");
  await mkdir(app);
  await writeFile(join(app, "index.html"), "<!doctype html><script src=\"app.js\"></script>");
  await writeFile(join(app, "app.js"), "document.body.append('works')");
  const { stdout } = await execFileAsync(process.execPath, [cli, "publish", app, "--dry-run", "--json"], { env: { ...process.env, MICRO_HOSTER_HOME: join(root, "state") } });
  const result = JSON.parse(stdout);
  assert.equal(result.ok, true);
  assert.equal(result.files, 4);
});

test("publisher rejects secrets", async () => {
  const root = await mkdtemp(join(tmpdir(), "micro-hoster-test-"));
  await writeFile(join(root, "index.html"), "ok");
  await writeFile(join(root, ".env"), "SECRET=do-not-publish");
  await assert.rejects(execFileAsync(process.execPath, [cli, "publish", root, "--dry-run"], { env: { ...process.env, MICRO_HOSTER_HOME: join(root, "state") } }), /Refusing to publish possible secret/);
});

test("publisher rejects Pages Functions", async () => {
  const root = await mkdtemp(join(tmpdir(), "micro-hoster-test-"));
  await writeFile(join(root, "index.html"), "ok");
  await mkdir(join(root, "functions"));
  await writeFile(join(root, "functions", "hello.js"), "export const onRequest = () => new Response('hi')");
  await assert.rejects(execFileAsync(process.execPath, [cli, "publish", root, "--dry-run"], { env: { ...process.env, MICRO_HOSTER_HOME: join(root, "state") } }), /forbidden path/);
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
  await assert.rejects(execFileAsync(process.execPath, [cli, "publish", html, "--dry-run"], { env: { ...process.env, MICRO_HOSTER_HOME: state } }), /Cost guard stopped this deployment/);
});
