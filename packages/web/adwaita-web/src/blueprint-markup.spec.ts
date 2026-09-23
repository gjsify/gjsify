// The custom-element markup the gallery's Web Components tab shows for a one-Blueprint block,
// PARSED back by the browser and held to the tree `buildSharedTree` makes from the same `.blp`.
//
// The website renders that markup with `@gjsify/adwaita-core/markup` from the block's
// `?shared-tree` projection, on every build. Markup a reader copies has to build the same widget: an attribute spelled
// against `attributeOf`, a boolean written as `"true"` where the element reads presence, or
// a slot dropped would each parse fine and mount something else. So every `.blp` under
// `website/src/blueprints/` is imported below — `scripts/check-website-blueprint-markup.mjs`
// fails on one that is not.

import { describe, expect, it } from '@gjsify/unit';

import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';
import { sharedTreeHtml } from '@gjsify/adwaita-core/markup';
import { hostTagOf } from '@gjsify/adwaita-core/tags';

import clampTree from '../../../../website/src/blueprints/adwaita/clamp.blp?shared-tree';

import { buildSharedTree } from './shared-tree-builder.js';

/** Every one-Blueprint `.blp` of the gallery, by its path under `website/src/blueprints/`. */
export const GALLERY_BLUEPRINTS: Readonly<Record<string, SharedTreeNode>> = {
    'adwaita/clamp.blp': clampTree,
};

/**
 * An element tree as text a comparison can hold: the tag, the attributes SORTED (their order is
 * the one thing markup and a builder may legitimately disagree on, and no element reads it), and
 * the children, with the indentation between elements dropped since the builder never makes any.
 */
const canonical = (el: Element, depth = 0): string => {
    const attributes = [...el.attributes].map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort();
    const pad = '  '.repeat(depth);
    const lines = [`${pad}<${el.localName}${attributes.map((a) => ` ${a}`).join('')}>`];
    for (const node of el.childNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) lines.push(canonical(node as Element, depth + 1));
        else if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim() !== '') {
            lines.push(`${pad}  ${JSON.stringify(node.textContent)}`);
        }
    }
    return lines.join('\n');
};

const withIds = (node: SharedTreeNode, into: SharedTreeNode[] = []): SharedTreeNode[] => {
    if (node.id !== undefined) into.push(node);
    for (const child of node.children ?? []) withIds(child, into);
    return into;
};

export const AdwBlueprintMarkupTest = async () => {
    await describe('adwaita-web: the gallery’s markup, parsed', async () => {
        for (const [file, tree] of Object.entries(GALLERY_BLUEPRINTS)) {
            // Both sides DETACHED and upgraded: a detached build runs each element's constructor
            // and attribute callbacks (a label renders its text on `label=`), and so does parsing
            // in this document. Neither is connected, so what differs is only what was authored.
            await it(`${file}: parses to the element tree buildSharedTree makes`, async () => {
                const parsed = document.createRange().createContextualFragment(sharedTreeHtml(tree));
                expect(canonical(parsed.firstElementChild!)).toBe(canonical(buildSharedTree(tree)));
            });

            await it(`${file}: mounted, every id reaches an upgraded element of its tag`, async () => {
                const host = document.createElement('div');
                host.innerHTML = sharedTreeHtml(tree);
                document.body.append(host);
                try {
                    const nodes = withIds(tree);
                    expect(nodes.length > 0).toBe(true);
                    for (const node of nodes) {
                        const found = host.querySelector(`#${node.id}`);
                        const tag = hostTagOf(node.tag);
                        expect(found?.localName).toBe(tag);
                        const defined = customElements.get(tag);
                        expect(defined !== undefined && found instanceof defined).toBe(true);
                    }
                } finally {
                    host.remove();
                }
            });
        }
    });
};
