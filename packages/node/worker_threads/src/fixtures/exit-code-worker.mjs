// SPDX-License-Identifier: MIT
// Exits with a non-zero code on purpose, the way `process.exit(3)` does in a
// Node worker: no error was thrown, so the parent must see `exit` 3 and no
// `error` event. Runs under Node and bare GJS.

const ctx = globalThis.__gjsify_worker_context;
if (ctx) {
    ctx.exit(3);
    // The exit only lands once the script yields; park so nothing runs after it.
    await new Promise(() => {});
} else {
    process.exit(3);
}
