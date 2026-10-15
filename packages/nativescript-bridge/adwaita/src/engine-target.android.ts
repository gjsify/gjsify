// WHICH ENGINE AN ANDROID BUILD DEFAULTS TO: the real one (ADR 0110 § 1, owner's decision of
// 2026-10-15 on the two gate reports). The base file beside this one holds every other target.
//
// This flag does not BUILD anything — the port cannot, for the tier reason in
// `@gjsify/adwaita-core`'s `engine.ts` § "What an EMPTY slot means". It says that an empty slot
// here is a missing decision rather than a default, so `engineForTarget` refuses loudly instead
// of handing the app the subset it did not ask for.

import type { EngineTarget } from '@gjsify/adwaita-core';

export const ENGINE_TARGET: EngineTarget = {
    name: 'NativeScript Android',
    realGObjectIsDefault: true,
};
