/**
 * The two name transforms this package's DIALECT owns.
 *
 * Everything else that used to live here — the GIR-type-to-TypeScript mapper, the
 * enum-nick unions, the `@girs` package map — moved into `@girs/<ns>/vocabulary`
 * with ADR 0029, which renders each property's type in its own `.d.ts` and ships
 * the nicks as data. What no vocabulary can answer is how a FRAMEWORK spells a
 * member, because every framework spells it differently; that is dialect, it stays
 * here, and it is why this file is `names.mts` and no longer `tsmap.mts`.
 *
 * Both are also read by `generated.spec.ts`, which runs them against the host's own
 * inverse (`toSignalName`) over every generated name. Two independent
 * implementations checked against each other is the point: nothing made them agree,
 * and the first run of that check found that they did not.
 */

/** `row-activated` -> `onRowActivated`; `notify` handled by the caller. */
export const eventPropOf = (signal: string): string =>
    `on${signal.replace(/(^|[-_])([a-z0-9])/g, (_, __, c: string) => c.toUpperCase())}`;

/** `can-focus` -> `canFocus`. The inverse of the host's `toPropertyName`. */
export const camelOf = (kebab: string): string => kebab.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
