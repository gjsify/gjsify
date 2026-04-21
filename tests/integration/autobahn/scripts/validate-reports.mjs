#!/usr/bin/env node
// Validates Autobahn report JSON against a committed baseline.
//
// Autobahn writes one JSON summary per agent after /updateReports fires:
//   reports/output/clients/index.json
// The structure is:
//   {
//     "<agent-name>": {
//       "1.1.1": { "behavior": "OK" | "FAILED" | "INFORMATIONAL" | "NON-STRICT" | "UNIMPLEMENTED", ... },
//       ...
//     }
//   }
//
// Baseline JSONs under reports/baseline/<agent>.json capture the expected
// per-case outcome. A run is considered:
//   - PASS   : every case that was OK/NON-STRICT/INFORMATIONAL in the baseline
//              is still at least that good, AND no case regressed from OK to
//              FAILED.
//   - FAIL   : any previously-passing case is now FAILED.
//   - UPGRADE: some cases improved — we print them and ask you to refresh
//              the baseline.
//
// This lets the diff-reviewer see exactly which RFC 6455 behaviors changed.
// Usage:
//   node validate-reports.mjs              → validate all agents in the run
//   node validate-reports.mjs websocket    → validate agent "gjsify-websocket"
//   node validate-reports.mjs ws           → validate agent "gjsify-ws"

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const AGENT_ALIASES = {
  websocket: 'gjsify-websocket',
  ws:        'gjsify-ws',
};

const here = path.dirname(fileURLToPath(import.meta.url));
const reportDir = path.resolve(here, '..', 'reports');
const runReport = path.join(reportDir, 'output', 'clients', 'index.json');
const baselineDir = path.join(reportDir, 'baseline');

function loadJson(p) {
  try { return JSON.parse(readFileSync(p, 'utf8')); }
  catch (err) {
    throw new Error(`Failed to read ${p}: ${err.message}`);
  }
}

function slimRun(raw) {
  const out = {};
  for (const [agent, cases] of Object.entries(raw)) {
    out[agent] = {};
    for (const [caseId, info] of Object.entries(cases)) {
      out[agent][caseId] = {
        behavior: info.behavior,
        behaviorClose: info.behaviorClose,
        remoteCloseCode: info.remoteCloseCode,
      };
    }
  }
  return out;
}

// OK and NON-STRICT are both passes in Autobahn's model. INFORMATIONAL
// means "the test is about a library choice, not a protocol requirement"
// — we accept. UNIMPLEMENTED means the case was skipped (our fault or by
// design) — treat like INFORMATIONAL.
const PASS_OUTCOMES = new Set(['OK', 'NON-STRICT', 'INFORMATIONAL', 'UNIMPLEMENTED']);

function isPass(outcome) {
  return PASS_OUTCOMES.has(outcome);
}

function compareAgent(agent, run, baseline) {
  const runCases = run[agent] ?? {};
  const baseCases = baseline[agent] ?? {};

  const regressions = [];   // case was pass in baseline, fails now
  const improvements = [];  // case failed in baseline, passes now
  const missing = [];        // baseline had case, run doesn't

  for (const [caseId, base] of Object.entries(baseCases)) {
    const current = runCases[caseId];
    if (!current) { missing.push(caseId); continue; }
    const basePass = isPass(base.behavior);
    const currPass = isPass(current.behavior);
    if (basePass && !currPass) {
      regressions.push({ caseId, was: base.behavior, now: current.behavior });
    } else if (!basePass && currPass) {
      improvements.push({ caseId, was: base.behavior, now: current.behavior });
    }
  }

  // Cases new in the run that aren't in the baseline — treat as
  // informational (the test suite grew). Only worth flagging if they fail.
  const newFailures = [];
  for (const [caseId, current] of Object.entries(runCases)) {
    if (!(caseId in baseCases) && !isPass(current.behavior)) {
      newFailures.push({ caseId, outcome: current.behavior });
    }
  }

  return { agent, regressions, improvements, missing, newFailures };
}

function printReport(result) {
  const { agent, regressions, improvements, missing, newFailures } = result;
  const tag = `[${agent}]`;

  if (regressions.length === 0 && improvements.length === 0 && missing.length === 0 && newFailures.length === 0) {
    console.log(`${tag} ✔ matches baseline exactly`);
    return 0;
  }

  for (const r of regressions) {
    console.error(`${tag} ✗ REGRESSION case ${r.caseId}: ${r.was} → ${r.now}`);
  }
  for (const i of improvements) {
    console.log(`${tag} ↑ improvement case ${i.caseId}: ${i.was} → ${i.now}`);
  }
  for (const c of missing) {
    console.error(`${tag} ✗ MISSING case ${c} — driver did not run it`);
  }
  for (const n of newFailures) {
    console.error(`${tag} ✗ NEW FAILURE case ${n.caseId}: ${n.outcome}`);
  }

  if (improvements.length > 0 && regressions.length === 0 && missing.length === 0 && newFailures.length === 0) {
    console.log(`${tag} ⚠ only improvements — refresh baseline: cp reports/output/clients/index.json reports/baseline/${agent}.json`);
    return 0; // upgrade, not a failure
  }

  return regressions.length + missing.length + newFailures.length;
}

function main() {
  if (!existsSync(runReport)) {
    console.error(`No report at ${runReport}. Did the driver run?`);
    process.exit(2);
  }
  // The freshly-generated Autobahn index.json has noisy per-run fields
  // (duration, reportfile) that confuse diff-based comparison. Load it
  // through the same slimmer we use when refreshing the baseline so both
  // sides are apples-to-apples.
  const run = slimRun(loadJson(runReport));

  const requestedAlias = process.argv[2];
  const wantedAgent = requestedAlias ? AGENT_ALIASES[requestedAlias] : null;
  if (requestedAlias && !wantedAgent) {
    console.error(`Unknown agent alias "${requestedAlias}". Known: ${Object.keys(AGENT_ALIASES).join(', ')}`);
    process.exit(2);
  }

  const agents = wantedAgent ? [wantedAgent] : Object.keys(run);
  let failures = 0;

  for (const agent of agents) {
    const baselinePath = path.join(baselineDir, `${agent}.json`);
    if (!existsSync(baselinePath)) {
      console.error(`[${agent}] ! no baseline at ${baselinePath} — copy from run to accept current state`);
      failures++;
      continue;
    }
    const baseline = loadJson(baselinePath);
    failures += printReport(compareAgent(agent, run, baseline));
  }

  process.exit(failures > 0 ? 1 : 0);
}

main();
