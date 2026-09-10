// `Gtk.Label` for NativeScript — the pure half: what the label SHOWS.
//
// WHAT THIS PORT DOES WITH PANGO MARKUP, DECLARED RATHER THAN LEFT TO BE FOUND OUT.
// `Gtk.Label:use-markup` says the label's text is Pango markup, and a renderer that
// honours it draws bold runs, spans and links. NativeScript's `Label` has `text`, which is
// LITERAL, and `formattedText`, which takes `FormattedString`/`Span` objects and no markup
// string; the NS CSS subset has no inline-markup layer at all. So there are three possible
// answers and only one of them is honest:
//
//   · render it — impossible, there is no parser to hand it to;
//   · pass the markup through to `text` — the label then shows `<b>Bold</b>` verbatim,
//     which is what a reader would call a bug;
//   · reduce the markup to its PLAIN TEXT and say so — which is what this does, and what
//     `bannerTitleText` already does for `Adw.Banner:use-markup` one widget over
//     (`chrome.ts`). The two now share `stripMarkup`, so the port has ONE answer to
//     markup rather than one per widget.
//
// UNPARSEABLE MARKUP KEEPS THE RAW STRING, which is the C fallback: `gtk_label_set_markup`
// warns and leaves the text as it was given. `stripMarkup` returns `null` for anything
// outside Pango's tag set, and the `?? text` below is that fallback.
//
// AND `use-markup` IS FALSE BY DEFAULT, which is the half that matters most on this
// surface. `Gtk.Label:use-markup` defaults to FALSE, so `new Gtk.Label({ label: 'a < b' })`
// shows `a < b` — literally, on GTK and here. The hazard this port is not exposed to is
// the one the other direction has: a row that parses markup by DEFAULT (Adwaita's rows do)
// silently blanks a label containing a `<` in ordinary prose. Nothing here parses anything
// unless asked, and when asked it strips rather than parses, so a `<` in a sentence is
// visible in every combination.
//
// THE MNEMONIC IS STRIPPED AND NOT UNDERLINED. `use-underline` marks the next character as
// the mnemonic; NativeScript has no keyboard-accelerator layer and no way to underline one
// character of a `Label`, so the marker is removed and the key is not bound. Same reduction
// `Adw.ButtonContent` makes through `buttonContentLabelText`, and the same reason.
//
// No `@nativescript/core` value imports, so the spec suite drives this off-device
// (AGENTS.md) — `gtk-label.ts` cannot be imported there at all.
//
// Reference: refs/gtk gtk/gtklabel.c (gtk_label_set_markup, gtk_label_set_use_underline)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { stripMarkup, stripMnemonic } from '@gjsify/adwaita-core';

/**
 * The string a `Gtk.Label` puts in `Label.text` for a given `label` and the two flags
 * that transform it.
 *
 * ORDER MATTERS AND FOLLOWS THE C: markup is reduced first, the mnemonic marker second.
 * `gtk_label_set_markup_with_mnemonic` parses the markup and then takes the underscore out
 * of the resulting TEXT, so an `_` inside a tag's attributes is not a mnemonic. Doing it
 * the other way round would let `<span font_desc="Sans">` lose its underscore and stop
 * parsing.
 */
export function labelDisplayText(label: string, useMarkup: boolean, useUnderline: boolean): string {
    const text = label ?? '';
    const plain = useMarkup ? (stripMarkup(text) ?? text) : text;
    return useUnderline ? stripMnemonic(plain) : plain;
}

/** Whether `label` carries markup this port could not reduce, so the raw string is shown. */
export function labelMarkupIsUnparseable(label: string, useMarkup: boolean): boolean {
    return useMarkup && stripMarkup(label ?? '') === null;
}
