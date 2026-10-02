// Browser port of the Tree Expander story. Shares metadata with tree-expander.story.ts.
//
// The GTK rendering gets its rows from a `Gtk.TreeListModel`; this one declares the same
// rows directly, because the browser element takes the three numbers it would have read
// off a `Gtk.TreeListRow` as attributes (ADR 0089). Same tree, same depths, same leaves.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { TREE_EXPANDER_TREE, treeExpanderMeta } from '../../presentation/tree-expander.meta.js';

interface TreeRow {
    readonly label: string;
    readonly depth: number;
    readonly expandable: boolean;
}

/** The tree flattened to rows, parents before their children. */
const ROWS: readonly TreeRow[] = Object.entries(TREE_EXPANDER_TREE).flatMap(([parent, children]) => [
    { label: parent, depth: 0, expandable: children.length > 0 },
    ...children.map((child) => ({ label: child, depth: 1, expandable: false })),
]);

export class TreeExpanderWebStory extends StoryElement {
    private _expanders: HTMLElement[] = [];

    constructor() {
        super(TreeExpanderWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return treeExpanderMeta;
    }

    initialize(): void {
        const list = document.createElement('gtk-box');
        list.setAttribute('orientation', 'vertical');
        list.setAttribute('spacing', '6');
        for (const row of ROWS) {
            const expander = document.createElement('gtk-tree-expander');
            expander.setAttribute('depth', String(row.depth));
            expander.toggleAttribute('expandable', row.expandable);
            const label = document.createElement('gtk-label');
            label.setAttribute('label', row.label);
            expander.appendChild(label);
            list.appendChild(expander);
            this._expanders.push(expander);
        }
        this._apply();
        this.addContent(list);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        const expanded = this.args.expanded as boolean;
        this._expanders.forEach((expander, index) => {
            expander.toggleAttribute('expanded', expanded);
            expander.toggleAttribute('hide-expander', this.args.hideExpander as boolean);
            expander.setAttribute('indent-for-icon', String(this.args.indentForIcon as boolean));
            // A collapsed parent's children are not in a `GtkTreeListModel` at all, so the
            // rows go with the arrow rather than only the arrow turning.
            if (ROWS[index]!.depth > 0) expander.hidden = !expanded;
        });
    }
}

export const TreeExpanderWebStories: WebStoryModule = { stories: [TreeExpanderWebStory] };
