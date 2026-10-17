// The core's resource icon lookup against the shared vectors, with a current theme that holds
// only `go-next-symbolic`. Real GTK holds the same vectors in `icon-theme-resources.gjs.spec.ts`.

import { describe, expect, it } from '@gjsify/unit';

import { driveIconThemeResourceVectors, type IconThemeResourceSubject } from './conformance/icon-theme-resources.js';
import { Resource, resources_register, resources_unregister } from './gio-resource.js';
import { IconTheme } from './gtk-platform.js';
import { iconLookupNames, lookupResourceIcon } from './icon-theme-resources.js';

const subject: IconThemeResourceSubject = {
    name: 'adwaita-core',
    isOracle: false,
    register(data) {
        const resource = Resource.new_from_data(data);
        resources_register(resource);
        return () => resources_unregister(resource);
    },
    theme() {
        const theme = new IconTheme();
        theme.set_resource_path([]);
        return theme;
    },
    lookup(theme, name, size, scale, direction) {
        const match = lookupResourceIcon(theme as IconTheme, {
            names: iconLookupNames(name, direction),
            size,
            scale,
            themeHas: (glyph) => glyph === 'go-next-symbolic',
        });
        if (match === null) return null;
        return match.kind === 'theme' ? 'theme' : { uri: `resource://${match.path}`, symbolic: match.symbolic };
    },
};

export default async () => {
    await driveIconThemeResourceVectors(subject, { describe, it, expect });

    await describe('lookupResourceIcon (ADR 0116 § 4)', async () => {
        await it('builds the GThemedIcon names with their direction variants first', () => {
            expect(iconLookupNames('a', null).join()).toBe('a,a-symbolic');
            expect(iconLookupNames('a-symbolic', 'rtl').join()).toBe('a-symbolic-rtl,a-symbolic,a-rtl,a');
        });

        await it('does not ask the current theme when no resource holds a name', () => {
            const theme = new IconTheme();
            let asked = 0;
            const match = lookupResourceIcon(theme, {
                names: iconLookupNames('nothing-here-symbolic', null),
                size: 16,
                scale: 1,
                themeHas: () => (asked++, true),
            });
            expect(match).toBe(null);
            expect(asked).toBe(0);
        });
    });
};
