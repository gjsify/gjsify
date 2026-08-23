// The check that keeps the widget table honest about the GTK that is installed.

import { expect, it, on } from '@gjsify/unit';

import Gtk from 'gi://Gtk?version=4.0';

import { descriptorProblems, installDiagnosticsGate, methodsOf } from './conformance/index.js';
import { gated } from './testing/gate.mjs';
import { lookupWidget, registeredTags } from './registry.js';
import type { WidgetDescriptor } from './types.js';
import { BUILTIN_DESCRIPTORS, registerBuiltinWidgets } from './descriptors/index.js';

export default async () => {
    await on('Gjs', async () => {
        Gtk.init();
        registerBuiltinWidgets();

        // Same gate as every other spec in this package: a describe without one
        // reports ✔ while GTK prints a critical, and the blame lands on a
        // neighbour twelve tests later. `gated` registers the hooks INSIDE the
        // describe, where @gjsify/unit actually keeps them.
        const diagnostics = installDiagnosticsGate();

        await gated(diagnostics, 'descriptor table vs installed typelib', async () => {
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
                    // Assert the ENTRIES, not the length: `methodsOf` returns a
                    // fixed-length array per kind, so a policy with every method
                    // `undefined` passed a length check while naming nothing.
                    expect(methods.every((m) => typeof m === 'string' && m.length > 0)).toBe(true);
                    // `none` and `uncurated` are the two kinds that legitimately
                    // name no method: the first says the widget takes no child, the
                    // second that the generator found the tag and no placement rule
                    // was ever measured for it. Everything else must name one.
                    const nameless = d.children.kind === 'none' || d.children.kind === 'uncurated';
                    expect(nameless || methods.length > 0).toBe(true);
                }
            });

            await it('every built-in descriptor is reachable by its own gtype', async () => {
                // A count over a module-global registry fails when anything else
                // registers a widget, and passes when two descriptors collide.
                // Identity answers the question the count was standing in for.
                const seen = new Set<string>();
                for (const d of BUILTIN_DESCRIPTORS) {
                    expect(seen.has(d.gtype)).toBe(false);
                    seen.add(d.gtype);
                    expect(lookupWidget(d.gtype) === d).toBe(true);
                }
                expect(registeredTags().length >= BUILTIN_DESCRIPTORS.length).toBe(true);
            });

            await it('reports a descriptor that lies — the check is not vacuous', async () => {
                // Four shapes that "the method exists" cannot see. Each was a real
                // defect: a read-only or non-string text sink drops the write at
                // exit 0; a missing getter degrades the single-child guard; a
                // native-reorder claim without an `after` makes reorderMode lie.
                const liars: WidgetDescriptor[] = [
                    { gtype: 'GtkLabel', ctor: () => Gtk.Label, children: { kind: 'none' }, textSink: 'width-request' },
                    { gtype: 'GtkLabel', ctor: () => Gtk.Label, children: { kind: 'none' }, textSink: 'scale-factor' },
                    {
                        gtype: 'GtkBox',
                        ctor: () => Gtk.Box,
                        children: { kind: 'ordered', append: 'append', remove: 'remove', reorder: 'native' },
                    },
                    {
                        gtype: 'GtkStack',
                        ctor: () => Gtk.Stack,
                        children: {
                            kind: 'keyed',
                            add: 'add_titled',
                            remove: 'remove',
                            nameFrom: 'name',
                            titled: false,
                        },
                    },
                ];
                for (const liar of liars) {
                    expect(descriptorProblems([liar]).length > 0).toBe(true);
                }
            });
        });
    });
};
