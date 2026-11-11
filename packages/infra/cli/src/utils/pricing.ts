// The pricing tier (ADR 0139), as the CLI needs it: validate a value. Mirrors
// `@gjsify/distribution`'s pricing() function on purpose and does not import it:
// the CLI would then depend on a package it must be able to build and publish first.

export const PRICINGS = ['free', 'paid'] as const;
export type DeclaredPricing = (typeof PRICINGS)[number];

/** Env var `gjsify ship` hands to the project's own build, which has no `--pricing` to pass. */
export const PRICING_ENV = 'GJSIFY_PRICING';

/** The pricing `value` names, or a refusal that lists the alternatives. `undefined` stays unset. */
export function parseDeclaredPricing(value: unknown, source: string): DeclaredPricing | undefined {
    if (value === undefined || value === '') return undefined;
    if ((PRICINGS as readonly unknown[]).includes(value)) return value as DeclaredPricing;
    throw new Error(`${source}: "${String(value)}" is not a pricing tier. Known: ${PRICINGS.join(', ')}.`);
}
