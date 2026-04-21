#!/usr/bin/env node
// Start the Autobahn Testsuite container.
//
// Why direct `podman run` / `docker run` instead of compose:
//   - We launch a single container; compose's declarative multi-service
//     model is overkill.
//   - `podman compose` currently shells out to docker-compose on the
//     author's Fedora 43, which then tries to talk to the Docker daemon
//     and fails because we're using rootless Podman with no socket.
//     Skipping the compose layer avoids that indirection entirely.
//   - The CLI flags for `podman run` and `docker run` are 100% compatible
//     for what we need (port mapping, volume mount, image tag, command).
//
// Resolution order: CONTAINER_RUNTIME env var → podman → docker.
// The container name stays `gjsify-autobahn` regardless so tear-down is
// idempotent.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const configFile = path.resolve(here, '..', 'config', 'fuzzingserver.json');
const reportsDir = path.resolve(here, '..', 'reports');
const CONTAINER_NAME = 'gjsify-autobahn';
// Fully-qualified image name: rootless Podman with strict short-name
// resolution refuses bare `crossbario/autobahn-testsuite` because it
// cannot prompt for a registry choice in a non-TTY context. Spelling
// out docker.io removes the ambiguity; Docker accepts the same string.
const IMAGE = 'docker.io/crossbario/autobahn-testsuite';
const PORT = 9001;

function has(cmd) {
  const r = spawnSync('/usr/bin/env', ['sh', '-c', `command -v "$1"`, '--', cmd], { stdio: 'ignore' });
  return r.status === 0;
}

function pickRuntime() {
  const pref = process.env.CONTAINER_RUNTIME;
  if (pref === 'docker' || pref === 'podman') return pref;
  if (has('podman')) return 'podman';
  if (has('docker')) return 'docker';
  console.error('Neither podman nor docker found in PATH.');
  console.error('Install one, or set CONTAINER_RUNTIME=<docker|podman>.');
  process.exit(2);
}

if (!existsSync(configFile)) {
  console.error(`Missing ${configFile}`);
  process.exit(2);
}

const runtime = pickRuntime();

// Stop+remove any stale container from a prior crashed run. Ignore errors
// — this is best-effort idempotence.
spawnSync(runtime, ['rm', '-f', CONTAINER_NAME], { stdio: 'ignore' });

const runArgs = [
  'run',
  '-d',                              // detached
  '--rm',                            // auto-remove on stop (with --detach only honored on new podman; we also `rm -f` explicitly on teardown)
  '--name', CONTAINER_NAME,
  '-p', `${PORT}:${PORT}`,
  '-v', `${configFile}:/config/fuzzingserver.json:ro,Z`,
  '-v', `${reportsDir}:/reports:Z`,  // :Z relabels for SELinux on Fedora/RHEL; no-op on other OSes
  IMAGE,
  'wstest', '--mode', 'fuzzingserver', '--spec', '/config/fuzzingserver.json',
];

console.log(`Starting ${CONTAINER_NAME} via ${runtime}...`);
const r = spawnSync(runtime, runArgs, { stdio: 'inherit' });
if (r.status !== 0) {
  console.error(`${runtime} run failed with exit ${r.status}`);
  process.exit(r.status ?? 1);
}
