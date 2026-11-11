// @gjsify/distribution — where this build is distributed, and what that allows (ADR 0113, 0114, 0139).
// Pure TS, no platform imports: runs identically on GJS, Node and in a browser.

/** Compile-time define the CLI sets from `--channel` / `gjsify.ship.channel`. Absent in a plain `tsc` or test run. */
declare const __GJSIFY_CHANNEL__: string | undefined;

/** Compile-time define the CLI sets from `--pricing` / `gjsify.ship.pricing`. Absent means `'free'`. */
declare const __GJSIFY_PRICING__: string | undefined;

/** The closed set of channels a build can declare, plus `unknown` for a build that declared none. */
export type Channel = 'flathub' | 'web' | 'microsoft-store' | 'apple-app-store' | 'unknown';

/** How a user may support the project in this channel. */
export type SupportPath = 'external-link' | 'store-purchase' | 'none';

/** Which store commerce backend this channel has. */
export type Commerce = 'microsoft' | 'apple' | 'none';

/** What a channel permits. A new capability is a new field here, never a channel-name comparison in an app. */
export interface ChannelCapabilities {
    /** How a user may support the project in this channel. */
    support: SupportPath;
    /** Which store commerce backend this channel has. */
    commerce: Commerce;
    /** May the app unlock itself with its own licence key or account. */
    ownLicensing: boolean;
}

/**
 * Names describe where a build is distributed, not what it may do — so a channel can become quiet
 * later without a rename. `unknown` is quiet on purpose: a donation line in a store build can cost a
 * rejection, a missing one in a free build costs a link the maintainer notices (ADR 0113 § 4).
 */
export const CHANNEL_CAPABILITIES: Readonly<Record<Channel, ChannelCapabilities>> = {
    flathub: { support: 'external-link', commerce: 'none', ownLicensing: true },
    web: { support: 'external-link', commerce: 'none', ownLicensing: true },
    'microsoft-store': { support: 'none', commerce: 'microsoft', ownLicensing: true },
    'apple-app-store': { support: 'store-purchase', commerce: 'apple', ownLicensing: false },
    unknown: { support: 'none', commerce: 'none', ownLicensing: false },
};

/** Every channel a user may declare (everything but `unknown`). */
export const DECLARABLE_CHANNELS: readonly Channel[] = ['flathub', 'web', 'microsoft-store', 'apple-app-store'];

/** Narrow a raw value to a declarable {@link Channel}; anything else is `undefined`. */
export function parseChannel(value: unknown): Channel | undefined {
    return typeof value === 'string' && (DECLARABLE_CHANNELS as readonly string[]).includes(value)
        ? (value as Channel)
        : undefined;
}

/** How a user may support the project in `candidate`. Pure; the CLI uses it for the metainfo gate. */
export function supportPathFor(candidate: Channel): SupportPath {
    return CHANNEL_CAPABILITIES[candidate].support;
}

/**
 * The channel this build was made for. A direct `typeof` on the define keeps it substitutable: the
 * bundler replaces `__GJSIFY_CHANNEL__` with a string literal, so a store build drops the donation
 * branches instead of hiding them at runtime.
 */
export const channel: Channel =
    (typeof __GJSIFY_CHANNEL__ === 'undefined' ? undefined : parseChannel(__GJSIFY_CHANNEL__)) ?? 'unknown';

/** How a user may support the project in this build. Ask this, never compare {@link channel} by name. */
export function supportPath(): SupportPath {
    return supportPathFor(channel);
}

/**
 * Whether this build came from a paid listing. `__GJSIFY_PRICING__` is set by the CLI from
 * `gjsify.ship.pricing` (default `'free'`). Unknown values are treated as `'free'`.
 */
export function pricing(): 'free' | 'paid' {
    const value = typeof __GJSIFY_PRICING__ === 'undefined' ? 'free' : __GJSIFY_PRICING__;
    return value === 'paid' ? 'paid' : 'free';
}

/**
 * Whether `candidate` permits an external support link.
 * @deprecated Use {@link supportPathFor}(candidate) === 'external-link' instead.
 */
export function donationsAllowedFor(candidate: Channel): boolean {
    return supportPathFor(candidate) === 'external-link';
}

/**
 * Whether this build may show an external support link.
 * @deprecated Use {@link supportPath}() === 'external-link' instead.
 */
export function donationsAllowed(): boolean {
    return supportPath() === 'external-link';
}

/**
 * Whether `candidate` is a channel where the app is bought.
 * @deprecated Use {@link pricing}() === 'paid' instead; a free store download is not a purchase.
 */
export function purchasedFor(_candidate: Channel): boolean {
    return pricing() === 'paid';
}

/**
 * Whether this build was bought, so the UI may thank the buyer.
 * @deprecated Use {@link pricing}() === 'paid' instead; a free store download is not a purchase.
 */
export function purchased(): boolean {
    return pricing() === 'paid';
}
