// Whole Vite config for the NativeScript build. `defineNativescriptConfig` composes
// @nativescript/vite and layers gjsify's NativeScript transforms; its second argument is
// merged over the result.
//
// THE ONE THING THIS SUITE ADDS: `__GJSIFY_GI_OPT_IN__`, the build-time flag `app/opt-in.ts`
// branches on. It is a DEFINE and not a runtime env read because that is the measurement:
// the app-level opt-in of ADR 0105 stage 4 is a decision the APP makes, and the control run
// (`GJSIFY_GI_OPT_IN=0`) has to be the same app with the same payload in the APK and nothing
// but that decision different. Default ON — the opted-in run is the subject.
import { resolve } from 'node:path';

import { defineNativescriptConfig } from '@gjsify/nativescript-vite';

// `GJSIFY_GI_PLUGIN=0` keeps `@gjsify/node-gi` OUT OF THE BUNDLE, by aliasing it to
// `app/no-gi-stub.ts`. It is a third variant beside the opt-in flag, not a synonym for it, and
// stage 4 found that importing the bridge loaded `libnode_gi.so` from its module body, so
// `GJSIFY_GI_OPT_IN=0` alone still paid for the native library; the NativeScript host is lazy
// now and the import costs only its JS. The two flags still measure
// two different costs — the DECISION (opt-in) and the IMPORT (plugin) — which is exactly the
// A0/B0/B/C ladder ADR 0110 gate 2 asks for. It forces the opt-in off: an opt-in that reached the
// stub would throw, and a variant whose point is "this app pays nothing" must not.
const plugin = process.env.GJSIFY_GI_PLUGIN !== '0';
const optIn = plugin && process.env.GJSIFY_GI_OPT_IN !== '0';
// `GJSIFY_GI_BENCH=1` adds the per-instance benchmark (ADR 0105 stage 2). Off by default so the
// cold-start and APK-size runs carry neither its seconds nor its bytes.
const bench = process.env.GJSIFY_GI_BENCH === '1';
// `GJSIFY_GI_UI=0` drops the two ADR 0110 § 3 UI specs. ON by default: they are what makes the
// run a DUAL run, and they are the only coverage the NativeScript storybook view layer has
// anywhere. Off in the gate-2 release rungs — see globals.d.ts for why.
const ui = process.env.GJSIFY_GI_UI !== '0';

export default defineNativescriptConfig(
    {},
    {
        define: {
            __GJSIFY_GI_OPT_IN__: JSON.stringify(optIn),
            __GJSIFY_GI_BENCH__: JSON.stringify(bench),
            __GJSIFY_GI_UI__: JSON.stringify(ui),
        },
        resolve: {
            alias: plugin ? [] : [{ find: /^@gjsify\/node-gi\/gi$/, replacement: resolve('app/no-gi-stub.ts') }],
        },
        build: {
            rollupOptions: {
                output: {
                    // ONE CHUNK, AND THE OPT-IN DEPENDS ON IT.
                    //
                    // `@nativescript/vite` puts every `node_modules` module except
                    // `@nativescript/core` into `vendor.mjs`, which `bundle.mjs` imports as its
                    // first statement — so ALL of vendor evaluates before ANY app module. The
                    // engine slot is read in `@gjsify/adwaita-nativescript/gobject`'s module body
                    // (vendor) and the opt-in call sits in `app/opt-in.ts` (bundle): with the split
                    // in place, no import order inside the app can make the call win, and the run
                    // fails with "registered too late" out of an APK that carries the full payload.
                    // Measured here on 2026-10-11 before this line existed.
                    //
                    // Returning `undefined` for every module keeps everything in the entry chunk,
                    // where plain ESM evaluation order applies and `app/app.ts`'s first import
                    // decides — the contract ADR 0105 § 4 describes. It is also what upstream
                    // already does for `@nativescript/core`, for the same reason: its bootstrap
                    // must not evaluate ahead of the entry.
                    manualChunks: () => undefined,
                },
            },
        },
    },
);
