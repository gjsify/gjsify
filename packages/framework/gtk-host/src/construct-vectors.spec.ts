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

import { buildSharedTree } from './conformance/index.js';
import { capabilities } from './capabilities.js';
import { registerBuiltinWidgets } from './descriptors/index.js';
import { GTK_HOSTS } from './testing/gate.mjs';

const hostTree = (node: SharedTreeNode): SharedTreeNode => ({
    ...node,
    tag: hostTagOf(node.tag),
    ...(node.children === undefined ? {} : { children: node.children.map(hostTree) }),
});

function observe(vector: ConstructVector): unknown {
    const root = buildSharedTree(hostTree(vector.tree)).widget as unknown as Gtk.Widget;
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
