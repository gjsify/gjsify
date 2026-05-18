/**
 * Re-exports native MessageChannel/MessagePort globals for Node.js builds.
 *
 * On Node 22+ these are real globals (HTML spec implementation lives in
 * the runtime since Node 15). The `ALIASES_WEB_FOR_NODE` redirect in
 * `@gjsify/resolve-npm` points bare `message-channel` imports here on
 * Node so consumer code gets the native implementation.
 *
 * On GJS the bare `message-channel` specifier resolves to
 * `@gjsify/message-channel` instead — see `ALIASES_WEB_FOR_GJS`.
 */
export const MessageChannel = globalThis.MessageChannel;
export const MessagePort = globalThis.MessagePort;
