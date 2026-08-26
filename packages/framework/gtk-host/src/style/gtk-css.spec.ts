// The measured CSS table, re-measured against the GTK that is running.
//
// `gtk-css.ts` is a claim about another program. Committing it as data is what makes
// the partition testable without a display, but data that nothing re-checks is a
// claim that decays: a GTK upgrade that adds `text-align` or removes `line-height`
// would leave the table describing a version nobody runs, and the partition would go
// on emitting declarations GTK drops in silence.
//
// So this asserts BOTH directions against a real `Gtk.CssProvider`. The negative
// direction is the load-bearing one: without it the table could list every property
// in CSS and still pass.

import Gtk from 'gi://Gtk?version=4.0';
import { expect, it, on } from '@gjsify/unit';

import { GTK_CSS_PROBES, NOT_GTK_CSS } from './gtk-css.js';
import { GTK_HOSTS, gated } from '../testing/gate.mjs';
import { installDiagnosticsGate } from '../conformance/index.js';

/** Load one declaration and report the parser's own verdict. */
function parseError(property: string, value: string): string | null {
    const provider = new Gtk.CssProvider();
    let message: string | null = null;
    const handler = provider.connect('parsing-error', (_provider, _section, error) => {
        message = error.message;
    });
    provider.load_from_string(`.probe { ${property}: ${value}; }`);
    provider.disconnect(handler);
    return message;
}

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        const diagnostics = installDiagnosticsGate();

        await gated(diagnostics, 'the measured GTK CSS table', async () => {
            await it('GTK accepts every property the table claims it accepts', async () => {
                const rejected = GTK_CSS_PROBES.filter(([property, value]) => parseError(property, value) !== null).map(
                    ([property, value]) => `${property}: ${value}`,
                );
                expect(rejected).toStrictEqual([]);
            });

            await it('GTK refuses every property the table claims it refuses', async () => {
                // Without this direction the table could name every property in CSS
                // and the test above would still pass — which is the shape of a gate
                // that looks alive and checks nothing.
                const accepted = NOT_GTK_CSS.filter(([property, value]) => parseError(property, value) === null).map(
                    ([property, value]) => `${property}: ${value}`,
                );
                expect(accepted).toStrictEqual([]);
            });

            await it('reports text-align as absent, which is the one that reads like paint', async () => {
                // Called out on its own because it is the property most likely to be
                // grouped with `color` and `font-size` by anyone reading a `text-*`
                // utility family, and GTK drops it without a word.
                const error = parseError('text-align', 'center');
                expect(error === null).toBe(false);
                expect(String(error)).toContain('text-align');
            });
        });
    });
};
