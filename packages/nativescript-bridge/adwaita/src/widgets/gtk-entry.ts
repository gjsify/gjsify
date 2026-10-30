// GtkEntry — the Adwaita-styled GTK text entry for NativeScript.
//
// NAMED FOR THE LIBRARY THAT OWNS THE GTYPE (ADR 0034 clause 1): libadwaita styles
// `GtkEntry` in `_entries.scss` and subclasses nothing. `AdwEntryRow` is the row form and
// IS a genuine Adw type; this one is not, which the next paragraph already said in prose
// while the class name said otherwise.
//
// The bare input — what `Gtk.Entry` is, and the counterpart of
// `@gjsify/adwaita-web`'s `<gtk-entry>`: a filled, rounded field that stands on
// its own in a toolbar, a search bar or a form, NOT inside a boxed-list row.
// `AdwEntryRow` is the row form and keeps its floating title, pencil and apply
// button; none of that applies here.
//
// THE FIVE PROPERTIES ARE DECLARED, NOT HAND-ROLLED (ADR 0105 § 2, route D). `text`,
// `text-length`, `max-length`, `placeholder-text` and `editable` are GObject properties of
// this class, so on Android they live in the GObject's own store — which is what
// `bind_property` binds to and what `NodeGiGetProperty` reads. What the class kept before
// was a `_text` field plus a `_applyText` re-entrancy funnel; the seam's equal-write rule
// is that funnel now, and the two stores the old shape implied (the field's and `_text`'s)
// are one.
//
// NO CORE STATE MACHINE, DELIBERATELY: `EntryRowState`'s render state is row-shaped
// (`titleAsPlaceholder`, `showEdit`, `showApply`, the apply latch) and a bare entry has
// none of it. What the two share is the character arithmetic, which is where a port
// actually goes wrong: `clampEntryText` and `entryTextLength` count CODE POINTS, so
// `'🔒é'` is two characters and a truncation never splits a surrogate pair. Both come
// from `@gjsify/adwaita-core` (ADR 0004), and `clampEntryMaxLength` replaces the ceiling
// this class used to arrive at by hand.
//
// MEASURED ON GTK 4.22.5 / GJS, AND WHAT THIS PORT DOES WITH IT:
//
//   - `changed` COMES BEFORE `notify::text` on a programmatic write, and AFTER it on a
//     typed one. `gtk_editable_set_text` emits the signal and then notifies; `insert_text`
//     and `delete_text` — the keyboard's path — notify and then emit. Both orders are
//     reproduced, which is why `_applyText` takes the origin: a `changed` handler that
//     reads the widget sees the same sequence here as on GTK.
//   - `text` and `editable` are `GtkEditable` properties UPSTREAM, not `GtkEntry` ones
//     (`Gtk.Entry.find_property('text').owner_type` is `GtkEditable`). That is no obstacle
//     to declaring them: this class registers its own GType and implements no real
//     interface, so there is no interface slot to collide with — `AdwEntryRow` has
//     declared both since route D and the device leg carries it.
//   - `editable = false` DOES NOT REFUSE A WRITE, programmatic or `insert_text`. It is
//     about the pointer and the keyboard only, so it reaches the field and nothing else.
//   - SHRINKING `max-length` TRUNCATES the text already held, and the truncation notifies
//     FIRST: `changed`, `notify::text`, then `notify::max-length`. Growing it restores
//     nothing. Hence `explicitNotify` on `max-length` — the seam would otherwise put its
//     own notify ahead of the text it moves.
//   - AN EQUAL WRITE TO `placeholder-text` STILL NOTIFIES, where every other property here
//     guards. See the declaration.
//   - `max-length` clamps to `0 … 65535`: `-1` reads back `0` and `1000000` reads back
//     `65535`, which is `clampEntryMaxLength`'s range.
//
// AND THE THREE PLACES THIS PORT DELIBERATELY DIVERGES, each measured:
//
//   - GTK emits `changed` TWICE for a write to a non-empty entry, and emits `changed` plus
//     `notify::text` even for an EQUAL one — `gtk_editable_set_text` is
//     `delete_text (0, -1)` then `insert_text`, and a handler between the two reads `''`.
//     This port has no `GtkEntryBuffer` and no delete/insert decomposition, so there is no
//     transient `''` to report and it emits once per real change, nothing for an equal
//     write. Reproducing the pair would mean announcing a value the text never held.
//   - `Gtk.Entry` NEVER notifies `text-length`; the length notification lives on the
//     buffer, as `GtkEntryBuffer:length`. This port has no buffer, so a consumer would
//     have nowhere to listen — `text-length` notifies here, exactly as the vendored
//     `Adw.EntryRow` does (measured: `changed`, `notify::text`, `notify::text-length`).
//   - writing `null` to `text` leaves the value standing upstream (a `text != NULL`
//     assertion, no change, no emission) and `''` is what `AdwEntryRow` resolves it to.
//     This class follows the measurement rather than its sibling, so a `null` is refused
//     in `normalize` and changes nothing.
//
// STRUCTURE: a box around a `TextField`, not a `TextField` subclass, because the two
// halves of the appearance are set in different places. Android's Material `EditText`
// draws a bottom underline Adwaita has nowhere, and stripping it takes an INLINE
// `backgroundColor: 'transparent'` + `borderWidth: 0` on the field. An inline value is
// not overridable from CSS, so the field cannot also carry the Adwaita FILL — the box
// does, out of `theme/adwaita.css`, where a `.ns-dark` rule can answer the light/dark
// question an inline value could not.
//
// `Gtk.Entry:activates-default` is deliberately absent: libadwaita vendors no
// `adw-entry.c`, so it would be a guess. `AdwEntryRow` carries an `activatesDefault`
// because `Adw.EntryRow` IS vendored and states its semantics, and the `max-length`
// ceiling below comes from that same vendored declaration. `Gtk.Entry:visibility` is
// absent for a different reason, recorded in `shadowed-properties.ts`: NativeScript's
// `View.visibility` already owns the name and means something else entirely.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_entries.scss (the `entry`
//   surface: min-height 34, 9px horizontal padding, `$button_color` fill)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, ItemSpec, TextField } from '@nativescript/core';
import { clampEntryMaxLength, clampEntryText, entryTextLength } from '@gjsify/adwaita-core';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { readDeclaredValue, withSignals, type GObjectNotify } from './signals.js';

/** Event name emitted when {@link GtkEntry.text} changes. Mirrors GObject `notify::text`. */
export const NOTIFY_TEXT = 'notify::text';

/** Event name emitted when {@link GtkEntry.textLength} changes. Mirrors `notify::text-length`. */
export const NOTIFY_TEXT_LENGTH = 'notify::text-length';

/** Event name emitted when {@link GtkEntry.maxLength} changes. Mirrors `notify::max-length`. */
export const NOTIFY_MAX_LENGTH = 'notify::max-length';

/** Event name emitted when {@link GtkEntry.placeholderText} changes. */
export const NOTIFY_PLACEHOLDER_TEXT = 'notify::placeholder-text';

/** Event name emitted when {@link GtkEntry.editable} changes. */
export const NOTIFY_EDITABLE = 'notify::editable';

/** Event name emitted when the return key is pressed — `Gtk.Entry::activate`. */
export const ACTIVATE = 'activate';

/** `Gtk.Editable::changed` — every change of the text, typed or set. */
export const CHANGED = 'changed';

/**
 * The entry a declared property's {@link DeclaredProperty.normalize} reads its siblings off.
 * Structural, because `normalize` is handed a bare `object` while the instance may still be
 * constructing — the `EntryRowValues` precedent, and the same reason a cast to `GtkEntry`
 * would be a lie there.
 */
interface EntryValues {
    readonly text: string;
    readonly maxLength: number;
}

export class GtkEntry extends withSignals(GridLayout, {
    GTypeName: 'GtkEntry',
    Properties: {
        text: {
            kind: 'string',
            default: '',
            // `explicitNotify` because this property OWES AN ORDER the seam cannot produce:
            // `changed` before `notify::text` when written, after it when typed (measured —
            // see the module header). A store that notified on change would have put
            // `notify::text` first in both directions, and `afterNotify` cannot take it back.
            explicitNotify: true,
            blurb: 'The contents of the entry',
            // Truncation belongs HERE and not in a `notify::text` handler: a handler runs
            // after the store already took the over-long value, and a refusal or a rewrite
            // from one cannot be seen at all (see `signals.ts` on logged handler exceptions).
            // A `null` resolves to the text already held, which is how upstream's refusal
            // reads through a seam that has no veto: the equal-write rule drops it.
            normalize: (value, self) =>
                value === null || value === undefined
                    ? (self as EntryValues).text
                    : clampEntryText(String(value), (self as EntryValues).maxLength),
            afterNotify: (self) => (self as GtkEntry)._applyText(),
        },
        'text-length': {
            kind: 'uint',
            default: 0,
            blurb: 'Number of characters in the text',
            // Read-only upstream (`G_PARAM_READABLE` alone, measured), and read-only here BY
            // DERIVATION: the normalizer ignores what was written and answers with the count
            // of this entry's OWN text, so a write resolves to the value already held and the
            // equal-write rule drops it. `AdwEntryRow:text-length` states the same thing.
            normalize: (_value, self) => entryTextLength((self as EntryValues).text),
        },
        'max-length': {
            kind: 'int',
            default: 0,
            // `explicitNotify` because the truncation this write can cause notifies BEFORE it
            // (measured): `changed`, `notify::text`, then `notify::max-length`. The seam's own
            // notify would have come first.
            explicitNotify: true,
            blurb: 'Maximum number of characters for this entry',
            // `readDeclaredValue` first, so `<gtk:Entry maxLength="12">` reads the same as on a
            // property with no normalizer at all; the clamp to `0 … 65535` is what this one
            // ADDS. The ceiling is `Adw.EntryRow:max-length`'s (`ENTRY_ROW_MAX_LENGTH_LIMIT`,
            // adw-entry-row.c:678-682) and the measurement agrees: `1000000` reads back
            // `65535`, `-1` reads back `0`.
            normalize: (value) => clampEntryMaxLength(readDeclaredValue('max-length', 'int', value) as number),
            afterNotify: (self) => (self as GtkEntry)._applyMaxLength(),
        },
        'placeholder-text': {
            kind: 'string',
            default: '',
            blurb: 'Show text in the entry when it is empty and unfocused',
            // `gtk_entry_set_placeholder_text` guards on nothing at all, so an EQUAL write
            // notifies every time — measured, and the reason this property declares `changed`.
            // `GtkImage:icon-name` and `AdwActionRow:subtitle` are the other two that cannot
            // use the identity answer. A `null` reads back `''`, as it does upstream.
            normalize: (value) => (value === null || value === undefined ? '' : String(value)),
            changed: () => true,
            afterNotify: (self) => (self as GtkEntry)._applyPlaceholderText(),
        },
        editable: {
            kind: 'boolean',
            default: true,
            blurb: 'Whether the entry contents can be edited',
            // It gates the KEYBOARD and nothing else: a programmatic write to `text`, and even
            // an `insert_text`, still lands on a non-editable entry (measured). So this reaches
            // the field and takes part in no refusal.
            afterNotify: (self) => (self as GtkEntry)._applyEditable(),
        },
    },
    Signals: {
        // `GtkEditable::changed` and `GtkEntry::activate`, both parameterless upstream. A
        // `notify::` carries a `GParamSpec` and these carry nothing, so a handler that wants
        // the new text reads the emitter: `(self) => self.text`.
        changed: {},
        activate: {},
    },
}) {
    static readonly GTypeName: string = 'GtkEntry';

    /** The real input. Chrome-less: the box around it paints the Adwaita surface. */
    protected readonly _field: TextField;

    /**
     * Whether the write being applied came from the keyboard. It decides the ORDER
     * {@link _applyText} emits in, and nothing else — see the module header's measurement.
     */
    private _typing = false;

    /** The entry's contents, truncated to {@link maxLength}. Declared above; the seam installs it. */
    declare text: string;

    /**
     * `Gtk.Entry:text-length` — the number of CHARACTERS, not UTF-16 units, so `'🔒é'` is 2.
     *
     * READ-ONLY, as upstream declares it: a write is normalized back to the count derived from
     * this entry's own {@link text} and so changes nothing (see the declaration). Not `readonly`
     * in TypeScript, because the seam installs one accessor pair per declared property and this
     * widget is what writes the derived value.
     */
    declare textLength: number;

    /** `Gtk.Entry:max-length` — maximum number of characters, `0` = unlimited. */
    declare maxLength: number;

    /** Placeholder shown while the entry is empty (`Gtk.Entry:placeholder-text`). */
    declare placeholderText: string;

    /** Whether the entry accepts edits (`GtkEditable:editable`). */
    declare editable: boolean;

    /** GJS's `notify('<prop>')` beside NativeScript's `notify({ eventName })`; see the seam. */
    declare notify: GObjectNotify;

    constructor(props?: ConstructProps<GtkEntry>) {
        super();

        this.className = 'adw-entry';
        this.addColumn(new ItemSpec(1, 'star'));
        this.addRow(new ItemSpec(1, 'auto'));

        const field = new TextField();
        field.className = 'adw-entry-input';
        // Android's Material TextField draws a bottom underline; an Adwaita entry
        // has none — its outline IS the filled rounded box. Strip it by making
        // the field chrome-less, exactly as `AdwEntryRow` does; `.set()` because
        // `borderWidth` is outside the ambient `ns-core.d.ts` slice.
        field.set('backgroundColor', 'transparent');
        field.set('borderWidth', 0);
        this.addChild(field);
        this._field = field;

        // Every edit goes through the declared property, so max-length counts CHARACTERS and a
        // keystroke notifies on the same path a programmatic write does — the one difference
        // being the emission order, which `_typing` carries.
        field.addEventListener('textChange', () => {
            const outer = this._typing;
            this._typing = true;
            try {
                this.text = this._field.text ?? '';
            } finally {
                this._typing = outer;
            }
        });
        field.addEventListener('returnPress', () => this.emit(ACTIVATE));

        applyConstructProps(this, props);
    }

    /**
     * What a `text` write does once the seam holds the normalized value: push the field, move
     * the derived length, and emit in the MEASURED order.
     *
     * Writing the field re-enters through `textChange`, which writes this very value back; the
     * seam's equal-write rule drops it, and that is what retired the old re-entrancy funnel.
     * The origin is read BEFORE that write, because the handler it re-enters assigns `_typing`
     * and the flag is no longer this call's once the field has been touched.
     */
    private _applyText(): void {
        const typed = this._typing;
        const text = this.text;
        if (this._field.text !== text) this._field.text = text;

        if (typed) {
            this.notify('text');
            this.emit(CHANGED);
        } else {
            this.emit(CHANGED);
            this.notify('text');
        }

        // Derived and read-only, so the value written here is re-derived by the normalizer; what
        // this write decides is only WHEN the notify lands, which is after `text`'s — the order
        // the vendored `Adw.EntryRow` measures.
        this.textLength = entryTextLength(text);
    }

    /**
     * What a `max-length` write does: re-run the held text against the new ceiling, so a
     * SHRINKING limit truncates what is already there, and only then announce the limit —
     * `changed`, `notify::text`, `notify::max-length`, as measured.
     */
    private _applyMaxLength(): void {
        // Through a local because a literal `this.text = this.text` is a lint error. The write
        // re-enters `normalize`, which clamps against the ceiling just stored; a text that
        // already fits resolves to itself and the equal-write rule keeps it silent.
        const held = this.text;
        this.text = held;
        this.notify('max-length');
    }

    /** `placeholder-text` reaches the field's hint and nothing else. */
    private _applyPlaceholderText(): void {
        this._field.hint = this.placeholderText;
    }

    /** `editable` gates the keyboard only — see the declaration. */
    private _applyEditable(): void {
        this._field.editable = this.editable;
    }

    /** `gtk_editable_get_text`. */
    get_text(): string {
        return this.text;
    }

    /** `gtk_editable_set_text`. */
    set_text(text: string): void {
        this.text = text;
    }

    /** `gtk_entry_get_max_length`. */
    get_max_length(): number {
        return this.maxLength;
    }

    /** `gtk_entry_set_max_length`. */
    set_max_length(max: number): void {
        this.maxLength = max;
    }

    /** The inner `TextField` — for focus, selection and host-specific keyboard options. */
    get field(): TextField {
        return this._field;
    }
}
