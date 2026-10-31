// The stylesheet `Application.addCss` is handed, held to the shared px-to-dip rows. The door is the
// platform host itself, so a `setStyles` that stops converting fails here.

import { CSS_LENGTH_VECTORS, driveCssLengthVectors } from '@gjsify/adwaita-core/conformance';
import { Application } from '@nativescript/core';
import { describe, expect, it } from '@gjsify/unit';

import { nativePlatformHost } from './platform-host.js';

let owners = 0;

/** `Application.appliedCss()` is the testing double's read-back, which the real class has no twin for. */
const applied = Application as unknown as { appliedCss(): readonly string[] };

export default async () => {
    await driveCssLengthVectors(
        {
            name: 'adwaita-nativescript',
            isOracle: false,
            toDip: (css) => {
                nativePlatformHost.setStyles([{ owner: { id: owners++ }, css, priority: 0 }]);
                return applied.appliedCss().at(-1) ?? '';
            },
        },
        { describe, expect, it },
        CSS_LENGTH_VECTORS,
    );
};
