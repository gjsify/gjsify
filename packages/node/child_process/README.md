# @gjsify/child_process

GJS implementation of the Node.js `child_process` module using Gio.Subprocess. Supports exec, execSync, execFile, execFileSync, spawn, and spawnSync.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/child_process

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/child_process
yarn add @gjsify/child_process
```

## Usage

```typescript
import { execSync, spawn } from '@gjsify/child_process';

const output = execSync('echo hello').toString();
const child = spawn('ls', ['-la']);
```

## Platform support

Process spawning goes through `Gio.Subprocess`, which works on every platform
GIO runs on. The parts of Node's API that are inherently platform-specific are
resolved in `src/platform/` (`linux.ts` / `darwin.ts` / `win32.ts` behind an
`index.ts`, mirroring `@gjsify/os`). Detection is capability-based — the
filesystem is probed for what is actually there — so an unrecognised POSIX host
degrades to the generic POSIX answers rather than to a wrong one.

| Feature | Linux / Android | macOS | Windows |
|---|---|---|---|
| `shell: true` | `/bin/sh -c` (`/system/bin/sh` on Bionic) | `/bin/sh -c` | `%ComSpec%` (default `cmd.exe`) with `/d /s /c "<cmd>"`, matching Node |
| `shell: '<path>'` | that shell, `-c` | that shell, `-c` | that shell; `-c` unless it is `cmd`/`cmd.exe` |
| `timeout` (`spawnSync`) | ✅ in-process GLib timer | ✅ same | ✅ same |
| `timeout` / `signal` (`spawn`, `exec`, `execFile`) | ✅ | ✅ | ⚠️ kill degrades to `force_exit()` (see *Signals*) |
| `argv0` | ✅ via `bash -c 'exec -a "$0" "$@"'` | ✅ same | ❌ throws `ERR_UNSUPPORTED_OPERATION` |
| `detached` | ✅ via `setsid(1)` from `PATH` | ⚠️ no `setsid(1)` on stock macOS | ⚠️ no equivalent |
| `stdio` `pipe`/`inherit`/`ignore` | ✅ | ✅ | ✅ |
| `uid` / `gid` | accepted, no-op | accepted, no-op | accepted, no-op |
| `windowsHide` / `windowsVerbatimArguments` | accepted, no-op | accepted, no-op | accepted, no-op |

### Timeouts need no external binary

`options.timeout` on `spawnSync` used to be delegated to the GNU coreutils
`timeout(1)` binary, because `Gio.Subprocess.communicate()` blocks the calling
thread and never iterates a GLib main context — so a timer armed around it could
never fire.

It is now enforced in-process: `communicate_async()` is driven on a **private**
`GLib.MainContext` pushed as thread-default, with the deadline as a
`GLib.timeout_source_new()` attached to that same context. Iterating a private
context dispatches only our own sources, so no application timer, GTK event or
unrelated GIO callback can run — the re-entrancy profile is identical to the
blocking `communicate()` it replaces.

Besides removing the GNU-userland dependency (macOS ships `timeout` only as
Homebrew's `gtimeout`; Windows not at all), this reports the **real child pid**
in `result.pid` and the **real termination signal** in `result.signal`, both of
which the wrapper process used to mask.

`options.timeout` is **not** implemented for `execSync` / `execFileSync` on any
platform — it is accepted and ignored, as it was before.

### `detached`

Node implements `detached` as `setsid(2)` in the child on POSIX and
`DETACHED_PROCESS` / `CREATE_NEW_PROCESS_GROUP` on Windows. Neither is reachable
from GJS: `g_subprocess_launcher_set_child_setup()` is `(skip)`-annotated in the
GIR (it takes a raw C function pointer), `GSubprocess` never sets
`G_SPAWN_FILE_AND_ARGV_ZERO`, and `Gio.SubprocessLauncher` exposes no
`CreateProcess` creation flags.

The POSIX path therefore prepends the `setsid(1)` binary, resolved from `PATH`
(not hard-coded to `/usr/bin/setsid`, so Alpine/Nix layouts work).

**Degraded contract where no `setsid(1)` exists** (stock macOS, Windows): the
child is spawned normally and still outlives the parent — GIO sets no
`PR_SET_PDEATHSIG` equivalent and does not place children in a job object — but
it is **not** promoted to a session/process-group leader, so terminal-generated
signals (Ctrl-C `SIGINT`, `SIGHUP` on terminal close; a console Ctrl-C event on
Windows) still reach it. Installing `setsid` on macOS (`brew install util-linux`,
then put it on `PATH`) restores the full contract.

### `argv0`

Because the launcher's child-setup hook is not introspectable, `argv0` is
implemented by wrapping the spawn in a shell's `exec -a "$0" "$@"`, which issues
exactly the `execve()` Node's `posix_spawn` path does.

`exec -a` is a bash/ksh/zsh extension, **not** POSIX `sh` — on Debian/Ubuntu
`/bin/sh` is `dash` and has no `exec -a`. The shell for this wrapper is
therefore resolved as `bash` → `zsh` → the platform default shell, so the option
behaves correctly on dash-based distributions too.

On Windows there is no mechanism at all (no `exec -a` in `cmd.exe`, and GLib's
`protect_argv()` builds `lpCommandLine` from `argv[0]`), so `argv0` **throws**
an `Error` with `code: 'ERR_UNSUPPORTED_OPERATION'` rather than silently running
the child under the wrong name.

### Signals

`child.kill(signal)` and the `killSignal` used by `timeout` / `AbortSignal`
accept a name or a number. Names are translated through a **per-platform** table
because the numeric values genuinely differ: `SIGUSR1` is `10` on Linux but `30`
on macOS, `SIGSTOP` is `19` on Linux but `17` on macOS. Sending a Linux number
on macOS would deliver a completely different signal.

`SIGKILL` always routes through `Gio.Subprocess.force_exit()`. On Windows
`g_subprocess_send_signal()` is a documented no-op, so **every** signal routes
through `force_exit()` (`TerminateProcess`) — matching how Node maps
`SIGTERM`/`SIGKILL`/`SIGINT` there, but meaning a Windows child cannot be sent a
graceful, catchable signal.

### `windowsVerbatimArguments`

Node forces this on for the `cmd.exe` shell path so libuv does not re-quote the
already-quoted command string. GLib always builds the Windows command line
itself via `protect_argv()` and offers no opt-out, so the option is accepted and
ignored. A shell command containing embedded double quotes may therefore be
quoted differently under GJS than under Node on Windows.

## License

MIT
