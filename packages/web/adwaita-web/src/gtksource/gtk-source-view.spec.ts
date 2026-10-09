import { describe, expect, it } from '@gjsify/unit';
import { GTKSOURCE_VIEW_DEFAULT_VECTORS } from '@gjsify/gtksource-core/conformance';

import './gtk-source-view.js';
import { GtkSourceView } from './gtk-source-view.js';

export const GtkSourceViewTest = async () => {
    await describe('<gtk-source-view>: GtkSource.View', async () => {
        for (const vector of GTKSOURCE_VIEW_DEFAULT_VECTORS) {
            await it(`${vector.property} defaults to ${vector.shows}`, () => {
                const view = new GtkSourceView();
                expect((view as unknown as Record<string, unknown>)[vector.member]).toStrictEqual(vector.shows);
            });
        }

        await it('writes through attributes with GTK semantics', () => {
            const view = document.createElement('gtk-source-view') as GtkSourceView;
            view.setAttribute('show-line-numbers', 'true');
            view.setAttribute('indent-width', '4');
            view.setAttribute('left-margin', '12');
            expect(view.showLineNumbers).toBe(true);
            expect(view.indentWidth).toBe(4);
            expect(view.leftMargin).toBe(12);
        });

        await it('refuses a value that is not a boolean, by name', () => {
            const view = new GtkSourceView();
            expect(() => (view.editable = 'maybe')).toThrow(/GtkSource.View.editable/);
        });

        await it('shows the buffer text in the textarea and takes a user edit back into the buffer', () => {
            const view = document.createElement('gtk-source-view') as GtkSourceView;
            document.body.append(view);
            view.buffer.text = 'LDA #$01';
            expect(view.textarea.value).toBe('LDA #$01');
            view.textarea.value = 'LDA #$02';
            view.textarea.dispatchEvent(new Event('input'));
            expect(view.buffer.text).toBe('LDA #$02');
            view.remove();
        });
    });
};
