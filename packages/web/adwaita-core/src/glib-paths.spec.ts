// The GLib path helpers of the core against the shared vectors, plus the values this port chose.

import { describe, expect, it } from '@gjsify/unit';

import { GLIB_PATH_VECTORS, driveGLibPathVectors } from './conformance/glib-paths.js';
import { MAXUINT32, buildFilenamev, getCurrentDir, getSystemDataDirs } from './glib-paths.js';

export default async () => {
    await driveGLibPathVectors(
        {
            name: 'adwaita-core',
            isOracle: false,
            GLib: {
                MAXUINT32,
                build_filenamev: buildFilenamev,
                get_current_dir: getCurrentDir,
                get_system_data_dirs: getSystemDataDirs,
            },
        },
        { describe, it, expect },
    );

    await describe('adwaita-core: GLib paths defaults', async () => {
        await it('the working directory is the root and no system data dir exists', () => {
            expect(getCurrentDir()).toBe('/');
            expect(getSystemDataDirs().length).toBe(0);
        });
        await it('has a vector row for every vector', () => {
            expect(GLIB_PATH_VECTORS.length > 0).toBe(true);
        });
    });
};
