// @gjsify/devtools-mcp — how the bridge decides WHERE to dial the app. Pure logic, so a
// spec can check the precedence.

/** The transport the bridge uses to reach `org.gjsify.Devtools`. */
export type ClientTransportChoice =
    /** A `Gio.DBusServer` peer address (no bus daemon, no bus name). */
    | { kind: 'peer'; address: string; source: 'option' | 'env' | 'address-file' }
    /** The session bus, addressed by the app's well-known bus name. */
    | { kind: 'session-bus' }
    /** Nothing to dial — the caller must explain all three ways in. */
    | { kind: 'unavailable' };

/**
 * The bridge-side PRECEDENCE, mirroring `installDevtools`' app-side one:
 *
 * | option address | `GJSIFY_DEVTOOLS_ADDRESS` | published address file | session bus | choice |
 * |---|---|---|---|---|
 * | set   | any | any     | any | `peer` (option) |
 * | unset | set | any     | any | `peer` (env) |
 * | unset | unset | present | any | `peer` (address file) |
 * | unset | unset | absent  | yes | `session-bus` — **Linux is byte-unchanged** |
 * | unset | unset | absent  | no  | `unavailable` |
 *
 * The published address FILE deliberately outranks the session bus, because it is
 * POSITIVE evidence: it exists only while an app of exactly this id runs on the peer
 * transport, and the app deletes it on shutdown, whereas "a session bus exists" says
 * nothing about the app. Ranked the other way, an app launched with an explicit
 * `GJSIFY_DEVTOOLS_ADDRESS` on a Linux desktop was reported as "no devtools-enabled app
 * on the session bus". In the default case that row is a stat() that misses, since
 * nothing in bus mode writes an address file.
 */
export function chooseClientTransport(input: {
    optionAddress?: string | null;
    envAddress?: string | null;
    addressFileValue?: string | null;
    sessionBusAvailable: boolean;
}): ClientTransportChoice {
    if (input.optionAddress) return { kind: 'peer', address: input.optionAddress, source: 'option' };
    if (input.envAddress) return { kind: 'peer', address: input.envAddress, source: 'env' };
    if (input.addressFileValue) return { kind: 'peer', address: input.addressFileValue, source: 'address-file' };
    if (input.sessionBusAvailable) return { kind: 'session-bus' };
    return { kind: 'unavailable' };
}
