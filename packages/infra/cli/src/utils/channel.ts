// The distribution channel (ADR 0113), as the CLI needs it: validate a value, and ask whether
// it permits donation UI. Mirrors `@gjsify/distribution`'s table on purpose and does not import
// it: the CLI would then depend on a package it must be able to build and publish first.

export const CHANNELS = ['flathub', 'web', 'microsoft-store', 'apple-app-store'] as const;
export type DeclaredChannel = (typeof CHANNELS)[number];

const DONATIONS: Readonly<Record<DeclaredChannel, boolean>> = {
    flathub: true,
    web: true,
    'microsoft-store': false,
    'apple-app-store': false,
};

/** Env var `gjsify ship` hands to the project's own build, which has no `--channel` to pass. */
export const CHANNEL_ENV = 'GJSIFY_CHANNEL';

/** The channel `value` names, or a refusal that lists the alternatives. `undefined` stays unset. */
export function parseDeclaredChannel(value: unknown, source: string): DeclaredChannel | undefined {
    if (value === undefined || value === '') return undefined;
    if ((CHANNELS as readonly unknown[]).includes(value)) return value as DeclaredChannel;
    throw new Error(`${source}: "${String(value)}" is not a distribution channel. Known: ${CHANNELS.join(', ')}.`);
}

/** Unset (an `unknown` build) permits no donation UI, as the ADR's quiet default. */
export function channelAllowsDonations(channel: string | undefined): boolean {
    return channel !== undefined && DONATIONS[channel as DeclaredChannel] === true;
}
