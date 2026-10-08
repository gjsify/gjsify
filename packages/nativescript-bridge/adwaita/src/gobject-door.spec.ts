// ADR 0096 on this port: `GObject.registerClass` held to `GOBJECT_VECTORS` through the real tree
// builder, and one class written the GNOME way, built from a `.blp`. On the TREES entry for the
// reason `grid-layout.spec.ts` gives.

import {
    bindProperties,
    type GObjectConstructor,
    type GObjectInstance,
    type GObjectNamespace,
} from '@gjsify/adwaita-core';
import { driveGObjectVectors, type SharedTreeNode } from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { build } from './builder/index.js';
import * as GObject from './namespace/gobject.js';
import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';

import hexdumpTree from './gobject-door.blp?shared-tree';

/** This port has no `Gtk.Switch`; `Gtk.ToggleButton` is the widget with `active` and `notify::active`. */
function withToggle(node: SharedTreeNode): SharedTreeNode {
    return {
        ...node,
        tag: node.tag === 'GtkSwitch' ? 'GtkToggleButton' : node.tag,
        children: node.children?.map(withToggle),
    };
}

export const AdwGObjectDoorNsTest = async () => {
    await driveGObjectVectors(
        {
            name: 'adwaita-nativescript',
            isOracle: false,
            GObject: GObject as unknown as GObjectNamespace,
            Widget: Gtk.Box as unknown as GObjectConstructor,
            template: (source) => withToggle(source.tree),
            bind: (source, sourceProperty, target, targetProperty, flags) => {
                bindProperties(source, sourceProperty, target, targetProperty, flags);
            },
        },
        { describe, it, expect },
    );

    await describe('adwaita-nativescript: a GNOME component class (ADR 0096 § 3)', async () => {
        await it('builds its template under `new`, installs the internal children and runs the bind both ways', () => {
            const seen: string[] = [];
            class GoNsHexdump extends Adw.Bin {
                declare _toggle: Gtk.ToggleButton;
                declare _copyButton: Gtk.Button;
                declare enabled: boolean;
                declare code: string;
                constructor(params?: Record<string, unknown>) {
                    super(params as never);
                    seen.push(`after super:${typeof this._copyButton}`);
                }
                onCopy(): void {
                    seen.push('copy');
                }
            }
            GObject.registerClass(
                {
                    GTypeName: 'GoNsHexdump',
                    Template: hexdumpTree,
                    InternalChildren: ['toggle', 'copyButton'],
                    Properties: {
                        code: GObject.ParamSpec.string('code', '', '', GObject.ParamFlags.READWRITE, ''),
                        enabled: GObject.ParamSpec.boolean('enabled', '', '', GObject.ParamFlags.READWRITE, false),
                    },
                },
                GoNsHexdump,
            );

            const hexdump = new GoNsHexdump({ code: 'ff' });
            expect(seen.join()).toBe('after super:object');
            expect(hexdump.code).toBe('ff');
            expect(hexdump instanceof Adw.Bin).toBe(true);

            expect(hexdump._toggle.active).toBe(false);
            hexdump.enabled = true;
            expect(hexdump._toggle.active).toBe(true);
            hexdump._toggle.active = false;
            expect(hexdump.enabled).toBe(false);

            (hexdump._copyButton as unknown as GObjectInstance).emit('clicked');
            expect(seen.join()).toBe('after super:object,copy');
        });

        await it('refuses a bind flag and `template` as a source when no template instance is present', () => {
            const bound = (
                source: string,
                flags: ('bidirectional' | 'inverted' | 'no-sync-create')[],
            ): SharedTreeNode => ({
                tag: 'GtkBox',
                children: [
                    { tag: 'GtkToggleButton', id: 'source' },
                    { tag: 'GtkToggleButton', bindings: { active: { source, property: 'active', flags } } },
                ],
            });
            expect(() => build(bound('source', ['bidirectional']))).toThrow('plain form only');
            expect(() => build(bound('template', []))).toThrow("id 'template'");
        });
    });
};
