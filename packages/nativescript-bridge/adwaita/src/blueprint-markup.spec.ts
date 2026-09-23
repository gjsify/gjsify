// The NativeScript XML the gallery's NativeScript tab shows for a one-Blueprint block, LOADED
// back through NativeScript's XML door and held to the tree `build` makes from the same `.blp`.
//
// The website renders that XML with `@gjsify/adwaita-core/markup` from the block's
// `?shared-tree` projection, on every build. Text a reader copies has to load: an element name no barrel exports, a
// property spelled so no setter hears it, or a slot written as a plain child would each
// load at exit 0 into a different view tree. So every `.blp` under `website/src/blueprints/`
// is imported below — `scripts/check-website-blueprint-markup.mjs` fails on one that is not —
// and its XML is parsed and built here.
//
// THE PARSER IS NATIVESCRIPT'S OWN (`@nativescript/core/xml`, the SAX parser `Builder` runs
// with namespaces on). `Builder` itself needs a device, so {@link loadXml} replays the three
// rules of its `ComponentParser` that a template like this one reaches, each named where it is
// applied: an element is the member of the module its `xmlns` names, an attribute is a plain
// assignment, and a child goes to the parent's `_addChildFromBuilder` under its complex
// property's name, or its own element name when it has none.

// The `*.blp?shared-tree` module pattern, from the build plugin that serves it (this package's
// tsconfig reads no ambient types it does not reference).
/// <reference types="@gjsify/vite-plugin-blueprint/types" />

import { describe, expect, it } from '@gjsify/unit';

import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';
import { sharedTreeNativeScriptXml } from '@gjsify/adwaita-core/markup';
import { propertyOf } from '@gjsify/adwaita-core/tags';
import type { View } from '@nativescript/core';
import { ParserEventType, XmlParser } from '@nativescript/core/xml';

import clampTree from '../../../../website/src/blueprints/adwaita/clamp.blp?shared-tree';

import { build, elementFor } from './builder/index.js';

/** Every one-Blueprint `.blp` of the gallery, by its path under `website/src/blueprints/`. */
export const GALLERY_BLUEPRINTS: Readonly<Record<string, SharedTreeNode>> = {
    'adwaita/clamp.blp': clampTree,
};

/**
 * The library each `xmlns` barrel of the markup names. The member is then read off that barrel
 * by `elementFor`, the builder's own lookup, so this spec imports no widget class itself.
 */
const LIBRARIES: Readonly<Record<string, string>> = { '~/adw': 'Adw', '~/gtk': 'Gtk' };

interface BuilderParent {
    _addChildFromBuilder(name: string, view: View): void;
}

/** A template, built the way `Builder.parse` builds one. */
function loadXml(xml: string): View {
    const parents: View[] = [];
    const properties: { parent: View; name: string }[] = [];
    let root: View | undefined;
    const parser = new XmlParser(
        (event) => {
            const name = event.elementName ?? '';
            if (event.eventType === ParserEventType.StartElement) {
                // `<adw:Clamp.child>` opens a complex property of the current parent.
                if (name.includes('.')) {
                    properties.push({ parent: parents[parents.length - 1]!, name: name.split('.').pop()! });
                    return;
                }
                // `createComponentInstance`: `instanceModule[elementName]` of the module the
                // namespace resolves to.
                const library = LIBRARIES[event.namespace ?? ''];
                if (library === undefined) throw new Error(`<${event.prefix}:${name}> names no barrel`);
                const view = new (elementFor(`${library}${name}`).ctor)();
                // `applyComponentAttributes`: `instance[attr] = value`. A prefixed attribute
                // (`xmlns:adw`) is a platform filter there and never reaches the instance; the
                // default `xmlns` is assigned like any other, so it is skipped here as dead.
                for (const [attribute, value] of Object.entries(event.attributes ?? {})) {
                    if (attribute === 'xmlns' || attribute.includes(':')) continue;
                    (view as unknown as Record<string, unknown>)[attribute] = value;
                }
                const parent = parents[parents.length - 1] as unknown as BuilderParent | undefined;
                const property = properties[properties.length - 1];
                if (parent === undefined) root = view;
                else if (property !== undefined && property.parent === (parent as unknown as View)) {
                    parent._addChildFromBuilder(property.name, view);
                } else parent._addChildFromBuilder(name, view);
                parents.push(view);
            } else if (event.eventType === ParserEventType.EndElement) {
                if (name.includes('.')) properties.pop();
                else parents.pop();
            }
        },
        (error) => {
            throw error;
        },
        true,
    );
    parser.parse(xml);
    if (root === undefined) throw new Error('the template has no root element');
    return root;
}

/** Every node of a tree that carries an id. */
const withIds = (node: SharedTreeNode, into: SharedTreeNode[] = []): SharedTreeNode[] => {
    if (node.id !== undefined) into.push(node);
    for (const child of node.children ?? []) withIds(child, into);
    return into;
};

export const AdwBlueprintMarkupNsTest = async () => {
    await describe('the gallery’s NativeScript XML, loaded through the XML door', async () => {
        for (const [file, tree] of Object.entries(GALLERY_BLUEPRINTS)) {
            await it(`${file}: every id resolves to the view build() makes, with its props`, () => {
                const loaded = loadXml(sharedTreeNativeScriptXml(tree));
                const built = build(tree);
                const nodes = withIds(tree);
                expect(nodes.length > 0).toBe(true);
                for (const node of nodes) {
                    const fromXml = loaded.getViewById(node.id!) as unknown as Record<string, unknown> | undefined;
                    const fromTree = built.getViewById(node.id!) as unknown as Record<string, unknown> | undefined;
                    expect(fromXml?.constructor.name).toBe(node.tag);
                    expect(fromXml?.constructor).toBe(fromTree?.constructor);
                    for (const prop of Object.keys(node.props ?? {})) {
                        const member = propertyOf(prop);
                        expect(String(fromXml?.[member])).toBe(String(fromTree?.[member]));
                    }
                    expect(JSON.stringify(fromXml?.styleClasses)).toBe(JSON.stringify(fromTree?.styleClasses));
                }
            });
        }
    });
};
