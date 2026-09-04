// The check that keeps the widget table honest about the GTK that is installed.

import { expect, it, on } from '@gjsify/unit';

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import {
    descriptorProblems,
    describeLogRecord,
    installDiagnosticsGate,
    isEnvironmentDiagnostic,
    methodsOf,
    windowChromeCensus,
    windowChromeProblems,
} from './conformance/index.js';
import { GTK_HOSTS, gated } from './testing/gate.mjs';
import { lookupWidget, registeredTags, registerWidget } from './registry.js';
import { createElement, insert, materialize, remove, setSlot } from './host.js';
import type { WidgetDescriptor } from './types.js';
import { BUILTIN_DESCRIPTORS, registerBuiltinWidgets } from './descriptors/index.js';

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        registerBuiltinWidgets();

        // Same gate as every other spec in this package: a describe without one
        // reports ✔ while GTK prints a critical, and the blame lands on a
        // neighbour twelve tests later. `gated` registers the hooks INSIDE the
        // describe, where @gjsify/unit actually keeps them.
        const diagnostics = installDiagnosticsGate();

        await it('describes every record it counts, MESSAGE field or not', async () => {
            // `MESSAGE` is a structured field like any other and a record may arrive
            // without one. The first version answered `String(raw ?? '')`, so such a
            // record was COUNTED and then described as nothing: a CI run failed with
            // "GTK reported 1 diagnostic(s) that would have passed at exit 0:" and a
            // blank list, right after a test that had constructed the whole table. A
            // count without a name sends the reader back to guessing, which is the
            // state this module exists to end.
            //
            // Tested on the renderer directly rather than by emitting a real record:
            // `GLib.log_structured_array` wants `GLib.LogField` structs GJS cannot
            // build from object literals ("not a subclass of GObject_Struct").
            const encode = (text: string) => new TextEncoder().encode(text);
            expect(describeLogRecord({ MESSAGE: encode('a plain warning') })).toBe('a plain warning');
            expect(describeLogRecord({ MESSAGE: 'already a string' })).toBe('already a string');
            // The three shapes that used to render as the empty string.
            const empties = [
                { GLIB_DOMAIN: encode('gtk-host-probe') },
                { MESSAGE: null, GLIB_DOMAIN: 'x' },
                { MESSAGE: '' },
            ];
            for (const record of empties) {
                const answer = describeLogRecord(record);
                expect(answer.includes('no MESSAGE')).toBe(true);
                expect(answer.trim().length > 0).toBe(true);
            }
            expect(describeLogRecord({ GLIB_DOMAIN: encode('gtk-host-probe') }).includes('gtk-host-probe')).toBe(true);
            // A record with nothing at all still says so, rather than ''.
            expect(describeLogRecord(null).length > 0).toBe(true);
            expect(describeLogRecord({}).length > 0).toBe(true);
        });

        await it('separates a diagnostic about the MACHINE from one about the tree', async () => {
            // The vector that stops this gate from asserting a fact about the runner.
            //
            // MEASURED: a Fedora 44 CI container with no `/dev/dri` and a PowerVR
            // Vulkan ICD emits eight warnings the moment GSK realises a surface —
            // before any widget of ours is drawn. A vector that presented a dialog
            // went red there and stayed silent on a desktop with a working GPU, so
            // what it actually asserted was "this machine has a GPU".
            //
            // The classification is one-directional on purpose: a `Vulkan:` record
            // is set aside, and EVERYTHING ELSE is still a failure. The two lines
            // below are verbatim from that CI run.
            expect(
                isEnvironmentDiagnostic(
                    'Vulkan: ../src/imagination/vulkan/pvr_instance.c:73: Failed to enumerate drm devices ' +
                        '(errno 2: No such file or directory) (VK_ERROR_INITIALIZATION_FAILED)',
                ),
            ).toBe(true);
            expect(
                isEnvironmentDiagnostic(
                    "Vulkan: Loader Message: setup_loader_term_phys_devs: Call to 'vkEnumeratePhysicalDevices' " +
                        'in ICD /usr/lib64/libvulkan_powervr_mesa.so failed with error code -3',
                ),
            ).toBe(true);
            // The control side, which is the half that makes the vector worth
            // anything: the messages this module was written to catch are NOT
            // environment, and a message that merely mentions Vulkan is not either —
            // only the GDK/GSK prefix counts.
            for (const message of [
                'Gtk-WARNING **: Trying to snapshot GtkBox without a current allocation',
                'Adwaita-ERROR **: AdwDialog can only be used inside a window',
                'GLib-GObject-WARNING **: unable to set property text from value of type gchararray',
                'a message mentioning Vulkan: in the middle',
                '',
            ]) {
                expect(isEnvironmentDiagnostic(message)).toBe(false);
            }
        });

        await gated(diagnostics, 'descriptor table vs installed typelib', async () => {
            await it('every declared method and text sink exists', async () => {
                // A descriptor that names a method the installed GTK lacks fails
                // deep inside a render with `host[policy.append] is not a function`.
                // This turns that into one message naming the widget.
                const problems = descriptorProblems();
                expect(problems.map((p) => `${p.gtype}: ${p.problem}`)).toStrictEqual([]);
            });

            await it('names a policy method the class does not have', async () => {
                // This was gate G3 in the generator, where it answered the question by
                // walking GIR XML. The generator reads a published vocabulary now and
                // has no method list at all, so the question moved to the only place
                // that can still answer it: the installed class itself. Checked against
                // the real GtkBox rather than a fixture, so a rename in GTK shows up as
                // a failure here instead of a fixture that agrees with itself.
                const box = lookupWidget('GtkBox');
                const broken = { ...box, children: { ...box.children, append: 'nope' } } as WidgetDescriptor;
                expect(descriptorProblems([broken]).map((p) => `${p.gtype}: ${p.problem}`)).toStrictEqual([
                    'GtkBox: declares children.nope(), which GtkBox does not have',
                ]);
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

            await it('reports an adder-backed slot with nothing to remove it with', async () => {
                // `slotted.remove` is optional because a set_-prefixed slot is
                // emptied through its own setter and needs no remove method. An
                // ADDER-backed slot has no such fallback: `detachChild` can only
                // refuse the unmount by name. So the optionality has to come with
                // a rule, and the rule has to be held against a defect.
                const problems = descriptorProblems([
                    {
                        gtype: 'AdwToolbarView',
                        ctor: () => Adw.ToolbarView,
                        children: {
                            kind: 'slotted',
                            slots: { top: 'add_top_bar', content: 'set_content' },
                            defaultSlot: 'content',
                        },
                    },
                ]);
                const said = problems.map((p) => p.problem).join('\n');
                // The SLOT is named, not just the widget: a message that says
                // "needs a remove" without saying which slot forced it sends the
                // reader to read the whole policy back.
                //
                // QUOTED, because the slot name is a SUBSTRING of its own adder.
                // `problem.includes('top')` matches `add_top_bar` just as happily,
                // so it could not tell a message naming the slot from one naming
                // the method — measured: with `policyProblems()` reporting the
                // method and no slot at all, the unquoted assertion stayed green
                // and the suite passed 2053/2053.
                expect(said).toContain('"top"');
                // And ONLY the adder slot. `content` is setter-backed and needs no
                // remove; naming it here would send the reader to fix the half of
                // the policy that is fine. A `Object.keys(policy.slots)` slip
                // reports the right COUNT of problems with the wrong content, and
                // nothing but this line separates the two.
                expect(said.includes('"content"')).toBe(false);
            });

            await it('reports a wrapSlots key that names no slot', async () => {
                // `makeWrapper` LOOKS THE SLOT UP, so a typo is not an error there —
                // a miss reads as "no wrap", the child goes into the inner list bare,
                // and the leak this declaration exists to close comes straight back,
                // behind one `Gtk-WARNING` at unmount. Nothing else can see it: the
                // methods all exist, the slots are all real, and the round-trip
                // mechanism would fail with a message about a removal rather than
                // about a misspelt key.
                const problems = descriptorProblems([
                    {
                        gtype: 'AdwExpanderRow',
                        ctor: () => Adw.ExpanderRow,
                        children: {
                            kind: 'slotted',
                            slots: { prefix: 'add_prefix', suffix: 'add_suffix', row: 'add_row' },
                            defaultSlot: 'row',
                            remove: 'remove',
                            wrapSlots: { rows: 'list-box-row' },
                        },
                    },
                ]);
                const said = problems.map((p) => p.problem).join('\n');
                expect(said).toContain('wrapSlots names "rows"');
                // And the CORRECT spelling is silent — otherwise the assertion above
                // would pass over a rule that flags every wrapSlots entry there is.
                expect(
                    descriptorProblems([
                        {
                            gtype: 'AdwExpanderRow',
                            ctor: () => Adw.ExpanderRow,
                            children: {
                                kind: 'slotted',
                                slots: { prefix: 'add_prefix', suffix: 'add_suffix', row: 'add_row' },
                                defaultSlot: 'row',
                                remove: 'remove',
                                wrapSlots: { row: 'list-box-row' },
                            },
                        },
                    ]),
                ).toStrictEqual([]);
            });

            await it('an adder-backed slot with no remove refuses BY NAME, not by TypeError', async () => {
                // The runtime half of the same rule. `policyProblems()` keeps this
                // shape out of the BUILT-IN table, so this path is unreachable
                // through it — but `registerWidget` takes descriptors from
                // applications and nothing checks those. Unguarded, the unmount is
                // `host[undefined] is not a function`, which blames the host for a
                // claim the descriptor made and names neither the slot nor the file
                // to fix.
                registerWidget({
                    gtype: 'AdwToolbarView',
                    ctor: () => Adw.ToolbarView,
                    children: {
                        kind: 'slotted',
                        slots: { top: 'add_top_bar', content: 'set_content' },
                        defaultSlot: 'content',
                    },
                });
                try {
                    const view = createElement('AdwToolbarView');
                    // MATERIALIZED, or the whole test proves nothing: `attach`
                    // returns early on a parent with no widget, so the child is
                    // never `attached`, `remove()` returns before `detachChild`,
                    // and the assertion below reads an empty string. That is how
                    // this test first passed while measuring nothing.
                    materialize(view);
                    const bar = createElement('AdwHeaderBar');
                    setSlot(bar, 'top');
                    insert(bar, view);
                    expect(bar.attached).toBe(true);
                    let said = '';
                    try {
                        remove(bar);
                    } catch (error) {
                        said = String((error as Error).message);
                    }
                    // The slot AND the adder that put the child there: either one
                    // alone sends the reader back to read the policy.
                    expect(said).toContain('"top"');
                    expect(said).toContain('add_top_bar');
                } finally {
                    // The registry is module-global and every sibling suite reads
                    // it, so the real table goes back even if the asserts throw.
                    registerBuiltinWidgets();
                }
            });

            await it('stays clean on an all-setter slotted policy with no remove', async () => {
                // The other direction, and the one that is easy to skip. Making a
                // field optional can turn a check into one that passes on
                // everything; a rule measured only where it fires has not been
                // measured. `Adw.NavigationSplitView` is the honest shape:
                // two setter slots, and — measured on libadwaita 1.9.3 — no remove
                // method of its own to name even if the policy wanted one.
                const problems = descriptorProblems([
                    {
                        gtype: 'AdwNavigationSplitView',
                        ctor: () => Adw.NavigationSplitView,
                        children: {
                            kind: 'slotted',
                            slots: { sidebar: 'set_sidebar', content: 'set_content' },
                            defaultSlot: 'content',
                        },
                    },
                ]);
                expect(problems.map((p) => `${p.gtype}: ${p.problem}`)).toStrictEqual([]);
            });
        });

        await gated(diagnostics, 'window chrome — the decoration a window has exactly ONE of', async () => {
            /** A toolbar view with its own header bar around `child`. */
            const chromed = (child: Gtk.Widget): Adw.ToolbarView => {
                const view = new Adw.ToolbarView();
                view.add_top_bar(new Adw.HeaderBar());
                view.set_content(child);
                return view;
            };
            /** A navigation page whose own header bar sits above `child`. */
            const page = (title: string, child: Gtk.Widget): Adw.NavigationPage =>
                new Adw.NavigationPage({ title, tag: title, child: chromed(child) });

            /**
             * Present `content` in a window, ask `body`, and take the window away again.
             *
             * PRESENTED, because mapping is the only honest reading — see
             * `conformance/window-chrome.ts`. Measured: nothing needs a main-loop turn
             * after `present()`; the counts are already final.
             */
            const shown = (content: Gtk.Widget, body: (window: Adw.Window) => void): void => {
                const window = new Adw.Window({ content, defaultWidth: 900, defaultHeight: 700 });
                try {
                    window.present();
                    body(window);
                } finally {
                    window.destroy();
                }
            };

            await it('finds no problem in the one-bar window every Adwaita application is', async () => {
                shown(chromed(new Gtk.Label({ label: 'content' })), (window) => {
                    const census = windowChromeCensus(window);
                    expect(census.headerBars).toBe(1);
                    // NOT vacuous: a host whose decoration layout drew no buttons at
                    // all would answer 0 here and make every "no duplicate" below
                    // meaningless. The invariant is per SIDE, so which side carries
                    // them is the host's business and not this vector's.
                    expect(census.start + census.end).toBe(1);
                    expect(windowChromeProblems(window)).toStrictEqual([]);
                });
            });

            await it('refuses three stacked header bars, and says how many close buttons draw', async () => {
                // The shape a routed application produced before #1460: the window's
                // own bar, the navigation page's, and a nested tab level's. MEASURED
                // on libadwaita 1.9.3 — libadwaita hides none of them, so all three
                // close buttons are drawn and reachable, at exit 0.
                const tabs = new Adw.ViewStack();
                tabs.add_titled(new Gtk.Label({ label: 'one' }), 'one', 'One');
                const view = new Adw.NavigationView();
                view.add(page('tabs', chromed(tabs)));
                view.replace_with_tags(['tabs']);

                shown(chromed(view), (window) => {
                    const census = windowChromeCensus(window);
                    expect(census.headerBars).toBe(3);
                    expect(Math.max(census.start, census.end)).toBe(3);
                    const problems = windowChromeProblems(window);
                    expect(problems.length).toBe(1);
                    expect(problems[0]?.includes('3 sets of window controls')).toBe(true);
                    expect(problems[0]?.includes('3 mapped header bar(s)')).toBe(true);
                });
            });

            await it('accepts AdwNavigationSplitView, which shows TWO bars on purpose', async () => {
                // THE DISCRIMINATOR, and the reason the invariant is not "one header
                // bar": libadwaita splits the decoration layout across the sidebar's
                // bar and the content's, so two bars draw ONE set of controls per side.
                // A check that counted bars would refuse Adwaita's own composition.
                const split = new Adw.NavigationSplitView({
                    sidebar: page('sidebar', new Gtk.Label({ label: 'sidebar' })),
                    content: page('content', new Gtk.Label({ label: 'content' })),
                });
                shown(split, (window) => {
                    expect(windowChromeCensus(window).headerBars).toBe(2);
                    expect(windowChromeProblems(window)).toStrictEqual([]);
                });
            });

            await it('counts what is MAPPED, so a pooled navigation page does not', async () => {
                // MEASURED, and it is why this reader does not walk `get_visible()`:
                // a page that is in the view's pool but not on screen is `visible` and
                // NOT mapped, so a visibility-based count answered 4 on the three-bar
                // tree above and 2 here — both wrong, both silently.
                const view = new Adw.NavigationView();
                view.add(page('first', new Gtk.Label({ label: 'first' })));
                view.add(page('second', new Gtk.Label({ label: 'second' })));
                view.replace_with_tags(['first']);
                shown(view, (window) => {
                    expect(windowChromeCensus(window).headerBars).toBe(1);
                    expect(windowChromeProblems(window)).toStrictEqual([]);
                });
            });

            await it('refuses an UNMAPPED root instead of reporting it clean', async () => {
                // The green-that-checked-nothing shape this guard exists for: an
                // unpresented window answers 0 to every count, so a vector that forgot
                // `present()` would read as "no duplicates" having measured nothing.
                const window = new Adw.Window({ content: chromed(new Gtk.Label({ label: 'x' })) });
                try {
                    expect(windowChromeCensus(window).mapped).toBe(false);
                    const problems = windowChromeProblems(window);
                    expect(problems.length).toBe(1);
                    expect(problems[0]?.includes('is not mapped')).toBe(true);
                } finally {
                    window.destroy();
                }
            });

            await it('refuses a window whose chrome draws nothing at all', async () => {
                // The other direction, and the one this fix could have overshot into:
                // an `Adw.Window` carries no titlebar of its own, so a content tree
                // with no header bar leaves the window with no way to be closed.
                shown(new Gtk.Label({ label: 'no chrome' }), (window) => {
                    const problems = windowChromeProblems(window);
                    expect(problems.length).toBe(1);
                    expect(problems[0]?.includes('no window control draws anywhere')).toBe(true);
                });
            });
        });
    });
};
