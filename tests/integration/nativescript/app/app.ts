// NativeScript app entry — runs the gjsify portable-package smoke specs on the
// V8 runtime and reports via console.log markers (parsed from logcat) + a UI
// Label fallback. No @gjsify/unit run() — see app/reporter.ts for why.
import { Application } from '@nativescript/core';
import { begin, summary, type Summary } from './reporter.js';
import pathSmoke from './specs/path.smoke.js';
import bufferSmoke from './specs/buffer.smoke.js';
import streamSmoke from './specs/stream.smoke.js';
import nativePlatformSmoke from './specs/native-platform.smoke.js';

// Module-level result the page binds to (set when the async run lands).
export const result: { summary: Summary | null; runId: string } = {
    summary: null,
    runId: `ns-${Date.now()}`,
};

async function runSmoke(): Promise<void> {
    begin(result.runId);
    try {
        await pathSmoke();
        await bufferSmoke();
        await streamSmoke();
        await nativePlatformSmoke();
    } catch (err) {
        // A throw OUTSIDE an it() (e.g. an import-time crash on a missing
        // polyfill) is the worst case — surface it explicitly so the parser
        // records a FAIL rather than an ambiguous incomplete run.
        const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
        console.log(`__GJSIFY_NS__ CASE FAIL harness :: top-level -- ${msg}`);
    }
    result.summary = summary(result.runId);
}

// Run the suite as early as possible, then boot the UI so the Label can mirror it.
runSmoke();

Application.run({ moduleName: 'main-page' });
