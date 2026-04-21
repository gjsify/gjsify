#!/usr/bin/env node
// Slim the Autobahn index.json to just behavior + behaviorClose + remoteCloseCode
// per case, dropping the `duration` and `reportfile` fields that change on
// every run and explode diff noise. Used when refreshing the committed
// baseline so PR reviewers see only real compliance changes.
//
// Usage: node scripts/slim-report.mjs <path-to-index.json>
//        (writes slimmed content to stdout)

import { readFileSync } from 'node:fs';

const inPath = process.argv[2];
if (!inPath) {
  console.error('Usage: slim-report.mjs <index.json>');
  process.exit(2);
}

const data = JSON.parse(readFileSync(inPath, 'utf8'));
const slim = {};
for (const [agent, cases] of Object.entries(data)) {
  slim[agent] = {};
  for (const [caseId, info] of Object.entries(cases)) {
    slim[agent][caseId] = {
      behavior: info.behavior,
      behaviorClose: info.behaviorClose,
      remoteCloseCode: info.remoteCloseCode,
    };
  }
}

// Two-space indent keeps baseline files diff-friendly.
process.stdout.write(JSON.stringify(slim, null, 2) + '\n');
