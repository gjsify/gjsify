// The check that keeps the widget table honest about the GTK that is installed.

import { describe, expect, it, on } from '@gjsify/unit';

import Gtk from 'gi://Gtk?version=4.0';

import { descriptorProblems, methodsOf } from './conformance/index.js';
import { BUILTIN_DESCRIPTORS, registerBuiltinWidgets } from './descriptors/index.js';
import { registeredTags } from './registry.js';

export default async () => {
    await on('Gjs', async () => {
        Gtk.init();
        registerBuiltinWidgets();

        await describe('descriptor table vs installed typelib', async () => {
            await it('every declared method and text sink exists', async () => {
                // A descriptor that names a method the installed GTK lacks fails
                // deep inside a render with `host[policy.append] is not a function`.
                // This turns that into one message naming the widget.
                const problems = descriptorProblems();
                expect(problems.map((p) => `${p.gtype}: ${p.problem}`)).toStrictEqual([]);
            });

            await it('every descriptor declares at least one method or an explicit none', async () => {
                for (const d of BUILTIN_DESCRIPTORS) {
                    const methods = methodsOf(d.children);
                    expect(d.children.kind === 'none' || methods.length > 0).toBe(true);
                }
            });

            await it('registers every built-in descriptor exactly once', async () => {
                expect(registeredTags().length).toBe(BUILTIN_DESCRIPTORS.length);
            });
        });
    });
};
