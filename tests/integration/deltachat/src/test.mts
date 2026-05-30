// Integration-test entry for @gjsify/integration-deltachat.
//
// DeltaChat / chatmail core is distributed via:
//   - @deltachat/jsonrpc-client (pure JS JSON-RPC client + StdioDeltaChat
//     wrapper class — zero native deps)
//   - @deltachat/stdio-rpc-server (Node wrapper that spawns the binary
//     and pipes stdio — depends on platform-specific @deltachat/stdio-rpc-
//     server-<os>-<arch> as optionalDependency)
//   - @deltachat/stdio-rpc-server-linux-x64 (~27 MB static-PIE ELF binary
//     of the Rust core compiled with --features jsonrpc)
//
// What's tested:
//   - End-to-end spawn + JSON-RPC over stdio works on the target runtime
//     (Node baseline + GJS validation).
//   - Round-trips: getSystemInfo, checkEmailValidity, addAccount,
//     getAllAccountIds, removeAccount, getProviderInfo, sleep.
//
// Why this matters for gjsify:
//   - Validates that @gjsify/child_process (spawn via Gio.Subprocess) +
//     bidirectional stdio piping with a long-running subprocess work
//     end-to-end. This is the same pattern future GTK/Adwaita DeltaChat
//     apps would use.
//   - First integration suite that crosses the GJS↔native-subprocess
//     boundary in BOTH directions (the existing @gjsify/child_process unit
//     tests cover one-shot exec; here the subprocess outlives many JSON-
//     RPC round-trips).
//
// gjsify build runs with --globals 'auto' — the stdio + JSON-RPC code is
// pure JS, all Node built-ins go through their `node:`-prefix imports.

import { run } from '@gjsify/unit';
import deltaChatRpcSmokeSuite from './deltachat-rpc-smoke.spec.js';
import deltaChatBasicSuite from './basic.spec.js';

run({
    deltaChatRpcSmokeSuite,
    deltaChatBasicSuite,
});
