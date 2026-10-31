// The real `Gio.MenuModel` twin, held to the GJS measurements (ADR 0128).
//
// Every table driven here was measured against GJS 1.88 / GTK 4.22 and records what GIO
// ANSWERED. The tables are driven rather than read: the spec reproduces the call from the
// row's data, so a twin that drifts from the measurement fails here and not in a review.

import { describe, expect, it } from '@gjsify/unit';

import { registeredClassOf } from './gobject.js';
import { Variant } from './glib-variant.js';
import {
    GioMenu,
    GioMenuItem,
    GioMenuModel,
    GjsifyMenu,
    MENU_ATTRIBUTE_ACTION,
    MENU_ATTRIBUTE_ACTION_NAMESPACE,
    MENU_ATTRIBUTE_ICON,
    MENU_ATTRIBUTE_LABEL,
    MENU_ATTRIBUTE_TARGET,
    MENU_EXPORTER_MAX_SECTION_SIZE,
    MENU_LINK_SECTION,
    MENU_LINK_SUBMENU,
    buildMenu,
    menuTree,
    watchMenuModel,
} from './gio-menu.js';
import {
    MENU_ATTRIBUTE_VARIANT_VECTORS,
    MENU_CONSTANT_VECTORS,
    MENU_LINK_VECTORS,
    MENU_MODEL_DIVERGENCE_VECTORS,
    MENU_MODEL_TYPE_VECTORS,
    MENU_MUTATOR_EMISSION_VECTORS,
} from './conformance/menu.js';
import type { MenuAttributeSet, MenuMutatorCall } from './conformance/menu.js';

/** The named constants, by the name the table addresses them with. */
const CONSTANTS: Readonly<Record<string, string | number>> = {
    MENU_ATTRIBUTE_ACTION,
    MENU_ATTRIBUTE_ACTION_NAMESPACE,
    MENU_ATTRIBUTE_ICON,
    MENU_ATTRIBUTE_LABEL,
    MENU_ATTRIBUTE_TARGET,
    MENU_LINK_SECTION,
    MENU_LINK_SUBMENU,
    MENU_EXPORTER_MAX_SECTION_SIZE,
};

/** A menu of `n` plain items, named `A`, `B`, … — the `before` of an emission row. */
const menuOf = (n: number): GioMenu => {
    const menu = new GioMenu();
    for (let i = 0; i < n; i++) menu.append(String.fromCharCode(65 + i), `app.${i}`);
    return menu;
};

/** A section/submenu child list, as the emission table spells it. */
const childrenOf = (labels: readonly string[]): GioMenu => {
    const menu = new GioMenu();
    for (const label of labels) menu.append(label, null);
    return menu;
};

/** Apply one row's mutator call to `menu`. */
const applyCall = (menu: GioMenu, call: MenuMutatorCall): void => {
    switch (call.method) {
        case 'append':
            menu.append(call.label, call.action ?? null);
            return;
        case 'prepend':
            menu.prepend(call.label, call.action ?? null);
            return;
        case 'insert':
            menu.insert(call.position, call.label, call.action ?? null);
            return;
        case 'append_item':
            menu.append_item(new GioMenuItem(call.label));
            return;
        case 'prepend_item':
            menu.prepend_item(new GioMenuItem(call.label));
            return;
        case 'insert_item':
            menu.insert_item(call.position, new GioMenuItem(call.label));
            return;
        case 'append_section':
            menu.append_section(call.label, childrenOf(call.children));
            return;
        case 'prepend_section':
            menu.prepend_section(call.label, childrenOf(call.children));
            return;
        case 'append_submenu':
            menu.append_submenu(call.label, childrenOf(call.children));
            return;
        case 'prepend_submenu':
            menu.prepend_submenu(call.label, childrenOf(call.children));
            return;
        case 'insert_section':
            menu.insert_section(call.position, call.label, childrenOf(call.children));
            return;
        case 'insert_submenu':
            menu.insert_submenu(call.position, call.label, childrenOf(call.children));
            return;
        case 'remove':
            menu.remove(call.position);
            return;
        case 'remove_all':
            menu.remove_all();
            return;
        case 'items_changed':
            menu.items_changed(call.position, call.removed, call.added);
            return;
    }
};

/** Build the item an attribute row reads from. */
const itemFor = (set: MenuAttributeSet): GioMenuItem => {
    const item = new GioMenuItem();
    switch (set.kind) {
        case 'detailed-action':
            item.set_detailed_action(set.detailed);
            return item;
        case 'label':
            item.set_label(set.label);
            return item;
        case 'attribute':
            item.set_attribute_value(set.name, new Variant(set.variant.type, set.variant.value));
            return item;
        case 'nothing':
            return item;
    }
};

/**
 * `$gtype` as a GJS caller reads it. `registerBaseClass` installs the property on the
 * constructor; the class's TS type does not declare it, which is why every read casts.
 */
const gtypeNameOf = (klass: unknown): string => (klass as { $gtype: { name: string } }).$gtype.name;

/**
 * The GType name one hop up — the twin's answer to `GObject.type_parent(...)`. The port has no
 * `GObject.type_parent`, so the parent is the static prototype chain's next REGISTERED class,
 * which is the same edge `registerBaseClass` recorded.
 */
const parentTypeNameOf = (klass: object): string | undefined =>
    registeredClassOf(Object.getPrototypeOf(klass) as object)?.typeName;

/** The twin's answer to `GObject.signal_lookup(name, klass.$gtype) !== 0`. */
const hasSignal = (klass: object, name: string): boolean => registeredClassOf(klass)?.signals[name] !== undefined;

/**
 * Every `items-changed` a model emits, as the `(position, removed, added)` triple GIO sends.
 * The handler takes rest args because that is the port's signal signature — a three-parameter
 * handler is not assignable to it.
 */
const recordEmissions = (model: GioMenuModel): Array<readonly [number, number, number]> => {
    const emissions: Array<readonly [number, number, number]> = [];
    model.connect('items-changed', (_source: unknown, ...args: unknown[]) => {
        emissions.push(args as unknown as readonly [number, number, number]);
    });
    return emissions;
};

/** THE SCENE the link table runs against: one section at 0, holding one item. */
const linkScene = (): { menu: GioMenu; section: GioMenu } => {
    const section = new GioMenu();
    section.append('Cut', 'app.cut');
    const menu = new GioMenu();
    menu.append_section('Edit', section);
    return { menu, section };
};

export default async () => {
    await describe('the GType surface (ADR 0128 conformance vectors)', async () => {
        for (const { query, answer, throws, rule } of MENU_MODEL_TYPE_VECTORS) {
            await it(`${query} — ${rule}`, () => {
                switch (query) {
                    case 'construct-abstract':
                        // The base is abstract, which TypeScript also knows — the cast is
                        // what a JS caller reaching for it would do, and the measurement
                        // is about the RUNTIME refusal.
                        expect(() => new (GioMenuModel as unknown as new () => GioMenuModel)()).toThrow(throws ?? '');
                        return;
                    case 'gtype-name':
                        expect(gtypeNameOf(new GioMenu().constructor)).toBe(answer);
                        return;
                    case 'parent-gtype-name':
                        expect(parentTypeNameOf(GioMenu)).toBe(answer);
                        return;
                    case 'instance-of-base':
                        expect(new GioMenu() instanceof GioMenuModel).toBe(answer);
                        return;
                    case 'items-changed-on-base':
                        expect(hasSignal(GioMenuModel, 'items-changed')).toBe(answer);
                        return;
                    case 'fresh-n-items':
                        expect(new GioMenu().get_n_items()).toBe(answer);
                        return;
                    case 'fresh-is-mutable':
                        expect(new GioMenu().is_mutable()).toBe(answer);
                        return;
                }
            });
        }

        await it('a GjsifyMenu is a GMenu is a GMenuModel, so the door takes it', () => {
            const menu = new GjsifyMenu();
            expect(menu instanceof GioMenu).toBe(true);
            expect(menu instanceof GioMenuModel).toBe(true);
            expect(gtypeNameOf(menu.constructor)).toBe('GjsifyMenu');
            expect(parentTypeNameOf(GjsifyMenu)).toBe('GMenu');
        });
    });

    await describe('every mutator emits ONE items-changed (ADR 0128 conformance vectors)', async () => {
        for (const { before, call, emission, after, rule } of MENU_MUTATOR_EMISSION_VECTORS) {
            await it(`${call.method} on ${before} → (${emission.join(', ')}) — ${rule}`, () => {
                const menu = menuOf(before);
                const emissions = recordEmissions(menu);

                applyCall(menu, call);

                expect(emissions.length).toBe(1);
                expect([...(emissions[0] ?? [])]).toStrictEqual([...emission]);
                expect(menu.get_n_items()).toBe(after);
            });
        }

        await it('a no-op skip would be wrong: remove_all on an EMPTY menu still emits', () => {
            // The row is in the table, and this is what it costs to get wrong — the skip
            // `Gtk.StringList` is right to make (ADR 0122) silences a menu GIO does not.
            const menu = new GioMenu();
            let emissions = 0;
            menu.connect('items-changed', () => emissions++);
            menu.remove_all();
            expect(emissions).toBe(1);
        });

        await it('an out-of-range remove changes nothing and says nothing', () => {
            const menu = menuOf(2);
            let emissions = 0;
            menu.connect('items-changed', () => emissions++);
            menu.remove(7);
            menu.remove(-1);
            expect(emissions).toBe(0);
            expect(menu.get_n_items()).toBe(2);
        });
    });

    await describe('attribute variant types (ADR 0128 conformance vectors)', async () => {
        for (const vector of MENU_ATTRIBUTE_VARIANT_VECTORS) {
            const { set, read, expectedType, type, value, rule } = vector;
            await it(`${set.kind} → ${read} is ${type ?? 'empty'} — ${rule}`, () => {
                const menu = new GioMenu();
                menu.append_item(itemFor(set));
                const answer = menu.get_item_attribute_value(0, read, expectedType ?? null);

                if (type === null) {
                    expect(answer).toBe(null);
                    return;
                }
                expect(answer).not.toBe(null);
                expect(answer?.get_type_string()).toBe(type);
                if (value !== undefined) expect(answer?.deepUnpack()).toBe(value);
            });
        }

        await it('the two spellings of one string target produce EQUAL variants', () => {
            const read = (detailed: string): Variant | null => {
                const menu = new GioMenu();
                menu.append_item(itemFor({ kind: 'detailed-action', detailed }));
                return menu.get_item_attribute_value(0, 'target', null);
            };
            const colons = read('app.view::list');
            const parens = read("app.view('list')");
            expect(colons).not.toBe(null);
            expect(colons?.equal(parens as Variant)).toBe(true);
        });
    });

    await describe('links and the emission that does not bubble (ADR 0128 conformance vectors)', async () => {
        for (const { query, answer, rule } of MENU_LINK_VECTORS) {
            await it(`${query} — ${rule}`, () => {
                const { menu, section } = linkScene();
                switch (query) {
                    case 'section-identity':
                        expect(menu.get_item_link(0, MENU_LINK_SECTION) === section).toBe(answer);
                        return;
                    case 'repeat-read-identity':
                        expect(
                            menu.get_item_link(0, MENU_LINK_SECTION) === menu.get_item_link(0, MENU_LINK_SECTION),
                        ).toBe(answer);
                        return;
                    case 'wrong-link-name':
                        expect(menu.get_item_link(0, MENU_LINK_SUBMENU)).toBe(answer);
                        return;
                    case 'unknown-link-name':
                        expect(menu.get_item_link(0, 'x-no-such-link')).toBe(answer);
                        return;
                    case 'link-iteration': {
                        const iter = menu.iterate_item_links(0);
                        const names: string[] = [];
                        while (iter.next()) names.push(iter.get_name() ?? '');
                        expect(names).toStrictEqual([...(answer as readonly string[])]);
                        return;
                    }
                    case 'attribute-iteration': {
                        const iter = menu.iterate_item_attributes(0);
                        const names: string[] = [];
                        while (iter.next()) names.push(iter.get_name() ?? '');
                        expect(names).toStrictEqual([...(answer as readonly string[])]);
                        return;
                    }
                    case 'link-emission-does-not-bubble': {
                        let root = 0;
                        menu.connect('items-changed', () => root++);
                        section.append('Paste', 'app.paste');
                        expect(root).toBe(answer);
                        return;
                    }
                    case 'link-count-after-append': {
                        section.append('Paste', 'app.paste');
                        expect(menu.get_item_link(0, MENU_LINK_SECTION)?.get_n_items()).toBe(answer);
                        return;
                    }
                }
            });
        }

        await it('watchMenuModel is what the non-bubbling emission costs: it hears a section too', () => {
            const { menu, section } = linkScene();
            let heard = 0;
            const stop = watchMenuModel(menu, () => heard++);

            section.append('Paste', 'app.paste');
            expect(heard).toBe(1);

            menu.append('Quit', 'app.quit');
            expect(heard).toBe(2);

            stop();
            section.append('Delete', 'app.delete');
            menu.append('More', 'app.more');
            expect(heard).toBe(2);
        });

        await it('and a submenu, at any depth, since a link is a model of its own', () => {
            const deep = new GioMenu();
            deep.append('Rename', 'app.rename');
            const inner = new GioMenu();
            inner.append_submenu('Deeper', deep);
            const root = new GioMenu();
            root.append_section(null, inner);

            let heard = 0;
            const stop = watchMenuModel(root, () => heard++);
            deep.append('Delete', 'app.delete');
            expect(heard).toBe(1);
            stop();
        });
    });

    await describe('where the twin cannot copy GIO (ADR 0128 conformance vectors)', async () => {
        for (const { probe, twin, rule } of MENU_MODEL_DIVERGENCE_VECTORS) {
            await it(`${probe} — ${rule}`, () => {
                switch (probe) {
                    case 'attribute-read-out-of-range': {
                        // GIO takes the process with it; the twin answers the empty read.
                        const menu = buildMenu([{ kind: 'item', label: 'Save' }]);
                        expect(menu.get_item_attribute_value(99, 'label', null)).toBe(null);
                        expect(twin).toBe('null');
                        return;
                    }
                    case 'link-read-out-of-range': {
                        const menu = buildMenu([{ kind: 'item', label: 'Save' }]);
                        expect(menu.get_item_link(99, MENU_LINK_SECTION)).toBe(null);
                        return;
                    }
                    case 'freeze-does-not-lock': {
                        const menu = menuOf(1);
                        menu.freeze();
                        expect(menu.is_mutable()).toBe(false);
                        menu.append('After', 'app.after');
                        expect(menu.get_n_items()).toBe(2);
                        return;
                    }
                    case 'item-is-a-snapshot': {
                        const menu = new GioMenu();
                        const item = new GioMenuItem('Before');
                        menu.append_item(item);
                        item.set_label('After');
                        expect(menu.get_item_attribute_value(0, 'label', null)?.deepUnpack()).toBe('Before');

                        // The other half of the row: `menuTree` is a deep snapshot too.
                        const section = new GioMenu();
                        section.append('Cut', 'app.cut');
                        const root = new GioMenu();
                        root.append_section('Edit', section);
                        const snapshot = menuTree(root);
                        section.append('Paste', 'app.paste');
                        const node = snapshot[0];
                        expect(node?.kind === 'section' ? node.items.length : -1).toBe(1);
                        return;
                    }
                    case 'null-attribute-removes': {
                        const item = new GioMenuItem('Save', 'app.save');
                        item.set_label(null);
                        item.set_attribute_value('action', null);
                        const menu = new GioMenu();
                        menu.append_item(item);
                        expect(menu.get_item_attribute_value(0, 'label', null)).toBe(null);
                        expect(menu.get_item_attribute_value(0, 'action', null)).toBe(null);
                        return;
                    }
                    case 'bare-string-attribute-refused': {
                        const item = new GioMenuItem();
                        expect(() => item.set_attribute_value('x', 'str' as unknown as Variant)).toThrow(
                            "Expected an object of type GVariant for argument 'value' but got type string",
                        );
                        return;
                    }
                    case 'icon-is-a-serialised-gicon': {
                        // The subset has no `(sv)`, so the port writes the NAME as `s`.
                        const menu = buildMenu([{ kind: 'item', label: 'Save', icon: 'document-save-symbolic' }]);
                        const icon = menu.get_item_attribute_value(0, MENU_ATTRIBUTE_ICON, null);
                        expect(icon?.get_type_string()).toBe('s');
                        expect(icon?.deepUnpack()).toBe('document-save-symbolic');
                        return;
                    }
                    case 'varargs-attribute-getter-absent': {
                        const menu = new GioMenu();
                        expect('get_item_attribute' in menu).toBe(false);
                        return;
                    }
                    case 'typed-variant-getters-refused': {
                        const menu = buildMenu([{ kind: 'item', label: 'Save' }]);
                        const label = menu.get_item_attribute_value(0, MENU_ATTRIBUTE_LABEL, null);
                        expect(label).not.toBe(null);
                        // What the twin reads THROUGH, and what it is refused. The typed
                        // getters are PRESENT and throw: the subset refuses by name so the
                        // caller learns which surface it reached for, rather than tripping
                        // over an undefined.
                        expect(typeof label?.deepUnpack).toBe('function');
                        expect(typeof label?.get_type_string).toBe('function');
                        for (const refused of ['get_string', 'get_boolean', 'get_int32']) {
                            const call = (label as unknown as Record<string, () => unknown>)[refused];
                            expect(typeof call).toBe('function');
                            expect(() => call?.call(label)).toThrow(
                                `GLib.Variant.prototype.${refused}() is outside the GLib.Variant subset (ADR 0118 § 2).`,
                            );
                        }
                        return;
                    }
                    case 'variant-type-is-a-string': {
                        // `expected_type` is a TYPE STRING here, because the Variant
                        // subset has no `GLib.VariantType` to build one with.
                        const menu = buildMenu([{ kind: 'item', label: 'Save' }]);
                        expect(menu.get_item_attribute_value(0, MENU_ATTRIBUTE_LABEL, 's')?.deepUnpack()).toBe('Save');
                        expect(menu.get_item_attribute_value(0, MENU_ATTRIBUTE_LABEL, 'b')).toBe(null);
                        return;
                    }
                }
            });
        }
    });

    await describe('the Gio menu constants (ADR 0128 conformance vectors)', async () => {
        for (const { name, value, rule } of MENU_CONSTANT_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                expect(CONSTANTS[name]).toBe(value);
            });
        }
    });

    await describe('buildMenu / menuTree round trip', async () => {
        await it('a normalised tree survives a trip through a real model', () => {
            const tree = [
                { kind: 'item' as const, label: 'New', action: 'app.new' },
                {
                    kind: 'section' as const,
                    label: 'Edit',
                    items: [{ kind: 'item' as const, label: 'Cut', action: 'app.cut' }],
                },
                {
                    kind: 'submenu' as const,
                    label: 'More',
                    items: [{ kind: 'item' as const, label: 'Rename' }],
                },
            ];
            expect(menuTree(buildMenu(tree))).toStrictEqual(tree);
        });

        await it('an authored attribute round trips, including the ones GIO has no type for', () => {
            const tree = [
                {
                    kind: 'item' as const,
                    label: 'Zoom',
                    action: 'win.zoom',
                    icon: 'zoom-in-symbolic',
                    verbIcon: 'go-next-symbolic',
                    accel: '<Control>plus',
                    hiddenWhen: 'action-disabled',
                    id: 'zoom',
                    useMarkup: true,
                },
            ];
            expect(menuTree(buildMenu(tree))).toStrictEqual(tree);
        });

        await it('use-markup is written as text and read back from either spelling', () => {
            // The portable writer has always used `s`; GIO's own menus use `b`. A reader
            // that took only one of them would drop the markup flag of the other.
            const menu = buildMenu([{ kind: 'item', label: '<b>Bold</b>', useMarkup: true }]);
            expect(menu.get_item_attribute_value(0, 'use-markup', null)?.get_type_string()).toBe('s');

            const gio = new GioMenu();
            const item = new GioMenuItem('<b>Bold</b>');
            item.set_attribute_value('use-markup', new Variant('b', true));
            gio.append_item(item);
            expect(menuTree(gio)[0]).toStrictEqual({ kind: 'item', label: '<b>Bold</b>', useMarkup: true });
        });
    });

    await describe('GjsifyMenu.reconcile — the authored model a widget owns', async () => {
        await it('an equal tree is NOT a change, so the renderer is not woken', () => {
            const menu = new GjsifyMenu();
            menu.reconcile([{ label: 'Save', action: 'app.save' }]);
            let emissions = 0;
            menu.connect('items-changed', () => emissions++);
            menu.reconcile([{ label: 'Save', action: 'app.save' }]);
            expect(emissions).toBe(0);
        });

        await it('a different tree is ONE emission, covering the whole menu', () => {
            const menu = new GjsifyMenu();
            menu.reconcile([{ label: 'Save' }, { label: 'Quit' }]);
            const emissions = recordEmissions(menu);
            menu.reconcile([{ label: 'Save' }]);
            expect(emissions.length).toBe(1);
            expect([...(emissions[0] ?? [])]).toStrictEqual([0, 2, 1]);
            expect(menuTree(menu)).toStrictEqual([{ kind: 'item', label: 'Save' }]);
        });

        await it('clearing to null empties it rather than leaving the last menu up', () => {
            const menu = new GjsifyMenu();
            menu.reconcile([{ label: 'Save' }]);
            menu.reconcile(null);
            expect(menu.get_n_items()).toBe(0);
            expect(menuTree(menu)).toStrictEqual([]);
        });

        await it('the identity never changes, which is what lets a widget hold one', () => {
            // The widget writes this model at its own property ONCE. If `reconcile`
            // replaced it, every render would be a `notify::menu-model` and the popover
            // would be rebuilt — the defect the identity guard exists to avoid.
            const menu = new GjsifyMenu();
            menu.reconcile([{ label: 'A' }]);
            const before = menu;
            menu.reconcile([{ label: 'B' }]);
            expect(menu).toBe(before);
        });
    });
};
