// SPDX-License-Identifier: MIT
// PoC harness — the browser leg. Serves the worktree, opens index.html in headless
// Chromium and prints the same JSON the Node leg prints:
//
//   node docs/poc/gobject-wasm/harness/run-browser.mjs
//
// PLAYWRIGHT_ROOT points at a checkout whose node_modules has playwright (the PoC
// worktree installs nothing of its own); NODE_GI_WASM_DIR at the build output.
import { homedir } from 'node:os';
import { serve } from './serve.mjs';

const root = new URL('../../../../', import.meta.url).pathname.replace(/\/$/, '');
const engineDir = process.env.NODE_GI_WASM_DIR ?? `${homedir()}/.cache/gjsify-wasm/out`;
const playwrightRoot = process.env.PLAYWRIGHT_ROOT ?? root;

const playwright = await import(`${playwrightRoot}/node_modules/playwright/index.mjs`);
const engineName = process.env.POC_BROWSER ?? 'chromium';
const { url, close } = await serve(root, engineDir);

const browser = await playwright[engineName].launch();
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(`${url}docs/poc/gobject-wasm/harness/index.html?n=${process.env.POC_ITERATIONS ?? 200000}`);
await page.waitForFunction('globalThis.__pocDone === true', undefined, { timeout: 120000 });
const results = await page.evaluate('globalThis.__pocResults');

await browser.close();
await close();

if (process.env.POC_VERBOSE) for (const line of logs) console.error(line);
console.log(JSON.stringify(results, null, 2));
process.exit(results.error ? 1 : 0);
