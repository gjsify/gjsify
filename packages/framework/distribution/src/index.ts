// @gjsify/distribution — where this build is distributed, and what that allows (ADR 0113, 0114).
// Pure TS, no platform imports: runs identically on GJS, Node and in a browser.

/** Compile-time define the CLI sets from `--channel` / `gjsify.ship.channel`. Absent in a plain `tsc` or test run. */
declare const __GJSIFY_CHANNEL__: string | undefined;

/** The closed set of channels a build can declare, plus `unknown` for a build that declared none. */
export type Channel = 'flathub' | 'web' | 'microsoft-store' | 'apple-app-store' | 'unknown';

/** What a channel permits. A new capability is a new field here, never a channel-name comparison in an app. */
export interface ChannelCapabilities {
    /** May the app show a donation / "support the project" link or prompt. */
    donations: boolean;
    /** Was this build bought. Only a store channel claims it; an unset channel never does (ADR 0114). */
    purchased: boolean;
}

/**
 * Names describe where a build is distributed, not what it may do — so a channel can become quiet
 * later without a rename. `unknown` is quiet on purpose: a donation line in a store build can cost a
 * rejection, a missing one in a free build costs a link the maintainer notices (ADR 0113 § 4).
 */
export const CHANNEL_CAPABILITIES: Readonly<Record<Channel, ChannelCapabilities>> = {
    flathub: { donations: true, purchased: false },
    web: { donations: true, purchased: false },
    'microsoft-store': { donations: false, purchased: true },
    'apple-app-store': { donations: false, purchased: true },
    unknown: { donations: false, purchased: false },
};

/** Every channel a user may declare (everything but `unknown`). */
export const DECLARABLE_CHANNELS: readonly Channel[] = ['flathub', 'web', 'microsoft-store', 'apple-app-store'];

/** Narrow a raw value to a declarable {@link Channel}; anything else is `undefined`. */
export function parseChannel(value: unknown): Channel | undefined {
    return typeof value === 'string' && (DECLARABLE_CHANNELS as readonly string[]).includes(value)
        ? (value as Channel)
        : undefined;
}

/** Whether `candidate` permits donation UI. Pure; the CLI uses it for the metainfo gate. */
export function donationsAllowedFor(candidate: Channel): boolean {
    return CHANNEL_CAPABILITIES[candidate].donations;
}

/**
 * The channel this build was made for. A direct `typeof` on the define keeps it substitutable: the
 * bundler replaces `__GJSIFY_CHANNEL__` with a string literal, so a store build drops the donation
 * branches instead of hiding them at runtime.
 */
export const channel: Channel =
    (typeof __GJSIFY_CHANNEL__ === 'undefined' ? undefined : parseChannel(__GJSIFY_CHANNEL__)) ?? 'unknown';

/** Whether this build may show donation UI. Ask this, never compare {@link channel} by name. */
export function donationsAllowed(): boolean {
    return donationsAllowedFor(channel);
}

/** Whether `candidate` is a channel where the app is bought. Pure; mirrors {@link donationsAllowedFor}. */
export function purchasedFor(candidate: Channel): boolean {
    return CHANNEL_CAPABILITIES[candidate].purchased;
}

/** Whether this build was bought, so the UI may thank the buyer. Ask this, never compare {@link channel} by name. */
export function purchased(): boolean {
    return purchasedFor(channel);
}
