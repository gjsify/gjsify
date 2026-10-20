// THE APP ENTRY, and the place where the import order of ADR 0105 stage 4 is honoured.
//
// `./opt-in.js` is a side-effect import and it is FIRST, above `@nativescript/core` and above
// every spec. That is not style: `@gjsify/adwaita-nativescript/gobject` (reached through
// `./specs/engine.js`) reads the core's engine slot in its module body, the slot freezes on that
// read, and ESM evaluates dependencies in the order their import declarations appear. Move this
// line down and the port builds its namespace on the default engine, the opt-in throws "registered
// too late", and the run reports pure-JS from an APK that carries the whole payload.
import './opt-in.js';

import { Application } from '@nativescript/core';

import { begin, describe, it, summary, type Summary } from './reporter.js';
import { optInError, optedIn } from './opt-in.js';
import loaderProbe from './specs/loader.probe.js';
import { engineSpec } from './specs/engine.js';
import gobjectVectors from './specs/gobject.vectors.js';
import listStoreVectors from './specs/list-store.js';
import settingsVectors from './specs/settings.js';
import fileChooserVectors from './specs/file-chooser.js';
import { viewsSpec } from './specs/views.js';
import { storybookSpec } from './specs/storybook.js';
import { windowTitleSpec } from './specs/window-title.js';
import benchSpec from './specs/bench.js';
import inversionSpec from './specs/inversion.js';
import foreignParentSpec from './specs/foreign-parent.js';

/**
 * The engine THIS leg claims to run on, derived from the opt-in define alone — the two legs are
 * one APK built twice, and the define is the only thing that differs. `specs/engine.ts` then
 * asserts the claim against what the core and the port actually report, so a wrong name here
 * fails the run rather than relabelling it.
 */
const engine: 'real-gio' | 'pure-js' = optedIn ? 'real-gio' : 'pure-js';

// Module-level result the page binds to (set when the async run lands).
export const result: { summary: Summary | null; runId: string } = {
    summary: null,
    runId: `ns-gi-${Date.now()}`,
};

/** The opt-in's own failure, as the one failed case of the run — see `app/opt-in.ts` for why. */
async function reportOptInFailure(error: unknown): Promise<void> {
    await describe('the app-level opt-in (ADR 0105 § 4)', async () => {
        await it('useRealGObjectEngine reached real GObject', () => {
            const message = error instanceof Error ? error.message : String(error);
            // The `cause` carries the dlopen / typelib message, which is what distinguishes a
            // wrong-ABI APK from a missing `app/girepository-1.0`; without it the case says only
            // that something in the payload is absent.
            const cause = error instanceof Error ? (error as { cause?: unknown }).cause : undefined;
            const because = cause instanceof Error ? cause.message : cause === undefined ? '' : String(cause);
            throw new Error(because === '' ? message : `${message} [cause: ${because}]`);
        });
    });
}

async function runSuite(): Promise<void> {
    begin(result.runId);
    try {
        if (optedIn && optInError !== null) {
            // No vectors at all. They would run on the pure-JS engine and PASS, and the run would
            // report a successful real-GObject measurement that never happened.
            await reportOptInFailure(optInError);
        } else {
            // The payload specs only where there is a payload to reach: in the control run calling
            // `requireGi` would load `libnode_gi.so` anyway and the run would stop being the
            // pure-JS comparison it exists to be.
            if (optedIn) await loaderProbe();
            await engineSpec(engine)();
            await gobjectVectors();
            if (optedIn) await listStoreVectors();
            // Settings before any other Gio.Settings or Gtk use: GIO fixes its schema source once.
            if (optedIn) await settingsVectors();
            if (optedIn) await fileChooserVectors();
            // THE DUAL LEG (ADR 0110 § 3). Unlike the four above, these run in BOTH legs and on
            // purpose: they are statements about the DOOR between a NativeScript widget and
            // whichever engine backs the subset, so a difference between the two runs is a defect
            // in whichever engine disagrees. Gating them on `optedIn` would leave the subset
            // untested at exactly the moment Android stops shipping it by default.
            if (__GJSIFY_GI_UI__) {
                await viewsSpec(engine)();
                await storybookSpec(engine)();
                // The first PORT widget whose properties are a GObject on this leg (ADR 0105 § 2,
                // route D). Dual for the same reason as the two above, and last of the three
                // because it mounts a view the others do not expect.
                await windowTitleSpec(engine)();
            }
            if (optedIn) await inversionSpec();
            if (optedIn) await foreignParentSpec();
            // LAST, and only when the build asked for it: it is seconds long and the runs that
            // measure cold start must not carry it. `specs/bench.ts` says why it is a define.
            if (__GJSIFY_GI_BENCH__) await benchSpec();
        }
    } catch (err) {
        // A throw OUTSIDE an it() — an import-time crash, a typelib missing a type the subject
        // needs — would otherwise leave an incomplete run, which the parser cannot tell apart from
        // a crashed app. Name it as a case instead.
        const msg = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
        console.log(`__GJSIFY_NS__ CASE FAIL harness :: top-level -- ${msg}`);
    }
    result.summary = summary(result.runId);
}

runSuite();

Application.run({ moduleName: 'main-page' });
