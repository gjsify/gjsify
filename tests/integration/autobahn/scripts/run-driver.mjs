#!/usr/bin/env node
// Run a GJS Autobahn driver with a completion-watchdog.
//
// Motivation: `System.exit(0)` called from inside the bundled driver's
// Promise.then continuation silently returns without killing the gjs
// process — the GLib main loop kept alive by `ensureMainLoop()` keeps the
// process running indefinitely, even though main() has resolved and the
// Autobahn report is already written to disk. The same `System.exit`
// call works correctly from a standalone script or a plain MainLoop
// idle callback, so the blocker is specific to the heavily-patched
// @gjsify/node-globals runtime surface the driver bundles.
//
// Workaround: tail the log file, wait for the "Done." marker the driver
// prints on success, give it a short grace window to self-exit, then
// SIGKILL. Exit status mirrors whether "Done." ever appeared.
//
// Remove this wrapper once the underlying exit-bypass is fixed in
// @gjsify/process or wherever the interception lives.

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const [, , bundleArg, logArg] = process.argv;
if (!bundleArg || !logArg) {
  console.error('Usage: run-driver.mjs <bundle.gjs.mjs> <logfile>');
  process.exit(2);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.resolve(here, '..', bundleArg);
const logfile = path.resolve(here, '..', logArg);
mkdirSync(path.dirname(logfile), { recursive: true });

if (!existsSync(bundle)) {
  console.error(`Bundle not found: ${bundle}`);
  process.exit(2);
}

// Truncate prior log so "Done." detection isn't fooled by a stale run.
await (await import('node:fs/promises')).writeFile(logfile, '');

const out = (await import('node:fs')).openSync(logfile, 'a');
const child = spawn('gjs', ['-m', bundle], { stdio: ['ignore', out, out] });

async function sawDone() {
  try { return (await readFile(logfile, 'utf8')).includes('\nDone.'); }
  catch { return false; }
}

let exited = false;
child.on('exit', () => { exited = true; });

// Poll every 1s for either "Done." in the log or child exit.
while (!exited) {
  if (await sawDone()) break;
  await delay(1000);
}

// Grace window for a clean exit, then SIGKILL.
const GRACE_MS = 3000;
const deadline = Date.now() + GRACE_MS;
while (!exited && Date.now() < deadline) {
  await delay(200);
}
if (!exited) {
  try { child.kill('SIGKILL'); } catch { /* ignore */ }
}

await new Promise((resolve) => {
  if (exited) resolve();
  else child.once('exit', () => resolve());
});

process.exit((await sawDone()) ? 0 : 1);
