// The custom-element markup of the `index.html` file the gallery's Web Components tab shows for
// a one-Blueprint block, PARSED back by the browser and held to the tree `buildSharedTree`
// makes from the same `.blp`.
//
// The website renders that markup with `@gjsify/adwaita-core/markup` from the block's
// `?shared-tree` projection, on every build. Markup a reader copies has to build the same
// widget: an attribute spelled against `attributeOf`, a boolean written as `"true"` where the
// element reads presence, or a slot dropped would each parse fine and mount something else. So every `.blp` under
// `website/src/blueprints/` is imported below — `scripts/check-website-blueprint-markup.mjs`
// fails on one that is not.

import { describe, expect, it } from '@gjsify/unit';

import type { SharedTreeNode } from '@gjsify/adwaita-core/conformance';
import { sharedTreeHtml } from '@gjsify/adwaita-core/markup';
import { hostTagOf } from '@gjsify/adwaita-core/tags';

import adwaitaActionRowTree from '../../../../website/src/blueprints/adwaita/action-row.blp?shared-tree';
import adwaitaAvatarTree from '../../../../website/src/blueprints/adwaita/avatar.blp?shared-tree';
import adwaitaBannerTree from '../../../../website/src/blueprints/adwaita/banner.blp?shared-tree';
import adwaitaBottomSheetTree from '../../../../website/src/blueprints/adwaita/bottom-sheet.blp?shared-tree';
import adwaitaButtonContentTree from '../../../../website/src/blueprints/adwaita/button-content.blp?shared-tree';
import adwaitaButtonRowTree from '../../../../website/src/blueprints/adwaita/button-row.blp?shared-tree';
import adwaitaCarouselTree from '../../../../website/src/blueprints/adwaita/carousel.blp?shared-tree';
import clampTree from '../../../../website/src/blueprints/adwaita/clamp.blp?shared-tree';
import adwaitaComboRowTree from '../../../../website/src/blueprints/adwaita/combo-row.blp?shared-tree';
import adwaitaEntryRowTree from '../../../../website/src/blueprints/adwaita/entry-row.blp?shared-tree';
import adwaitaExpanderRowTree from '../../../../website/src/blueprints/adwaita/expander-row.blp?shared-tree';
import adwaitaHeaderBarTree from '../../../../website/src/blueprints/adwaita/header-bar.blp?shared-tree';
import adwaitaNavigationSplitViewTree from '../../../../website/src/blueprints/adwaita/navigation-split-view.blp?shared-tree';
import adwaitaNavigationViewTree from '../../../../website/src/blueprints/adwaita/navigation-view.blp?shared-tree';
import adwaitaOverlaySplitViewTree from '../../../../website/src/blueprints/adwaita/overlay-split-view.blp?shared-tree';
import adwaitaPasswordEntryRowTree from '../../../../website/src/blueprints/adwaita/password-entry-row.blp?shared-tree';
import adwaitaPreferencesGroupTree from '../../../../website/src/blueprints/adwaita/preferences-group.blp?shared-tree';
import adwaitaShortcutLabelTree from '../../../../website/src/blueprints/adwaita/shortcut-label.blp?shared-tree';
import adwaitaSidebarTree from '../../../../website/src/blueprints/adwaita/sidebar.blp?shared-tree';
import adwaitaSpinRowTree from '../../../../website/src/blueprints/adwaita/spin-row.blp?shared-tree';
import adwaitaSplitButtonTree from '../../../../website/src/blueprints/adwaita/split-button.blp?shared-tree';
import adwaitaStatusPageTree from '../../../../website/src/blueprints/adwaita/status-page.blp?shared-tree';
import adwaitaSwitchRowTree from '../../../../website/src/blueprints/adwaita/switch-row.blp?shared-tree';
import adwaitaToggleGroupTree from '../../../../website/src/blueprints/adwaita/toggle-group.blp?shared-tree';
import adwaitaToolbarViewTree from '../../../../website/src/blueprints/adwaita/toolbar-view.blp?shared-tree';
import adwaitaViewSwitcherBarTree from '../../../../website/src/blueprints/adwaita/view-switcher-bar.blp?shared-tree';
import adwaitaWindowTitleTree from '../../../../website/src/blueprints/adwaita/window-title.blp?shared-tree';
import adwaitaWrapBoxTree from '../../../../website/src/blueprints/adwaita/wrap-box.blp?shared-tree';
import gtkButtonTree from '../../../../website/src/blueprints/gtk/button.blp?shared-tree';
import gtkMenuButtonTree from '../../../../website/src/blueprints/gtk/menu-button.blp?shared-tree';

import { buildSharedTree } from './shared-tree-builder.js';

/** Every one-Blueprint `.blp` of the gallery, by its path under `website/src/blueprints/`. */
export const GALLERY_BLUEPRINTS: Readonly<Record<string, SharedTreeNode>> = {
    'adwaita/action-row.blp': adwaitaActionRowTree,
    'adwaita/avatar.blp': adwaitaAvatarTree,
    'adwaita/banner.blp': adwaitaBannerTree,
    'adwaita/bottom-sheet.blp': adwaitaBottomSheetTree,
    'adwaita/button-content.blp': adwaitaButtonContentTree,
    'adwaita/button-row.blp': adwaitaButtonRowTree,
    'adwaita/carousel.blp': adwaitaCarouselTree,
    'adwaita/clamp.blp': clampTree,
    'adwaita/combo-row.blp': adwaitaComboRowTree,
    'adwaita/entry-row.blp': adwaitaEntryRowTree,
    'adwaita/expander-row.blp': adwaitaExpanderRowTree,
    'adwaita/header-bar.blp': adwaitaHeaderBarTree,
    'adwaita/navigation-split-view.blp': adwaitaNavigationSplitViewTree,
    'adwaita/navigation-view.blp': adwaitaNavigationViewTree,
    'adwaita/overlay-split-view.blp': adwaitaOverlaySplitViewTree,
    'adwaita/password-entry-row.blp': adwaitaPasswordEntryRowTree,
    'adwaita/preferences-group.blp': adwaitaPreferencesGroupTree,
    'adwaita/shortcut-label.blp': adwaitaShortcutLabelTree,
    'adwaita/sidebar.blp': adwaitaSidebarTree,
    'adwaita/spin-row.blp': adwaitaSpinRowTree,
    'adwaita/split-button.blp': adwaitaSplitButtonTree,
    'adwaita/status-page.blp': adwaitaStatusPageTree,
    'adwaita/switch-row.blp': adwaitaSwitchRowTree,
    'adwaita/toggle-group.blp': adwaitaToggleGroupTree,
    'adwaita/toolbar-view.blp': adwaitaToolbarViewTree,
    'adwaita/view-switcher-bar.blp': adwaitaViewSwitcherBarTree,
    'adwaita/window-title.blp': adwaitaWindowTitleTree,
    'adwaita/wrap-box.blp': adwaitaWrapBoxTree,
    'gtk/button.blp': gtkButtonTree,
    'gtk/menu-button.blp': gtkMenuButtonTree,
};

/**
 * An attribute's value as the comparison reads it. `style` is read as the declarations it
 * sets, one longhand each and sorted: which of the builder's margin and an element's own
 * `flex-direction` was written first, and whether the serialiser folds two margins into a
 * `margin-inline`, is text neither side chose and no style resolves differently for.
 */
const attributeText = (el: Element, attribute: Attr): string => {
    if (attribute.name !== 'style') return attribute.value;
    const style = (el as HTMLElement).style;
    return [...style]
        .map((property) => `${property}: ${style.getPropertyValue(property)}`)
        .sort()
        .join('; ');
};

/**
 * An element tree as text a comparison can hold: the tag, the attributes SORTED (their order is
 * the one thing markup and a builder may legitimately disagree on, and no element reads it), and
 * the children, with the indentation between elements dropped since the builder never makes any.
 */
const canonical = (el: Element, depth = 0): string => {
    const attributes = [...el.attributes].map((a) => `${a.name}=${JSON.stringify(attributeText(el, a))}`).sort();
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
