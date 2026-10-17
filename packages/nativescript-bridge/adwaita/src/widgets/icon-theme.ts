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
// `packages/web/adwaita-web/src/icon-theme.ts` resolves a name against a COMPILED
// SUBSET of `@gjsify/adwaita-icons` and the resource paths an application added for
// anything outside it. The subset exists because the whole set does not fit — and on a PHONE bundle that
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
// this map does not carry can still pass the document itself, exactly as before, or ship
// it in a GResource under `<resource-base-path>/icons/` to make it resolvable by name.
// {@link iconValueKind} is the whole discrimination, and the two grammars are disjoint by
// construction — an icon NAME is one CSS token (`normalizeIconName`), an SVG document
// starts with `<`. Nothing guesses.
//
// RESOURCE PATHS (ADR 0116 § 4). A name also goes through the `Gtk.IconTheme` resource paths an
// application added (`GtkApplication` adds `<resource-base-path>/icons/` at startup);
// `@gjsify/adwaita-core`'s `lookupResourceIcon` decides which file answers, as gtkicontheme.c
// does, and asks this module only whether the current theme — the compiled subset — holds a
// symbolic glyph. {@link resolveIconDrawing} is that lookup. A
// symbolic SVG file draws through the same rasteriser as a compiled glyph, a PNG decodes as it is
// (a `.symbolic.png` tinted in the icon colour). NativeScript decodes no SVG, so a COLOUR SVG, an
// XPM or a compressed entry draws `image-missing` with a warning.
//
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+ — the icon SVGs.
// Original implementation.

import {
    iconLookupNames,
    lookupResourceIcon,
    normalizeIconName,
    resources_lookup_data,
    type IconDirection,
    type IconTheme,
    type ResourceIconMatch,
} from '@gjsify/adwaita-core';

import { fitIconToGrid } from './icon-path.js';

import {
    contactNewSymbolic,
    documentEditSymbolic,
    documentOpenSymbolic,
    documentSaveSymbolic,
    editCopySymbolic,
    goHomeSymbolic,
    goNextSymbolic,
    goPreviousSymbolic,
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
import { faceSmileSymbolic } from '@gjsify/adwaita-icons/emotes';
import {
    folderDocumentsSymbolic,
    folderDownloadSymbolic,
    folderMusicSymbolic,
    folderSymbolic,
    userTrashSymbolic,
} from '@gjsify/adwaita-icons/places';
import {
    avatarDefaultSymbolic,
    imageMissingSymbolic,
    mailUnreadSymbolic,
    starredSymbolic,
} from '@gjsify/adwaita-icons/status';

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
    // The `Gtk.EmojiChooser` gallery block's "insert an emoji" button, the same face GTK
    // puts on an entry's prefix.
    'face-smile': faceSmileSymbolic,
    'camera-photo': cameraPhotoSymbolic,
    'contact-new': contactNewSymbolic,
    'document-edit': documentEditSymbolic,
    'document-open': documentOpenSymbolic,
    'document-save': documentSaveSymbolic,
    'edit-copy': editCopySymbolic,
    'emblem-system': emblemSystemSymbolic,
    folder: folderSymbolic,
    'folder-documents': folderDocumentsSymbolic,
    'folder-download': folderDownloadSymbolic,
    'folder-music': folderMusicSymbolic,
    'go-home': goHomeSymbolic,
    'go-next': goNextSymbolic,
    'go-previous': goPreviousSymbolic,
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
 * off a file). An icon name is
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
    return resolved !== '' && Object.hasOwn(COMPILED_ICONS, resolved);
}

/** The subset's names, sorted — for a spec or a gate that has to enumerate them. */
export function compiledIconNames(): string[] {
    return Object.keys(COMPILED_ICONS).sort();
}

/**
 * A caller's icon value as the SVG document a rasteriser can read.
 *
 * The one function every icon property on this port goes through, so that a name means
 * the same thing on all of them. `''` stays `''` — see {@link IconValueKind}. A source
 * passes through untouched. A name resolves against the compiled subset, then
 * {@link ICON_FALLBACK_NAME}.
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
            return COMPILED_ICONS[name] ?? imageMissingSymbolic;
        }
    }
}

/** What an icon value draws as on this port. */
export type IconDrawing =
    /** An SVG document for `renderSymbolicIcon`, recoloured in the icon colour. */
    | { readonly kind: 'svg'; readonly svg: string }
    /** A PNG file as base64, for `ImageSource.fromBase64Sync`; a `symbolic` one is tinted. */
    | { readonly kind: 'png'; readonly base64: string; readonly symbolic: boolean };

/** What an image hands its theme besides the name. */
export interface IconRequest {
    /** In DIPs. */
    readonly size: number;
    /** The device scale; 1 when absent. */
    readonly scale?: number;
    readonly direction?: IconDirection;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(data: Uint8Array): string {
    let out = '';
    for (let i = 0; i < data.length; i += 3) {
        const [a, b = 0, c = 0] = [data[i] as number, data[i + 1], data[i + 2]];
        const n = (a << 16) | (b << 8) | c;
        out += BASE64[n >> 18] + BASE64[(n >> 12) & 63];
        out += i + 1 < data.length ? BASE64[(n >> 6) & 63] : '=';
        out += i + 2 < data.length ? BASE64[n & 63] : '=';
    }
    return out;
}

/** Drawings of resource files by path, per theme, for the current scan; and who redraws. */
const themes = new WeakMap<IconTheme, { drawings: Map<string, IconDrawing>; listeners: Set<() => void> }>();

function stateOf(theme: IconTheme) {
    let state = themes.get(theme);
    if (state === undefined) {
        const created = { drawings: new Map<string, IconDrawing>(), listeners: new Set<() => void>() };
        // One handler per theme, so the drawings are dropped before any image redraws.
        theme.connect('changed', () => {
            created.drawings.clear();
            for (const listener of Array.from(created.listeners)) listener();
        });
        themes.set(theme, created);
        state = created;
    }
    return state;
}

/**
 * Run `listener` after `theme`'s `changed` signal, once the cached resource drawings are gone —
 * GTK's images redo their lookup then. Returns the unsubscribe function.
 */
export function onIconThemeChanged(theme: IconTheme, listener: () => void): () => void {
    const { listeners } = stateOf(theme);
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

const MISSING: IconDrawing = { kind: 'svg', svg: imageMissingSymbolic };

/** The file at `path` as a drawing, or `image-missing` (warned once per scan) when it cannot be. */
function readResourceDrawing(path: string, symbolic: boolean): IconDrawing {
    const suffix = path.slice(path.lastIndexOf('.'));
    if (suffix === '.svg' && !symbolic) {
        console.warn(
            `Gtk.IconTheme: ${path} is a colour SVG; NativeScript decodes no SVG and draws one only as a ` +
                'symbolic icon (ADR 0116 § 4).',
        );
        return MISSING;
    }
    if (suffix !== '.svg' && suffix !== '.png') {
        console.warn(`Gtk.IconTheme: ${path} is not an SVG or a PNG, which is all NativeScript draws (ADR 0116 § 4).`);
        return MISSING;
    }
    let data: Uint8Array;
    try {
        data = resources_lookup_data(path, 0).get_data();
    } catch (error) {
        console.warn(`Gtk.IconTheme: ${path} cannot be drawn: ${(error as Error).message}`);
        return MISSING;
    }
    return suffix === '.svg'
        ? { kind: 'svg', svg: fitIconToGrid(new TextDecoder().decode(data)) }
        : { kind: 'png', base64: toBase64(data), symbolic };
}

/**
 * Which file under `theme`'s resource paths answers the icon name `name`, or `'theme'`'s glyph
 * when the current theme answers first; `null` when no resource takes part and the answer is
 * {@link resolveIconSource}'s alone.
 */
export function lookupThemeIcon(theme: IconTheme, name: string, request: IconRequest): ResourceIconMatch | null {
    return lookupResourceIcon(theme, {
        names: iconLookupNames(name, request.direction ?? null),
        size: request.size,
        scale: request.scale ?? 1,
        themeHas: (candidate) => isIconAvailable(candidate),
    });
}

/**
 * A caller's icon value as what it draws, with `theme`'s resource paths taking part in the
 * lookup the way `gtk_icon_theme_lookup_by_gicon` has them take part for a `GtkImage`. `null` for
 * `''`, as {@link resolveIconSource} answers `''`. Without a resource holding the name the answer
 * is {@link resolveIconSource}'s.
 */
export function resolveIconDrawing(
    theme: IconTheme,
    value: string | null | undefined,
    request: IconRequest,
): IconDrawing | null {
    const raw = value ?? '';
    if (iconValueKind(raw) !== 'name') return raw === '' ? null : { kind: 'svg', svg: raw };
    const match = lookupThemeIcon(theme, raw, request);
    if (match === null || match.kind !== 'resource') {
        return { kind: 'svg', svg: resolveIconSource(match === null ? raw : match.name) };
    }
    const { drawings } = stateOf(theme);
    let drawing = drawings.get(match.path);
    if (drawing === undefined) {
        drawing = readResourceDrawing(match.path, match.symbolic);
        drawings.set(match.path, drawing);
    }
    return drawing;
}
