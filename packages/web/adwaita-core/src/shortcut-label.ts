// Adwaita shortcut-label behaviour — headless (ADR 0004).
//
// `AdwShortcutLabel` turns an accelerator STRING into a row of keycaps. All of
// the interesting behaviour is in that translation, and it is a four-level
// grammar rather than a split on one separator (adw-shortcut-label.c:463-544):
//
//   ' '   alternatives          `<Shift>A Home`            joined by a dimmed `/`
//   '...' a range               `<Alt>1...9`               joined by a dimmed `⋯`
//   '+'   pressed in sequence   `<Control>C+<Control>X`    joined by a dimmed `→`
//   '&'   pressed together      `Control_L&Control_R`      joined by NOTHING
//
// The levels nest in that order — `rebuild` splits on spaces, `parse_range`
// looks for the FIRST `...`, `parse_sequence` splits on `+`, `parse_combination`
// splits on `&` — so `<Alt>1...9 <Alt>0` is two alternatives, the first a range,
// and no other reading is possible. Each leaf goes through
// `gtk_accelerator_parse` and becomes one BOX of keycaps.
//
// WHY THE CORE OWNS THIS. Nothing above is layout: it is a parse and a lookup
// table, and it is the part where a renderer that re-derives it drifts silently
// — the keycap order (Hyper, Super, Ctrl, Alt, Shift, Meta, then the key) is not
// the order the modifiers were written in, and a hand-rolled port reproduces the
// written order without anyone noticing.
//
// FOUR DELIBERATE DIFFERENCES FROM THE C, each because GTK is doing something
// that is not the derivation:
//
//   1. NO MARKUP. `get_labels` returns pango markup — `&lt;` for `<`, and
//      `%s <small><b>%s</b></small>` for a sided modifier. A key here is
//      `{ label, sideMarker? }`: the DOM escapes text by construction, and the
//      subscript is a structure a renderer should draw with an element, not a
//      string it has to parse back out.
//   2. NO KEYVALS. GTK parses to a numeric `GdkKeyval` and looks the label up
//      from it. The keysym table is tens of thousands of entries and none of the
//      derivation needs the NUMBER — every branch keys off the name or off the
//      ASCII character behind it, so the name is carried through instead.
//   3. UNTRANSLATED LABELS. `GTK_KEY_LABEL(x)` is `g_dpgettext2("gtk40",
//      "keyboard label", x)`, which returns its msgid unchanged when there is no
//      catalogue — the C locale renders `Page_Up`, literally. The msgids are
//      what this module returns, so a renderer with a catalogue can translate
//      them and one without matches GTK exactly.
//   4. AN UNKNOWN KEY NAME IS ACCEPTED, NOT REJECTED. `gtk_accelerator_parse`
//      fails on a name GDK does not know, and the widget then logs a warning and
//      stops. Without the keysym table this module cannot tell an unknown name
//      from a valid obscure one, so it renders it — the same fallback branch GTK
//      takes for a name it DOES know (:332-346). An unknown MODIFIER is still a
//      hard failure, because that is decidable: the modifier set is closed.
//
// PLATFORM-NEUTRAL: renders nothing, imports nothing, touches no global.
//
// Reference: refs/libadwaita/src/adw-shortcut-label.c:115-544
// Reference: refs/libadwaita/src/stylesheet/widgets/_shortcuts-dialog.scss:33-58
//            (`.keycap` and the dimmed separators)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** One keycap. `sideMarker` is the `L`/`R` subscript of a sided modifier key. */
export interface ShortcutKeycap {
    /** The untranslated label — a `GTK_KEY_LABEL` msgid, a character, or a glyph. */
    label: string;
    /** `L` or `R` for `Control_L` / `Control_R` and friends (:115-196). */
    sideMarker?: 'L' | 'R';
}

/** One node of the rendered label, in order. */
export type ShortcutLabelNode =
    /** A combination: keycaps drawn side by side, no separator (:370-395). */
    | { readonly kind: 'keys'; readonly keys: readonly ShortcutKeycap[] }
    /** A dimmed separator between groups (:359-368). */
    | { readonly kind: 'separator'; readonly text: string }
    /** The `disabled-text` placeholder, shown for an empty accelerator (:513-520). */
    | { readonly kind: 'disabled'; readonly text: string };

/** What a renderer needs to draw one `AdwShortcutLabel`. */
export interface ShortcutLabelParse {
    /** The nodes, in visual order. */
    readonly nodes: readonly ShortcutLabelNode[];
    /** The `aria-label` GTK builds alongside the widgets (:423-424, :538-540). */
    readonly accessibleLabel: string;
    /**
     * The fragment that failed to parse, or `null`.
     *
     * GTK warns and stops mid-build (:531-534), keeping whatever it had already
     * placed — so `nodes` is the partial result, not an empty one.
     */
    readonly error: string | null;
}

/** Options a renderer supplies from its own environment. */
export interface ShortcutLabelOptions {
    /** Shown when the accelerator is empty (:513-520). Defaults to `''`. */
    readonly disabledText?: string;
    /** Text direction — picks the sequence arrow (:439, :447). */
    readonly direction?: 'ltr' | 'rtl';
    /**
     * Which modifier glyphs to use.
     *
     * The C picks this at COMPILE time with `#ifdef __APPLE__` (:153-182,
     * :216-245, :318-331), so it is a build constant there and a runtime option
     * here — a renderer knows its platform, and a browser one can be running on
     * either.
     */
    readonly platform?: 'default' | 'apple';
}

/** The modifier bits `gtk_accelerator_parse` understands, in GTK's spelling. */
type Modifier = 'shift' | 'control' | 'alt' | 'meta' | 'super' | 'hyper';

/**
 * Modifier names accepted inside `<…>`, lowercased.
 *
 * `primary` is Control everywhere but Apple, where it is Command/Meta — the same
 * mapping GDK applies. `mod1` is Alt; `mod2`…`mod5` have no fixed meaning on
 * Wayland and are not accepted, which is a parse failure rather than a silent
 * drop.
 */
const MODIFIER_NAMES: Readonly<Record<string, Modifier | 'primary'>> = {
    shift: 'shift',
    shft: 'shift',
    control: 'control',
    ctrl: 'control',
    ctl: 'control',
    alt: 'alt',
    mod1: 'alt',
    meta: 'meta',
    super: 'super',
    hyper: 'hyper',
    primary: 'primary',
};

/** Keycap order — NOT the order the modifiers were written in (:209-245). */
const MODIFIER_ORDER: readonly Modifier[] = ['hyper', 'super', 'control', 'alt', 'shift', 'meta'];

/** The label for each modifier, per platform (:150-193, :209-245). */
const MODIFIER_LABELS: Readonly<Record<Modifier, { default: string; apple: string }>> = {
    hyper: { default: 'Hyper', apple: 'Hyper' },
    super: { default: 'Super', apple: 'Super' },
    control: { default: 'Ctrl', apple: '⌃' },
    alt: { default: 'Alt', apple: '⌥' },
    shift: { default: 'Shift', apple: '⇧' },
    meta: { default: 'Meta', apple: '⌘' },
};

/** The sided modifier KEYS — `Control_L` is a key, not a modifier (:121-145). */
const SIDED_MODIFIER_KEYS: Readonly<Record<string, Modifier>> = {
    Shift: 'shift',
    Control: 'control',
    Alt: 'alt',
    Meta: 'meta',
    Super: 'super',
    Hyper: 'hyper',
};

/**
 * Keysym names for the printable ASCII range, X11's own spelling.
 *
 * This is the table that stands in for `gdk_keyval_to_unicode` (:249): every
 * keysym in `0x21`…`0x7e` IS its character, so `<Control>plus` draws `+` and not
 * `Plus`. `space` is deliberately absent — its character is not `isgraph`, so the
 * C falls through to the glyph branch and draws `␣` (:306-308).
 */
const ASCII_KEYSYMS: Readonly<Record<string, string>> = {
    exclam: '!',
    quotedbl: '"',
    numbersign: '#',
    dollar: '$',
    percent: '%',
    ampersand: '&',
    apostrophe: "'",
    parenleft: '(',
    parenright: ')',
    asterisk: '*',
    plus: '+',
    comma: ',',
    minus: '-',
    period: '.',
    slash: '/',
    colon: ':',
    semicolon: ';',
    less: '<',
    equal: '=',
    greater: '>',
    question: '?',
    at: '@',
    bracketleft: '[',
    backslash: '\\',
    bracketright: ']',
    asciicircum: '^',
    underscore: '_',
    grave: '`',
    braceleft: '{',
    bar: '|',
    braceright: '}',
    asciitilde: '~',
};

/**
 * Keys drawn as a glyph or a msgid rather than as their name (:284-331).
 *
 * The four Apple-only entries are `#ifdef`-ed upstream: on any other platform
 * those keys fall through to the name branch and draw `Escape`, `Tab`,
 * `BackSpace`, `Delete`.
 */
const GLYPH_KEYS: Readonly<Record<string, { default?: string; apple?: string }>> = {
    Left: { default: '←' },
    Up: { default: '↑' },
    Right: { default: '→' },
    Down: { default: '↓' },
    space: { default: '␣' },
    Return: { default: '⏎' },
    Page_Up: { default: 'Page_Up' },
    Page_Down: { default: 'Page_Down' },
    Escape: { apple: '⎋' },
    Tab: { apple: '⇥' },
    BackSpace: { apple: '⌫' },
    Delete: { apple: '⌦' },
};

/** `\` gets a WORD, not the character — the one escape that is not markup (:267-269). */
const BACKSLASH_LABEL = 'Backslash';

/** An accelerator split into its modifiers and its key name. */
interface ParsedAccelerator {
    readonly modifiers: ReadonlySet<Modifier>;
    readonly key: string;
}

/**
 * `gtk_accelerator_parse`, over names instead of keyvals.
 *
 * Returns `null` for a malformed accelerator — an unterminated `<`, an unknown
 * modifier name, or no key at all. Every one of those is decidable without the
 * keysym table; an unknown KEY name is not, and is accepted (see the header).
 */
export function parseAccelerator(
    accelerator: string,
    platform: 'default' | 'apple' = 'default',
): ParsedAccelerator | null {
    const modifiers = new Set<Modifier>();
    let rest = accelerator;

    while (rest.startsWith('<')) {
        const end = rest.indexOf('>');
        if (end === -1) return null;

        const name = rest.slice(1, end).toLowerCase();
        rest = rest.slice(end + 1);

        // `<Release>` is a press/release marker, not a modifier: GTK strips it
        // and it contributes no keycap.
        if (name === 'release') continue;

        const modifier = MODIFIER_NAMES[name];
        if (!modifier) return null;

        modifiers.add(modifier === 'primary' ? (platform === 'apple' ? 'meta' : 'control') : modifier);
    }

    if (rest.length === 0) return null;

    return { modifiers, key: rest };
}

/** The keycap for the key itself — everything after the modifiers (:249-348). */
function keycapForKey(key: string, platform: 'default' | 'apple'): ShortcutKeycap {
    // A sided modifier key: `Control_L` draws the modifier label with an `L`
    // subscript (:115-196). Checked first, because `_L` would otherwise fall
    // through to the name branch and draw `Control_L`.
    const sided = /^([A-Za-z]+)_([LR])$/.exec(key);
    if (sided && SIDED_MODIFIER_KEYS[sided[1]]) {
        const modifier = SIDED_MODIFIER_KEYS[sided[1]];
        return { label: MODIFIER_LABELS[modifier][platform], sideMarker: sided[2] as 'L' | 'R' };
    }

    const glyph = GLYPH_KEYS[key];
    if (glyph) {
        const label = platform === 'apple' ? (glyph.apple ?? glyph.default) : glyph.default;
        if (label) return { label };
    }

    // The keypad: `KP_Home` keeps its name, but a keypad key with a PRINTABLE
    // character gets the `KP ` prefix and the character (:272-276).
    const keypad = /^KP_(.+)$/.exec(key);
    if (keypad) {
        const inner = printableFor(keypad[1]);
        if (inner) return { label: `KP ${inner.toUpperCase()}` };
    }

    const printable = printableFor(key);
    if (printable) {
        return { label: printable === '\\' ? BACKSLASH_LABEL : printable.toUpperCase() };
    }

    // `gdk_keyval_name (gdk_keyval_to_lower (key))` (:333): a one-character name
    // is upper-cased, anything longer is passed to the translation as-is.
    return { label: key.length === 1 ? key.toUpperCase() : key };
}

/** The character a keysym name stands for, or `null` if it is not a printable one. */
function printableFor(name: string): string | null {
    if (name.length === 1) {
        const code = name.codePointAt(0) ?? 0;
        // `ch && ch < 0x80 && g_unichar_isgraph (ch)` (:250) — space excluded.
        return code > 0x20 && code < 0x7f ? name : null;
    }
    return ASCII_KEYSYMS[name] ?? null;
}

/** Every keycap of one accelerator: modifiers in GTK's order, then the key (:198-357). */
export function shortcutKeycaps(
    accelerator: string,
    platform: 'default' | 'apple' = 'default',
): readonly ShortcutKeycap[] | null {
    const parsed = parseAccelerator(accelerator, platform);
    if (!parsed) return null;

    const keys: ShortcutKeycap[] = [];
    for (const modifier of MODIFIER_ORDER) {
        if (parsed.modifiers.has(modifier)) keys.push({ label: MODIFIER_LABELS[modifier][platform] });
    }
    keys.push(keycapForKey(parsed.key, platform));

    return keys;
}

/**
 * The accessible string for one accelerator — `gtk_accelerator_get_label`
 * (:419-426), which is the user-facing localized form and NOT the
 * `aria-keyshortcuts` one.
 */
function accessibleFor(keys: readonly ShortcutKeycap[]): string {
    return keys.map((key) => (key.sideMarker ? `${key.label} ${key.sideMarker}` : key.label)).join('+');
}

/**
 * Parse an accelerator into the nodes a renderer draws.
 *
 * The four grammar levels of the widget's own `rebuild` → `parse_range` →
 * `parse_sequence` → `parse_combination` chain (:398-544), in that nesting.
 */
export function parseShortcutLabel(accelerator: string, options: ShortcutLabelOptions = {}): ShortcutLabelParse {
    const { disabledText = '', direction = 'ltr', platform = 'default' } = options;

    if (accelerator.length === 0) {
        return {
            nodes: [{ kind: 'disabled', text: disabledText }],
            accessibleLabel: disabledText,
            error: null,
        };
    }

    const nodes: ShortcutLabelNode[] = [];
    let accessible = '';
    let error: string | null = null;

    /** `parse_combination` (:397-432) — `&`-joined accelerators, no separator. */
    const combination = (part: string): boolean => {
        for (const accel of part.split('&')) {
            const keys = shortcutKeycaps(accel, platform);
            if (!keys) {
                error = accel;
                return false;
            }
            nodes.push({ kind: 'keys', keys });
            accessible += accessibleFor(keys);
        }
        return true;
    };

    /** `parse_sequence` (:434-461) — `+`-joined, with the direction-aware arrow. */
    const sequence = (part: string): boolean => {
        const arrow = direction === 'rtl' ? '←' : '→';
        const steps = part.split('+');
        for (const [index, step] of steps.entries()) {
            if (index > 0) {
                nodes.push({ kind: 'separator', text: arrow });
                accessible += arrow;
            }
            if (!combination(step)) return false;
        }
        return true;
    };

    /** `parse_range` (:463-485) — the FIRST `...` only, and `⋯` between the ends. */
    const range = (part: string): boolean => {
        const dots = part.indexOf('...');
        if (dots === -1) return sequence(part);

        if (!sequence(part.slice(0, dots))) return false;
        nodes.push({ kind: 'separator', text: '⋯' });
        // The accessible string uses `…`, not the `⋯` that is drawn (:478-479).
        accessible += '…';
        return sequence(part.slice(dots + 3));
    };

    for (const [index, alternative] of accelerator.split(' ').entries()) {
        if (index > 0) {
            nodes.push({ kind: 'separator', text: '/' });
            accessible += ' ';
        }
        // GTK warns and BREAKS, keeping the nodes it already built (:531-534).
        if (!range(alternative)) break;
    }

    return { nodes, accessibleLabel: accessible, error };
}
