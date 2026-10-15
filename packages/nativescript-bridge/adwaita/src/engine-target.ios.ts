// WHICH ENGINE AN iOS BUILD DEFAULTS TO: the pure-JS subset, unchanged by ADR 0110 (its § 2, and
// ADR 0105 § 6). There is no node-gi payload for iOS, so an empty slot here is an answer and not
// a missing decision — the opposite of `./engine-target.android.ts`.
//
// A file of its own rather than letting iOS fall through to `./engine-target.ts`: the base is
// "a host that is neither", and iOS is a declared NativeScript platform whose answer should be
// written down where the other platforms write theirs. `gjsify.nativescriptPlatforms` enforces
// exactly that — a platform-resolved module owes every declared platform a variant, because the
// NS build resolves `foo.<platform>.ts` before `foo.ts` and a missing one falls back silently.

import type { EngineTarget } from '@gjsify/adwaita-core';

export const ENGINE_TARGET: EngineTarget = {
    name: 'NativeScript iOS',
    realGObjectIsDefault: false,
};
