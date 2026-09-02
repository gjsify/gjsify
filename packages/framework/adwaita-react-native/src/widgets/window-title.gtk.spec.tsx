/** @jsxImportSource @gjsify/gtk-host/react */
// The GTK half of `AdwWindowTitle`, against the libadwaita that is installed.
//
// THE ASSERTION IS THE LABELS' `visible`, NOT THE PROPERTIES. Reading `wt.title` back
// proves a string was written and nothing else; what the widget IS is the binding from
// each label's `visible` to `string_is_not_empty` (adw-window-title.ui:15, the closure at
// adw-window-title.c:207), and that is what `window-title.native.spec.tsx` reproduces in
// TypeScript. So this suite walks to the two real `GtkLabel`s and reads the decision C
// made — including the row that catches a `trim()`: a title of THREE SPACES is VISIBLE,
// because the closure reads the first byte and never trims.
//
// The harness (window, pump, tree search, diagnostics gate) is `../testing/gtk.spec.tsx`.

import type Gtk from 'gi://Gtk?version=4.0';
import { expect, it } from '@gjsify/unit';
import { gtkChildren } from '@gjsify/gtk-host/conformance';

import { find, laidOut, typeOf, withGtk } from '../testing/gtk.spec.js';
import { AdwWindowTitle } from './window-title.gtk.js';

/** Every `GtkLabel` under a widget, in tree order — the title first, the subtitle second. */
function labels(root: Gtk.Widget): Gtk.Label[] {
    const found: Gtk.Label[] = [];
    for (const child of gtkChildren(root)) {
        if (typeOf(child) === 'GtkLabel') found.push(child as Gtk.Label);
        found.push(...labels(child));
    }
    return found;
}

export default async () => {
    await withGtk(async ({ gated }) => {
        await gated('AdwWindowTitle is the real widget, carrying both properties', async () => {
            await it('writes title and subtitle onto an Adw.WindowTitle', async () => {
                laidOut(<AdwWindowTitle title="Document" subtitle="Edited" />, (container) => {
                    const title = find(container, 'AdwWindowTitle') as unknown as {
                        title: string;
                        subtitle: string;
                    };
                    expect(title.title).toBe('Document');
                    expect(title.subtitle).toBe('Edited');
                });
            });

            await it('leaves an omitted property on libadwaita’s own default', async () => {
                // `undefined` is never written, so this reads the INSTALLED default
                // rather than a transcription of it — the rule `clamp.gtk.tsx` states.
                laidOut(<AdwWindowTitle title="Document" />, (container) => {
                    const title = find(container, 'AdwWindowTitle') as unknown as { subtitle: string };
                    expect(title.subtitle).toBe('');
                });
            });
        });

        await gated('the visibility rule both halves answer alike', async () => {
            await it('has exactly two labels, and shows both when both are set', async () => {
                laidOut(<AdwWindowTitle title="Document" subtitle="Edited" />, (container) => {
                    const both = labels(find(container, 'AdwWindowTitle'));
                    expect(both.length).toBe(2);
                    expect(both.map((label) => label.label)).toStrictEqual(['Document', 'Edited']);
                    expect(both.map((label) => label.get_visible())).toStrictEqual([true, true]);
                });
            });

            await it('hides the TITLE label when the title is empty', async () => {
                // The rule neither renderer had: only the subtitle was ever hidden, so a
                // header bar with a subtitle and no title reserved a blank line above it.
                laidOut(<AdwWindowTitle title="" subtitle="Edited" />, (container) => {
                    const both = labels(find(container, 'AdwWindowTitle'));
                    expect(both.map((label) => label.get_visible())).toStrictEqual([false, true]);
                });
            });

            await it('hides the subtitle label when the subtitle is empty', async () => {
                laidOut(<AdwWindowTitle title="Document" subtitle="" />, (container) => {
                    const both = labels(find(container, 'AdwWindowTitle'));
                    expect(both.map((label) => label.get_visible())).toStrictEqual([true, false]);
                });
            });

            await it('keeps a title of three SPACES visible — the closure never trims', async () => {
                // `string_is_not_empty` is `string && string[0]`: one byte. A `trim()` in
                // a port hides a label GTK draws, and the React Native half asserts the
                // same row.
                laidOut(<AdwWindowTitle title="   " subtitle="" />, (container) => {
                    const both = labels(find(container, 'AdwWindowTitle'));
                    expect(both[0]?.label).toBe('   ');
                    expect(both.map((label) => label.get_visible())).toStrictEqual([true, false]);
                });
            });
        });
    });
};
