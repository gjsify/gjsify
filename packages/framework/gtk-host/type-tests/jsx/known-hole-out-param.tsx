// A HOLE THE VOCABULARY MIGRATION OPENED, kept as an executable fixture.
//
// `GtkSpinButton::input` has an `out` parameter GIR marks `caller-allocates="0"`.
// GJS passes an argument in that slot and it holds uninitialised memory — measured,
// `new_value` arrives as `6.9526682391035e-310`, an ordinary `number` that nothing
// warns about. The generator used to type it `OutParam` (`src/attrs.ts`), so reading
// it as a value was a compile error at the position the reader would have looked.
//
// Signal signatures are `@girs`' `SignalSignatures` since ADR 0029, and `@girs` 4.5.0
// spells that parameter `number`:
//
//     input: (new_value: number) => number;      // gtk-4.0.d.ts
//
// So the line below COMPILES, and that is the measurement. It was a `@ts-expect-error`
// negative in `negative-handlers.tsx` until the migration; leaving it there reported
// TS2578 (unused directive) and took the whole gate down, which says the directive is
// stale rather than what it is really about — the surface stopped refusing the reading.
//
// UPSTREAM, not a reason to re-derive the type here (`src/attrs.ts` says the same where
// `OutParam` is defined, and `OutParam` stays for hand-written signatures): ts-for-gir
// renders a `caller-allocates="0"` out parameter as its value type. Tracked in
// `status/open-todos.md` § The `@girs/*` vocabulary is consumed. When a released `@girs`
// spells it as something a `number` annotation cannot satisfy, this fixture turns RED and
// the line moves back to `negative-handlers.tsx` — a hole recorded only in prose is a hole
// nobody re-measures.
//
// The other direction still holds and is NOT a hole: `get-child-position` is
// `caller-allocates="1"`, the handler is handed a live `Gdk.Rectangle` to FILL, and
// `negative-handlers.tsx` keeps that case as a line that must compile.

/** Accepted, and should not be: `input`'s slot is not a value to read. */
export const readsOutParam = <gtk-spin-button onInput={(value: number) => value + 1} />;
