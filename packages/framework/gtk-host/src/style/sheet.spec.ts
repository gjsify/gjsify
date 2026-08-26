// The generated stylesheet, against a real GTK CSS parser.
//
// Two of these vectors exist because of a failure mode that produces NO error at
// all: a rule GTK accepts but which ends the document, taking every rule after it
// with it. An application then loses its styling wholesale and nothing anywhere
// says why. The containment probe is the only thing that sees it, so the vector
// that drives it is the one this file is really for.

import Gtk from 'gi://Gtk?version=4.0';
import { expect, it, on } from '@gjsify/unit';

import { StyleSheet, StyleSheetError } from './sheet.js';
import { GTK_HOSTS, gated } from '../testing/gate.mjs';
import { installDiagnosticsGate } from '../conformance/index.js';

const threw = (fn: () => unknown): StyleSheetError => {
    try {
        fn();
    } catch (error) {
        if (error instanceof StyleSheetError) return error;
        throw error;
    }
    throw new Error('expected a StyleSheetError, nothing was thrown');
};

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        const diagnostics = installDiagnosticsGate();

        await gated(diagnostics, 'the generated stylesheet', async () => {
            await it('gives identical declarations one class and one rule', async () => {
                // A per-element name is the shape that makes a long list re-parse the
                // whole document per row, so sharing is the behaviour, not an
                // optimisation to be added later.
                const sheet = new StyleSheet();
                const first = sheet.classFor(['color: rgb(1 2 3)']);
                const second = sheet.classFor(['color: rgb(1 2 3)']);
                expect(second).toBe(first);
                expect(sheet.size).toBe(1);
            });

            await it('gives different declarations different classes', async () => {
                const sheet = new StyleSheet();
                const a = sheet.classFor(['color: rgb(1 2 3)']);
                const b = sheet.classFor(['color: rgb(4 5 6)']);
                expect(a === b).toBe(false);
                expect(sheet.size).toBe(2);
            });

            await it('emits a variant as a pseudo-class on the same name', async () => {
                // This is what makes a pressed style free: GTK animates `:active`
                // itself, so nothing reaches the reconciler when a finger goes down.
                const sheet = new StyleSheet();
                const name = sheet.classFor(['opacity: 1'], { active: ['opacity: 0.7'] });
                const document = sheet.toString();
                expect(document).toContain(`.${name} {`);
                expect(document).toContain(`.${name}:active {`);
            });

            await it('refuses a variant it cannot express, naming the ones it can', async () => {
                const sheet = new StyleSheet();
                const error = threw(() => sheet.classFor(['opacity: 1'], { 'group-hover': ['opacity: 0.5'] }));
                expect(error.message).toContain('group-hover');
                expect(error.message).toContain('active');
            });

            await it('refuses a declaration GTK rejects, instead of loading it', async () => {
                // Without this the declaration is dropped by GTK's own recovery and
                // the widget is simply painted without it — green run, wrong window.
                const sheet = new StyleSheet();
                expect(threw(() => sheet.classFor(['text-align: center'])).message).toContain('text-align');
            });

            await it('refuses a rule that would disable every rule after it', async () => {
                // The failure with no error attached. An unterminated string ends the
                // document, and everything that follows is silently absent — which
                // presents as "the application lost its styling", nowhere near the
                // rule that caused it.
                const sheet = new StyleSheet();
                const error = threw(() => sheet.classFor(['font-family: "unterminated']));
                expect(error.message).toContain('disable every rule after it');
            });

            await it('keeps the document loadable after a refusal', async () => {
                // A refusal must not poison the sheet: the rule never joined the
                // document, so what was already there still loads.
                const sheet = new StyleSheet();
                const good = sheet.classFor(['color: rgb(1 2 3)']);
                threw(() => sheet.classFor(['font-family: "unterminated']));
                expect(sheet.size).toBe(1);
                expect(sheet.toString()).toContain(good);
                sheet.flush();
            });

            await it('refuses an empty class rather than naming nothing', async () => {
                const sheet = new StyleSheet();
                expect(threw(() => sheet.classFor([])).message).toContain('no declarations');
            });
        });
    });
};
