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
