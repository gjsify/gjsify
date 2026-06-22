// @gjsify/devtools-protocol — shared contract constants.

/**
 * The well-known DBus interface name. It is constant across apps — each app
 * implements it on its own bus name + object path (see {@link resolveBusAddress}).
 * Both the in-app adapter (@gjsify/devtools) and the MCP bridge
 * (@gjsify/devtools-mcp) import it, so they always agree on the interface.
 */
export const DEVTOOLS_INTERFACE = 'org.gjsify.Devtools';
