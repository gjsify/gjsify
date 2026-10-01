// SPDX-License-Identifier: MIT
// "Can this host translate at all?" — one answer, shared by the locale tests.
//
// GNU gettext refuses to translate while LC_MESSAGES is the C locale, and
// `setlocale` only leaves C for a locale the host has actually GENERATED. So a
// translation test needs a real locale the way a GTK test needs a display, and
// the gate states that requirement instead of letting the suite go quietly
// vacuous where it is unmet.
//
// MEASURED, and it is why `C.UTF-8` is not in the candidate list: on glibc 2.43
// a catalog bound under `LC_ALL=C.UTF-8 LANGUAGE=de` still returns the untranslated
// msgid — glibc treats the C.UTF-8 locale as the C locale for message lookup and
// ignores LANGUAGE there, exactly as it does for plain `C`. C.UTF-8 is the ONLY
// locale `glibc-minimal-langpack` (the Fedora container base) generates, which is
// why `.docker/ci-fedora.Dockerfile` installs a langpack for the suite.
//
// The language the CATALOG is written for is independent of the locale that is
// set: with LC_MESSAGES at any non-C locale, `LANGUAGE` picks the catalog
// directory (measured: `LC_ALL=en_US.utf8 LANGUAGE=de` reads `de/LC_MESSAGES/`).
// So the tests need ONE fixture language and ANY usable locale, not a matching pair.
//
// Plus the launcher contract for the PROBE CHILD, which is a different question
// and was the wrong runtime's answer by accident. See `probeLauncher()`.
import { execFileSync } from 'node:child_process';

/** The catalog directory the fixtures are written to, selected via `LANGUAGE`. */
export const FIXTURE_LANGUAGE = 'de';

/**
 * Locales to try when the host cannot enumerate them (`locale -a` is POSIX and
 * absent on Windows). Ordered by how reliably a runner has them generated.
 */
const FALLBACK_CANDIDATES = ['en_US.UTF-8', 'de_DE.UTF-8', 'en_US.utf8', 'de_DE.utf8'];

function enumerateLocales() {
    if (process.platform === 'win32') return FALLBACK_CANDIDATES;
    try {
        const out = execFileSync('locale', ['-a'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        return out
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
    } catch {
        // `locale(1)` is not installed (a minimal container) — fall back to probing
        // the usual names, which costs one setlocale each and answers the same question.
        return FALLBACK_CANDIDATES;
    }
}

/**
 * A locale name this host can actually switch to, or `null`.
 *
 * The authority is `locale -a`, which lists the locales that have been GENERATED —
 * deliberately NOT node-gi's own `setlocale`, which is the thing these tests
 * measure. A gate built on the code under test reports "nothing to run here" for
 * exactly the defect it was written to catch, and the suite goes green by
 * skipping itself.
 *
 * Plain `C`, `POSIX` and the `C.*` family are excluded: they are always present
 * and never translate, so accepting one would hand the tests a locale that makes
 * every assertion pass for the wrong reason.
 *
 * @returns {string | null}
 */
export function findTranslatableLocale() {
    const isCLocale = (name) => name === 'C' || name === 'POSIX' || name.startsWith('C.');
    const candidates = enumerateLocales().filter((name) => !isCLocale(name));
    // UTF-8 first: a legacy-charset locale makes gettext transcode the catalog, so
    // a mismatch would show up as mojibake rather than as the thing under test.
    return candidates.find((n) => /utf-?8$/i.test(n)) ?? candidates[0] ?? null;
}

/** What to print when the gate is closed, so a vacuous run is never silent. */
export const NO_LOCALE_DIAGNOSTIC =
    'no non-C locale is generated on this host — install a langpack ' +
    '(Fedora: glibc-langpack-de, Debian/Ubuntu: locales + locale-gen de_DE.UTF-8)';

// ---------------------------------------------------------------------------
// WHICH RUNTIME RUNS THE PROBE CHILD
// ---------------------------------------------------------------------------

/**
 * Why the launcher is named rather than inherited. `process.execPath` is not
 * "the Node binary" — it is WHATEVER IS HOSTING, and it differs per runtime:
 * measured `/opt/homebrew/…/node`, `~/.bun/bin/bun` and `~/.deno/bin/deno`. A
 * probe spawned with it therefore inherits, silently and unstated, whatever
 * child-launch contract the HOST runtime happens to have, and each one is
 * different (see `PROBE_CHILD_ARGS`).
 *
 * The child's real requirement is a FRESH PROCESS with a FRESH ENVIRONMENT that
 * loads the addon — the probe has to be a child because `setlocale` is
 * process-global and the addon adopts the environment locale once, at load
 * (its own header says so). It requires NOTHING of the runtime: the fixture is
 * plain ESM plus `requireGi` and one `process.stdout.write`, and it needs no
 * Node semantics at all. Measured, green and exiting 0 under BOTH node (102ms)
 * and bun (64ms) on darwin/arm64, identically with and without `NODE_GI_NATIVE`
 * and identically from a node, bun or deno parent.
 *
 * So the runtime is a NAMED CHOICE the harness owns (`scripts/cross-runtime.mjs`
 * sets the variable below), not an accident of who is running.
 */
export const HOST_RUNTIME =
    typeof globalThis.Bun !== 'undefined' ? 'bun' : typeof globalThis.Deno !== 'undefined' ? 'deno' : 'node';

/** The variable that names the probe child's runtime. The HARNESS sets it. */
export const PROBE_RUNTIME_ENV = 'NODE_GI_PROBE_RUNTIME';

/**
 * The runtime the child runs on unless the harness names another: **node**.
 *
 * Not because Node is better at loading the addon — measured above, it is not
 * the point — but because it is the only one of the three whose child needs
 * NOTHING the parent does not already have. Bun's child has no measurable
 * requirement on darwin yet does not complete on `windows-latest` x64 (measured
 * there: `bun.exe` never returns, `scripts/cross-runtime.mjs bun` 38/39 — the CI
 * text in #1917). Deno's child needs permission flags, and only gets them by
 * inheritance: `deno run fixtures/locale-probe.mjs …` from a shell dies
 * `NotCapable: Requires env access to "GJSIFY_GTK_RUNTIME"`, while the same child
 * spawned from inside `deno test -A` succeeds — Deno forwards a parent `deno`'s
 * permissions to a spawned `deno`. Stating the flags instead of inheriting them
 * is the difference between a contract and an accident.
 *
 * The cross-runtime claim is NOT lost by this, because it does not live in the
 * child: `locale.test.mjs` asserts the addon adopted the AMBIENT locale of the
 * process hosting it, in-process, with no spawn at all. `locale` was the only
 * file in the subset that launched an addon-loading child (`int64`'s is gated
 * `if (isNode)`; the `cairo`/`cairo-canvas2d`/`struct-construct` spawns are `gjs`,
 * which does not exist on Windows), so it was the only file exposed to this.
 */
export const DEFAULT_PROBE_RUNTIME = 'node';

/** Flags a child needs BEFORE the script path, per runtime. */
export const PROBE_CHILD_ARGS = Object.freeze({
    node: [],
    bun: [],
    // `run` FIRST: `deno -A script.mjs` reads the flag as a V8 one and answers
    // `V8 did not recognize flag '-A'`. Subcommand-then-flags is the order
    // `cross-runtime.mjs` already uses for its own deno children.
    deno: ['run', '-A', '--node-modules-dir=manual'],
});

/**
 * The launcher for the probe child: a NAMED runtime, its command and its flags.
 *
 * The same runtime as this one resolves to `process.execPath` — that is the one
 * place the host's own binary is right, because it IS the binary being named.
 * Any other runtime resolves to its bare NAME for `PATH`, so a missing runtime
 * fails as a spawn error that names it. There is deliberately no third branch:
 * an unrecognised name throws, and nothing here can fall back to `process.execPath`.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ runtime: string, command: string, args: string[] }}
 */
export function probeLauncher(env = process.env) {
    const runtime = env[PROBE_RUNTIME_ENV] ?? DEFAULT_PROBE_RUNTIME;
    const extra = PROBE_CHILD_ARGS[runtime];
    if (extra === undefined) {
        throw new Error(
            `${PROBE_RUNTIME_ENV}=${JSON.stringify(runtime)} names no runtime this suite can launch a probe ` +
                `child on (known: ${Object.keys(PROBE_CHILD_ARGS).join(', ')}). Launching it anyway is the ` +
                `implicit-execPath shape this exists to remove: name the runtime or the gate fails.`,
        );
    }
    return Object.freeze({
        runtime,
        command: runtime === HOST_RUNTIME ? process.execPath : runtime,
        args: [...extra],
    });
}
