// The payload the packers see.
//
// One shape, read back off the staged tree rather than carried in memory from
// the planner. That is deliberate: it makes `gjsify ship --stage` and
// `gjsify ship --target deb` provably the same payload, because the second
// reads what the first wrote. A packer fed straight from the planner could
// drift from the staged tree and nothing would notice.

import { statSync } from 'node:fs';

/** One file in the payload, with its bytes. */
export interface PayloadEntry {
    /** Prefix-relative path, POSIX-separated, e.g. `bin/learn6502`. */
    path: string;
    /** POSIX mode bits. */
    mode: number;
    data: Uint8Array;
}

/**
 * The build stamp every header gets.
 *
 * `SOURCE_DATE_EPOCH` is the cross-ecosystem convention and wins when it is
 * set. Without it the stamp is the BUNDLE's mtime — never `Date.now()`, which
 * is the one input guaranteeing that packing the same tree twice produces
 * different bytes, and never a fixed 0 either: `Build Date: 1 Jan 1970` is
 * what `rpm -qi` then shows a user, and an artifact that looks broken is a
 * support question. The mtime keeps the property that matters (pack the same
 * build twice, get the same bytes) while saying something true.
 *
 * Only the ASSEMBLING host runs this. A stage records the answer it got
 * (`.gjsify-ship-stage.json` → `mtime`) and the packing host reuses it: an
 * artifact upload does not carry mtimes, so re-stat'ing the stage there would
 * stamp every header with "whenever the download finished" and quietly destroy
 * the reproducibility this function exists to protect.
 */
export function buildTimestamp(bundlePath: string, env: Record<string, string | undefined> = process.env): number {
    const raw = env.SOURCE_DATE_EPOCH;
    if (raw !== undefined) {
        const parsed = Number(raw);
        if (!Number.isInteger(parsed) || parsed < 0) {
            throw new Error(`gjsify ship: SOURCE_DATE_EPOCH must be a non-negative integer, got "${raw}".`);
        }
        return parsed;
    }
    return Math.floor(statSync(bundlePath).mtimeMs / 1000);
}

/**
 * What the payload itself says about what it installs.
 *
 * Every field here used to be answered from the SETTINGS — `settings.iconFiles.length > 0`,
 * `settings.schemaFiles.length > 0`, `settings.typelibFiles` — i.e. from lists of absolute paths
 * on the BUILD host. Two things were wrong with that, and the second is why this function exists
 * at all:
 *
 *  1. It answered a different question than the one being asked. `cacheRefreshCommands` emits
 *     `gtk-update-icon-cache <prefix>/share/icons/hicolor` — the honest precondition is "did this
 *     package install anything into that directory", not "did the project have icon files lying
 *     around". They come apart for a `kind: 'cli'` project with a `data/icons/` folder: the
 *     planner stages no icon (icons are an `'app'` thing), the settings still listed them, and the
 *     postinst refreshed a cache for files that were never installed.
 *  2. An absolute build-host path cannot cross to the host that packs the artifact
 *     (ADR 0024 § A2). Carrying `iconFiles: ["/home/…/icon.svg"]` in a stage manifest so that
 *     `.length > 0` can be read on another machine is authoring a value that is measurable right
 *     there in the tree.
 *
 * Path-only, on purpose — `isArchIndependent` is the sibling that reads BYTES, and the two answer
 * different questions from the same payload. The same split as `plan.ts`'s `isExecutableAsset`
 * (by name) versus this module's magic sniffing (by content).
 *
 * NOT EVERY QUESTION BELONGS HERE, and one that does not was briefly added: "does this package need
 * a Node interpreter", derived from a `*.node.mjs` filename anywhere in the tree. Every fact above
 * is about something the package INSTALLS at a well-known path, which is why a path answers it.
 * That one was about what the launcher EXECS — and `discoverPayload` stages the whole directory
 * beside the bundle, so a `--app gjs` project that also builds a Node bundle carried the file and
 * ran neither. It lives on `settings.app` now, with `assertLauncherMatchesInterpreter` below as the
 * check. Before adding a field here, ask whether a path can answer it or only correlate with it.
 */
export interface PayloadFacts {
    /** The payload installs a `share/applications/*.desktop`. */
    hasDesktopEntry: boolean;
    /** The payload installs into `share/icons/hicolor/`. */
    hasIcons: boolean;
    /** The payload installs a compiled-on-install `share/glib-2.0/schemas/*.gschema.xml`. */
    hasSchemas: boolean;
    /** The payload installs a `share/mime/packages/*.xml`, so the mime cache needs rebuilding. */
    hasMimeTypes: boolean;
    /** Prefix-relative paths of the typelibs the payload carries itself. */
    bundledTypelibs: string[];
}

/**
 * Read {@link PayloadFacts} off a payload or off a plan.
 *
 * Takes anything with a `path`, so the assembling phase can ask the same
 * question of the PLAN (before the tree is read back) that the packing phase
 * asks of the payload. One function, so the two phases cannot disagree about
 * whether a package installs a schema.
 */
export function readPayloadFacts(entries: readonly { path: string }[]): PayloadFacts {
    const paths = entries.map((entry) => entry.path);
    return {
        hasDesktopEntry: paths.some((path) => path.startsWith('share/applications/') && path.endsWith('.desktop')),
        hasIcons: paths.some((path) => path.startsWith('share/icons/hicolor/')),
        hasSchemas: paths.some((path) => path.startsWith('share/glib-2.0/schemas/') && path.endsWith('.gschema.xml')),
        hasMimeTypes: paths.some((path) => path.startsWith('share/mime/packages/') && path.endsWith('.xml')),
        // Anywhere in the payload, not only `lib/<name>/gi/`: `gjsify.ship.extraFiles` can place
        // one elsewhere, and a typelib the package carries is a typelib the package must not also
        // declare a distro dependency for, wherever it sits.
        bundledTypelibs: paths.filter((path) => path.endsWith('.typelib')),
    };
}

/**
 * Every interpreter the STAGED launcher could exec, resolved to a bare name.
 *
 * WHY THIS IS READ BACK AT ALL, when `settings.app` already says so. Because
 * `settings.app` says what the launcher was RENDERED from, and the dependency is
 * a claim about what the installed package will RUN. Those were once two
 * different things: the Node dependency was derived from a filename glob over
 * the staged tree while `renderLauncher` execed `gjs` unconditionally, and the
 * packer emitted `Depends: gjs (>= 1.86), nodejs (>= 24)` for a package that
 * runs neither combination. Nothing in the pipeline compared them, and no
 * structural check could: both artifacts were individually well-formed.
 *
 * A LIST, and every `exec` rather than one of them. The first cut took the first
 * match while its own comment claimed the last — `/\nexec\s+/` is not global, so
 * the two disagreed and the comment was the wrong one. Neither is right for a
 * script this tree did not write: a launcher may exec different interpreters on
 * different branches, and picking one branch's answer is a guess. Collecting
 * them lets {@link assertLauncherMatchesInterpreter} ask the only question that
 * is safe on a foreign script — see there.
 *
 * NAMES, not the tokens as written. `exec /usr/bin/gjs -m …` execs gjs, and an
 * `env` prefix (`exec env NODE_OPTIONS=… node …`) execs whatever follows its
 * assignments. Both are things `gjsify.ship.extraFiles` legitimately writes, and
 * the raw-token version REFUSED them: measured, an untouched `--app gjs` project
 * whose `extraFiles` replaced the launcher with `exec /usr/bin/gjs -m …` failed
 * the pack at exit 1 with "execs `/usr/bin/gjs`, but this package would declare
 * a dependency on `gjs`" — a working artifact rejected over a parser, which is
 * exactly what the `null` branch was written to prevent and did not.
 */
export function readLauncherInterpreters(payload: readonly PayloadEntry[], binaryName: string): string[] {
    const launcher = payload.find((entry) => entry.path === `bin/${binaryName}`);
    if (launcher === undefined) return [];
    const text = new TextDecoder().decode(launcher.data);
    const found: string[] = [];
    // `[ \t]*` because a branching launcher indents the `exec` inside its `if`,
    // and a pattern anchored hard to the newline silently sees only the last,
    // unindented one — measured: a two-branch script reported `gjs` alone. A
    // comment (`# exec gjs …`) still cannot match, since `#` is not whitespace.
    for (const match of `\n${text}`.matchAll(/\n[ \t]*exec\s+([^\n]*)/g)) {
        const name = interpreterOf((match[1] as string).trim());
        if (name !== null) found.push(name);
    }
    return [...new Set(found)];
}

/**
 * The program an `exec` line runs, as a bare name, or `null` when the line is
 * not one this reader can honestly resolve.
 *
 * `env` is followed through because it is the documented way to pass variables
 * to an interpreter and says nothing about which one runs. Everything past the
 * first non-assignment word is arguments, so the walk stops there.
 */
function interpreterOf(line: string): string | null {
    let words = line.split(/\s+/).filter((word) => word.length > 0);
    for (let hop = 0; hop < 2 && words.length > 0; hop++) {
        const program = basenameOf(words[0] as string);
        if (program !== 'env') return program === '' ? null : program;
        // Past `env`: skip its flags and `NAME=value` assignments to reach the
        // program. `-S` takes the rest of the line as one string, which the split
        // above has already flattened into words — the right answer either way.
        words = words.slice(1).filter((word) => !word.startsWith('-') && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word));
    }
    return null;
}

/** Last path segment, POSIX or Windows — a launcher is generated text, not a path object. */
function basenameOf(token: string): string {
    const parts = token.split(/[/\\]/);
    return parts[parts.length - 1] ?? '';
}

/**
 * Refuse a package whose launcher execs an interpreter the package does not
 * depend on.
 *
 * THE RULE, and it is deliberately asymmetric: fail ONLY when the launcher
 * positively names the OTHER known interpreter and never names the declared one.
 * Everything else passes — no launcher, no `exec` this reader resolves, a program
 * that is neither `gjs` nor `node`, or a script whose branches include the
 * declared one.
 *
 * That asymmetry is the correction. The first cut failed whenever the resolved
 * token was not equal to the declared interpreter, and its own doc comment
 * claimed the opposite ("`null` is SILENT ... refusing a package because this
 * function did not understand a launcher somebody else wrote would fail a
 * working artifact over a parser"). The parser's failure mode is not `null` — it
 * answers confidently wrong. Measured on an otherwise untouched `--app gjs`
 * project whose `gjsify.ship.extraFiles` replaced `bin/<name>`:
 *
 *     exec /usr/bin/gjs -m …        → exit 1, "execs `/usr/bin/gjs`"
 *     exec env NODE_OPTIONS=… node… → exit 1, "execs `env`"
 *
 * Both worked before the check existed. A guard that turns working packages into
 * failures buys nothing over the defect it prevents.
 *
 * The advice in the message is also fixed. It used to say "re-run the `--stage`
 * phase", which is FALSE for the case that actually reaches a user: re-staging
 * an `extraFiles` override reproduces it forever. The two real causes are named
 * instead.
 */
export function assertLauncherMatchesInterpreter(
    payload: readonly PayloadEntry[],
    binaryName: string,
    interpreter: 'gjs' | 'node',
): void {
    const found = readLauncherInterpreters(payload, binaryName);
    if (found.length === 0 || found.includes(interpreter)) return;
    const other = interpreter === 'gjs' ? 'node' : 'gjs';
    if (!found.includes(other)) return;
    throw new Error(
        `gjsify ship: the launcher bin/${binaryName} execs \`${other}\`, but this package would declare a ` +
            `dependency on \`${interpreter}\`.\n` +
            '    An installed package that depends on one interpreter and runs another installs cleanly and ' +
            'fails\n' +
            "    at first launch, on the user's machine.\n" +
            `    Either set \`gjsify.app\` to "${other}", or fix the launcher — if it comes from ` +
            '`gjsify.ship.extraFiles`,\n' +
            '    that override is what decides which interpreter runs and it must match the declaration.',
    );
}

/**
 * Payload entries whose correctness depends on a step only a LINUX PACKAGE runs.
 *
 * WHY THIS EXISTS, and it is the hole the layout axis opened. `planStage` emits
 * one prefix-relative plan and every layout carries it, so the darwin and windows
 * trees hold the same `share/…` files the `.deb` does — and on Linux three of
 * those four are only correct because `cacheRefreshCommands` compiles or reindexes
 * them at install time (`scripts.ts`), which is a `.deb`/`.rpm` scriptlet and
 * nothing else. A `.gschema.xml` that no `glib-compile-schemas` ever saw makes
 * GSettings abort at runtime; a `.desktop` entry and an AppStream component are
 * freedesktop metadata neither macOS nor Windows reads at all.
 *
 * The equality the layout suite checks — same file set, same bytes, modulo the map
 * — is structurally blind to every one of them, because SAMENESS IS THE DEFECT
 * here: the Linux tree is right for a reason the other two do not have. So this is
 * the list, named rather than discovered later, printed at stage time and pinned
 * by `tests/e2e/ship-layout` so it cannot grow in silence. Deciding what each one
 * BECOMES — a compiled `gschemas.compiled` in the bundle, an `Info.plist`
 * `CFBundleDocumentTypes`, a Windows registry association, or simply dropped — is
 * ADR 0024 stages 4 and 5, and it needs the container that does not exist yet.
 */
export function linuxInstallDependent(entries: readonly { path: string }[]): { path: string; why: string }[] {
    // Keyed on the same four prefixes `cacheRefreshCommands` guards, plus the
    // AppStream component, so this list cannot drift from the scriptlets it
    // describes without one of the two going obviously wrong.
    const rules: Array<[string, string]> = [
        ['share/glib-2.0/schemas/', 'needs `glib-compile-schemas` at install; GSettings aborts without it'],
        ['share/mime/packages/', 'needs `update-mime-database`; detection runs off the compiled cache'],
        ['share/icons/hicolor/', 'needs `gtk-update-icon-cache`; neither OS reads the hicolor theme'],
        ['share/applications/', 'a freedesktop desktop entry; neither OS reads one'],
        ['share/metainfo/', 'an AppStream component; neither OS reads one'],
    ];
    const out: { path: string; why: string }[] = [];
    for (const entry of entries) {
        const rule = rules.find(([prefix]) => entry.path.startsWith(prefix));
        if (rule !== undefined) out.push({ path: entry.path, why: rule[1] });
    }
    return out;
}

/**
 * The interpreters the payload's own executables need, read off their shebangs.
 *
 * An interpreter is a dependency like any other, and rpm expects it declared:
 * `rpmbuild`'s file-based generator emits one `Requires` per executable
 * shebang, with the `RPMSENSE_FIND_REQUIRES` sense that says "derived, not
 * declared". Measured on Fedora 44 against a package whose only file is a
 * `#!/bin/sh` script: `rpm -qp --requires` → `/usr/bin/sh 16384`.
 *
 * The LITERAL path, not a resolved one. `rpmbuild` prints `/usr/bin/sh` there
 * because it resolved `/bin` through the symlink of the usrmerged host it ran
 * on; this writer has no target host to resolve against (ADR 0024 § A1 — the
 * packers are pure JavaScript and run anywhere), and `/bin/sh` is satisfied on
 * both layouts: measured on Fedora 44, `rpm -q --whatprovides /bin/sh` and
 * `/usr/bin/sh` both answer `bash`. It is also the spelling the scriptlet
 * requirements already use.
 *
 * EXECUTABLE files only, which is the same rule `rpmbuild` applies. A GJS
 * bundle staged 0644 carries `#!/usr/bin/env -S gjs -m` for the days it is run
 * directly, but nothing in the installed package executes it as a program — the
 * launcher `exec`s `gjs` with it as an argument — so declaring `/usr/bin/env`
 * for it would be a dependency on a path this package never uses.
 */
export function readShebangInterpreters(payload: readonly PayloadEntry[]): string[] {
    const found = new Set<string>();
    for (const entry of payload) {
        if ((entry.mode & 0o111) === 0) continue;
        const interpreter = readShebang(entry.data);
        if (interpreter !== null) found.add(interpreter);
    }
    return [...found].sort();
}

/** The absolute interpreter path of a `#!` line, or `null` when there is none to read. */
function readShebang(data: Uint8Array): string | null {
    if (data[0] !== 0x23 || data[1] !== 0x21) return null; // `#!`
    // A shebang is one LINE; reading further would let a long file's contents
    // decide how much work this does. 256 bytes is above every real one and is
    // what Linux itself truncates at (BINPRM_BUF_SIZE).
    const line = new TextDecoder().decode(data.subarray(2, Math.min(data.byteLength, 256))).split('\n')[0] ?? '';
    const interpreter = line.trim().split(/\s+/)[0] ?? '';
    return interpreter.startsWith('/') ? interpreter : null;
}

/**
 * Does the payload contain anything architecture-specific?
 *
 * Decided from the file's MAGIC, not from its name. A bundled runtime is just
 * called `node`, a stripped helper may have no extension at all, and an
 * extension list that misses one of them produces `Architecture: all` on an
 * x86-64 payload — which apt and dnf will happily install on arm64, where it
 * does not run.
 */
export function isArchIndependent(payload: readonly PayloadEntry[]): boolean {
    return !payload.some((entry) => isNativeBinary(entry.data));
}

// `process.arch` tokens, keyed by what the image records about itself. Only the
// values this repository can actually produce are listed; an unknown one reads
// as "cannot tell" rather than as a mismatch, because refusing an artifact over
// a machine constant nobody here emits would be a guess wearing a gate's clothes.
// The machine values this project actually ships packages for — no more. A value
// missing here makes `readBinaryArch` return null, and null is SILENT, so an
// absent row costs nothing but a check that does not fire.
//
// `EM_MIPS` (0x08) is absent for that reason and no other. An earlier version of
// this comment claimed it was absent because one value covers `mips` and
// `mipsel` and the row would have to guess; that was wrong three times over, and
// is corrected here rather than deleted because it is the kind of reasoning that
// gets re-derived: (1) `mipsel` IS little-endian MIPS, so the discriminator is
// `EI_DATA`, which `readBinaryArch` reads four lines below; (2) it could not
// "refuse a correct pack" either way, because `formats.ts` has no `mips` row in
// `DEBIAN_ARCH`/`RPM_ARCH`, so `archName` throws before any label is written;
// and (3) the principle it invoked is already broken one row down — `0x16` maps
// to `s390x`, but `EM_S390` is emitted by 31-bit `s390` too, and its
// discriminator is `EI_CLASS` at offset 4, which this function does NOT read.
// That row is the ambiguous one. Unreachable today (nothing here builds s390),
// but it is the row to fix first if this table ever grows.
const ELF_MACHINE_TO_ARCH: Record<number, string> = {
    0x03: 'ia32',
    0x15: 'ppc64',
    0x16: 's390x',
    0x28: 'arm',
    0x3e: 'x64',
    0xb7: 'arm64',
    0xf3: 'riscv64',
};

const MACHO_CPUTYPE_TO_ARCH: Record<number, string> = {
    0x00000007: 'ia32',
    0x0000000c: 'arm',
    0x01000007: 'x64',
    0x0100000c: 'arm64',
};

/**
 * The `process.arch` token an image says it is built for, or `null` when the
 * question cannot be answered from the bytes.
 *
 * `null` covers three different things on purpose, and all three must stay
 * silent: a file that is not a native binary at all (most of a payload), a PE
 * (whose COFF machine field this tree has never parsed — `isNativeBinary` reads
 * `MZ` and stops), and a Mach-O fat archive, which carries several
 * architectures and therefore matches any label a caller could pass.
 */
export function readBinaryArch(data: Uint8Array): string | null {
    if (data.byteLength < 20) return null;
    const magic = ((data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!) >>> 0;
    if (magic === 0x7f454c46) {
        // ELF: EI_DATA at offset 5 says which end e_machine (offset 18) is written from.
        const littleEndian = data[5] === 1;
        const machine = littleEndian ? data[18]! | (data[19]! << 8) : (data[18]! << 8) | data[19]!;
        return ELF_MACHINE_TO_ARCH[machine] ?? null;
    }
    if (magic === 0xfeedface || magic === 0xfeedfacf) {
        return MACHO_CPUTYPE_TO_ARCH[((data[4]! << 24) | (data[5]! << 16) | (data[6]! << 8) | data[7]!) >>> 0] ?? null;
    }
    if (magic === 0xcefaedfe || magic === 0xcffaedfe) {
        return MACHO_CPUTYPE_TO_ARCH[((data[7]! << 24) | (data[6]! << 16) | (data[5]! << 8) | data[4]!) >>> 0] ?? null;
    }
    return null;
}

/**
 * Refuse a payload whose binaries disagree with the label the package will carry.
 *
 * THE INCIDENT, measured on 0.41.0 before this existed. A project whose payload
 * carries one x86-64 `.so`, packed on this x86-64 host:
 *
 *     gjsify ship --skip-build --arch arm64
 *     → xarch-demo_1.2.3-1_arm64.deb, xarch-demo-1.2.3-1.aarch64.rpm
 *     rpm -qp --qf '%{ARCH}'  → aarch64
 *     the .so inside it       → ELF e_machine 0x3e (x86-64)
 *
 * `--arch` LABELS the payload; it does not cross-compile it, and nothing
 * compared the two. The result installs on an arm64 machine — apt and dnf both
 * believe the header — and then fails to load, which is this tree's most
 * expensive failure class with an independent oracle actively confirming the
 * lie: `rpm` reads the header, and the header was written from the caller's
 * claim.
 *
 * Payload against LABEL, never payload against HOST. Assembling an arm64
 * artifact on an x64 machine is a supported path — the packers are pure
 * JavaScript and ADR 0024 § A1 turns it into a design commitment — so a host
 * comparison would refuse the very case the split exists to allow.
 */
export function assertPayloadMatchesArch(payload: readonly PayloadEntry[], arch: string): void {
    for (const entry of payload) {
        const found = readBinaryArch(entry.data);
        if (found === null || found === arch) continue;
        throw new Error(
            `gjsify ship: the payload is ${found}, but the package would be labelled ${arch} — ` +
                `${entry.path} is built for ${found}.\n` +
                '    `--arch` names the architecture the PAYLOAD was built for; it does not cross-compile ' +
                'anything.\n' +
                `    A package labelled ${arch} installs on ${arch} and then fails to load. Build the payload ` +
                `for ${arch}\n` +
                '    (its own prebuild), or assemble the stage without `--arch` and label the payload you ' +
                'actually have.',
        );
    }
}

/** ELF, Mach-O (both endiannesses, both widths, and a fat archive) or PE. */
function isNativeBinary(data: Uint8Array): boolean {
    if (data.byteLength < 4) return false;
    const magic = (data[0]! << 24) | (data[1]! << 16) | (data[2]! << 8) | data[3]!;
    switch (magic >>> 0) {
        case 0x7f454c46: // \x7fELF
        case 0xfeedface: // Mach-O 32
        case 0xfeedfacf: // Mach-O 64
        case 0xcefaedfe: // Mach-O 32, byte-swapped
        case 0xcffaedfe: // Mach-O 64, byte-swapped
        case 0xcafebabe: // Mach-O universal binary
            return true;
        default:
            return data[0] === 0x4d && data[1] === 0x5a; // MZ — PE/COFF
    }
}
