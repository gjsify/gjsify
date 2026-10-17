// ADR 0093: this renderer's `./capabilities` table held to `CONSTRUCT_VECTORS` through the real
// tree builder. A refused construct throws before anything is created, so only `page` needs GTK.

import {
    CONSTRUCT_VECTORS,
    driveConstructVectors,
    type ConstructVector,
    type SharedTreeNode,
} from '@gjsify/adwaita-core/conformance';
import { hostTagOf } from '@gjsify/adwaita-core/tags';
import { describe, expect, it, on } from '@gjsify/unit';
import Gtk from 'gi://Gtk?version=4.0';

import { buildSharedTree, withAtContext } from './conformance/index.js';
import { capabilities } from './capabilities.js';
import { registerBuiltinWidgets } from './descriptors/index.js';
import { GTK_HOSTS } from './testing/gate.mjs';
import type { HostElement } from './types.js';

const hostTree = (node: SharedTreeNode): SharedTreeNode => ({
    ...node,
    // An application class is in no GIR, so `hostTagOf` has no spelling for it.
    tag: node.extern === true ? node.tag : hostTagOf(node.tag),
    ...(node.children === undefined ? {} : { children: node.children.map(hostTree) }),
});

function observe(vector: ConstructVector): unknown {
    const built: HostElement[] = [];
    const root = buildSharedTree(hostTree(vector.tree), built).widget as unknown as Gtk.Widget;
    if (vector.kind === 'accessibility') {
        // GTK has no getter for an ARIA value, only `gtk_test_accessible_has_*`: the value is
        // the one the host handed `update_property`, read only where the widget holds the slot.
        const button = built.find((el) => el.descriptor.gtype === 'GtkButton')!;
        const widget = withAtContext(button.widget as unknown as Gtk.Button);
        const held = (property: Gtk.AccessibleProperty, name: string) =>
            Gtk.test_accessible_has_property(widget, property) ? button.accessibility?.[name] : null;
        return [
            {
                label: held(Gtk.AccessibleProperty.LABEL, 'label'),
                description: held(Gtk.AccessibleProperty.DESCRIPTION, 'description'),
            },
        ];
    }
    if (vector.kind !== 'page') return undefined;
    const stack = root as Gtk.Stack;
    return stack.get_pages().get_n_items() === 0
        ? []
        : [stack.get_page(stack.get_first_child()!)].map((page) => ({ name: page.name, title: page.title }));
}

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        registerBuiltinWidgets();
        await driveConstructVectors(
            { name: 'gtk-host', capabilities, vectors: CONSTRUCT_VECTORS, observe },
            { describe, it, expect },
        );
    });
};
