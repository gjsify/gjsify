// E2E test for `scripts/check-prebuild-loader-path.mjs` — the guard that a shipped prebuild
// resolves its OWN sibling libraries from its own directory.
//
// The bug it catches: the `*-native` bridges ship TWO libraries whose leaf names differ on
// purpose — `libgjsify<name>.{so,dylib}` (the Vala library the typelib names) and
// `libgjsify_<name>.{so,dylib}` (the cargo cdylib it links against, underscore). The typelib
// mentions only the first, so nothing else in the pipeline names the second, and a `cp` list
// that forgets it builds green, uploads green, lands on main and dies at `dlopen` on a
// user's machine with `Library not loaded: @rpath/libgjsify_rolldown.dylib` — which reads
// like a broken rpath and is a missing FILE. The darwin rolldown leg shipped exactly that.
//
// The committed prebuilds are the fixtures ON PURPOSE: they are real linked artifacts, and
// the darwin ones give the Mach-O parser real coverage from a Linux CI host that cannot run
// a single instruction of them — the only way a committed macOS binary gets checked before
// someone with a Mac tries to use it.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    copyFileSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { prebuildDir } from '../helpers.mjs';
import { machO, LC_ID_DYLIB, LC_LOAD_DYLIB, LC_RPATH, SYSTEM_DYLIB } from '../macho.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');
const CHECKER = join(MONOREPO_ROOT, 'scripts', 'check-prebuild-loader-path.mjs');

const { checkPrebuildDir, readLibrary, readTypelibSharedLibraries } = await import(`file://${CHECKER}`);
// The libc-axis readers live in the SAME parser (AGENTS.md: extend `binary.mjs`, never add a
// second) but are not on the loader-path CLI's surface, so they come from the package.
const { readElfNeeded, readElfGlibcRequires, compareGlibcVersions } = await import(
    `file://${join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib', 'binary.mjs')}`
);

/**
 * The Vala+Rust pairs, with the leaf names that MUST stay in step. Since ADR 0017 each
 * target lives in its own package, so a pair names only its bridge and the directory is
 * resolved per target through the shared `prebuildDir()`.
 */
const PAIRS = [
    { pillar: 'infra', bridge: 'rolldown-native', vala: 'libgjsifyrolldown', rust: 'libgjsify_rolldown' },
    { pillar: 'infra', bridge: 'oxfmt-native', vala: 'libgjsifyoxfmt', rust: 'libgjsify_oxfmt' },
    {
        pillar: 'infra',
        bridge: 'lightningcss-native',
        vala: 'libgjsifylightningcss',
        rust: 'libgjsify_lightningcss',
    },
];

/**
 * Every target token this suite can inspect, in the current `<os>-<arch>[-musl]` grammar.
 *
 * `linux-*-musl` is listed although nothing commits one yet: each loop below skips a target
 * whose library is absent, so the day a musl leg lands its artifacts are checked with no
 * fixture edit. One list also keeps the token shape out of three loop heads — the cheap half
 * of the "fixtures recompose the target name" item in `status/open-todos.md`.
 */
const TARGETS = ['linux-x64', 'linux-x64-musl', 'linux-arm64', 'linux-arm64-musl', 'darwin-arm64'];

describe('check-prebuild-loader-path: committed prebuilds', () => {
    for (const { pillar, bridge, vala, rust } of PAIRS) {
        for (const target of TARGETS) {
            const staged = prebuildDir(pillar, bridge, target);
            const ext = target.startsWith('darwin') ? '.dylib' : '.so';
            if (!existsSync(join(staged, `${vala}${ext}`))) continue; // target not shipped (yet)

            it(`${vala}${ext} in ${target} resolves its sibling from its own directory`, () => {
                assert.deepEqual(checkPrebuildDir(staged), []);
            });

            it(`${vala}${ext} in ${target} records ${rust}${ext} + the self-relative search path`, () => {
                const info = readLibrary(join(staged, `${vala}${ext}`));
                assert.ok(info, 'expected a parseable shared library');
                const token = info.format === 'macho' ? '@loader_path' : '$ORIGIN';
                // Mach-O carries the leaf behind `@rpath/`, ELF records the bare soname. Both
                // must name the UNDERSCORE leaf — that spelling is the other half of the trap.
                assert.ok(
                    info.needed.some((n) => n.endsWith(`${rust}${ext}`)),
                    `expected a dependency on ${rust}${ext}, got ${info.needed.join(', ')}`,
                );
                assert.ok(
                    info.searchPaths.includes(token),
                    `expected ${token} in the search paths, got ${info.searchPaths.join(', ') || '(none)'}`,
                );
            });
        }
    }
});

describe('check-prebuild-loader-path: failure modes', () => {
    /** Stage a subset of a real prebuild into a throwaway directory. */
    function stageSubset(sourceDir, names) {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-loader-path-'));
        for (const n of names) copyFileSync(join(sourceDir, n), join(dir, n));
        return dir;
    }

    const source = prebuildDir('infra', 'oxfmt-native', 'darwin-arm64');

    it('fails when the sibling cdylib is not staged (the darwin rolldown bug)', () => {
        const dir = stageSubset(source, ['libgjsifyoxfmt.dylib', 'GjsifyOxfmt-1.0.typelib']);
        try {
            const problems = checkPrebuildDir(dir);
            assert.equal(problems.length, 1);
            assert.match(problems[0], /libgjsify_oxfmt\.dylib is NOT staged/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('passes once the sibling is staged alongside it', () => {
        const dir = stageSubset(source, ['libgjsifyoxfmt.dylib', 'libgjsify_oxfmt.dylib']);
        try {
            assert.deepEqual(checkPrebuildDir(dir), []);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('reports a directory that holds no library at all', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-loader-path-'));
        try {
            writeFileSync(join(dir, 'Foo-1.0.typelib'), 'not a library');
            assert.match(checkPrebuildDir(dir).join('\n'), /holds no \.so/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('reports a missing directory instead of passing vacuously', () => {
        const dir = join(mkdtempSync(join(tmpdir(), 'gjsify-loader-path-')), 'absent');
        assert.match(checkPrebuildDir(dir).join('\n'), /not a directory/);
    });

    it('SKIPS a format it cannot parse rather than calling it broken', () => {
        // A future win32 `.dll` is PE/COFF, which this parser does not speak. Calling a
        // platform broken because the checker cannot read it would make the guard lie; the
        // job's load test is the functional backstop.
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-loader-path-'));
        try {
            mkdirSync(dir, { recursive: true });
            writeFileSync(join(dir, 'gjsifyfoo.dll'), 'MZ not really a PE image');
            assert.deepEqual(checkPrebuildDir(dir), []);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

/**
 * The build-host leak (#1102): a Mach-O names each dependency by full install path, so an
 * unrelocated darwin prebuild carries the Homebrew prefix of the runner that linked it —
 * `/usr/local/…` from an Intel runner, `/opt/homebrew/…` from an Apple-silicon one.
 *
 * The fixtures are SYNTHESISED rather than produced with `install_name_tool`, because these
 * tests run on a Linux CI host that can neither execute nor edit a Mach-O. A minimal 64-bit
 * image is a header plus load commands — exactly the part the parser reads — so building one
 * in-process covers the failing shape on every platform, where the real tool would make the
 * one check guarding macOS runnable only ON macOS.
 *
 * The writer itself lives in `tests/e2e/macho.mjs`, shared with `tests/e2e/ship-macos`, which
 * needs the same bytes for the opposite question — a closure whose every dependency RESOLVES.
 * Two copies of a binary writer are two sets of bytes that drift.
 */
describe('check-prebuild-loader-path: the build-host leak', () => {
    /** Write one synthetic image into a throwaway prebuild directory. */
    function stage(commands) {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-loader-path-'));
        writeFileSync(join(dir, 'libgjsifyfoo.dylib'), machO(commands));
        return dir;
    }

    const SYSTEM = SYSTEM_DYLIB;

    it('FAILS an absolute dependency outside /usr/lib and /System', () => {
        const dir = stage([
            { cmd: LC_ID_DYLIB, str: '@rpath/libgjsifyfoo.dylib' },
            { cmd: LC_LOAD_DYLIB, str: '/usr/local/opt/glib/lib/libglib-2.0.0.dylib' },
            SYSTEM,
        ]);
        try {
            const problems = checkPrebuildDir(dir, { verbose: false });
            assert.equal(problems.length, 1);
            assert.match(problems[0], /hard-links the build host/);
            assert.match(problems[0], /libglib-2\.0\.0\.dylib/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('FAILS the Apple-silicon prefix too — the predicate is not a /usr/local grep', () => {
        // A hardcoded `/opt/homebrew` test is vacuously false on an Intel runner and a
        // hardcoded `/usr/local` one on Apple silicon, so either alone passes green while
        // proving nothing about the other arch.
        const dir = stage([{ cmd: LC_LOAD_DYLIB, str: '/opt/homebrew/opt/libepoxy/lib/libepoxy.0.dylib' }, SYSTEM]);
        try {
            assert.match(checkPrebuildDir(dir, { verbose: false }).join('\n'), /hard-links the build host/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('FAILS a prefix nobody thought to list — MacPorts, a custom prefix, a home directory', () => {
        const dir = stage([{ cmd: LC_LOAD_DYLIB, str: '/opt/local/lib/libglib-2.0.0.dylib' }, SYSTEM]);
        try {
            assert.match(checkPrebuildDir(dir, { verbose: false }).join('\n'), /hard-links the build host/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('FAILS an absolute LC_ID_DYLIB — the leak propagates into whoever links it', () => {
        const dir = stage([{ cmd: LC_ID_DYLIB, str: '/usr/local/Cellar/foo/1.0/lib/libgjsifyfoo.dylib' }, SYSTEM]);
        try {
            assert.match(checkPrebuildDir(dir, { verbose: false }).join('\n'), /records its OWN name/);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('PASSES /usr/lib and /System — those ship with macOS at a guaranteed path', () => {
        const dir = stage([
            { cmd: LC_ID_DYLIB, str: '@rpath/libgjsifyfoo.dylib' },
            { cmd: LC_LOAD_DYLIB, str: '@rpath/libglib-2.0.0.dylib' },
            SYSTEM,
            { cmd: LC_LOAD_DYLIB, str: '/System/Library/Frameworks/OpenGL.framework/Versions/A/OpenGL' },
            { cmd: LC_RPATH, str: '@loader_path' },
        ]);
        try {
            assert.deepEqual(checkPrebuildDir(dir, { verbose: false }), []);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('REPORTS an absolute rpath without failing it — a search path is not a requirement', () => {
        // dyld ABORTS the load over a missing `LC_LOAD_DYLIB` and SKIPS a missing
        // `LC_RPATH`, so the Homebrew prefix as the last search entry is a working fallback —
        // failing it would refuse the artifact `relocate-macho.mjs` deliberately produces.
        const dir = stage([
            { cmd: LC_LOAD_DYLIB, str: '@rpath/libglib-2.0.0.dylib' },
            SYSTEM,
            { cmd: LC_RPATH, str: '@loader_path' },
            { cmd: LC_RPATH, str: '/usr/local/lib' },
        ]);
        try {
            assert.deepEqual(checkPrebuildDir(dir, { verbose: false }), []);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('gives every committed darwin prebuild the SAME rpath order', () => {
        // The order IS the precedence policy — dyld expands `@rpath` against each `LC_RPATH`
        // in the order recorded — so a set-equality assertion would pass on the bug this
        // exists to catch: `relocate-macho.mjs` used to delete only the rpaths it did not
        // want and append the rest, so an entry the linker had baked in kept its position. A
        // freshly-linked `libgwebgl.dylib` carries `<brew>/lib` from the Homebrew link line,
        // and CI's artifact therefore shipped the SYSTEM prefix ahead of the bundle,
        // inverting ADR 0023's darwin policy.
        //
        // Read from the FILE rather than recomputed from `darwinPrebuildRpaths`: the point is
        // what the artifact records, and a shared helper would make the test agree with the
        // generator by construction.
        for (const target of ['darwin-x64', 'darwin-arm64']) {
            const arch = target.slice('darwin-'.length);
            const prefix = arch === 'arm64' ? '/opt/homebrew' : '/usr/local';
            const expected = ['@loader_path', `@loader_path/../../../gtk-runtime-${target}/gtk/lib`, `${prefix}/lib`];
            for (const { pillar, bridge } of [...PAIRS, { pillar: 'framework', bridge: 'webgl' }]) {
                const dir = prebuildDir(pillar, bridge, target);
                if (!existsSync(dir)) continue;
                for (const leaf of readdirSync(dir).filter((f) => f.endsWith('.dylib'))) {
                    const info = readLibrary(join(dir, leaf));
                    // The cdylibs have no `@rpath/` dependency and so get no rpaths at all.
                    if (!info?.needed.some((n) => n.startsWith('@rpath/'))) continue;
                    assert.deepEqual(
                        info.searchPaths,
                        expected,
                        `${target}/${leaf}: rpath ORDER must be @loader_path → bundle → system (ADR 0023)`,
                    );
                }
            }
        }
    });

    it('holds every COMMITTED darwin prebuild to the same rule', () => {
        // The regression half. It runs from any host — the parser reads both
        // arches' images without executing them — so an unrelocated artifact
        // committed from either runner is caught on the Linux leg.
        const dirs = [];
        for (const target of ['darwin-x64', 'darwin-arm64']) {
            for (const { pillar, bridge } of PAIRS) {
                const d = prebuildDir(pillar, bridge, target);
                if (existsSync(d)) dirs.push(d);
            }
            const webgl = prebuildDir('framework', 'webgl', target);
            if (existsSync(webgl)) dirs.push(webgl);
        }
        assert.ok(dirs.length > 0, 'expected at least one committed darwin prebuild to check');
        for (const dir of dirs) {
            const leaks = checkPrebuildDir(dir, { verbose: false }).filter((p) => /hard-links the build host/.test(p));
            assert.deepEqual(leaks, [], `${dir} still carries a build-host dependency`);
        }
    });
});

describe('typelib shared-library records', () => {
    const TERMINAL_LE = prebuildDir('node', 'terminal-native', 'linux-x64', 'GjsifyTerminal-1.0.typelib');

    it('reads the library a little-endian typelib names', () => {
        assert.deepEqual(readTypelibSharedLibraries(TERMINAL_LE), ['libgjsifyterminal.so']);
    });

    it('reads a BIG-endian typelib — the s390x case', () => {
        // A typelib is written in the byte order of the machine that compiled it and carries
        // NO endianness flag, so a `linux-s390x` one read little-endian from an x86-64 host
        // yields an out-of-range offset — which looks exactly like "this namespace names no
        // library" and silently skips the staged-leaf check on the one big-endian arch we
        // ship. Reproduced by swapping the committed typelib's header, so no second binary
        // fixture is needed.
        const src = readFileSync(TERMINAL_LE);
        const swapped = Buffer.from(src);
        for (const offset of [40, 52]) swapped.writeUInt32BE(src.readUInt32LE(offset), offset);
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-typelib-'));
        try {
            const file = join(dir, 'GjsifyTerminal-1.0.typelib');
            writeFileSync(file, swapped);
            assert.deepEqual(readTypelibSharedLibraries(file), ['libgjsifyterminal.so']);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('returns null for a file that is not a typelib', () => {
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-typelib-'));
        try {
            const file = join(dir, 'Fake-1.0.typelib');
            writeFileSync(file, 'x'.repeat(256));
            assert.equal(readTypelibSharedLibraries(file), null);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('libc axis — DT_NEEDED, read from the committed binaries', () => {
    // The readers exist so `libc` and `gjsify.glibcRequires` are MEASURED rather than
    // hand-maintained, and the committed prebuilds are the fixtures for the same reason the
    // loader-path checks use them: real linked artifacts on five architectures and two byte
    // orders, none of which this x86-64 host can execute.
    const TERMINAL = (target) => prebuildDir('node', 'terminal-native', target, 'libgjsifyterminal.so');
    const TLS = (target) => prebuildDir('node', 'tls-native', target, 'libgjsifytls.so');

    it('reports libc.so.6 for a bridge that links it — on every arch, both byte orders', () => {
        // `linux-s390x` is the big-endian one. Unlike a typelib an ELF header carries its own
        // byte order, so this is not a guess — but it is still the case a little-endian-only
        // reader gets silently wrong.
        for (const target of ['linux-x64', 'linux-arm64', 'linux-ppc64', 'linux-s390x', 'linux-riscv64']) {
            const needed = readElfNeeded(TERMINAL(target));
            assert.ok(Array.isArray(needed), `${target}: expected a measurement, got null`);
            assert.ok(needed.includes('libc.so.6'), `${target}: expected libc.so.6, got ${needed.join(', ')}`);
            // Leaf names, not raw strings: "does it need libc" is a question about the leaf.
            assert.ok(
                needed.every((n) => !n.includes('/')),
                `${target}: expected leaf names, got ${needed.join(', ')}`,
            );
        }
    });

    it('reports NO libc soname for a bridge that reaches libc only through GLib', () => {
        // `@gjsify/tls-native` on x64 calls into GLib/GIO/GnuTLS and nothing else, so it loads
        // against whatever libc the host's GLib was built for. That third state — neither
        // glibc nor musl — is why an unsuffixed target means "default build", not "glibc".
        const needed = readElfNeeded(TLS('linux-x64'));
        assert.ok(Array.isArray(needed));
        assert.ok(!needed.includes('libc.so.6'), `expected no libc.so.6, got ${needed.join(', ')}`);
        assert.ok(needed.includes('libgnutls.so.30'), needed.join(', '));
    });

    it('reports the SAME package as glibc-linked on riscv64 — the requirement is per TARGET', () => {
        // Measured, and it is the finding that shaped the `libc` rule: Fedora's
        // riscv64 toolchain records libc + the interpreter explicitly, so
        // `@gjsify/tls-native` is libc-agnostic on four targets and glibc-only on
        // this one. npm's package-level `libc` field cannot express that, which
        // is why `prebuild-libc` leaves it absent and says so in a note.
        const needed = readElfNeeded(TLS('linux-riscv64'));
        assert.ok(needed.includes('libc.so.6'), needed.join(', '));
    });

    it('returns NULL — not [] — for a file that is not an ELF at all', () => {
        // The contract the whole audit rests on: null is "not measured", `[]` is "measured,
        // records nothing". Collapsing them concludes "no libc.so.6, therefore musl-safe"
        // about a file nobody parsed.
        const dir = mkdtempSync(join(tmpdir(), 'gjsify-elf-'));
        try {
            const file = join(dir, 'libnothing.so');
            writeFileSync(file, 'x'.repeat(512));
            assert.equal(readElfNeeded(file), null);
            assert.equal(readElfGlibcRequires(file), null);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('returns null rather than throwing on a Mach-O image', () => {
        // Throwing would abort a whole audit run over a platform this reader never claimed
        // to inspect.
        const dylib = prebuildDir('infra', 'oxfmt-native', 'darwin-arm64', 'libgjsifyoxfmt.dylib');
        assert.equal(readElfNeeded(dylib), null);
        assert.equal(readElfGlibcRequires(dylib), null);
    });
});

describe('libc axis — the glibc floor, read from SHT_GNU_verneed', () => {
    it('reads the floor the dynamic linker will actually enforce', () => {
        // The two extremes in the tree: a pure-Vala bridge using only ancient symbols, and
        // the Rust cdylib that single-handedly sets this repo's Linux baseline (glibc 2.39 =
        // Ubuntu 24.04 / Debian 13) — the fact no declaration revealed before it was measured.
        assert.equal(
            readElfGlibcRequires(prebuildDir('node', 'terminal-native', 'linux-x64', 'libgjsifyterminal.so')),
            '2.2.5',
        );
        assert.equal(
            readElfGlibcRequires(prebuildDir('infra', 'lightningcss-native', 'linux-x64', 'libgjsify_lightningcss.so')),
            '2.39',
        );
    });

    it('reads a BIG-endian .gnu.version_r — the s390x case', () => {
        // Same trap as the big-endian typelib above, one section over.
        assert.equal(
            readElfGlibcRequires(prebuildDir('node', 'terminal-native', 'linux-s390x', 'libgjsifyterminal.so')),
            '2.2',
        );
    });

    it('reports null for a library that requires no versioned glibc symbol', () => {
        // The Vala half of a Rust pair records no libc at all, hence no floor — which is why
        // the rule takes the MAXIMUM over the whole staged directory. Reading only the
        // typelib-named library reports "no glibc requirement" for the three highest floors.
        assert.equal(
            readElfGlibcRequires(prebuildDir('infra', 'lightningcss-native', 'linux-x64', 'libgjsifylightningcss.so')),
            null,
        );
    });

    it('compares versions numerically, so 2.9 does not outrank 2.34', () => {
        // The one comparison a lexical sort gets wrong on the actual data, and it appears
        // twice: the maximum inside a `.gnu.version_r` table, and a measurement against a
        // declared floor.
        assert.ok(compareGlibcVersions('2.34', '2.9') > 0);
        assert.ok(compareGlibcVersions('2.9', '2.34') < 0);
        assert.equal(compareGlibcVersions('2.34', '2.34.0'), 0);
        assert.ok(compareGlibcVersions('2.2.5', '2.2') > 0);
        assert.ok(compareGlibcVersions('2.39', '2.28') > 0);
    });
});
