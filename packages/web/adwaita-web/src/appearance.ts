// Following the desktop's appearance in a plain web page (ADR 0078, #1821).
//
// A page learns the desktop's accent from, in order of precedence:
//
//   1. the APP's own choice   `applyAdwaitaAccent(name)` — never overwritten here
//   2. a server HANDOFF       `<meta name="adw-accent" content="purple">`, or
//                             `applyDesktopAppearance(json)` for live updates
//   3. the CSS SYSTEM COLOUR  `AccentColor`, once asked for (`applySystemAccent()`
//                             or `<meta name="adw-accent" content="system">`)
//   4. Adwaita blue           the stylesheet's own value
//
// The handoff outranks `AccentColor` because it is the better-informed source:
// a gjsify server reads the desktop itself (`@gjsify/adwaita-app/appearance`),
// while `AccentColor` is supported unevenly across engines and a page cannot
// tell a real system accent from an engine's fixed default.
//
// EVERY SOURCE IS SNAPPED TO ONE OF THE NINE with `nearestAccent`, as libadwaita
// does with the system colour it reads, so a web page and a native Adwaita
// window on the same desktop show the same accent. Consequently the standalone
// `--accent-color` is libadwaita's derivation of a palette colour, never of the
// raw system colour.
//
// Only `document.documentElement` follows; an accent set on any other element
// is the app's business.

import {
    ADW_ACCENT_META_SYSTEM,
    type AdwAccentColorName,
    type AppearanceMeta,
    appearanceFromMeta,
    type DesktopAppearance,
    formatAdwRgb,
    nearestAccent,
    parseAdwRgb,
    parseDesktopAppearance,
} from '@gjsify/adwaita-core';

import { clearAdwaitaAccent, hasAppChosenAccent, isAdwaitaDark, writeAdwaitaAccent } from './accent.js';

/** Which source the root's accent currently comes from. */
export type AdwAccentSource = 'app' | 'handoff' | 'system' | 'default';

/** What the handoff said last: from the `<meta>` tags, or from `applyDesktopAppearance`. */
let handoff: AppearanceMeta & { accentRgb?: string } = {};
/** Whether the page asked to follow CSS `AccentColor`. */
let systemRequested = false;
/** Whether the follower has written the root's accent, so it knows what it may remove. */
let wroteAccent = false;
/** The theme class the follower added for a handed-off colour scheme, if any. */
let addedSchemeClass: 'theme-dark' | 'theme-light' | null = null;
let installed = false;

/**
 * The browser's CSS system colour `AccentColor`, snapped to the nearest of the
 * nine — or `null` where the engine does not support the keyword or the
 * resolved colour cannot be read.
 *
 * SUPPORT IS UNEVEN AND NOT ASSUMED: Chrome announced shipping `AccentColor`
 * only in 2026, and what Firefox resolves it to on Linux is not established;
 * Firefox 156 on macOS resolves it to `rgb(0, 122, 255)`. An engine may also
 * report a fixed default instead of the real accent (fingerprinting
 * protection), which a page cannot detect.
 */
export function readSystemAccent(): { accent: AdwAccentColorName; accentRgb: string } | null {
    if (typeof CSS === 'undefined' || !CSS.supports('color', 'AccentColor')) return null;
    const probe = document.createElement('span');
    probe.style.color = 'AccentColor';
    probe.style.display = 'none';
    document.documentElement.append(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    const rgb = parseAdwRgb(resolved);
    if (!rgb) return null;
    return { accent: nearestAccent(rgb), accentRgb: formatAdwRgb(rgb) };
}

function resolve(): { accent: AdwAccentColorName; source: AdwAccentSource } | null {
    if (handoff.accent && handoff.accent !== ADW_ACCENT_META_SYSTEM)
        return { accent: handoff.accent, source: 'handoff' };
    // A handoff that carries only a colour (a server that did not snap it) is snapped here.
    const handedRgb = handoff.accentRgb ? parseAdwRgb(handoff.accentRgb) : null;
    if (handedRgb) return { accent: nearestAccent(handedRgb), source: 'handoff' };
    if (systemRequested || handoff.accent === ADW_ACCENT_META_SYSTEM) {
        const system = readSystemAccent();
        if (system) return { accent: system.accent, source: 'system' };
    }
    return null;
}

/** The source the root's accent comes from right now. */
export function adwaitaAccentSource(): AdwAccentSource {
    if (typeof document === 'undefined') return 'default';
    if (hasAppChosenAccent(document.documentElement)) return 'app';
    return resolve()?.source ?? 'default';
}

function syncScheme(root: HTMLElement): void {
    const scheme = handoff.colorScheme;
    const wanted = scheme === 'dark' ? 'theme-dark' : scheme === 'light' ? 'theme-light' : null;
    if (wanted === addedSchemeClass) return;
    if (addedSchemeClass) root.classList.remove(addedSchemeClass);
    addedSchemeClass = null;
    // A theme class the APP put on the root is its choice; the handoff does not fight it.
    if (wanted && !root.classList.contains('theme-dark') && !root.classList.contains('theme-light')) {
        root.classList.add(wanted);
        addedSchemeClass = wanted;
    }
}

/** Re-apply every automatic source to the root, in precedence order. */
function sync(): void {
    const root = document.documentElement;
    syncScheme(root);
    if (hasAppChosenAccent(root)) return;
    const resolved = resolve();
    if (resolved) {
        writeAdwaitaAccent(resolved.accent, root, isAdwaitaDark(root));
        wroteAccent = true;
    } else if (wroteAccent) {
        clearAdwaitaAccent(root);
        wroteAccent = false;
    }
}

const isHandoffMeta = (node: Node): boolean =>
    node.nodeName === 'META' && (node as Element).getAttribute('name')?.startsWith('adw-') === true;

/**
 * Only a change to one of OUR tags re-reads them. Frameworks and this package
 * itself insert <style> and <script> into <head> all the time, and re-reading on
 * those would reset a live handoff from `applyDesktopAppearance` to the tags.
 */
function touchesHandoffMeta(record: MutationRecord): boolean {
    // A renamed tag counts by its old name too, so dropping `name="adw-accent"` is seen.
    if (record.type === 'attributes')
        return (
            isHandoffMeta(record.target) ||
            (record.attributeName === 'name' && record.oldValue?.startsWith('adw-') === true)
        );
    return [...record.addedNodes, ...record.removedNodes].some(isHandoffMeta);
}

function readMetaHandoff(): void {
    handoff = appearanceFromMeta(
        (name) => document.head.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null,
    );
}

/**
 * Start following: read the handoff tags, and re-apply when they change, when
 * the colour scheme flips (the standalone accent differs between light and
 * dark) and when the page regains focus (`AccentColor` changes with no event).
 * Idempotent; `@gjsify/adwaita-web` calls it on import in a browser.
 */
export function followDesktopAppearance(): void {
    if (installed || typeof document === 'undefined') return;
    installed = true;
    readMetaHandoff();
    sync();
    new MutationObserver((records) => {
        if (records.some(touchesHandoffMeta)) {
            readMetaHandoff();
            sync();
        }
    }).observe(document.head, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['content', 'name'],
        attributeOldValue: true,
    });
    globalThis.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', sync);
    globalThis.addEventListener('focus', () => {
        if (systemRequested || handoff.accent === ADW_ACCENT_META_SYSTEM) sync();
    });
}

/**
 * Follow the CSS system colour `AccentColor` (#1821); `false` stops following
 * it. A server handoff and the app's own choice still win; where the engine
 * cannot resolve `AccentColor` the page keeps Adwaita blue. Returns the accent
 * the system colour snapped to, or `null` (always when disabling).
 */
export function applySystemAccent(enabled = true): AdwAccentColorName | null {
    followDesktopAppearance();
    systemRequested = enabled;
    sync();
    return enabled ? (readSystemAccent()?.accent ?? null) : null;
}

/**
 * Apply a desktop appearance handed over at runtime — the JSON a gjsify server
 * sends when the desktop changes (over SSE, a WebSocket, a message port). The
 * value is validated, so an untrusted payload is safe to pass straight in; it
 * REPLACES the previous handoff, including one from the `<meta>` tags.
 */
export function applyDesktopAppearance(appearance: unknown): void {
    // Install first: installing reads the <meta> tags, which must not overwrite this newer value.
    followDesktopAppearance();
    const { accent, accentRgb, colorScheme }: DesktopAppearance = parseDesktopAppearance(appearance);
    handoff = {
        ...(accent ? { accent } : {}),
        ...(accentRgb ? { accentRgb } : {}),
        ...(colorScheme ? { colorScheme } : {}),
    };
    sync();
}
