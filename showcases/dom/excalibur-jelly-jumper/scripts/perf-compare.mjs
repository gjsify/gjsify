#!/usr/bin/env node
/**
 * Compare [PERF] timing logs from GJS and browser versions.
 *
 * Usage:
 *   # 1. Capture GJS logs (run for ~30s, Ctrl-C):
 *   gjsify run dist/gjs.js 2>&1 | grep '\[PERF\]' > /tmp/gjs.log
 *
 *   # 2. Capture browser logs (open http://localhost:8080?perf=1, play for ~30s,
 *   #    copy [PERF] lines from DevTools console to a file):
 *   #    DevTools → Console → filter "[PERF]" → Select All → Copy → paste to /tmp/browser.log
 *
 *   # 3. Compare:
 *   node scripts/perf-compare.mjs /tmp/gjs.log /tmp/browser.log
 */

import { readFileSync } from 'fs';

const [, , gjsFile, browserFile] = process.argv;

if (!gjsFile || !browserFile) {
  console.error('Usage: node scripts/perf-compare.mjs <gjs.log> <browser.log>');
  process.exit(1);
}

function parsePerfLines(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const entries = [];
  for (const line of text.split('\n')) {
    const m = line.match(/\[PERF\]\s*(\{.+\})/);
    if (m) {
      try { entries.push(JSON.parse(m[1])); } catch { /* skip malformed */ }
    }
  }
  return entries;
}

function avg(entries, key) {
  if (!entries.length) return 0;
  return entries.reduce((s, e) => s + (e[key] ?? 0), 0) / entries.length;
}

function min(entries, key) {
  if (!entries.length) return 0;
  return Math.min(...entries.map(e => e[key] ?? 0));
}

const gjs = parsePerfLines(gjsFile);
const browser = parsePerfLines(browserFile);

if (!gjs.length) { console.error(`No [PERF] lines found in ${gjsFile}`); process.exit(1); }
if (!browser.length) { console.error(`No [PERF] lines found in ${browserFile}`); process.exit(1); }

const metrics = [
  { label: 'Samples (60-frame batches)', key: null, fn: (e) => e.length },
  { label: 'FPS avg', key: 'fps_avg', decimals: 1 },
  { label: 'FPS min (worst batch)', key: 'fps_min', decimals: 1, lowerIsBetter: false },
  { label: 'Frame avg ms', key: 'frame_avg_ms', decimals: 2, lowerIsBetter: true },
  { label: 'Update avg ms', key: 'update_avg_ms', decimals: 2, lowerIsBetter: true },
  { label: 'Draw avg ms', key: 'draw_avg_ms', decimals: 2, lowerIsBetter: true },
  { label: 'Dropped frames / 60', key: 'dropped', decimals: 1, lowerIsBetter: true },
];

const COL = 26;
const line = '─'.repeat(COL + 12 + 12 + 10);
console.log('\n' + line);
console.log(`${'Metric'.padEnd(COL)} ${'GJS'.padStart(10)} ${'Browser'.padStart(10)}  Delta`);
console.log(line);

for (const m of metrics) {
  let gjsVal, brVal;
  if (m.fn) {
    gjsVal = m.fn(gjs);
    brVal = m.fn(browser);
  } else {
    gjsVal = avg(gjs, m.key);
    brVal = avg(browser, m.key);
  }
  const dec = m.decimals ?? 0;
  const gjsStr = gjsVal.toFixed(dec);
  const brStr = brVal.toFixed(dec);
  const delta = gjsVal - brVal;
  const deltaStr = (delta >= 0 ? '+' : '') + delta.toFixed(dec);
  const flag = m.lowerIsBetter != null
    ? (m.lowerIsBetter ? (delta > 0.5 ? ' ← GJS slower' : '') : (delta < -0.5 ? ' ← GJS faster' : ''))
    : '';
  console.log(`${m.label.padEnd(COL)} ${gjsStr.padStart(10)} ${brStr.padStart(10)}  ${deltaStr}${flag}`);
}

console.log(line);
console.log('\nBottleneck hints:');
const drawDelta = avg(gjs, 'draw_avg_ms') - avg(browser, 'draw_avg_ms');
const updateDelta = avg(gjs, 'update_avg_ms') - avg(browser, 'update_avg_ms');
const droppedAvg = avg(gjs, 'dropped');

if (drawDelta > 3) console.log(`  • Draw is ${drawDelta.toFixed(1)}ms slower on GJS → consider pixelRatio:2 or WebGL bridge overhead`);
if (updateDelta > 2) console.log(`  • Update is ${updateDelta.toFixed(1)}ms slower on GJS → physics/logic cost or fixedUpdateFps jitter`);
if (droppedAvg > 5) console.log(`  • ${droppedAvg.toFixed(1)} dropped frames/batch on GJS → accumulator catching up, try fixedUpdateFps:30`);
if (drawDelta <= 3 && updateDelta <= 2 && droppedAvg <= 5) console.log('  • No significant bottleneck detected from logs alone — check __GJSIFY_DEBUG_RAF interval variance');
console.log();
