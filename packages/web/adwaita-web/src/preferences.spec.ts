// DOM-level conformance tests for <adw-preferences-group> and
// <adw-preferences-dialog>, driven by the SAME vectors the NativeScript
// renderer asserts against (`@gjsify/adwaita-core/conformance`).
//
// Two things are held here. The GROUP HEADER has five states, all five derived: an empty
// group must not paint a `.boxed-list` card (its `box-shadow` strokes a full-width
// hairline over nothing) and a one-line header carries the `single-line` class the
// stylesheet keys its metrics off. The SEARCH needs the page elements to survive — a
// dialog that hoists every page's children out and discards the pages leaves nothing to
// derive `General → Appearance` from.
import { describe, expect, it } from '@gjsify/unit';

import {
    PREFERENCES_GROUP_HEADER_VECTORS,
    PREFERENCES_SEARCH_PAGES,
    PREFERENCES_SEARCH_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import type { PreferencesSearchPage } from '@gjsify/adwaita-core';

import type { AdwPreferencesGroup } from './elements/adw-preferences-group.js';
import type { AdwPreferencesDialog, AdwPreferencesPage } from './elements/adw-preferences-dialog.js';

/** Let a `MutationObserver` deliver — its records arrive on a microtask. */
const flushMutations = () => new Promise<void>((resolve) => queueMicrotask(() => resolve()));

/** Mount a group with a title / description / suffix / row count. */
function mountGroup(options: {
    title?: string | null;
    description?: string | null;
    hasHeaderSuffix?: boolean;
    rowCount?: number;
}): { group: AdwPreferencesGroup; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const group = document.createElement('adw-preferences-group') as AdwPreferencesGroup;
    if (options.hasHeaderSuffix) {
        const suffix = document.createElement('button');
        suffix.setAttribute('slot', 'header-suffix');
        suffix.textContent = 'Sign out';
        group.appendChild(suffix);
    }
    for (let index = 0; index < (options.rowCount ?? 0); index++) {
        const row = document.createElement('adw-action-row');
        row.setAttribute('title', `Row ${index}`);
        group.appendChild(row);
    }

    host.appendChild(group);
    // Set AFTER connect to exercise the attribute path, and via setAttribute so exact
    // whitespace survives (` ` is a visible title).
    if (options.title !== undefined && options.title !== null) group.setAttribute('title', options.title);
    if (options.description !== undefined && options.description !== null) {
        group.setAttribute('description', options.description);
    }
    return { group, host };
}

/** The five states as this element renders them. */
function renderedState(group: AdwPreferencesGroup) {
    const header = group.querySelector('.adw-preferences-group-header') as HTMLElement;
    const title = group.querySelector('.adw-preferences-group-title') as HTMLElement;
    const description = group.querySelector('.adw-preferences-group-description') as HTMLElement;
    const listbox = group.querySelector('.adw-preferences-group-listbox') as HTMLElement;
    return {
        titleVisible: !title.hidden,
        descriptionVisible: !description.hidden,
        headerVisible: !header.hidden,
        singleLine: header.classList.contains('single-line'),
        listboxVisible: !listbox.hidden,
    };
}

/** Build the shared conformance tree as real elements inside a dialog. */
function mountSearchDialog(pages: readonly PreferencesSearchPage[]): {
    dialog: AdwPreferencesDialog;
    host: HTMLElement;
} {
    const host = document.createElement('div');
    document.body.appendChild(host);

    const dialog = document.createElement('adw-preferences-dialog') as AdwPreferencesDialog;
    host.appendChild(dialog);

    for (const page of pages) {
        const pageEl = document.createElement('adw-preferences-page') as AdwPreferencesPage;
        if (page.name) pageEl.setAttribute('name', page.name);
        pageEl.setAttribute('title', page.title ?? '');
        if (page.useUnderline) pageEl.setAttribute('use-underline', '');
        if (page.visible === false) pageEl.hidden = true;

        for (const group of page.groups) {
            const groupEl = document.createElement('adw-preferences-group') as AdwPreferencesGroup;
            groupEl.setAttribute('title', group.title ?? '');
            if (group.visible === false) groupEl.hidden = true;

            for (const row of group.rows) {
                // An action row has a searchable subtitle and an entry row does not — the
                // point of the vector.
                const rowEl = document.createElement(row.isActionRow ? 'adw-action-row' : 'adw-entry-row');
                rowEl.setAttribute('title', row.title);
                if (row.subtitle) rowEl.setAttribute('subtitle', row.subtitle);
                if (row.visible === false) rowEl.hidden = true;
                groupEl.appendChild(rowEl);
            }
            pageEl.appendChild(groupEl);
        }
        // Through the public add(), i.e. AFTER connect: the path that can leave a page
        // rendering outside the dialog card.
        dialog.add(pageEl);
    }
    return { dialog, host };
}

export const AdwPreferencesTest = async () => {
    await describe('adw-preferences-group header (libadwaita conformance vectors)', async () => {
        for (const vector of PREFERENCES_GROUP_HEADER_VECTORS) {
            // This element paints its labels as text, not as Pango markup, so it
            // derives with `useMarkup: false`; rows whose expectation depends on
            // markup being interpreted are not its to satisfy.
            if (vector.dependsOnMarkup) continue;

            await it(`${JSON.stringify(vector.input)} — ${vector.rule}`, () => {
                const { group, host } = mountGroup(vector.input);
                expect(renderedState(group)).toStrictEqual(vector.state);
                host.remove();
            });
        }

        await it('hides the listbox card of an empty group', () => {
            // The regression: `.adw-preferences-group-listbox` carries
            // background, radius AND `box-shadow: 0 0 0 1px …`, so a zero-height
            // empty list still stroked a full-width hairline.
            const { group, host } = mountGroup({ title: 'Account', rowCount: 0 });
            const listbox = group.querySelector('.adw-preferences-group-listbox') as HTMLElement;
            expect(listbox.hidden).toBe(true);
            host.remove();
        });

        await it('reveals the card again when a row is appended later', async () => {
            const { group, host } = mountGroup({ title: 'Account', rowCount: 0 });
            const listbox = group.querySelector('.adw-preferences-group-listbox') as HTMLElement;
            expect(listbox.hidden).toBe(true);

            const row = document.createElement('adw-action-row');
            row.setAttribute('title', 'Later');
            group.appendChild(row);
            await flushMutations();

            // C wires update_listbox_visibility to the row model's
            // items-changed, so the rule holds over time and not only at build.
            expect(listbox.hidden).toBe(false);
            expect(row.parentElement).toBe(listbox);
            host.remove();
        });

        await it('hides the card again when the last row is removed', async () => {
            const { group, host } = mountGroup({ title: 'Account', rowCount: 1 });
            const listbox = group.querySelector('.adw-preferences-group-listbox') as HTMLElement;
            expect(listbox.hidden).toBe(false);

            group.removeRow(listbox.children[0]!);
            expect(listbox.hidden).toBe(true);
            host.remove();
        });

        await it('refuses to remove a child it does not own', () => {
            const { group, host } = mountGroup({ title: 'Account', rowCount: 1 });
            const foreign = document.createElement('adw-action-row');
            document.body.appendChild(foreign);
            // ADW_CRITICAL_CANNOT_REMOVE_CHILD.
            expect(group.removeRow(foreign)).toBe(false);
            foreign.remove();
            host.remove();
        });

        await it('keeps a single-space title visible', () => {
            // g_strcmp0(text, "") — the visibility test does not trim.
            const { group, host } = mountGroup({ title: ' ' });
            const title = group.querySelector('.adw-preferences-group-title') as HTMLElement;
            expect(title.hidden).toBe(false);
            expect(title.textContent).toBe(' ');
            host.remove();
        });
    });

    await describe('adw-preferences-dialog pages', async () => {
        await it('keeps the page elements, so their identity survives', () => {
            // They used to be discarded: the dialog hoisted every page's
            // childNodes into one clamp, which is why `pageTitle` was inert on
            // web and every search subtitle would have been empty.
            const { dialog, host } = mountSearchDialog(PREFERENCES_SEARCH_PAGES);
            expect(dialog.pages.map((page) => page.name)).toStrictEqual(['general', 'network', 'developer']);
            expect(dialog.pages[0]!.getAttribute('title')).toBe('General');
            host.remove();
        });

        await it('renders a page added after connect INSIDE the dialog card', () => {
            // The old code snapshotted pages once in connectedCallback, so a
            // later page became a sibling of the scrim.
            const { dialog, host } = mountSearchDialog([]);
            const page = document.createElement('adw-preferences-page') as AdwPreferencesPage;
            dialog.add(page);
            expect(page.closest('.adw-preferences-dialog-box')).not.toBe(null);
            host.remove();
        });

        await it('refuses to remove a page it does not own', () => {
            const { dialog, host } = mountSearchDialog([]);
            const foreign = document.createElement('adw-preferences-page') as AdwPreferencesPage;
            expect(dialog.removePage(foreign)).toBe(false);
            host.remove();
        });
    });

    await describe('adw-preferences-dialog search (libadwaita conformance vectors)', async () => {
        for (const { query, results, rule } of PREFERENCES_SEARCH_VECTORS) {
            await it(`${JSON.stringify(query)} → ${results.length} result(s) — ${rule}`, () => {
                const { dialog, host } = mountSearchDialog(PREFERENCES_SEARCH_PAGES);
                expect(
                    dialog.search(query).map((result) => ({ title: result.title, subtitle: result.subtitle })),
                ).toStrictEqual(results.map((result) => ({ title: result.title, subtitle: result.subtitle })));
                host.remove();
            });
        }

        await it('returns the row ELEMENT, so a result can be activated', () => {
            // search_result_activated_cb reveals the page and focuses the row;
            // both come off the result rather than a second DOM query.
            const { dialog, host } = mountSearchDialog(PREFERENCES_SEARCH_PAGES);
            const [result] = dialog.search('strasse');
            expect((result!.row.ref as Element).getAttribute('title')).toBe('Straße');
            expect((result!.page.ref as Element).getAttribute('name')).toBe('network');
            host.remove();
        });

        await it('drops a row from the corpus the moment it is hidden', () => {
            const { dialog, host } = mountSearchDialog(PREFERENCES_SEARCH_PAGES);
            expect(dialog.search('sync over').length).toBe(1);
            const row = dialog.search('sync over')[0]!.row.ref as HTMLElement;
            row.hidden = true;
            // The corpus is derived per call from the live tree, so visibility
            // changes need no invalidation step.
            expect(dialog.search('sync over').length).toBe(0);
            host.remove();
        });
    });
};
