// Theme-NAME resolution for the NativeScript port — `iconName: 'list-add-symbolic'`.
//
// WHAT THIS ENDS. Every icon property on this port took an SVG SOURCE and nothing else,
// because `Image` on NativeScript decodes no SVG and the widgets rasterise the document
// themselves (`icons.android.ts`, `icons.ios.ts`). That is still true of the RENDERER —
// what was missing was the half in front of it: a NAME to look the document up by. So a
// caller who wanted the Adwaita `list-add` glyph had to import it
// (`import { listAddSymbolic } from '@gjsify/adwaita-icons/actions'`) and hand the source
// in, where the GJS and Blueprint spellings of the same widget write `list-add-symbolic`.
// Every `nativescript` pane in the website gallery carried that extra import line, and
// `check-website-adwaita-gallery.mjs` arm 12 counted the cost as its `glyph` kind.
//
// THE SHAPE IS THE WEB PILLAR'S, deliberately, because the constraint is the same one.
// `packages/web/adwaita-web/src/icon-registry.ts` resolves a name against a COMPILED
// SUBSET of `@gjsify/adwaita-icons` and offers {@link registerIcon} for anything outside
// it. The subset exists because the whole set does not fit — and on a PHONE bundle that
// is not a stylesheet argument but a download one. Measured over
// `packages/web/adwaita-icons/*.ts` (the command is in ADR 0034 § Amendment 18):
//
//   · the whole barrel        644 glyphs, 732 371 bytes of SVG source  (715.2 KiB)
//   · {@link COMPILED_ICONS}   31 glyphs,  27 851 bytes                 (27.2 KiB)
//   · what the subset ADDS     25 glyphs,  24 133 bytes                 (23.6 KiB)
//
// The third row is the honest one: six of the thirty-one were already imported by a
// widget in this directory for its own chrome, so the bundle grows by the other
// twenty-five — 3.3 % of the barrel. A `import * from '@gjsify/adwaita-icons'` would
// pull all 644 in, which is why nothing here does that and why the membership rule
// below is enforced by a gate rather than by intent.
//
// AN ENTRY IS PAID FOR BY EVERY APP, and that is deliberate rather than overlooked: a
// bundler cannot tree-shake individual properties out of an object literal, so the map
// is all-or-nothing exactly as the web pillar's stylesheet is. It is the reason arm 2 of
// the gate exists — an entry nothing emits is a byte bought for nobody — and the reason
// seven entries here are the price of a storybook control whose every option draws,
// which is the same trade `build-scss.mjs` records for five of its own.
//
// THE MEMBERSHIP RULE: every icon name a shipping NativeScript-facing surface in this
// repository emits as a NAME, and nothing else. The port's own chrome glyphs are NOT in
// here — a combo row's `pan-down`, a spin row's `value-increase`, a split button's arrow
// are imported at their point of use, because no caller names them and an entry no
// caller can reach is a byte bought for nobody.
//
// `check-nativescript-icon-names.mjs` holds that rule in BOTH directions over eight
// surfaces, and its second arm is the one that keeps a subset a subset. It found a defect
// the moment it ran: the storybook's button-row story mapped `edit-delete`, a name its own
// control does not offer, so picking "Trash" drew nothing at all.
//
// THE SVG-SOURCE DOOR STAYS OPEN. Name resolution is an ADDITION: a consumer with a glyph
// this map does not carry can still pass the document itself, exactly as before, and
// {@link registerIcon} makes that glyph resolvable by name for everything downstream.
// {@link iconValueKind} is the whole discrimination, and the two grammars are disjoint by
// construction — an icon NAME is one CSS token (`normalizeIconName`), an SVG document
// starts with `<`. Nothing guesses.
//
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+ — the icon SVGs.
// Original implementation.

import { normalizeIconName } from '@gjsify/adwaita-core';

import {
    contactNewSymbolic,
    documentEditSymbolic,
    documentOpenSymbolic,
    documentSaveSymbolic,
    goNextSymbolic,
    listAddSymbolic,
    listRemoveSymbolic,
    mailReplySenderSymbolic,
    mailSendSymbolic,
    openMenuSymbolic,
    sendToSymbolic,
    systemSearchSymbolic,
    viewConcealSymbolic,
    viewGridSymbolic,
    viewListSymbolic,
    viewMoreSymbolic,
    viewPagedSymbolic,
    viewRevealSymbolic,
} from '@gjsify/adwaita-icons/actions';
import { preferencesSystemSymbolic } from '@gjsify/adwaita-icons/categories';
import { cameraPhotoSymbolic, networkWirelessSymbolic } from '@gjsify/adwaita-icons/devices';
import { emblemSystemSymbolic } from '@gjsify/adwaita-icons/legacy';
import {
    folderDocumentsSymbolic,
    folderDownloadSymbolic,
    folderMusicSymbolic,
    folderSymbolic,
    userTrashSymbolic,
} from '@gjsify/adwaita-icons/places';
import { avatarDefaultSymbolic, imageMissingSymbolic, mailUnreadSymbolic, starredSymbolic } from '@gjsify/adwaita-icons/status';

/**
 * The name every unresolvable name resolves TO.
 *
 * libadwaita's own answer, and `adwaita-web`'s: a name nothing can draw draws the
 * broken-image glyph rather than nothing at all. An empty icon is invisible, and an
 * invisible failure is the class `check-adwaita-icon-masks.mjs` exists to have ended
 * once already — there a missing mask painted a solid 16px square that read as a
 * deliberate swatch, and no test could see it.
 */
export const ICON_FALLBACK_NAME = 'image-missing';

/**
 * The compiled subset: an icon NAME (libadwaita's, with `-symbolic` dropped) to its
 * Adwaita symbolic document.
 *
 * Adding an entry is one line here plus a shipping surface that names it — the gate
 * fails on an entry nothing emits, because the size argument in this file's header is
 * only enforceable in both directions.
 */
const COMPILED_ICONS: Readonly<Record<string, string>> = {
    'avatar-default': avatarDefaultSymbolic,
    'camera-photo': cameraPhotoSymbolic,
    'contact-new': contactNewSymbolic,
    'document-edit': documentEditSymbolic,
    'document-open': documentOpenSymbolic,
    'document-save': documentSaveSymbolic,
    'emblem-system': emblemSystemSymbolic,
    folder: folderSymbolic,
    'folder-documents': folderDocumentsSymbolic,
    'folder-download': folderDownloadSymbolic,
    'folder-music': folderMusicSymbolic,
    'go-next': goNextSymbolic,
    'image-missing': imageMissingSymbolic,
    'list-add': listAddSymbolic,
    'list-remove': listRemoveSymbolic,
    'mail-reply-sender': mailReplySenderSymbolic,
    'mail-send': mailSendSymbolic,
    'mail-unread': mailUnreadSymbolic,
    'network-wireless': networkWirelessSymbolic,
    'open-menu': openMenuSymbolic,
    'preferences-system': preferencesSystemSymbolic,
    'send-to': sendToSymbolic,
    starred: starredSymbolic,
    'system-search': systemSearchSymbolic,
    'user-trash': userTrashSymbolic,
    'view-conceal': viewConcealSymbolic,
    'view-grid': viewGridSymbolic,
    'view-list': viewListSymbolic,
    'view-more': viewMoreSymbolic,
    'view-paged': viewPagedSymbolic,
    'view-reveal': viewRevealSymbolic,
};

/** Glyphs a consumer added at runtime. Beats {@link COMPILED_ICONS} on the same name. */
const registered = new Map<string, string>();

/**
 * What a caller's icon value IS.
 *
 * `'empty'` is not the same answer as `'name'` that fails to resolve: the widgets read
 * it as "no icon" and take their own absent-icon path (an avatar falls back to the
 * person glyph, a status page collapses the image), which is libadwaita's behaviour for
 * a NULL `icon-name` and must not become an `image-missing`.
 */
export type IconValueKind = 'empty' | 'name' | 'source';

/**
 * Which of the two doors a value came through — the whole discrimination, in one place.
 *
 * An SVG document is recognised by its FIRST non-space character being `<`, which admits
 * an XML prolog and a DOCTYPE ahead of the root element (both legitimate in an icon read
 * off a file, and `icon-registry.ts` on the web side takes the same two). An icon name is
 * whatever `normalizeIconName` accepts: one CSS token once an optional `-symbolic` comes
 * off. Nothing is both, so nothing has to be guessed.
 *
 * A value that is NEITHER — `'two words'`, `'org.gnome.Builder'` — is reported as a
 * `'name'`, because that is what the caller meant and resolution draws
 * {@link ICON_FALLBACK_NAME} for it. Calling it a source instead would hand an
 * un-parseable string to the rasteriser, which draws nothing and says nothing.
 */
export function iconValueKind(value: string | null | undefined): IconValueKind {
    const raw = value ?? '';
    if (raw === '') return 'empty';
    return raw.trimStart().startsWith('<') ? 'source' : 'name';
}

/** Whether {@link resolveIconSource} can draw `name` without falling back. */
export function isIconAvailable(name: string | null | undefined): boolean {
    const resolved = normalizeIconName(name);
    return resolved !== '' && (registered.has(resolved) || Object.hasOwn(COMPILED_ICONS, resolved));
}

/** The subset's names, sorted — for a spec or a gate that has to enumerate them. */
export function compiledIconNames(): string[] {
    return Object.keys(COMPILED_ICONS).sort();
}

/** The names {@link registerIcon} has added, sorted. */
export function registeredIconNames(): string[] {
    return [...registered.keys()].sort();
}

/**
 * Make `name` resolvable from an Adwaita symbolic SVG source (what
 * `@gjsify/adwaita-icons` exports), for a glyph the compiled subset does not carry.
 *
 *     import { registerIcon } from '@gjsify/adwaita-nativescript';
 *     import { dialogErrorSymbolic } from '@gjsify/adwaita-icons/status';
 *
 *     registerIcon('dialog-error-symbolic', dialogErrorSymbolic);
 *     // …then anywhere: new Adw.StatusPage({ iconName: 'dialog-error-symbolic' })
 *
 * BOTH arguments are checked and a wrong one THROWS, the same verdict the web registry
 * reaches for the same reason: this is an explicit call, and quietly registering
 * something undrawable produces an icon strictly WORSE than an unregistered one — it
 * beats the `image-missing` fallback and draws nothing, while {@link isIconAvailable}
 * reports `true`.
 *
 * The SVG test is LEXICAL, not a parse, and that is a real limit rather than a shortcut:
 * NativeScript has no `DOMParser`, and the rasterisers here read the document with
 * `extractIconPaths`' own scanner. So a well-formed document with no `<svg>` root is
 * refused, and a malformed one inside an `<svg>` is accepted and draws whatever
 * `extractIconPaths` finds in it — which is the same thing it would have drawn had the
 * caller passed it straight to the widget.
 *
 * Registering a name the subset already compiles REPLACES the glyph.
 */
export function registerIcon(name: string, svg: string): void {
    const resolved = normalizeIconName(name);
    if (resolved === '') {
        throw new TypeError(
            `registerIcon: ${JSON.stringify(name)} is not usable as an icon name — it has to be a single ` +
                'CSS token ([A-Za-z0-9_-]+) once an optional `-symbolic` suffix is removed.',
        );
    }
    if (iconValueKind(svg) !== 'source' || !/<svg[\s>]/.test(svg)) {
        throw new TypeError(
            `registerIcon: the glyph for ${JSON.stringify(resolved)} has to be Adwaita symbolic SVG SOURCE ` +
                '(what @gjsify/adwaita-icons exports) — a document whose root element is `<svg>`.',
        );
    }
    registered.set(resolved, svg);
}

/** Drop a registration, so the name falls back to the compiled subset. Test seam. */
export function unregisterIcon(name: string): boolean {
    return registered.delete(normalizeIconName(name));
}

/**
 * A caller's icon value as the SVG document a rasteriser can read.
 *
 * The one function every icon property on this port goes through, so that a name means
 * the same thing on all of them. `''` stays `''` — see {@link IconValueKind}. A source
 * passes through untouched. A name resolves against the registrations, then the compiled
 * subset, then {@link ICON_FALLBACK_NAME}.
 */
export function resolveIconSource(value: string | null | undefined): string {
    const raw = value ?? '';
    switch (iconValueKind(raw)) {
        case 'empty':
            return '';
        case 'source':
            return raw;
        default: {
            const name = normalizeIconName(raw);
            return registered.get(name) ?? COMPILED_ICONS[name] ?? imageMissingSymbolic;
        }
    }
}
