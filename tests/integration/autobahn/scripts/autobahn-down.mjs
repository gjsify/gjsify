#!/usr/bin/env node
// Stop the Autobahn container. Idempotent — `rm -f` doesn't error if the
// container is already gone.

import { spawnSync } from 'node:child_process';

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
  process.exit(2);
}

const runtime = pickRuntime();
const r = spawnSync(runtime, ['rm', '-f', 'gjsify-autobahn'], { stdio: 'inherit' });
process.exit(r.status ?? 0);
