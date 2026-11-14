// What a Background request asks for and how an answer is read, as pure functions.

/** `XDP_BACKGROUND_FLAG_AUTOSTART`. `wish.gjs.spec.ts` holds this against the typelib's own value. */
export const AUTOSTART_FLAG = 1 << 0;

export type BackgroundOutcome = 'granted' | 'denied';

/**
 * A request is the whole wish, not a delta (ADR 0144 § 1): without AUTOSTART it removes an
 * existing entry. This one predicate is the rule an implementer gets wrong by instinct.
 */
export function wantsAutostart(flags: number): boolean {
    return (flags & AUTOSTART_FLAG) !== 0;
}

/** `request_background_finish`'s boolean: `false` is the person saying no. Cancelled and broken throw instead. */
export function outcomeOf(granted: boolean): BackgroundOutcome {
    return granted ? 'granted' : 'denied';
}

export type ProbeVerdict = 'absent' | 'broken';

// The D-Bus errors a bus returns for "nobody serves this": the service is not installed or not
// running (and could not be activated), or it runs without the Background interface.
const ABSENT_ERRORS: ReadonlySet<string> = new Set([
    'org.freedesktop.DBus.Error.ServiceUnknown',
    'org.freedesktop.DBus.Error.NameHasNoOwner',
    'org.freedesktop.DBus.Error.UnknownObject',
    'org.freedesktop.DBus.Error.UnknownInterface',
    'org.freedesktop.DBus.Error.UnknownMethod',
    'org.freedesktop.DBus.Error.UnknownProperty',
]);

/**
 * Whether a failed probe means "no Background portal here" (fall through to the autostart file) or
 * "a portal answered and is unwell" (throw, never fall through). `remoteError` is the D-Bus error
 * name, or `null` for an error that did not come off the wire.
 */
export function classifyProbeError(remoteError: string | null): ProbeVerdict {
    return remoteError !== null && ABSENT_ERRORS.has(remoteError) ? 'absent' : 'broken';
}
