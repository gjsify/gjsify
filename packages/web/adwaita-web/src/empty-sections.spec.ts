// The `hidden` derivation itself, driven in both directions.
//
// `connect-lifecycle.spec.ts` drives the WIDGETS: it appends into every container a
// consumer can reach and requires the child to be laid out. That half alone does not
// hold the invariant — replacing the whole derivation with `section.hidden = false`
// left the full adwaita-web browser suite green, because nothing anywhere asserted that
// an EMPTY section is hidden or that it goes back to hidden when its last child leaves.
// An empty bar that re-enters the flow is what that mutant ships.
//
// Driven against the helper rather than a widget on purpose: the two elements whose
// sections are private fields (`<adw-alert-dialog>`, `<adw-status-page>`) have no
// container getter, so the widget driver cannot see them, and giving them one to satisfy
// a test would be public API invented for the test.
import { describe, expect, it } from '@gjsify/unit';

import { bindEmptySections } from './empty-sections.js';

/** A section mounted in the document, since `hidden` is only observable where there is layout. */
function section(): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

/** One microtask checkpoint — where a MutationObserver callback lands. */
const settle = () => Promise.resolve();

export const AdwEmptySectionsTest = async () => {
    await describe('bindEmptySections', async () => {
        await it('hides a section that starts empty', async () => {
            const el = section();
            bindEmptySections(el);
            const hidden = el.hidden;
            el.remove();
            expect(`empty: hidden=${hidden}`).toBe('empty: hidden=true');
        });

        await it('shows it when a child lands and hides it again when the last one leaves', async () => {
            const el = section();
            bindEmptySections(el);

            const child = document.createElement('span');
            el.appendChild(child);
            await settle();
            const filled = el.hidden;

            child.remove();
            await settle();
            const emptied = el.hidden;

            el.remove();
            expect(`filled: hidden=${filled} | emptied: hidden=${emptied}`).toBe(
                'filled: hidden=false | emptied: hidden=true',
            );
        });

        await it('counts element children, not child nodes', async () => {
            const el = section();
            bindEmptySections(el);
            // The whitespace an indented `<div>\n  </div>` carries is a text node, and a
            // section full of indentation is still an empty section. This is also why the
            // CSS `:empty` that this looks like cannot express the rule.
            el.appendChild(document.createTextNode('\n    '));
            await settle();
            const hidden = el.hidden;
            el.remove();
            expect(`whitespace only: hidden=${hidden}`).toBe('whitespace only: hidden=true');
        });

        await it('derives each section it is handed independently', async () => {
            const empty = section();
            const filled = section();
            filled.appendChild(document.createElement('span'));
            bindEmptySections(empty, filled);
            const report = `empty=${empty.hidden} filled=${filled.hidden}`;
            empty.remove();
            filled.remove();
            expect(report).toBe('empty=true filled=false');
        });
    });
};
