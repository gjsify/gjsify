// WHICH ENGINE THIS BUILD DEFAULTS TO when the app registered none — the platform half of
// ADR 0110 § 1, read by `namespace/gobject.ts`. This BASE file is the target that is NEITHER
// NativeScript platform: the unit and tree tests, and anything else that loads the port off a
// device. The pure-JS subset is the default here, as it is on iOS
// (`./engine-target.ios.ts`, ADR 0105 § 6). `./engine-target.android.ts` is the one file that
// says otherwise.
//
// A FILE SPLIT AND NOT A RUNTIME `isAndroid` BRANCH, for the reason `platform-source.ts` and
// `clipboard-source.ts` are split the same way: NativeScript's platform file resolution picks the
// variant at BUILD time, so an iOS bundle never carries the Android answer and no bundle carries
// a branch that is dead in it. One line per target, decided where the target is known.

import type { EngineTarget } from '@gjsify/adwaita-core';

export const ENGINE_TARGET: EngineTarget = {
    name: 'this target (a host that is neither Android nor iOS)',
    realGObjectIsDefault: false,
};
