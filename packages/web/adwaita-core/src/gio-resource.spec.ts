// The Gio resource subset of the core against the shared vectors, plus what it refuses.

import { describe, expect, it } from '@gjsify/unit';

import { GIO_RESOURCE_VECTORS, driveGioResourceVectors, gioResourceFixtures } from './conformance/gio-resource.js';
import {
    Resource,
    ResourceLookupFlags,
    claimResourceRegistry,
    resources_enumerate_children,
    resources_get_info,
    resources_lookup_data,
    resources_register,
    resources_unregister,
} from './gio-resource.js';
import { Bytes } from './glib-bytes.js';
import { ResourceError } from './glib-error.js';

const refusedBy = (run: () => unknown): string => {
    try {
        run();
    } catch (error) {
        return (error as Error).name;
    }
    return 'nothing';
};

export default async () => {
    await driveGioResourceVectors(
        {
            name: 'adwaita-core',
            isOracle: false,
            Gio: {
                Resource,
                ResourceLookupFlags,
                ResourceError,
                resources_register,
                resources_unregister,
                resources_lookup_data,
                resources_get_info,
                resources_enumerate_children,
            } as never,
            bytes: (data) => new Bytes(data),
        },
        { describe, it, expect },
        GIO_RESOURCE_VECTORS,
    );

    await describe('adwaita-core: Gio resources, outside the subset (ADR 0116 § 3)', async () => {
        const { fixture } = gioResourceFixtures();
        const resource = Resource.new_from_data(fixture);

        await it('refuses a compressed lookup_data by name and still answers get_info', () => {
            expect(refusedBy(() => resource.lookup_data('/org/gjsify/fixture/big.txt', 0))).toBe(
                'UnsupportedGObjectError',
            );
            expect(resource.get_info('/org/gjsify/fixture/big.txt', 0).join()).toBe('true,600,1');
        });
        await it('refuses open_stream and Resource.load', () => {
            expect(refusedBy(() => resource.open_stream())).toBe('UnsupportedGObjectError');
            expect(refusedBy(() => Resource.load('/x.gresource'))).toBe('UnsupportedGObjectError');
        });
        await it('refuses a byte-swapped file rather than reading it wrong', () => {
            const swapped = new Uint8Array(24);
            swapped.set(new TextEncoder().encode('raVGtnai'));
            expect(refusedBy(() => Resource.new_from_data(swapped))).toBe('UnsupportedGObjectError');
        });
        await it('accepts only NONE as lookup flags', () => {
            expect(refusedBy(() => resource.lookup_data('/org/gjsify/fixture/hello.txt', 1))).toBe('Error');
        });
        await it('does not alias the bytes it was given', () => {
            const copy = fixture.slice();
            const own = Resource.new_from_data(copy);
            copy.fill(0);
            expect(own.get_info('/org/gjsify/fixture/hello.txt', 0).join()).toBe('true,6,0');
        });
        await it('throws when a second copy of the registry loads', () => {
            const host = {};
            claimResourceRegistry(host);
            expect(refusedBy(() => claimResourceRegistry(host))).toBe('Error');
        });
    });
};
