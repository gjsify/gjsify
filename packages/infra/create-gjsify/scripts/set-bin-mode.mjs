// Mark the built entry point executable.
//
// WHY A SCRIPT AND NOT `chmod +x`
//
// This step used to be the tail of the `build` script:
//
//   node scripts/process-template.mjs && tsc && chmod +x ./lib/index.js
//
// npm runs package scripts through `cmd.exe` on Windows, which has no `chmod`,
// so the whole script exited 1 — AFTER `tsc` had already emitted `lib/`. The
// package was therefore built and then reported as failed, and because
// `gjsify run build:infra` chains its steps with `&&`, that took the entire
// toolchain bootstrap down with it on a stock Windows box.
//
// It hid well: measured on the win32 VM, `build:infra` completed under a
// git-bash shell (whose `C:\Program Files\Git\usr\bin` supplies a real `chmod`)
// and failed under `cmd.exe`, which is what npm actually uses. Same tree, same
// commit, different answer — so "it builds on Windows" needed the shell
// spelled out to mean anything.
//
// Same fix and same reasoning as `@gjsify/cli`'s `scripts/build-assets.mjs`
// (c0b845d); this package is the other half of that chain.
//
// `fs.chmod` on Windows only toggles the read-only flag — there is no execute
// bit — so the call is a harmless no-op there rather than something to branch
// on. The mode still matters on POSIX and in the published tarball, where npm
// records it for the `bin` entry.

import { chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = dirname(dirname(fileURLToPath(import.meta.url)));

chmodSync(join(pkgRoot, 'lib', 'index.js'), 0o755);
