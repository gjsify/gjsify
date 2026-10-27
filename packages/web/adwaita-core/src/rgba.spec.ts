// The RGBA of the core against the shared vectors.

import { describe, expect, it } from '@gjsify/unit';

import { RGBA_VECTORS, driveRGBAVectors, type GdkRGBALike } from './conformance/rgba.js';
import { RGBA } from './rgba.js';

export default async () => {
    await driveRGBAVectors(
        { name: 'adwaita-core', isOracle: false, Gdk: { RGBA } as unknown as GdkRGBALike },
        { describe, it, expect },
        RGBA_VECTORS,
    );
};
