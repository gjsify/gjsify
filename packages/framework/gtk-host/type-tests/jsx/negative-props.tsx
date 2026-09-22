// PROPERTY negatives: what must NOT be assignable to a real widget.
//
// Grammar and mechanism: see the header of `negative-tags.tsx`.

/** A property name no widget in the surface carries. */
// @ts-expect-error TS2322 — `noSuchProp` is not a member of GtkBoxProps
export const unknownProp = <gtk-box noSuchProp={1} />;

/** A real property, the wrong value type. */
// @ts-expect-error TS2322 — `spacing` is a number
export const wrongType = <gtk-box spacing="6" />;

/**
 * A real enum property, a nick outside the enum.
 *
 * This is the negative that carries the generator's enum work: the nick union is
 * derived from the GIR, so a nick that GTK would silently ignore at runtime
 * (`box.orientation = 'diagonal'` keeps HORIZONTAL with no diagnostic at all) is
 * a compile error here.
 */
// @ts-expect-error TS2322 — 'diagonal' is not a GtkOrientationNick
export const badNick = <gtk-box orientation="diagonal" />;

/**
 * A READ-ONLY GObject property, offered nowhere in the surface.
 *
 * `GtkWidget:scale-factor` is `readable` and not `writable` in the GIR, so the
 * generator emits no slot for it in either spelling. Writing a read-only property
 * does not throw in GJS — it is one of the three exit-0 failure modes the host
 * exists to make loud — so refusing it at the type level is the only place it can
 * be caught before it silently does nothing.
 */
// @ts-expect-error TS2322 — read-only properties are emitted in neither spelling
export const readOnlyProp = <gtk-box scaleFactor={2} />;

/** A `notify::` handler for a property that does not exist. */
// @ts-expect-error TS2322 — no such property, so no such notify handler
export const unknownNotify = <gtk-box onNotifyNonsuch={() => {}} />;

/** A DECLARED kebab spelling still checks its VALUE type. */
// @ts-expect-error TS2322 — 'baseline-child' is a number in both spellings
export const kebabWrongType = <gtk-box baseline-child="0" />;

/**
 * A menu model is a LIST, not one item.
 *
 * The widening is an added union member, not a replacement: whatever is written
 * still has to be a menu. A bare descriptor is the mistake an author actually makes
 * (it reads like `label={…}` one level up), and GObject would take the object as an
 * unconvertible value at runtime.
 */
// @ts-expect-error TS2353 — menuModel takes a list, or a real Gio.MenuModel
export const menuNotAList = <adw-split-button menuModel={{ label: 'Save as…' }} />;

/** A property that is not a `GMenuModel` is NOT widened — the overlay is a name list. */
// @ts-expect-error TS2322 — `label` is a string, and no menu model widens it
export const labelNotAMenu = <adw-split-button label={[{ label: 'Save as…' }]} />;

/** A list model is an ARRAY, not one item — the same shape as the menu negative above. */
// @ts-expect-error TS2353 — model takes a list, or a real Gio.ListModel; a descriptor's keys exist on neither
export const listNotAnArray = <adw-combo-row model={{ value: 'a', label: 'A' }} />;

/**
 * `model` is widened by the property's TYPE, not by its name.
 *
 * `Gtk.ListView:model` is a `Gtk.SelectionModel`, which a `Gtk.StringList` is not, so
 * the portable form is a compile error here — and, for a caller that reaches the host
 * untyped, a refusal by name at runtime (`list-model-mismatch`). One keying, two layers.
 */
// @ts-expect-error TS2740 — GtkListView.model is a Gtk.SelectionModel and is not widened, so string[] lacks its members
export const listViewNotWidened = <gtk-list-view model={['a', 'b']} />;

/**
 * A bare number is NOT an adjustment (ADR 0047 § 1): it would be the value, and `value`
 * is a property of its own on every widget that takes an adjustment.
 */
// @ts-expect-error TS2322 — adjustment takes an object of the six numbers, or a real Gtk.Adjustment
export const adjustmentNotANumber = <adw-spin-row adjustment={5} />;

/**
 * A BITFIELD property, a member nick outside the bitfield.
 *
 * The flags counterpart of `badNick` above, and it needs a negative of its own
 * because the member list comes from a different table: `@girs` publishes no nick
 * LIST for a bitfield — GObject resolves no nick set — so the surface derives the
 * union from `FLAG_VALUES`' keys instead.
 */
// @ts-expect-error TS2322 — 'spellchek' is not a GtkInputHintsNick
export const badFlagNick = <gtk-entry input-hints="spellchek" />;

/**
 * The FIRST member of a nick SET is checked exactly, and this is the line that says
 * how far that reaches: `${Nick}|${string}` pins member one and the host resolves
 * the rest, because checking every member of a set of arbitrary length means
 * enumerating its permutations. A typo in member TWO compiles here and is refused at
 * the call with `bad-flags` — which is why the runtime vectors exist.
 */
// @ts-expect-error TS2322 — the leading member of the set is not a GtkInputHintsNick
export const badFlagSetHead = <gtk-entry input-hints="spellchek|lowercase" />;

/**
 * AN ARIA NAME THAT DOES NOT EXIST — the hole `known-hole-hyphen.tsx` records, closed.
 *
 * A flat `aria-labell` attribute would be exempt from excess-property checking like every
 * other hyphenated JSX attribute; a key inside a FRESH OBJECT LITERAL is not. That is the
 * measured reason `accessibility` is one grouped prop and not 53 flat ones.
 */
// @ts-expect-error TS2561 — `labell` is not a member of AccessibilityAttributes, and TS suggests `label`
export const unknownAria = <gtk-label accessibility={{ labell: 'Save' }} />;

/**
 * A real ARIA slot, the wrong value type.
 *
 * `value-now` is a `double` in GTK's own ARIA table and there is no ParamSpec behind it, so
 * this is the only place a wrong type can be caught before GJS guesses a GValue and GTK
 * drops the write with a critical at exit 0.
 */
// @ts-expect-error TS2322 — `value-now` is a number slot
export const ariaWrongType = <gtk-label accessibility={{ 'value-now': 'three' }} />;

/**
 * An ARIA nick outside its enum — typed by the ARIA table, not by the widget.
 *
 * `checked` is a `GtkAccessibleTristate`, and `GtkLabel` has no `checked` property at all,
 * so nothing about the widget could have produced this union.
 */
// @ts-expect-error TS2322 — 'perhaps' is not a GtkAccessibleTristateNick
export const ariaBadNick = <gtk-label accessibility={{ checked: 'perhaps' }} />;

/**
 * A RELATION that points at another widget: the named gap, DECLARED and unwritable.
 *
 * Omitting these fourteen names would make the excess-property check say GTK has no such
 * name, which is false. `never` says whose gap it is, and hover carries the reason.
 */
// @ts-expect-error TS2322 — `labelled-by` needs a widget address this host has not got
export const ariaReference = <gtk-label accessibility={{ 'labelled-by': 'other' }} />;
