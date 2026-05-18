// Integration-test entry for @gjsify/integration-worker-stress.
// Exercises @gjsify/worker_threads transferList + SAB pass-through under
// real-world-shaped workloads. Node baseline is the reference; GJS must
// produce the same output (with SAB suite skipped — see STATUS.md
// "Open TODOs": SharedArrayBuffer cross-process sharing).

import '@gjsify/node-globals/register/process';
import '@gjsify/node-globals/register/buffer';
import '@gjsify/node-globals/register/timers';
import '@gjsify/node-globals/register/structured-clone';
import { run } from '@gjsify/unit';
import transferListSuite from './transferlist-stress.spec.js';
import sabHashSuite from './sab-parallel-hash.spec.js';
import sabNativeHashSuite from './sab-native-parallel-hash.gjs.spec.js';

run({
  transferListSuite,
  sabHashSuite,
  sabNativeHashSuite,
});
