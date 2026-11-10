// `Adw.AboutDialog:comments` is Pango markup in libadwaita; the card draws it through
// `GtkLabel`'s markup path instead of showing `<b>` as text.
//
// This lives on the TREES entry (`src/test.trees.mts`): it builds the port's real widget
// classes, which evaluate `@nativescript/core` at module scope.

import { describe, expect, it } from '@gjsify/unit';

import * as Adw from './namespace/adw.js';

interface CommentsCard {
    _commentsLabel: { text: string; visibility: string; formattedText?: unknown };
}

const commentsOf = (comments: string) => {
    const dialog = new Adw.AboutDialog();
    dialog.comments = comments;
    return (dialog as unknown as CommentsCard)._commentsLabel;
};

export const AdwAboutDialogCommentsNsTest = async () => {
    await describe('NativeScript Adw.AboutDialog comments markup', async () => {
        await it('draws <b> as a styled span, not as angle-bracket text', () => {
            const label = commentsOf('<b>Open Source</b> · Learn');
            expect(label.text).toBe('Open Source · Learn');
            expect(label.formattedText).not.toBeNull();
        });

        await it('decodes &amp; entities', () => {
            expect(commentsOf('Tom &amp; Jerry').text).toBe('Tom & Jerry');
        });

        await it('keeps plain text as it is', () => {
            expect(commentsOf('Just text').text).toBe('Just text');
        });

        await it('falls back to the raw string on malformed markup', () => {
            expect(commentsOf('<b>unclosed').text).toBe('<b>unclosed');
            expect(commentsOf('Tom & Jerry').text).toBe('Tom & Jerry');
        });
    });
};
