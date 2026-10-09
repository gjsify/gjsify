// A `.blp` that says `GtkSource.View`, built by the shared-tree builder of
// `@gjsify/adwaita-nativescript` — the door an application's own `.blp` takes, so the one
// source file renders on GNOME (Gtk.Builder) and on Android.
//
// On the TREES entry (`src/test.trees.mts`): it builds the real widget classes, which need
// `@nativescript/core` and so run only under that entry's alias onto the platform double.

import { build } from '@gjsify/adwaita-nativescript/builder';
import { describe, expect, it } from '@gjsify/unit';

import './builder.js';
import { GtkSourceBuffer } from '@gjsify/gtksource-core';
import {
    GUTTER_PAINT_VECTORS,
    GTKSOURCE_BUFFER_VECTORS,
    GTKSOURCE_VIEW_SURFACE_VECTORS,
    type GtkSourceBufferLike,
    type GtkSourceViewSurfaceLike,
    type GutterPaintSurface,
} from '@gjsify/gtksource-core/conformance';

import * as GObject from '@gjsify/adwaita-nativescript/gobject';
import * as Gtk from '@gjsify/adwaita-nativescript/gtk';

import * as GtkSource from './namespace/gtksource.js';
import { GtkSourceView } from './view.js';

import tree from './fixtures/source-view.blp?shared-tree';

type Built = Record<string, unknown> & { getViewById(id: string): Built | undefined };

const built = (): Built => build(tree) as unknown as Built;

export const GtkSourceViewTreeNsTest = async () => {
    await describe('GtkSource.View in a shared tree', async () => {
        await it('builds the GtkSourceView class, not a stranger under the Gtk prefix', () => {
            const view = built().getViewById('sourceView');
            expect(view instanceof GtkSourceView).toBe(true);
            expect(view?.constructor.name).toBe('GtkSourceView');
        });

        await it("writes the authored properties through the view's coercing setters", () => {
            const view = built().getViewById('sourceView') as unknown as GtkSourceView | undefined;
            expect(view?.autoIndent).toBe(true);
            expect(view?.indentWidth).toBe(4);
            expect(view?.showLineNumbers).toBe(true);
            expect(view?.highlightCurrentLine).toBe(true);
            expect(view?.monospace).toBe(true);
            expect(view?.editable).toBe(false);
            expect(view?.leftMargin).toBe(12);
            expect(view?.bottomMargin).toBe(12);
        });

        await it('takes a `buffer:` object child with its authored text', () => {
            const view = built().getViewById('sourceView') as unknown as GtkSourceView | undefined;
            expect(view?.buffer instanceof GtkSourceBuffer).toBe(true);
            expect(view?.buffer.text).toBe('LDA #$01\nSTA $0200');
            expect(view?.buffer.highlightSyntax).toBe(false);
        });

        for (const vector of GTKSOURCE_BUFFER_VECTORS) {
            await it(`GtkSource.Buffer: ${vector.rule}`, () => {
                expect(vector.observe(GtkSource as unknown as GtkSourceBufferLike)).toStrictEqual(vector.shows);
            });
        }

        // A pass needs pixels; the device runs the rest, so only what is observable without one is proved here.
        for (const vector of GUTTER_PAINT_VECTORS.filter((candidate) => !candidate.paints)) {
            await it(`gutter: ${vector.rule}`, async () => {
                const never = () => Promise.reject(new Error('a vector without a pass does not present a view'));
                expect(
                    await vector.observe({ Gtk, GtkSource, GObject } as unknown as GutterPaintSurface, {
                        present: never,
                        settle: never,
                    }),
                ).toStrictEqual(vector.shows);
            });
        }

        for (const vector of GTKSOURCE_VIEW_SURFACE_VECTORS) {
            await it(`surface: ${vector.rule}`, () => {
                expect(vector.observe({ Gtk, GtkSource } as unknown as GtkSourceViewSurfaceLike)).toStrictEqual(
                    vector.shows,
                );
            });
        }

        await it('answers the GtkWidget layout properties the scrolled window asks it for', () => {
            const view = built().getViewById('sourceView') as unknown as GtkSourceView | undefined;
            expect(view?.hexpand).toBe(true);
            expect(view?.vexpand).toBe(true);
        });
    });
};
