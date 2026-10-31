/**
 * Re-exports the host's `Worker` global for browser and NativeScript builds.
 *
 * Node has no WHATWG `Worker`, so unlike its sibling `message-channel` this
 * package is NOT native there: a Node build keeps the adapter, which runs over
 * the native `node:worker_threads`. Only runtimes whose slot is `native` are
 * routed here.
 */
export const Worker = globalThis.Worker;
