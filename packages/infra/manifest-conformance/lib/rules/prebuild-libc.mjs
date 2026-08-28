/**
 * Rule `prebuild-libc` — is the libc claim MEASURED, or merely written down?
 *
 * `prebuild-artifacts` proved that a declared `<os>-<arch>` target has a body,
 * that the body's machine matches its directory and that it resolves its own
 * siblings. It says nothing about the C LIBRARY that body needs, and that
 * omission had two concrete consequences before this rule existed:
 *
 *   1. **No package in the tree declared `libc` at all.** npm, yarn and pnpm all
 *      honour that field as an install filter, so a musl host (Alpine, Void musl,
 *      the `-alpine` container images) happily installed every native bridge and
 *      then failed at `dlopen` — which surfaces as "the optional native path is
 *      just not working here", the least debuggable shape available.
 *   2. **Nobody had measured the glibc floor.** The number that actually bounds
 *      this repo's Linux support is `@gjsify/lightningcss-native`'s
 *      `GLIBC_2.39` — Ubuntu 24.04 / Debian 13 — and it was invisible: the
 *      package's own siblings sit as low as `GLIBC_2.2.5`, so nothing about the
 *      declarations hinted that ONE bridge moves the whole floor forward by
 *      thirteen glibc releases.
 *
 * Both are properties of the BINARY, so both are read out of the binary here
 * rather than maintained by hand (`../binary.mjs`: `readElfNeeded`,
 * `readElfGlibcRequires`). That is the same reason `prebuild-artifacts` reads the
 * machine out of `e_machine` instead of trusting the directory name: a
 * hand-maintained fact about a committed binary is a fact that has already
 * drifted, you just do not know when.
 *
 * WHAT IS CHECKED, and the one place this deviates from the obvious design:
 *
 *   • **Per target — the token must match the binary.** `<os>-<arch>-musl` must
 *     not hold a glibc-linked library and the unsuffixed default build must not
 *     hold a musl-linked one. For THIS question — where was the artifact built —
 *     `libc.so.6` in `DT_NEEDED` is a direct read rather than an inference (musl
 *     records `libc.musl-<arch>.so.1`/`ld-musl-<arch>.so.1` instead, never
 *     `libc.so.6`). It answers PROVENANCE only; it does not answer whether the
 *     artifact loads on the other libc, and conflating the two is the defect
 *     described under the `libc` FIELD below.
 *
 *   • **Per target — the measured glibc floor must fit the declaration.** A
 *     `gjsify.glibcRequires` entry that a rebuild has outgrown FAILS, naming both
 *     numbers. An entry the build no longer needs is a NOTE, not a failure: "we
 *     support glibc ≥ 2.28 as policy even though today's binary only needs 2.17"
 *     is a legitimate, conservative promise, and failing it would make a
 *     deliberate distro baseline impossible to state.
 *
 *   • **Per package — the `libc` FIELD, which is where the design deviates.**
 *     The obvious rule is "links glibc ⇒ declare `libc: ["glibc"]`". This rule
 *     SHIPPED with that rule, and it is wrong twice over.
 *
 *     Wrong once, because linking glibc does not imply failing on musl. musl's
 *     loader treats a DT_NEEDED of `libc.so.6` as a request for ITSELF — a
 *     reserved name it refuses to reload — so a glibc-built library naming it
 *     usually loads on Alpine. A container probe on `alpine:3.24.1` (x86_64 and
 *     aarch64) measured SIX of this repo's bridges loading and running there, one
 *     of them returning a correct result from a real call. Demanding the field
 *     from those six would make every package manager refuse the install on
 *     exactly the platform the libc axis was added to support. What actually
 *     blocks a musl load is the glibc LOADER (`ld-linux-*`) or a glibc-only
 *     SYMBOL — see {@link muslVerdictOfNeeded}, which is where that distinction
 *     lives and why one of its three answers is `undetermined`.
 *
 *     Wrong twice, because the requirement is genuinely PER TARGET and npm's
 *     field is one PACKAGE-level filter: `@gjsify/tls-native` records no libc
 *     soname on x64, arm64, ppc64 or s390x — it calls only into GLib/GIO/GnuTLS —
 *     and DOES record the interpreter on riscv64, because Fedora's riscv64
 *     toolchain links it explicitly. `@gjsify/webrtc-native` is the same shape.
 *
 *     So the field is keyed on musl-LOADABILITY, in three tiers:
 *       – every target `agnostic` (no libc soname at all) ⇒ `libc` must be
 *         ABSENT. Declaring it refuses installs on hosts where the artifact
 *         provably works.
 *       – every target `incompatible` (the glibc loader recorded) ⇒
 *         `libc: ["glibc"]` is REQUIRED. Nothing can load; without the field the
 *         install happens anyway.
 *       – anything else ⇒ OPTIONAL, and a note states each target's verdict. A
 *         musl load test can prove a restriction the ELF cannot, so forbidding
 *         the field would forbid stating a fact; requiring it would refuse a
 *         working install. The one exception is an `agnostic` target in the mix:
 *         its absence of a libc soname IS proof, so the field stays forbidden
 *         there and no load test can overturn it.
 *     The note is the point: a standing, printed-every-run statement of a gap
 *     npm's vocabulary cannot hold, and it stops being a note the moment those
 *     targets get `-musl` siblings.
 *
 *     Where the artifact cannot load, the consumer lands on the
 *     graceful-degradation path every one of these bridges already has
 *     (`imports.gi.GjsifyX` in a try/catch, `hasNativeSab()`,
 *     `hasTlsSessionAccess()`) — which is why "install it and let it degrade" is
 *     the recoverable wrong answer and "never install it" is not.
 *
 * WHAT IS DELIBERATELY NOT CHECKED:
 *
 *   • Non-Linux targets. npm defines `libc` as Linux-only, and every other OS
 *     ships one C library — a `darwin-arm64` directory is simply out of scope,
 *     not "unverified".
 *   • Mach-O and PE images, for the same reason.
 *   • Targets `gjsify.platformsUncommitted` exempts, and targets whose directory
 *     is missing entirely: `prebuild-artifacts` owns both of those failures, and
 *     a second rule reporting the same missing directory adds a derivative
 *     message and no information.
 *
 * Every skip above is COUNTED and printed. An artifact whose ELF the parser could
 * not read is a FAILURE, never a pass: concluding "records no libc.so.6, so it is
 * libc-agnostic" from a file that was never parsed is precisely the check that
 * claims more than it did.
 *
 * PORTABLE: manifest + files + file headers only. Nothing here knows this
 * repository's layout, package names or CI.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { defineRule } from '../registry.mjs';
import { compareGlibcVersions, readElfGlibcRequires, readElfNeeded } from '../binary.mjs';
import { ARCH_ALIASES } from '../platforms.mjs';
import { collectNativePackages } from './prebuild-artifacts.mjs';

/** The one libc suffix the target grammar spells out. */
const MUSL_SUFFIX = '-musl';

/**
 * Split a prebuild target into its three axes: `<os>-<arch>[-musl]`.
 *
 * The `.mjs` twin of `parsePlatformToken` in
 * `packages/infra/cli/src/utils/detect-native-packages.ts`. The two MUST agree —
 * that file's `ARCH_ALIASES` and `../platforms.mjs`'s already carry the same
 * lockstep requirement for the arch half, and the libc half is now part of it: a
 * divergence lets a package pass this rule while the CLI resolves a different
 * directory (or, worse, the same directory on the wrong libc).
 *
 * `-musl` is honoured ONLY when the OS half is `linux`. It targets no other
 * kernel, and npm's `libc` field is documented Linux-only, so `darwin-arm64-musl`
 * is a malformed token rather than an exotic one — reporting `libc: null` for it
 * lets the caller name the token instead of half-honouring it.
 *
 * @param {string} token
 * @returns {{os: string, arch: string, libc: 'musl' | null}}
 */
export function parsePrebuildTarget(token) {
    const isMusl = String(token).endsWith(MUSL_SUFFIX);
    const base = isMusl ? String(token).slice(0, -MUSL_SUFFIX.length) : String(token);
    const dash = base.indexOf('-');
    const os = dash < 0 ? base : base.slice(0, dash);
    const arch = dash < 0 ? '' : base.slice(dash + 1);
    return { os, arch, libc: isMusl && os === 'linux' ? 'musl' : null };
}

/**
 * The ONE target name a build on this host may stage into — the WRITE side.
 *
 * Exactly one name, not a preference list: a musl build must land in
 * `<os>-<arch>-musl` and NEVER in `<os>-<arch>`, because the unsuffixed directory
 * is the DEFAULT build that a glibc host resolves. Staging a musl-linked library
 * there is the failure `auditPrebuildLibc`'s Check A exists to catch, and a
 * stager that "helpfully" falls back to it would manufacture that failure on
 * every Alpine developer machine.
 *
 * The read side is `hostPlatformTokens()` in
 * `packages/infra/cli/src/utils/detect-native-packages.ts`, which returns a LIST
 * because resolution may legitimately fall back to the default build (the
 * libc-agnostic bridges load on either libc). This function is that list's FIRST
 * element, and the asymmetry is the point: tolerant on read, exact on write — the
 * same rule the retired uname spelling is held to.
 *
 * @param {string} platform `process.platform`
 * @param {string} arch `process.arch`
 * @param {'glibc'|'musl'|null|undefined} libc
 * @returns {string}
 */
export function hostPrebuildTarget(platform, arch, libc) {
    const base = `${platform}-${arch}`;
    return libc === 'musl' && platform === 'linux' ? `${base}${MUSL_SUFFIX}` : base;
}

/**
 * Canonical `<os>-<arch>[-musl]` form.
 *
 * `canonicalPlatform()` in `../platforms.mjs` is libc-BLIND: it does
 * `token.split('-')` and keeps the first two parts, so it silently folds
 * `linux-x64-musl` down to `linux-x64` — which would make a musl target compare
 * EQUAL to the glibc one in every set operation the prebuild rules perform. This
 * reimplements the split (reusing that module's alias TABLE, so the arch
 * vocabulary still has one definition) rather than editing it, because
 * `canonicalPlatform` is on the hot path of two shipped rules and nothing in the
 * tree declares a `-musl` target yet.
 *
 * FOLLOW-UP, and it is a real one: the moment a `-musl` target IS declared,
 * `../platforms.mjs`'s `PLATFORM_RE` rejects it (`platforms-ci` then fails the
 * declaration as invalid) and `canonicalPlatform` collapses it. Both must gain
 * the optional suffix in the SAME change that declares the first musl target.
 * Until then the collapse is unreachable, and this rule fails loudly on any
 * `-musl` token it does see, so the gap cannot be reached silently.
 *
 * @param {string} token
 * @returns {string}
 */
export function canonicalPrebuildTarget(token) {
    const { os, arch } = parsePrebuildTarget(token);
    if (!arch) return String(token);
    const canonical = `${os}-${ARCH_ALIASES[arch] ?? arch}`;
    return String(token).endsWith(MUSL_SUFFIX) ? `${canonical}${MUSL_SUFFIX}` : canonical;
}

/**
 * Which C library an ELF's dependency list says it was LINKED AGAINST.
 *
 * PROVENANCE ONLY. This answers "where was this built", which is what the
 * token-vs-binary check below needs and what npm's `libc` field means to an
 * installer. It deliberately does NOT answer "can this load on the other libc" —
 * see {@link muslVerdictOfNeeded}, which is a different question with a
 * different answer, and conflating the two is the defect this split exists to
 * remove.
 *
 * A direct read of two sonames, not a heuristic:
 *   • glibc's C library is always `libc.so.6` (its `ld.so` is
 *     `ld-linux-*.so.*`, which is also recorded on some architectures — Fedora's
 *     riscv64/ppc64/s390x toolchains do — and is equally glibc-specific).
 *   • musl's is `libc.musl-<arch>.so.1`, with `ld-musl-<arch>.so.1` as the
 *     loader. musl NEVER produces `libc.so.6`, which is what makes the glibc
 *     marker unambiguous.
 * An image recording NEITHER reaches libc only through GLib/GObject/GIO (plus
 * GnuTLS resp. GStreamer), so it binds against whatever libc the host's GLib was
 * built for. That third state is not an absence of information — it is the
 * reason the unsuffixed token means "default build" rather than "glibc build".
 *
 * @param {readonly string[]} needed DT_NEEDED leaf names
 * @returns {'glibc' | 'musl' | null}
 */
export function libcFlavourOfNeeded(needed) {
    const isGlibc = needed.some((n) => n === 'libc.so.6' || /^ld-linux(-|\.)/.test(n) || /^ld\d*\.so\.\d+$/.test(n));
    // Plain prefixes, so `startsWith` — unlike the glibc line above, whose two
    // patterns carry an alternation and a digit class and stay regexes. The
    // asymmetry is the signal: these two sonames have no variable part.
    const isMusl = needed.some((n) => n.startsWith('libc.musl-') || n.startsWith('ld-musl-'));
    // Both cannot be true for a loadable image; report glibc and let the caller
    // fail on the contradiction, which it does with the full leaf list.
    if (isGlibc && isMusl) return 'glibc';
    if (isGlibc) return 'glibc';
    return isMusl ? 'musl' : null;
}

/**
 * Can a glibc-built image load on a musl host? Three states, and only two of
 * them are decidable from an ELF header.
 *
 * THE CORRECTION THIS ENCODES. The obvious reading — "`libc.so.6` in DT_NEEDED
 * ⇒ glibc ⇒ cannot load on musl" — is FALSE, and this rule asserted it. musl's
 * dynamic linker treats a `DT_NEEDED` of `libc.so.6` as a request for ITSELF:
 * `load_library()` refuses to reload the implementation under any of its
 * reserved names (`c`, `pthread`, `rt`, `m`, `dl`, `util`, `xnet`). No
 * `libc.so.6` file exists on an Alpine image at all — only
 * `/lib/libc.musl-<arch>.so.1` — and glibc-built bridges naming it load anyway.
 *
 * Measured in a container probe on `alpine:3.24.1`, x86_64 and aarch64: SIX of
 * this repo's committed glibc bridges load and run on musl (`webgl`,
 * `http2-native`, `http-soup-bridge`, `terminal-native`, `tls-native`,
 * `webrtc-native`), and `tls-native` additionally returned a correct result from
 * a real call. Demanding `libc: ["glibc"]` from them — which this rule did —
 * would make every package manager REFUSE the install on exactly the platform
 * the libc axis was added to support (postmarketOS/Alpine, see
 * `gjsify.platforms`' `-musl` token).
 *
 * What genuinely prevents a musl load, in the order of how well an ELF shows it:
 *   1. **The glibc LOADER in DT_NEEDED** (`ld-linux-*.so.*`, `ld64.so.*`). Not a
 *      musl reserved name, so musl tries to open a file that is not there:
 *      `Error loading shared library ld-linux-x86-64.so.2`. Decidable HERE, and
 *      it is what kills the three x64 Rust cdylibs.
 *   2. **A glibc-only SYMBOL** — `fcntl64`, `__cmsg_nxthdr`,
 *      `gnu_get_libc_version` in the measured cases. Fails at relocation
 *      (`symbol not found`). NOT decidable here: it would need a curated list of
 *      glibc-only symbol names, i.e. exactly the hand-maintained table this file
 *      exists to avoid. Only a real `dlopen` on a musl host settles it, which is
 *      a CI-leg job, not a portable-rule job.
 *   3. A distro **soname** difference, which is not a libc question at all
 *      (`napi` wants `libmozjs-140.so.0`; Alpine ships `libmozjs-140.so`).
 *
 * So `'undetermined'` is a first-class answer, not a hedge: it is the honest
 * state for a glibc-linked image with no glibc loader recorded, and the rule
 * must not convert it into a `libc` requirement in either direction.
 *
 * CAVEAT that outlives this function: musl ignores ELF symbol versioning
 * entirely, so a reference to `GLIBC_2.39`-versioned `foo` binds to musl's
 * unversioned `foo` with no compatibility check. "Loads" is therefore weaker
 * than "behaves correctly" even for the six that load — which is why
 * {@link measurePrebuildLibc} keeps reporting the glibc floor separately.
 *
 * @param {readonly string[]} needed DT_NEEDED leaf names
 * @returns {'incompatible' | 'agnostic' | 'undetermined'}
 */
export function muslVerdictOfNeeded(needed) {
    if (needed.some((n) => /^ld-linux(-|\.)/.test(n) || /^ld\d*\.so\.\d+$/.test(n))) return 'incompatible';
    return libcFlavourOfNeeded(needed) === null ? 'agnostic' : 'undetermined';
}

/** A `gjsify.glibcRequires` value: a dotted glibc release, e.g. `2.39`. */
const GLIBC_VERSION_VALUE_RE = /^\d+(?:\.\d+)*$/;

/**
 * Measure one committed prebuild directory's libc facts.
 *
 * Aggregates across EVERY `.so` in the directory, because the Rust bridges split
 * their requirement across two libraries on purpose: the Vala/GObject library the
 * typelib names records no libc at all, while the cargo cdylib beside it carries
 * the whole floor (`libgjsifylightningcss.so` → nothing;
 * `libgjsify_lightningcss.so` → `GLIBC_2.39`). Reading only the typelib-named
 * library — the obvious choice, since it is the one GI hands to `dlopen` — would
 * report "no libc requirement" for the three packages with the HIGHEST floors in
 * the tree. The loader pulls in the sibling, so the directory's requirement is
 * the maximum over the set.
 *
 * The `musl` verdict aggregates the SAME way and for the same reason: the loader
 * pulls in the sibling, so one `ld-linux-*` anywhere in the directory makes the
 * whole directory unloadable on musl. That is precisely the three Rust bridges
 * on x64 — the Vala half records no libc, the cdylib beside it records the glibc
 * loader — so a per-library verdict would report the directory as loadable.
 *
 * @param {string} dir
 * @returns {{flavour: 'glibc'|'musl'|null, musl: 'incompatible'|'agnostic'|'undetermined', glibcRequires: string|null, libs: string[], mixed: boolean, unreadable: string[]}}
 *   `unreadable` names `.so` files whose ELF this parser could not read; a
 *   non-empty list makes the whole measurement untrustworthy and the caller
 *   turns it into a failure.
 */
export function measurePrebuildLibc(dir) {
    const libs = readdirSync(dir)
        .filter((f) => f.endsWith('.so'))
        .sort();
    /** @type {Set<'glibc'|'musl'>} */ const flavours = new Set();
    /** @type {Set<'incompatible'|'agnostic'|'undetermined'>} */ const muslVerdicts = new Set();
    /** @type {string[]} */ const unreadable = [];
    /** @type {string|null} */ let glibcRequires = null;

    for (const lib of libs) {
        const path = join(dir, lib);
        const needed = readElfNeeded(path);
        if (needed === null) {
            unreadable.push(lib);
            continue;
        }
        const flavour = libcFlavourOfNeeded(needed);
        if (flavour) flavours.add(flavour);
        muslVerdicts.add(muslVerdictOfNeeded(needed));
        const floor = readElfGlibcRequires(path);
        if (floor !== null && (glibcRequires === null || compareGlibcVersions(floor, glibcRequires) > 0)) {
            glibcRequires = floor;
        }
    }

    return {
        flavour: flavours.has('glibc') ? 'glibc' : flavours.has('musl') ? 'musl' : null,
        // Worst-case wins: one unloadable library sinks the directory.
        musl: muslVerdicts.has('incompatible')
            ? 'incompatible'
            : muslVerdicts.has('undetermined')
              ? 'undetermined'
              : 'agnostic',
        glibcRequires,
        libs,
        mixed: flavours.size > 1,
        unreadable,
    };
}

/**
 * Hold the libc + glibc-floor invariant over every committed Linux prebuild.
 *
 * Kept as a standalone export, exactly like `auditPrebuildArtifacts`, so an e2e
 * suite can drive it against SYNTHETIC packages in a temp directory — proving
 * that an undeclared `libc` fails means having a package with one, and the e2e
 * suites run four-at-a-time against a single shared checkout.
 *
 * @param {Array<object>} nativePkgs rows from `collectNativePackages()`
 * @returns {{failures: string[], notes: string[], stats: object}}
 */
export function auditPrebuildLibc(nativePkgs) {
    /** @type {string[]} */ const failures = [];
    /** @type {string[]} */ const notes = [];
    const stats = {
        packages: 0,
        targets: 0,
        libs: 0,
        glibcTargets: 0,
        muslTargets: 0,
        agnosticTargets: 0,
        skippedNonLinux: 0,
        skippedUncommitted: 0,
        skippedMissing: 0,
        floorsCompared: 0,
        floorsReported: 0,
        highestFloor: null,
        highestFloorAt: null,
    };

    for (const pkg of nativePkgs) {
        // Both of these are already failures in `platforms-ci` /
        // `prebuild-artifacts` respectively; restating them here would double the
        // output for one cause.
        if (!pkg.declared || !pkg.prebuildsField) continue;

        const exempt = new Set(
            pkg.uncommitted != null && typeof pkg.uncommitted === 'object' && !Array.isArray(pkg.uncommitted)
                ? Object.keys(pkg.uncommitted).map(canonicalPrebuildTarget)
                : [],
        );

        // ── the `gjsify.glibcRequires` declaration, validated before it is used
        const declaredFloors = pkg.manifestGjsify?.glibcRequires ?? null;
        /** @type {Map<string, string>} canonical target → declared floor */
        const floorByTarget = new Map();
        if (declaredFloors != null) {
            const isPlainObject =
                typeof declaredFloors === 'object' && !Array.isArray(declaredFloors) && declaredFloors !== null;
            if (!isPlainObject) {
                failures.push(
                    `${pkg.name} (${pkg.path}): \`gjsify.glibcRequires\` must be an object mapping each Linux \`<os>-<arch>[-musl]\` target to the minimum glibc release its committed artifacts need, e.g. {"linux-x64": "2.14", "linux-riscv64": "2.27"}. It is per-TARGET because the measured floors in this tree span thirteen glibc releases (2.2.5 … 2.39) — a single number for a whole package would either lie about the target a user is on or bury the one they care about.`,
                );
            } else {
                const declaredCanon = new Set(pkg.declared.map(canonicalPrebuildTarget));
                for (const [target, floor] of Object.entries(declaredFloors)) {
                    const canon = canonicalPrebuildTarget(target);
                    if (!declaredCanon.has(canon)) {
                        failures.push(
                            `${pkg.name} (${pkg.path}): \`gjsify.glibcRequires["${target}"]\` names a target \`gjsify.platforms\` (${pkg.declared.join(', ')}) does not declare — a glibc floor for a platform this package does not promise is a number nothing can ever check.`,
                        );
                        continue;
                    }
                    if (parsePrebuildTarget(canon).os !== 'linux') {
                        failures.push(
                            `${pkg.name} (${pkg.path}): \`gjsify.glibcRequires["${target}"]\` is not a Linux target. glibc symbol versioning is a Linux/ELF concept; a macOS or Windows artifact has no such floor, and stating one implies a check that cannot exist.`,
                        );
                        continue;
                    }
                    if (typeof floor !== 'string' || !GLIBC_VERSION_VALUE_RE.test(floor)) {
                        failures.push(
                            `${pkg.name} (${pkg.path}): \`gjsify.glibcRequires["${target}"]\` must be a dotted glibc release as a STRING (\`"2.39"\`), not ${JSON.stringify(floor)}. It is compared numerically component by component, so the JSON number \`2.39\` would also lose the distinction between \`2.39\` and \`2.390\`.`,
                        );
                        continue;
                    }
                    floorByTarget.set(canon, floor);
                }
            }
        }

        // ── per-target measurement ────────────────────────────────────────────
        /** @type {Map<string, ReturnType<typeof measurePrebuildLibc>>} */ const measured = new Map();
        let measurable = true;
        for (const target of pkg.declared) {
            const canon = canonicalPrebuildTarget(target);
            const { os, libc: tokenLibc } = parsePrebuildTarget(canon);
            if (os !== 'linux') {
                stats.skippedNonLinux++;
                continue;
            }
            if (exempt.has(canon)) {
                stats.skippedUncommitted++;
                continue;
            }
            const dir = join(pkg.prebuildDir, target);
            if (!existsSync(dir)) {
                stats.skippedMissing++;
                continue;
            }

            const m = measurePrebuildLibc(dir);
            measured.set(canon, m);
            stats.targets++;
            stats.libs += m.libs.length;

            if (m.unreadable.length > 0) {
                measurable = false;
                failures.push(
                    `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/\` holds \`.so\` file(s) whose ELF could not be read (${m.unreadable.join(', ')}), so this target's libc requirement was NOT measured. Reporting it as "records no libc.so.6" would turn an unread file into a claim that the artifact runs on musl — the one failure mode this rule exists to remove. Either the file is not an ELF shared object (\`prebuild-artifacts\` says which), or its section table was stripped, which also breaks every debugger and \`ldd\`.`,
                );
                continue;
            }
            if (m.mixed) {
                failures.push(
                    `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/\` mixes glibc- and musl-linked libraries (${m.libs.join(', ')}). No dynamic loader can satisfy both in one process, so at most one of these libraries is loadable — this is two builds staged into one directory.`,
                );
                continue;
            }

            if (m.flavour === 'glibc') stats.glibcTargets++;
            else if (m.flavour === 'musl') stats.muslTargets++;
            else stats.agnosticTargets++;

            // Check A — the directory NAME must agree with what is in it.
            if (tokenLibc === 'musl' && m.flavour === 'glibc') {
                failures.push(
                    `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/\` is a musl target but its libraries link glibc (\`libc.so.6\` in DT_NEEDED). A musl host resolves this directory FIRST — the CLI prefers the \`-musl\` token — so this is strictly worse than shipping nothing: it shadows the default build that might have loaded.`,
                );
            } else if (tokenLibc === null && m.flavour === 'musl') {
                failures.push(
                    `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/\` is the DEFAULT build but its libraries link musl (${m.libs.join(', ')}). The default build is what a glibc host resolves, and a musl-linked library cannot load there. Rename the directory to \`${target}${MUSL_SUFFIX}\` and declare that token.`,
                );
            }

            // Check B — the measured glibc floor against the declaration.
            const declaredFloor = floorByTarget.get(canon);
            if (m.glibcRequires === null) {
                if (declaredFloor !== undefined) {
                    notes.push(
                        `${pkg.name}: \`${target}\` declares \`glibcRequires: "${declaredFloor}"\` but its libraries reference no versioned glibc symbol at all (they link ${m.flavour === null ? 'no libc' : m.flavour}). The declaration is harmless but describes nothing — drop it, or keep it as a deliberate policy floor.`,
                    );
                }
                continue;
            }
            if (
                stats.highestFloor === null ||
                compareGlibcVersions(m.glibcRequires, /** @type {string} */ (stats.highestFloor)) > 0
            ) {
                stats.highestFloor = m.glibcRequires;
                stats.highestFloorAt = `${pkg.name} ${target}`;
            }
            if (declaredFloor === undefined) {
                stats.floorsReported++;
                notes.push(
                    `${pkg.name}: \`${target}\` requires glibc ≥ ${m.glibcRequires} (measured from SHT_GNU_verneed), undeclared. Add \`gjsify.glibcRequires["${target}"]: "${m.glibcRequires}"\` to turn the measurement into a promise this rule can hold a rebuild to.`,
                );
                continue;
            }
            stats.floorsCompared++;
            const cmp = compareGlibcVersions(m.glibcRequires, declaredFloor);
            if (cmp > 0) {
                failures.push(
                    `${pkg.name} (${pkg.path}): \`${pkg.prebuildsField}/${target}/\` requires glibc ≥ ${m.glibcRequires} but \`gjsify.glibcRequires["${target}"]\` promises ${declaredFloor}. The dynamic linker enforces the measured number — a host on ${declaredFloor} gets \`version 'GLIBC_${m.glibcRequires}' not found\` and no fallback. Either raise the declaration (and every document derived from it), or build the artifact against an older baseline.`,
                );
            } else if (cmp < 0) {
                notes.push(
                    `${pkg.name}: \`${target}\` declares glibc ≥ ${declaredFloor} but today's artifact only needs ${m.glibcRequires} — a conservative promise, kept on purpose or stale. Not a failure: a deliberate distro baseline above what the current build happens to need is a legitimate thing to state.`,
                );
            }
        }

        if (measured.size === 0) continue;
        stats.packages++;
        if (!measurable) continue; // a `libc` verdict from an unread binary is worthless

        // ── Check C — the package-level `libc` field ───────────────────────────
        const declaredLibc = pkg.manifest?.libc ?? null;

        if (declaredLibc !== null) {
            const shapeOk =
                Array.isArray(declaredLibc) &&
                declaredLibc.length > 0 &&
                declaredLibc.every((v) => v === 'glibc' || v === 'musl');
            if (!shapeOk) {
                failures.push(
                    `${pkg.name} (${pkg.path}): \`libc\` must be a non-empty array of npm's own tokens (\`["glibc"]\` / \`["musl"]\` / \`["glibc","musl"]\`), not ${JSON.stringify(declaredLibc)}. It is an npm INSTALL filter, so a value no package manager recognises does not fail — it silently filters nothing.`,
                );
                continue;
            }
        }

        // What decides the `libc` FIELD is musl-LOADABILITY, not provenance. The
        // two are different questions (see `muslVerdictOfNeeded`), and keying the
        // install filter on provenance is what made this rule demand `["glibc"]`
        // from six bridges that demonstrably run on Alpine.
        const muslVerdicts = new Set([...measured.values()].map((m) => m.musl));
        const byVerdict = (v) => [...measured.entries()].filter(([, m]) => m.musl === v).map(([t]) => t);
        const incompatible = byVerdict('incompatible');
        const undetermined = byVerdict('undetermined');

        if (!muslVerdicts.has('incompatible') && !muslVerdicts.has('undetermined')) {
            // Every committed Linux artifact is libc-agnostic: no libc soname at
            // all, so it binds against whatever libc the host's GLib was built
            // for. This is the one state where a declaration is provably wrong.
            if (declaredLibc !== null) {
                failures.push(
                    `${pkg.name} (${pkg.path}): declares \`libc: ${JSON.stringify(declaredLibc)}\` but not one of its committed Linux libraries records a libc soname — they reach libc only through GLib/GObject/GIO, so they bind against whatever libc the host's GLib was built for. The declaration refuses installs on hosts where the artifact works. Remove it.`,
                );
            }
            continue;
        }

        if (incompatible.length === measured.size) {
            // Every target records the glibc LOADER (`ld-linux-*`), which musl
            // cannot supply under any name. This is the only state in which a
            // package-level `["glibc"]` is provably right, and it is required:
            // without it the install happens and nothing can load.
            if (declaredLibc === null) {
                failures.push(
                    `${pkg.name} (${pkg.path}): every committed Linux target records the glibc dynamic loader in DT_NEEDED (${incompatible.join(', ')}), which musl cannot supply under any name — the load fails with "Error loading shared library ld-linux-*". npm, yarn and pnpm all honour \`libc\`, so without it the package installs on a host where nothing can load. Add \`"libc": ["glibc"]\`.`,
                );
            } else if (declaredLibc.length !== 1 || declaredLibc[0] !== 'glibc') {
                failures.push(
                    `${pkg.name} (${pkg.path}): declares \`libc: ${JSON.stringify(declaredLibc)}\` but every committed Linux target records the glibc dynamic loader (${incompatible.join(', ')}). Declare exactly \`["glibc"]\`.`,
                );
            }
            continue;
        }

        // MIXED or UNDETERMINED — the honest majority case, and `libc` must NOT be
        // required here in either direction.
        //
        // `undetermined` means: linked against glibc, but no glibc loader
        // recorded, so the ELF cannot say whether it loads on musl. musl aliases
        // `libc.so.6` to itself, so it very often DOES; what breaks it is a
        // glibc-only SYMBOL, which is only visible to a real `dlopen` on a musl
        // host. Failing the package here would refuse the install on the platform
        // the axis was added for; requiring the absence would forbid stating a
        // restriction a musl CI leg has actually proven. So: optional, and shape-
        // checked if present.
        const agnostic = byVerdict('agnostic');
        if (declaredLibc !== null && agnostic.length > 0) {
            // A target with NO libc soname at all provably runs on either libc.
            // Declaring the filter refuses an install that would have worked, and
            // unlike the `undetermined` case there is nothing a load test could
            // discover that would justify it — the absence of the soname IS the
            // proof. So this stays a failure even though the package also has
            // constrained targets: npm's field cannot say "glibc-only, but only on
            // riscv64", and refusing everywhere is the worse of the two wrongs.
            failures.push(
                `${pkg.name} (${pkg.path}): declares \`libc: ${JSON.stringify(declaredLibc)}\` while ${agnostic.join(', ')} record no libc soname at all and therefore run on either libc. A package-level filter refuses the install on every musl host, including those targets; the bridge's own graceful no-native path already covers ${[...incompatible, ...undetermined].join(', ')}. Remove \`libc\` and let the per-target reality stand.`,
            );
        } else if (declaredLibc !== null && (declaredLibc.length !== 1 || declaredLibc[0] !== 'glibc')) {
            failures.push(
                `${pkg.name} (${pkg.path}): declares \`libc: ${JSON.stringify(declaredLibc)}\`, but its committed targets are ${
                    incompatible.length > 0 ? `musl-incompatible (${incompatible.join(', ')})` : ''
                }${incompatible.length > 0 && undetermined.length > 0 ? ' and ' : ''}${
                    undetermined.length > 0
                        ? `glibc-linked with musl-loadability undetermined (${undetermined.join(', ')})`
                        : ''
                }. The only defensible package-level value here is \`["glibc"]\` — a restriction a musl load test has proven — or none at all.`,
            );
        }
        if (declaredLibc === null) {
            notes.push(
                `${pkg.name}: \`libc\` deliberately ABSENT. Per-target musl verdicts: ${[
                    incompatible.length > 0
                        ? `${incompatible.join(', ')} incompatible (glibc loader in DT_NEEDED)`
                        : null,
                    undetermined.length > 0
                        ? `${undetermined.join(', ')} undetermined (glibc-linked, no glibc loader — musl aliases libc.so.6 to itself, so only a real dlopen on musl decides)`
                        : null,
                    agnostic.length > 0 ? `${agnostic.join(', ')} agnostic` : null,
                ]
                    .filter(Boolean)
                    .join(
                        '; ',
                    )}. npm's field has no per-target dimension and refusing the install everywhere would also refuse it where the artifact works; the bridge's own graceful no-native path covers the targets where it does not. Ship a \`${MUSL_SUFFIX}\` sibling for the constrained target(s) and this note goes away.`,
            );
        } else {
            notes.push(
                `${pkg.name}: declares \`libc: ["glibc"]\` while the ELF alone cannot prove it — ${undetermined.join(', ') || '(none)'} are glibc-linked with no glibc loader recorded. Keep this declaration ONLY if a musl load test failed for every declared target; the ELF is not the evidence for it.`,
            );
        }
    }

    return { failures, notes, stats };
}

/**
 * What the libc audit measured, and — the load-bearing half — what it skipped.
 *
 * Printed on success as well as failure, like `renderPrebuildSummary`. "42
 * directories measured" and "42 directories are musl-safe" are different claims,
 * and the reader who is not told the difference assumes the second. The single
 * highest floor is named explicitly because it is the number that answers the
 * question people actually ask ("which distros can run this?") and no individual
 * package's declaration reveals it.
 *
 * @param {{failures: string[], notes: string[], stats: object}} result
 */
export function renderPrebuildLibcSummary({ notes, stats }) {
    const lines = [
        `prebuild-libc audit: ${stats.libs} shared librar(y|ies) across ${stats.targets} committed Linux target(s) in ${stats.packages} package(s) MEASURED from their ELF headers ` +
            `(DT_NEEDED for the libc flavour, SHT_GNU_verneed for the glibc floor) — ${stats.glibcTargets} glibc, ${stats.muslTargets} musl, ${stats.agnosticTargets} libc-agnostic (no libc soname recorded at all).`,
        `  glibc floors: ${stats.floorsCompared} compared against a declared \`gjsify.glibcRequires\`, ${stats.floorsReported} measured but undeclared` +
            (stats.highestFloor
                ? `. Highest across the whole tree: GLIBC_${stats.highestFloor} (${stats.highestFloorAt}) — that ONE artifact is the repo's Linux baseline, whatever every other package's floor says.`
                : '.'),
        `  out of scope: ${stats.skippedNonLinux} non-Linux target(s) (npm defines \`libc\` as Linux-only, and every other OS ships one C library)` +
            `; ${stats.skippedUncommitted} exempt via \`gjsify.platformsUncommitted\`; ${stats.skippedMissing} with no committed directory (\`prebuild-artifacts\` owns that failure).`,
    ];
    for (const n of notes) lines.push(`  · ${n}`);
    return lines.join('\n');
}

/**
 * The native-package rows, plus the two manifest fields this rule reads that
 * `collectNativePackages()` does not carry: `libc` is a plain npm field, and
 * `gjsify.glibcRequires` is new.
 *
 * Widening `collectNativePackages` itself would change the input shape
 * `prebuild-artifacts`, `platforms-ci` AND `audit-runtimes --platforms` all read,
 * for one rule's benefit. Re-deriving two fields here is the cheaper coupling.
 *
 * The lookup is built from `ctx.allPackages`, NOT `ctx.get()`: `byName` is
 * assembled from the WORKSPACE-glob packages only, and the two packages with the
 * most interesting platform declarations in this tree (`@gjsify/napi`,
 * `@gjsify/node-gi`) are deliberately not workspace members — they arrive through
 * `discoveryRoots`. Using `ctx.get()` would silently hand this rule an empty
 * manifest for exactly those, i.e. report "declares no `libc`" for a package whose
 * manifest was never read.
 *
 * @param {import('../context.mjs').ConformanceContext} ctx
 */
export function collectLibcPackages(ctx) {
    const byName = new Map(ctx.allPackages.map((p) => [p.name, p]));
    return collectNativePackages(ctx).map((row) => {
        const pkg = byName.get(row.name);
        return { ...row, manifest: pkg?.manifest ?? {}, manifestGjsify: pkg?.gjsify ?? {} };
    });
}

export const prebuildLibcRule = defineRule({
    id: 'prebuild-libc',
    scope: 'portable',
    fields: ['libc', 'gjsify.glibcRequires', 'gjsify.platforms', 'gjsify.prebuilds'],
    description:
        "each committed Linux prebuild's libc flavour + glibc floor is MEASURED from its ELF and matches the manifest",
    run(ctx) {
        const result = auditPrebuildLibc(collectLibcPackages(ctx));
        return {
            failures: result.failures,
            notes: result.notes,
            stats: result.stats,
            summary: renderPrebuildLibcSummary(result),
        };
    },
});
