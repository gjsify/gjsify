// `registerBarrel`: how a library that depends on this package (`GtkSource`, in
// `@gjsify/gtksource-nativescript`) teaches the shared-tree builder its own `xmlns` barrel without
// this package importing it.
//
// On the TREES entry: `elementFor` lives in the builder module, which reaches every widget
// through the namespace barrels and so needs `@nativescript/core`.

import { describe, expect, it } from '@gjsify/unit';

import { elementFor, registerBarrel } from './builder/index.js';

/** The message of the error `run` throws, or a failure when it does not throw. */
function refusal(run: () => unknown): string {
    try {
        run();
    } catch (error) {
        return (error as Error).message;
    }
    throw new Error('expected a refusal, the call returned');
}

class GtkProbeWidget {}
class GtkProbeOther {}
class ProbeWrongName {}

export const AdwRegisterBarrelNsTest = async () => {
    await describe('registerBarrel', async () => {
        await it('refuses a tag no registered library claims', () => {
            const message = refusal(() => elementFor('GtkNowhereWidget'));
            expect(message.includes('Module \'~/gtk\' has no member')).toBe(true);
        });

        await it('resolves a registered library\'s class under its prefix', () => {
            registerBarrel('gtkprobe', 'GtkProbe', { Widget: GtkProbeWidget });
            const element = elementFor('GtkProbeWidget');
            expect(element.xmlName).toBe('gtkprobe:Widget');
            expect(element.ctor === (GtkProbeWidget as unknown)).toBe(true);
        });

        await it('lets the longest library win a tag another library also starts', () => {
            // `GtkProbeWidget` starts with `Gtk` as well, and the Gtk barrel has no `ProbeWidget`.
            expect(elementFor('GtkProbeWidget').xmlName.startsWith('gtkprobe:')).toBe(true);
            expect(elementFor('GtkButton').xmlName).toBe('gtk:Button');
        });

        await it('refuses a member bound to a class of another name, as the built-in barrels are held', () => {
            registerBarrel('probewrong', 'ProbeWrong', { Name: ProbeWrongName, Widget: GtkProbeOther });
            const message = refusal(() => elementFor('ProbeWrongWidget'));
            expect(message.includes('resolves to class `GtkProbeOther`, not `ProbeWrongWidget`')).toBe(true);
        });

        await it('refuses a registered library that lacks the member', () => {
            const message = refusal(() => elementFor('GtkProbeMissing'));
            expect(message.includes('has no member for element \'gtkprobe:Missing\'')).toBe(true);
        });

        await it('replaces a barrel registered twice under the same library', () => {
            registerBarrel('gtkprobe', 'GtkProbe', { Widget: GtkProbeWidget, Other: GtkProbeOther });
            expect(elementFor('GtkProbeOther').xmlName).toBe('gtkprobe:Other');
        });

        await it('refuses a prefix that already names another library', () => {
            const message = refusal(() => registerBarrel('adw', 'NotAdw', {}));
            expect(message.includes('already names `Adw`')).toBe(true);
            expect(elementFor('AdwBin').xmlName).toBe('adw:Bin');
        });
    });
};
