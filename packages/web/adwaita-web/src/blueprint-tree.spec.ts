// ONE `.blp`, RENDERED BY THIS RENDERER — the acceptance case for ADR 0053 clause 1's second
// exit, taken all the way through a build.
//
// `./shared-trees.spec.ts` drives ADR 0051's corpus, which is authored as `SharedTreeNode`
// literals in `scripts/adwaita-gallery-shared-trees.mjs`. This file drives the OTHER reader of
// the same shape: a Blueprint file, parsed and projected by `@gjsify/blueprint` and handed over
// by `@gjsify/vite-plugin-blueprint`'s `?shared-tree` exit at build time. So what is under test
// is not the builder — that is the sibling's job — it is the JOIN: that a `.blp` a GTK showcase
// actually ships arrives on this target as a tree this renderer mounts, with the fields ADRs
// 0066, 0067 and 0068 put on the node still on it — `template`/`object-id`, the translatable
// marking, and the style classes. Naming two of the three read as a complete list once 0068
// landed, which is how a reader learns a field is not carried when it is.
//
// WHY A SHIPPED FILE AND NOT A FIXTURE. A fixture written for this test would be written to
// pass it. `showcases/gtk/effect-adw-services/src/window.blp` is a real interface — an
// `Adw.ToolbarView` with a header bar, a clamp, three preference groups and named rows — and one
// of the shipped `.blp` whose projection declares NO loss, so nothing about it is refused before
// it can be rendered. The reach across the tree is the shape the NativeScript driver already uses
// for the corpus module (`packages/nativescript-bridge/adwaita/src/shared-trees.spec.ts`), for
// the same reason: the thing under test lives outside the package that renders it.
//
// WHAT THIS MEASURED THAT NOTHING HAD, AND WHAT CLOSED IT: SLOT PLACEMENT WAS NOT CARRIED, AND
// IT COST CAPTIONS. `SharedTreeNode.slot` was on the node shape and read by none of the three
// tree builders. That went unnoticed because ADR 0051's seven-block corpus authors zero slots —
// a `.blp` is the first source that authors any, and this one authors four. The two cases below
// were `it.failing` markers for exactly this gap — the header bar authored `[top]` landing in the
// toolbar view's CONTENT instead, and the `title-widget:` window title then discarded by
// `adw-header-bar`'s own build, which derives a title element of its own when its centre is
// empty — until the builders were given a slot reader (`shared-tree-builder.ts`,
// `adw-header-bar.ts`, `adw-toolbar-view.ts`); both are plain `it()` now that placement holds.
//
// Giving `slot` a reader is a SHARED-VOCABULARY decision and not wiring: `content:`, `[top]` and
// `title-widget:` are GtkBuilder's names, this renderer's are the unnamed slot, `top` and
// `center`, and a table mapping one to the other inside one renderer is the per-surface
// translator ADR 0051 § Alternatives rejected turned down on a measurement. Tracked in
// `status/open-todos.md`.

import { describe, expect, it } from '@gjsify/unit';

import { hostTagOf } from '@gjsify/adwaita-core/tags';

import { mountSharedTree } from './shared-tree-builder.js';

// The build seam itself. `?shared-tree` is the projection; the same file without the query is
// the GtkBuilder XML the GTK showcase compiles, and neither import moves the other.
import windowTree from '../../../../showcases/gtk/effect-adw-services/src/window.blp?shared-tree';

type Node = typeof windowTree;

/** Every tag the authored tree names, in document order, so nothing is transcribed. */
const authoredTags = (node: Node, into: string[] = []): string[] => {
    into.push(node.tag);
    for (const child of node.children ?? []) authoredTags(child, into);
    return into;
};

/** Every prop value the source marked `_()`, read off the tree rather than off the `.blp`. */
const markedCaptions = (node: Node, into: string[] = []): string[] => {
    for (const prop of Object.keys(node.translatable ?? {})) into.push(String(node.props?.[prop]));
    for (const child of node.children ?? []) markedCaptions(child, into);
    return into;
};

export const AdwBlueprintTreeTest = async () => {
    await describe('adwaita-web: a shipped .blp, mounted', async () => {
        await it('arrives as a projected node with its composite class and markings', async () => {
            // The three fields ADRs 0066 and 0067 added are what make a `.blp` worth reading at
            // all: without them the root of every shipped file projected to its PARENT type and
            // said nothing about the class the file is about.
            expect(windowTree.tag).toBe('AdwApplicationWindow');
            expect(windowTree.template).toBe('EffectServicesWindow');
            expect(windowTree.props?.['default-width']).toBe(620);
            expect(windowTree.translatable?.title !== undefined).toBe(true);
            // Seven of the fourteen nodes are placed by slot, which is what makes this file the
            // probe the corpus could not be.
            expect(authoredTags(windowTree).length).toBe(14);
        });

        await it('mounts the content subtree exactly as authored', async () => {
            // FROM THE SCROLLED WINDOW DOWN, and the bound is the measurement rather than
            // convenience: everything the `.blp` places at `content:` on the toolbar view is
            // reached through the UNNAMED slot, which is the one placement this renderer and
            // GtkBuilder spell the same way. Asserting the whole tree here would PASS and prove
            // nothing — `adw-header-bar` derives a title element of its own, so the filtered
            // sequence has one `adw-window-title` either way and the authored one can vanish
            // with the count intact. That node is held by the caption case below instead.
            const { root, unmount } = mountSharedTree(windowTree);
            try {
                const authored = new Set(authoredTags(windowTree).map(hostTagOf));
                const realised = [...root.querySelectorAll('*')]
                    .map((el) => el.localName)
                    .filter((name) => authored.has(name));
                const from = realised.indexOf('gtk-scrolled-window');
                expect(from >= 0).toBe(true);
                expect(realised.slice(from).join(' ')).toBe(
                    'gtk-scrolled-window adw-clamp gtk-box adw-preferences-group adw-entry-row ' +
                        'adw-preferences-group adw-action-row adw-preferences-group adw-action-row adw-action-row',
                );
            } finally {
                unmount();
            }
        });

        await it('upgrades the custom elements it mounted, and carries the authored props', async () => {
            const { root, unmount } = mountSharedTree(windowTree);
            try {
                // UPGRADED, not merely created: an element this package defines is an instance
                // of its own class once connected. An unknown tag would be a plain HTMLElement,
                // and that is what tells the two apart.
                const defined = customElements.get('adw-preferences-group');
                expect(defined !== undefined).toBe(true);
                expect(root.querySelector('adw-preferences-group') instanceof defined!).toBe(true);

                // An authored property, through `attributeOf`'s case rule and nothing else.
                expect(root.getAttribute('default-width')).toBe('620');
                expect(root.querySelector('adw-clamp')?.getAttribute('maximum-size')).toBe('560');

                // And a caption that reached the SCREEN, not just an attribute: the element read
                // it on connect and wrote it into its own label.
                expect(root.querySelector('adw-preferences-group .adw-preferences-group-title')?.textContent).toBe(
                    'Read a directory',
                );
                expect(root.querySelector('adw-action-row .adw-row-subtitle')?.textContent).toBe('Type a path above.');
            } finally {
                unmount();
            }
        });

        await it('places a [top] child in the bar the .blp named', async () => {
            const { root, unmount } = mountSharedTree(windowTree);
            try {
                const headerBar = root.querySelector('adw-header-bar');
                expect(headerBar?.parentElement?.className).toBe('adw-toolbar-view-top');
            } finally {
                unmount();
            }
        });

        await it('renders every caption the .blp marks for translation', async () => {
            const { root, unmount } = mountSharedTree(windowTree);
            try {
                const text = root.textContent ?? '';
                const missing = markedCaptions(windowTree).filter((caption) => !text.includes(caption));
                expect(missing.join(' | ')).toBe('');
            } finally {
                unmount();
            }
        });
    });
};
