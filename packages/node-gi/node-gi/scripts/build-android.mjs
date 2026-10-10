// SPDX-License-Identifier: MIT
// Cross-compile the node-gi addon for one Android ABI into `libnode_gi.so`, with the NDK's clang
// against a GI stack built for Android and NativeScript's Node-API surface (libNativeScript.so).
// node-gyp has no Android target, so this is the whole build: docs/node-gi-platform-notes.md
// § "Building for Android".
//
// The source list is read from binding.gyp's `sources`, so there is no second list to drift.
//
// No libuv: on __ANDROID__ `NODE_GI_HAS_LIBUV` is 0, loop.cc compiles its ALooper pump instead of
// the uv bridge, and common.h does not include <uv.h>. Nothing here passes a libuv include path —
// that absence is part of the proof — and the finished library is checked for `uv_*` imports.
//
// Link against the `optimized` NativeScript AAR's libNativeScript.so, NOT the `regular` one: the
// regular build fails with `cannot locate symbol "__gxx_personality_v0"` (it does not export the
// C++ runtime the addon's static libstdc++ is meant to stand beside). `-static-libstdc++` keeps the
// addon's own C++ runtime inside it; `-landroid` supplies the ALooper_* entry points, which the
// NativeScript runtime links itself but a standalone .so has to ask for.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ABIS = {
    'arm64-v8a': 'aarch64-linux-android',
    x86_64: 'x86_64-linux-android',
};

const USAGE = `Usage: node scripts/build-android.mjs --abi <arm64-v8a|x86_64> [options]

Cross-compile libnode_gi.so for Android (NativeScript host, no libuv).

Options (each also read from the env var in brackets):
  --abi <abi>            arm64-v8a | x86_64                                    [ANDROID_ABI]
  --ndk <dir>            Android NDK root (contains toolchains/llvm)           [ANDROID_NDK_HOME]
  --gi-sysroot <dir>     prefix with lib/<abi>/lib{glib,gobject,gio,gmodule,girepository,
                         cairo,cairo-gobject,ffi,intl}-*.so; its lib/<abi>/pkgconfig
                         (else lib/pkgconfig) supplies the header paths        [NODE_GI_ANDROID_SYSROOT]
  --pkg-config-libdir <dir>
                         use this PKG_CONFIG_LIBDIR for the header paths instead (e.g. pixiewood's
                         bin-<arch>/meson-uninstalled, whose .pc files point into the build tree)
                                                                               [NODE_GI_ANDROID_PKGCONFIG]
  --napi-lib <path>      libNativeScript.so of the \`optimized\` AAR, or a directory holding it
                         (searched: <dir>, <dir>/<abi>, <dir>/jni/<abi>)       [NODE_GI_ANDROID_NAPI_LIB]
  --napi-include <dir>   NativeScript Node-API headers (default: derived from --napi-lib as
                         <aar>/prefab/modules/NativeScript/include)
  --api <level>          Android API level for the clang target (default 24)
  --out <dir>            output directory, created if missing                  [NODE_GI_ANDROID_OUT]
  --dry-run              print the compiler commands, run nothing
  -h, --help             this text
`;

function fail(message) {
    console.error(`build-android: ${message}`);
    process.exit(1);
}

function parseArgs(argv) {
    const env = process.env;
    const opts = {
        abi: env.ANDROID_ABI,
        ndk: env.ANDROID_NDK_HOME,
        giSysroot: env.NODE_GI_ANDROID_SYSROOT,
        pkgConfigLibdir: env.NODE_GI_ANDROID_PKGCONFIG,
        napiLib: env.NODE_GI_ANDROID_NAPI_LIB,
        napiInclude: undefined,
        api: '24',
        out: env.NODE_GI_ANDROID_OUT,
        dryRun: false,
    };
    const valued = {
        '--abi': 'abi',
        '--ndk': 'ndk',
        '--gi-sysroot': 'giSysroot',
        '--pkg-config-libdir': 'pkgConfigLibdir',
        '--napi-lib': 'napiLib',
        '--napi-include': 'napiInclude',
        '--api': 'api',
        '--out': 'out',
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '-h' || arg === '--help') {
            process.stdout.write(USAGE);
            process.exit(0);
        }
        if (arg === '--dry-run') {
            opts.dryRun = true;
            continue;
        }
        const [flag, inline] = arg.split(/=(.*)/s);
        const key = valued[flag];
        if (!key) fail(`unknown argument ${arg}\n\n${USAGE}`);
        const value = inline ?? argv[++i];
        if (value === undefined) fail(`${flag} needs a value`);
        opts[key] = value;
    }
    return opts;
}

/** binding.gyp is gyp (JSON plus `#` comment lines); only `targets[0].sources` is read. */
function gypSources() {
    const text = readFileSync(join(pkgDir, 'binding.gyp'), 'utf8')
        .split('\n')
        .filter((line) => !line.trim().startsWith('#'))
        .join('\n');
    const sources = JSON.parse(text).targets?.[0]?.sources;
    if (!Array.isArray(sources) || sources.length === 0) fail('binding.gyp has no targets[0].sources');
    for (const src of sources) {
        if (!existsSync(join(pkgDir, src))) fail(`binding.gyp lists ${src}, which does not exist`);
    }
    return sources;
}

function requireDir(label, dir, hint) {
    if (!dir) fail(`${label} is required (${hint})`);
    const abs = resolve(dir);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) fail(`${label}: ${abs} is not a directory`);
    return abs;
}

function findNapiLib(path, abi) {
    if (!path) fail('--napi-lib is required (libNativeScript.so of the `optimized` AAR, or its directory)');
    const abs = resolve(path);
    if (!existsSync(abs)) fail(`--napi-lib: ${abs} does not exist`);
    if (statSync(abs).isFile()) return abs;
    for (const candidate of [
        join(abs, 'libNativeScript.so'),
        join(abs, abi, 'libNativeScript.so'),
        join(abs, 'jni', abi, 'libNativeScript.so'),
    ]) {
        if (existsSync(candidate)) return candidate;
    }
    return fail(`--napi-lib: no libNativeScript.so under ${abs} (tried ., ${abi}/, jni/${abi}/)`);
}

function findClang(ndk, triple, api) {
    const prebuilt = join(ndk, 'toolchains', 'llvm', 'prebuilt');
    if (!existsSync(prebuilt)) fail(`--ndk: ${prebuilt} does not exist, not an NDK root`);
    for (const host of readdirSync(prebuilt)) {
        const clang = join(prebuilt, host, 'bin', `${triple}${api}-clang++`);
        if (existsSync(clang)) return clang;
    }
    return fail(`--ndk: no ${triple}${api}-clang++ under ${prebuilt}`);
}

function pkgConfigCflags(opts, abi) {
    const sysroot = requireDir('--gi-sysroot', opts.giSysroot, 'GI stack built for Android');
    const env = { ...process.env };
    if (opts.pkgConfigLibdir) {
        env.PKG_CONFIG_LIBDIR = requireDir('--pkg-config-libdir', opts.pkgConfigLibdir, '');
        delete env.PKG_CONFIG_PATH;
    } else {
        const dirs = [join(sysroot, 'lib', abi, 'pkgconfig'), join(sysroot, 'lib', 'pkgconfig')].filter(existsSync);
        if (dirs.length === 0) {
            fail(`${sysroot} has no lib/${abi}/pkgconfig or lib/pkgconfig; pass --pkg-config-libdir for header paths`);
        }
        env.PKG_CONFIG_LIBDIR = dirs.join(':');
        delete env.PKG_CONFIG_PATH;
    }
    const res = spawnSync('pkg-config', ['--cflags', 'girepository-2.0', 'cairo', 'cairo-gobject'], {
        env,
        encoding: 'utf8',
    });
    if (res.error) fail(`pkg-config not runnable: ${res.error.message}`);
    if (res.status !== 0) fail(`pkg-config could not resolve girepository-2.0/cairo/cairo-gobject:\n${res.stderr}`);
    return { sysroot, flags: res.stdout.trim().split(/\s+/).filter(Boolean) };
}

const GI_LIBS = [
    'girepository-2.0',
    'gobject-2.0',
    'glib-2.0',
    'gio-2.0',
    'gmodule-2.0',
    'cairo',
    'cairo-gobject',
    'ffi',
    'intl',
];

/**
 * The link command for one ABI. Exported so the library list is testable without an NDK —
 * `-llog` was missing here and `--no-undefined` failed the link on every ABI, which no
 * NDK-less test could have caught either, so the list itself is now the assertion.
 * @param {{ clang: string, out: string, objects: string[], libDir: string, napiLib: string }} spec
 * @returns {string[]} argv
 */
export function androidLinkArgs({ clang, out, objects, libDir, napiLib }) {
    return [
        clang,
        '-shared',
        '-o',
        join(out, 'libnode_gi.so'),
        ...objects,
        `-L${libDir}`,
        ...GI_LIBS.map((lib) => `-l${lib}`),
        '-landroid',
        // liblog, for android-log.cc's __android_log_print/_write. libNativeScript.so names those
        // symbols too, but as UND — it imports them itself — so the AAR satisfies nothing here and
        // `--no-undefined` fails the link on every ABI without this.
        '-llog',
        napiLib,
        '-static-libstdc++',
        '-Wl,--no-undefined',
    ];
}

function run(argv) {
    return new Promise((done, reject) => {
        const child = spawn(argv[0], argv.slice(1), { stdio: 'inherit' });
        child.on('error', reject);
        child.on('exit', (code) =>
            code === 0 ? done() : reject(new Error(`exit ${code}: ${argv[0]} ... ${argv.at(-1)}`)),
        );
    });
}

const quote = (argv) => argv.map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a}'`)).join(' ');

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const abi = opts.abi;
    if (!abi) fail(`--abi is required (${Object.keys(ABIS).join(' | ')})`);
    const triple = ABIS[abi];
    if (!triple) fail(`--abi ${abi}: expected ${Object.keys(ABIS).join(' | ')}`);
    if (!opts.ndk) fail('--ndk is required (Android NDK root)');
    if (!opts.out) fail('--out is required');

    const sources = gypSources();
    const clang = findClang(requireDir('--ndk', opts.ndk, 'Android NDK root'), triple, opts.api);
    const { sysroot, flags: giFlags } = pkgConfigCflags(opts, abi);
    const libDir = join(sysroot, 'lib', abi);
    if (!existsSync(libDir)) fail(`${libDir} does not exist: no GI libraries built for ${abi} in --gi-sysroot`);
    const missing = GI_LIBS.filter((lib) => !existsSync(join(libDir, `lib${lib}.so`)));
    if (missing.length) fail(`${libDir} lacks ${missing.map((l) => `lib${l}.so`).join(', ')}`);

    const napiLib = findNapiLib(opts.napiLib, abi);
    const napiInclude = opts.napiInclude
        ? resolve(opts.napiInclude)
        : resolve(dirname(napiLib), '..', '..', 'prefab', 'modules', 'NativeScript', 'include');
    if (!existsSync(napiInclude)) fail(`NativeScript headers not found at ${napiInclude}; pass --napi-include`);

    let addonApi;
    try {
        addonApi = createRequire(join(pkgDir, 'package.json'))('node-addon-api').include.replace(/^"|"$/g, '');
    } catch {
        fail('node-addon-api is not installed; run npm install in packages/node-gi/node-gi');
    }

    const out = resolve(opts.out);
    const cflags = [
        '-std=c++17',
        '-fPIC',
        '-O2',
        '-DNAPI_VERSION=8',
        '-DNAPI_DISABLE_CPP_EXCEPTIONS',
        '-DNODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS',
        `-I${napiInclude}`,
        `-I${addonApi}`,
        ...giFlags,
    ];
    const objects = sources.map((src) => join(out, `${src.replace(/^src\//, '').replace(/\.cc$/, '')}.o`));
    const compiles = sources.map((src, i) => [clang, ...cflags, '-c', join(pkgDir, src), '-o', objects[i]]);
    const link = androidLinkArgs({ clang, out, objects, libDir, napiLib });

    if (opts.dryRun) {
        for (const cmd of [...compiles, link]) console.log(quote(cmd));
        return;
    }
    mkdirSync(out, { recursive: true });
    await Promise.all(compiles.map(run));
    await run(link);
    console.log(`built ${join(out, 'libnode_gi.so')}`);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('build-android.mjs')) {
    main().catch((err) => fail(err.message));
}
