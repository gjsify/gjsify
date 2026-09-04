// E2E test for @gjsify/create-app CLI
// Scaffolds each template, patches @gjsify/* deps to local tarballs, installs,
// runs `npm run build` to prove the template compiles end-to-end, and then
// STARTS the scaffolded app to prove it runs.
// Requires: yarn build (monorepo must be built first)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// The zero-dependency subpath, deliberately: the plugin root would pull vite,
// execa and minify-xml into an e2e suite that only wants the answer.
import { resolveBlueprintCompiler } from '@gjsify/vite-plugin-blueprint/resolve';

import {
    MONOREPO_ROOT,
    createTestEnvironment,
    cleanupTestEnvironment,
    toFileRef,
    buildOverrides,
    npmInstallWithRetry,
    spawnUntilReady,
    hasCommand,
    createAppRegistryGapSkipReason,
} from '../helpers.mjs';
// The one definition of what `pack.mjs` packs — imported from the module that owns it
// rather than re-derived. See `registryGjsifyRangesFor` for why this suite needs it before
// `createTestEnvironment` has packed anything.
import { packableWorkspaces } from '../workspaces.mjs';
// Imported, not re-spelled: a second copy of the globals vocabulary is the one that drifts.
import { GJS_GLOBALS_GROUPS, GJS_GLOBALS_MAP } from '../../../packages/infra/resolve-npm/lib/globals-map.mjs';
import { ALIASES_WEB_FOR_GJS } from '../../../packages/infra/resolve-npm/lib/index.mjs';

// Listing order matches the template catalog (simple first).
const TEMPLATES = [
    'gtk-minimal',
    'cli',
    'adw-canvas2d',
    'adw-webgl',
    'adw-game',
    'web-server-hono',
    'web-server-express',
];

const TEMPLATES_DIR = join(MONOREPO_ROOT, 'templates');
/** What the scaffolder actually copies — `file:` edges already resolved to ranges. */
const DIST_TEMPLATES_DIR = join(MONOREPO_ROOT, 'packages', 'infra', 'create-gjsify', 'dist-templates');

/**
 * The registers an EXPLICIT `--globals` list injects, mirroring `resolveGlobalsList`. `auto`
 * and `none` are dropped: not identifiers, and what `auto` finds depends on the graph, which
 * no manifest can promise. A template is held to the set it NAMES.
 */
function registerPathsFor(globalsArg) {
    const out = new Set();
    for (const token of globalsArg.split(',').map((t) => t.trim())) {
        if (!token || token === 'auto' || token === 'none') continue;
        const group = GJS_GLOBALS_GROUPS[token];
        for (const id of group ?? [token]) {
            const path = GJS_GLOBALS_MAP[id];
            if (path) out.add(path);
        }
    }
    return out;
}

/**
 * The `@gjsify/*` spelling of a register path: the globals map stores the BARE specifier
 * where the alias table rewrites at build time (`fetch/register/xhr`), so the name to find
 * in `dependencies` is the alias target, not the prefix as written.
 */
function canonicalRegisterPath(registerPath) {
    const direct = ALIASES_WEB_FOR_GJS[registerPath];
    if (direct) return direct;
    if (registerPath.startsWith('@')) return registerPath;
    const head = packageNameOf(registerPath);
    const aliased = ALIASES_WEB_FOR_GJS[head];
    return aliased ? aliased + registerPath.slice(head.length) : registerPath;
}

function packageNameOf(registerPath) {
    const parts = registerPath.split('/');
    return registerPath.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

// Templates that compile `.blp` files — require a blueprint-compiler the BUILD
// can find. Asking the resolver rather than probing PATH ourselves is the whole
// point: on win32 MSYS2 does not put its bin dirs on PATH, so a `--version`
// probe answers "missing" and skips three templates on a host where every one of
// them builds. The resolver is what the plugin actually spawns, so it is the
// only answer that predicts the build.
const BLUEPRINT_TEMPLATES = new Set(['adw-canvas2d', 'adw-webgl', 'adw-game']);

function hasBlueprintCompiler() {
    return resolveBlueprintCompiler() !== null;
}

/**
 * How each template is STARTED and what proves it came up.
 *
 * There is deliberately NO default: `launchRecipe` throws on a template that is
 * not listed, so a template added to `TEMPLATES` cannot scaffold, type-check and
 * then never run. A default entry is exactly how the next template would quietly
 * stop being checked — which is the hole this table closes.
 *
 *   gtk    — a GTK/Adwaita app: announces nothing, so it is asked over the
 *            session bus for the name it claims.
 *   cli    — a one-shot command: must exit 0 having printed `expect`.
 *   server — an HTTP server: must print `ready` and then answer a request.
 */
const LAUNCH = {
    'gtk-minimal': { kind: 'gtk' },
    cli: { kind: 'cli', expect: /runtime\s*:/ },
    'adw-canvas2d': { kind: 'gtk' },
    'adw-webgl': { kind: 'gtk' },
    'adw-game': { kind: 'gtk' },
    'web-server-hono': { kind: 'server', ready: /Hono server running at http:\/\/localhost:\d+/ },
    'web-server-express': { kind: 'server', ready: /Express server running at http:\/\/localhost:\d+/ },
};

function launchRecipe(template) {
    const recipe = LAUNCH[template];
    if (!recipe) {
        const kinds = [...new Set(Object.values(LAUNCH).map((r) => r.kind))].join(' | ');
        throw new Error(
            `template "${template}" has no LAUNCH entry in tests/e2e/create-app/run.mjs. ` +
                `Add one (kind: ${kinds}) so the scaffolded app is actually started — building it is not evidence that it runs.`,
        );
    }
    return recipe;
}

// One port per template, fixed and suite-specific. `PORT=0` is not an option:
// the templates print the port they were ASKED for, so the readiness line would
// read `localhost:0` and the request would have nowhere to go.
const SERVER_PORT_BASE = 39_180;

const HAS_DISPLAY = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
// Xvfb is how this repo already gives CI a display (see the `Test` job in
// .github/workflows/main.yml and `xorg-x11-server-Xvfb` in
// .docker/ci-fedora.Dockerfile); a developer box with a real session skips it.
const GUI_WRAPPER = HAS_DISPLAY
    ? []
    : hasCommand('xvfb-run')
      ? ['xvfb-run', '-a', '--server-args=-screen 0 1280x720x24']
      : null;

/**
 * Why the GUI templates cannot be started here, or `false` when they can.
 *
 * A displayless host is NOT covered by this: GTK4 fails to open a display,
 * `gjs` exits 1 and the app never reaches the bus, so `spawnUntilReady` reports
 * the real reason. Only a host that cannot provide a display AT ALL is excused.
 */
const GUI_SKIP_REASON =
    GUI_WRAPPER === null
        ? 'no DISPLAY/WAYLAND_DISPLAY and no xvfb-run — this host cannot run a GTK app'
        : !hasCommand('dbus-daemon') || !hasCommand('gdbus')
          ? 'dbus-daemon/gdbus missing — a GTK app is asked for its application id over the session bus'
          : false;

// LIBGL_ALWAYS_SOFTWARE mirrors what the WebGL jobs in main.yml set (Xvfb has no
// GPU); GTK_A11Y=none silences the a11y-bus warning GTK itself prints under a
// bus with no a11y service on it.
const GUI_ENV = { LIBGL_ALWAYS_SOFTWARE: '1', GTK_A11Y: 'none' };

/**
 * A private session bus, one per launched GUI app.
 *
 * Not the host's: CI has no session bus at all, and on a developer box the host
 * bus may already carry a name a scaffolded app wants — the assertion would then
 * be about somebody else's process. Not a shared one either: a name is dropped
 * when its owner's connection closes, so a bus reused across templates lets the
 * previous app's name linger into the next one's assertion.
 */
function startPrivateBus() {
    const out = execFileSync('dbus-daemon', ['--session', '--fork', '--print-address', '--print-pid'], {
        encoding: 'utf8',
    });
    const [address, pid] = out.trim().split('\n');
    return { address, pid: Number(pid) };
}

/** The well-known names currently owned on `address`. */
function busNames(address) {
    const out = execFileSync(
        'gdbus',
        [
            'call',
            '--session',
            '--dest',
            'org.freedesktop.DBus',
            '--object-path',
            '/org/freedesktop/DBus',
            '--method',
            'org.freedesktop.DBus.ListNames',
        ],
        { encoding: 'utf8', env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: address } },
    );
    return [...out.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

// `npm install` retry (transient @girs registry 404s) lives in ../helpers.mjs
// as `npmInstallWithRetry`. `npm run build` is intentionally NOT retried so a
// real regression (e.g. a runtime dep misclassified as a devDependency — the
// bug this suite guards) still fails deterministically on the first attempt.

/** Scaffold a project using the create-app CLI with an explicit template. */
function scaffold(cwd, projectName, template, extraArgs = []) {
    const createAppBin = join(MONOREPO_ROOT, 'packages', 'infra', 'create-gjsify', 'lib', 'index.js');
    const stdout = execFileSync('node', [createAppBin, projectName, '--template', template, ...extraArgs], {
        cwd,
        encoding: 'utf8',
    });
    return { dir: join(cwd, projectName), stdout };
}

/**
 * The TWO surfaces onto the same scaffolder, keyed by name.
 *
 * `npm create @gjsify/app` runs the standalone bin; `gjsify create` runs the CLI
 * subcommand, which imports the very same package. They are separate argv
 * parsers, which is how they drifted: the subcommand offered neither `--runtime`
 * nor `--package-manager` and passed neither on, so `createProject` fell back to
 * the host runtime and its first manager — `gjsify create --install` ran `npm
 * install` without ever saying so, while the bin refused to guess.
 */
const SURFACES = {
    'create-app': (argv) => [
        'node',
        [join(MONOREPO_ROOT, 'packages', 'infra', 'create-gjsify', 'lib', 'index.js'), ...argv],
    ],
    'gjsify create': (argv) => [
        'node',
        [join(MONOREPO_ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js'), 'create', ...argv],
    ],
};

/**
 * Run `argv` on a surface with NO tty, and report everything a user would see.
 *
 * stdout and stderr are merged on purpose: which stream a notice goes to is part
 * of the answer, but the parity assertion is about the answer itself, and the two
 * surfaces would otherwise be free to agree on the text while disagreeing on
 * where it lands. The cwd is scrubbed because it is the one legitimate difference
 * — each surface scaffolds into its own directory.
 */
function runSurface(surface, cwd, argv) {
    const [cmd, args] = SURFACES[surface](argv);
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
    return {
        status: r.status,
        output: `${r.stdout ?? ''}${r.stderr ?? ''}`.split(cwd).join('<cwd>'),
    };
}

/**
 * The build artifacts a scaffolded project DECLARES: `gjsify.main` (the
 * `--app gjs` bundle) plus `gjsify.example.node` (the `--app node` one, shared
 * by node/bun/deno).
 *
 * Asserting against the manifest instead of a hardcoded `dist/index.js` is what
 * makes this suite track the template rather than one historical filename: a
 * template that claims a runtime and emits no bundle for it now fails here,
 * and a rename of the output cannot quietly turn the assertion into a tautology
 * against a file nothing produces any more.
 */
function declaredArtifacts(projectDir) {
    const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
    return [pkg.gjsify?.main, pkg.gjsify?.example?.node].filter((p) => typeof p === 'string' && p.length > 0);
}

/**
 * Every `@gjsify/*` range a scaffolded project will really ask the REGISTRY for.
 *
 * Two subtleties, and getting either wrong makes this wait for the wrong thing.
 *
 * The manifests are read off `dist-templates/` and not `templates/`, because that
 * is the artifact the scaffolder copies: in `templates/` the same edge is still a
 * checkout-relative `file:`/`workspace:` specifier that `process-template.mjs` has
 * not yet resolved into a range.
 *
 * And a range there does NOT mean a registry install. `patchPackageJson` remaps
 * every WORKSPACE member to a locally packed tarball, so being packed is the
 * discriminator. MEASURED: reading `dist-templates` alone reports ELEVEN ranges,
 * ten of which are answered by a tarball and would have made this wait on publishes
 * the suite never touches. What is left is the deliberate exception —
 * `@gjsify/node-gi` is not a workspace member (own CI, native addon, ADR 0031) and
 * four templates declare it.
 *
 * THE ORDERING CONSTRAINT, and why asking `packableWorkspaces()` is not a second
 * list. This used to read the discriminator off the live tarball map, which forced
 * the whole question after `createTestEnvironment()` has packed the entire workspace
 * — fine for a wait inside `before()`, impossible for a `{ skip }` that `describe`
 * reads at DEFINITION time. The tarball map is not an independent source of truth: it
 * is a materialization of `packableWorkspaces()`, because `pack.mjs` iterates exactly
 * that list and `process.exit(1)`s if any entry yields no filename. So its key set is
 * knowable before a single tarball exists, from the same function pack.mjs itself
 * calls — which is what `workspaces.mjs`'s header designates this module for. The
 * suite then CHECKS that equality against the real map once it has one, so a drift
 * between the two is a named failure rather than a skip on the wrong package.
 */
const PACKED_NAMES = new Set(packableWorkspaces().map((w) => w.name));

/**
 * ONE TEMPLATE's registry-bound ranges — and asking per template is the point.
 *
 * Only 4 of the 7 templates carry a registry-bound edge at all: `gtk-minimal`,
 * `adw-canvas2d`, `adw-webgl` and `adw-game` declare `@gjsify/node-gi`, while
 * `cli`, `web-server-hono` and `web-server-express` name nothing but
 * `workspace:^` members, every one of them in `PACKED_NAMES`. The union used to
 * be asked once and hung on the OUTER describe, so a release window suppressed
 * those three — 21 tests that would have passed — along with the four it
 * actually applies to (#1533).
 */
function registryGjsifyRangesFor(template) {
    const seen = new Map();
    const manifest = join(DIST_TEMPLATES_DIR, template, 'package.json');
    if (!existsSync(manifest)) return [];
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
    for (const field of ['dependencies', 'devDependencies']) {
        for (const [name, spec] of Object.entries(pkg[field] ?? {})) {
            if (!name.startsWith('@gjsify/') || typeof spec !== 'string') continue;
            // A path, link, tarball or git edge needs no registry at all…
            if (/^(?:file:|link:|https?:|git|portal:|\.|\/)/.test(spec)) continue;
            // …and neither does one this suite is about to replace with a tarball.
            if (PACKED_NAMES.has(name)) continue;
            seen.set(`${name}@${spec}`, [name, spec]);
        }
    }
    return [...seen.values()];
}

/**
 * Patch the scaffolded package.json:
 * - Drop @girs/* (types-only; gi:// imports are externalized by esbuild).
 * - Remap @gjsify/* deps/devDeps to local tarballs.
 * - Leave third-party deps (hono, express, yargs, three, excalibur, …) as published versions.
 * - Add overrides for all @gjsify/* packages so transitive deps resolve to tarballs.
 */
function patchPackageJson(projectDir, tarballsDir, tarballMap) {
    const pkgPath = join(projectDir, 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

    for (const field of ['dependencies', 'devDependencies']) {
        if (!pkg[field]) continue;
        for (const name of Object.keys(pkg[field])) {
            if (name.startsWith('@girs/')) {
                delete pkg[field][name];
                continue;
            }
            const ref = toFileRef(name, tarballsDir, tarballMap);
            if (ref) pkg[field][name] = ref;
        }
    }

    pkg.overrides = buildOverrides(tarballsDir, tarballMap);

    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Its own describe, so it runs without paying for the tarball packing below —
// a missing launch recipe should be reported in seconds, not after seven installs.
describe('create-app launch coverage', () => {
    it('every template has a launch recipe', () => {
        for (const template of TEMPLATES) launchRecipe(template);
    });

    // Templates only, because a template is the one package kind rebuilt OUTSIDE this
    // monorepo by a manager we do not choose; a showcase ships a bundle built here, where
    // everything is hoisted and the gap cannot bite. The incident is in the message below,
    // where the next reader meets it.
    it('every register a template asks for is a dependency it declares', () => {
        for (const template of TEMPLATES) {
            const pkg = JSON.parse(readFileSync(join(TEMPLATES_DIR, template, 'package.json'), 'utf8'));
            const declared = new Set([
                ...Object.keys(pkg.dependencies ?? {}),
                ...Object.keys(pkg.devDependencies ?? {}),
            ]);
            for (const [script, body] of Object.entries(pkg.scripts ?? {})) {
                if (typeof body !== 'string') continue;
                for (const match of body.matchAll(/--globals\s+(\S+)/g)) {
                    for (const registerPath of registerPathsFor(match[1])) {
                        const owner = packageNameOf(canonicalRegisterPath(registerPath));
                        assert.ok(
                            declared.has(owner),
                            `templates/${template}: script \`${script}\` passes --globals ${match[1]}, which injects ` +
                                `\`${registerPath}\`, but the template declares no \`${owner}\`.\n` +
                                '  It resolves only where the package manager HOISTS a transitive copy to the ' +
                                'project root, which npm and bun do and the isolated layouts do not. Measured on the ' +
                                'three adw templates: under pnpm, and under deno (the ONLY manager `gjsify create` ' +
                                'offers for the deno runtime), `deno task build` — the next command the scaffolder ' +
                                'prints — died on UnresolvedWorkspaceImportError, because `--app node` has no ' +
                                'resolvable-register filter. The gjs half failed more quietly: it SKIPS an ' +
                                'unresolvable register with a warning, so the build exited 0 without the DOM surface ' +
                                'it had asked for (75 KB against npm 220 KB).\n' +
                                `  Add \`${owner}\` to devDependencies — registers are bundled into the output, so it ` +
                                'is not needed at runtime.',
                        );
                    }
                }
            }
        }
    });
});

// The D-Bus spec's rule for a well-known name, restated here rather than imported
// from the scaffolder: a test that asks the implementation what "valid" means
// cannot catch the implementation being wrong.
const BUS_NAME = /^[A-Za-z_-][A-Za-z0-9_-]*(\.[A-Za-z_-][A-Za-z0-9_-]*)+$/;

describe('create-app scaffolding options', { timeout: 2 * 60 * 1000 }, () => {
    let tmpDir;

    before(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-e2e-create-app-opts-'));
    });

    after(() => {
        cleanupTestEnvironment(tmpDir);
    });

    it('scaffolds with --package-manager gjsify and says so in the next steps', () => {
        // `gjsify` is the only one of the four managers that works on a host with
        // no Node.js, and nothing exercised it: the flag was threaded from argv to
        // `printNextSteps` and never read back.
        const { stdout } = scaffold(tmpDir, 'pm-gjsify', 'cli', ['--package-manager', 'gjsify']);
        assert.match(stdout, /^ {2}gjsify install$/m, `next steps must install with gjsify. Output:\n${stdout}`);
        assert.match(stdout, /^ {2}gjsify run dev$/m, `next steps must run scripts with gjsify. Output:\n${stdout}`);
        assert.doesNotMatch(stdout, /npm run/, `no npm spelling may leak through. Output:\n${stdout}`);
    });

    // The argv shapes where the two surfaces can disagree at all: a flag the
    // subcommand might not have, a default that has to be announced, a refusal
    // that has to happen. `--install` appears WITHOUT a manager on purpose — it
    // is the one default that would reach the user's disk, and the case where
    // the drift was live rather than cosmetic. Nothing here installs: every one
    // of these settles before `createProject` spawns anything.
    const PARITY_ARGV = [
        ['proj', '-t', 'cli'],
        ['proj', '-t', 'cli', '-r', 'deno'],
        ['proj', '-t', 'cli', '-p', 'bun'],
        ['proj', '-t', 'cli', '--install'],
        ['proj', '-t', 'cli', '-r', 'gjs', '-p', 'npm'],
        ['proj', '-t', 'cli', '-r', 'bun', '-p', 'deno'],
    ];

    for (const argv of PARITY_ARGV) {
        it(`answers \`${argv.slice(1).join(' ')}\` the same on both surfaces`, () => {
            const results = Object.keys(SURFACES).map((surface) => {
                const cwd = join(tmpDir, `parity-${surface.replace(/\W+/g, '-')}-${argv.join('-')}`);
                mkdirSync(cwd, { recursive: true });
                return { surface, ...runSurface(surface, cwd, argv) };
            });
            const [first, ...rest] = results;
            for (const other of rest) {
                assert.equal(
                    other.status,
                    first.status,
                    `\`${argv.join(' ')}\` exits ${first.status} on ${first.surface} but ${other.status} on ${other.surface}`,
                );
                assert.equal(
                    other.output,
                    first.output,
                    `\`${argv.join(' ')}\` answers differently on ${other.surface}:\n--- ${first.surface} ---\n${first.output}\n--- ${other.surface} ---\n${other.output}`,
                );
            }
        });
    }

    it('refuses to pick an installer for you off a tty', () => {
        // `--install` with no `--package-manager` and no terminal to ask: the
        // manager writes node_modules and a lockfile, so a default here is a
        // decision made ON the user rather than for them.
        for (const surface of Object.keys(SURFACES)) {
            const cwd = join(tmpDir, `no-silent-install-${surface.replace(/\W+/g, '-')}`);
            mkdirSync(cwd, { recursive: true });
            const { status, output } = runSurface(surface, cwd, ['proj', '-t', 'cli', '--install']);
            assert.equal(status, 1, `${surface} must refuse. Output:\n${output}`);
            assert.match(
                output,
                /--package-manager is required with --install/,
                `${surface} must say which flag is missing. Output:\n${output}`,
            );
            assert.ok(
                !existsSync(join(cwd, 'proj')),
                `${surface} must not scaffold when it refuses. Output:\n${output}`,
            );
        }
    });

    it('derives the application id from the project name', () => {
        const { dir } = scaffold(tmpDir, 'appid-derived', 'gtk-minimal');
        const src = readFileSync(join(dir, 'src', 'index.ts'), 'utf8');
        const id = src.match(/application_?[Ii]d: '([^']+)'/)?.[1];
        // Two projects that both announce `org.gjsify.example` are one app to
        // GTK: the second to start becomes a REMOTE instance of the first,
        // forwards `activate` to the other project's window and exits 0 with no
        // window and no error of its own.
        assert.equal(id, 'org.gjsify.appid-derived', `scaffolded app id must be the project's own. Source:\n${src}`);
    });

    it('keeps the application id a valid bus name for a digit-leading project name', () => {
        // npm accepts `2048`; a D-Bus name element may not begin with a digit, and
        // `Gtk.Application` refuses to construct with an invalid id — at startup,
        // where nothing but a launched app can see it.
        const { dir } = scaffold(tmpDir, '2048', 'gtk-minimal');
        const src = readFileSync(join(dir, 'src', 'index.ts'), 'utf8');
        const id = src.match(/application_?[Ii]d: '([^']+)'/)?.[1];
        assert.match(id ?? '', BUS_NAME, `"${id}" is not a valid D-Bus name. Source:\n${src}`);
    });
});

// Top-level await, like the two PnP suites: the reason has to exist before `describe`
// is called, because `{ skip }` is read when the suite is DEFINED, not when it runs.
// Logged as well as returned — a skip reason is easy to miss in a 146-suite
// concurrent run, and the three states this suite can end in (passed, skipped because
// the release has not published yet, failed) have to be one glance apart.
//
// ONE DECISION PER TEMPLATE, because that is the granularity of the condition
// (#1533). The probe still runs concurrently over the whole set, and a template
// with no registry-bound edge never reaches the network at all — `wanted` is
// empty and `unpublishedRegistryDependencies` returns before its first request.
const registryGapByTemplate = new Map(
    await Promise.all(
        TEMPLATES.map(async (template) => [
            template,
            await createAppRegistryGapSkipReason(registryGjsifyRangesFor(template)),
        ]),
    ),
);
for (const [template, gap] of registryGapByTemplate) {
    if (gap) console.log(`  SKIP create-app E2E template ${template}: ${gap}`);
}

// The outer suite still packs the whole workspace in its `before()`, which is
// minutes of CI. Worth doing for one template that can run; worth skipping when
// the window covers every one of them — and that is an equality with the
// per-template decision, not the coarser question the outer skip used to ask.
const everyTemplateInTheWindow = TEMPLATES.every((template) => registryGapByTemplate.get(template));

describe(
    'create-app E2E',
    {
        timeout: 60 * 60 * 1000,
        skip: everyTemplateInTheWindow ? registryGapByTemplate.get(TEMPLATES[0]) : false,
    },
    () => {
        let tmpDir;
        let tarballsDir;
        let tarballMap;

        before(() => {
            const env = createTestEnvironment('gjsify-e2e-create-app-');
            tmpDir = env.tmpDir;
            tarballsDir = env.tarballsDir;
            tarballMap = env.tarballMap;
        });

        after(() => {
            cleanupTestEnvironment(tmpDir);
        });

        it('packs exactly the set the registry-gap decision assumed', () => {
            // The skip above ran before anything was packed, off `packableWorkspaces()`.
            // That is sound only while `pack.mjs` packs exactly that list — and if it ever
            // stops, the failure mode is the dangerous one: a name wrongly believed
            // registry-bound turns a green suite into a permanent skip. So the assumption
            // is checked here against the map that was actually produced, on every run
            // that is not itself skipped.
            assert.deepEqual(
                [...PACKED_NAMES].sort(),
                Object.keys(tarballMap).sort(),
                'pack.mjs and packableWorkspaces() disagree about what gets packed, so ' +
                    'registryGjsifyRangesFor() decided the release-window skip on the wrong set',
            );
        });

        for (const template of TEMPLATES) {
            describe(
                `template: ${template}`,
                { timeout: 15 * 60 * 1000, skip: registryGapByTemplate.get(template) },
                () => {
                    const projectName = `test-${template}`;
                    let projectDir;
                    let skipReason;

                    before(() => {
                        if (BLUEPRINT_TEMPLATES.has(template) && !hasBlueprintCompiler()) {
                            skipReason = 'blueprint-compiler not installed';
                            return;
                        }

                        console.log(`  [${template}] scaffolding…`);
                        projectDir = scaffold(tmpDir, projectName, template).dir;

                        console.log(`  [${template}] patching package.json…`);
                        patchPackageJson(projectDir, tarballsDir, tarballMap);

                        console.log(`  [${template}] npm install…`);
                        npmInstallWithRetry(projectDir, { label: template });
                    });

                    it('scaffolded project has expected files', (t) => {
                        if (skipReason) return t.skip(skipReason);
                        assert.ok(existsSync(join(projectDir, 'package.json')), 'package.json missing');
                        assert.ok(existsSync(join(projectDir, 'tsconfig.json')), 'tsconfig.json missing');
                        assert.ok(existsSync(join(projectDir, 'src', 'index.ts')), 'src/index.ts missing');
                    });

                    it('package.json was scaffolded with the expected name', (t) => {
                        if (skipReason) return t.skip(skipReason);
                        const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
                        assert.equal(pkg.name, projectName, 'project name not rewritten');
                        assert.notEqual(pkg.name, 'new-gjsify-app', 'sentinel name leaked through');
                    });

                    it('npm install created node_modules', (t) => {
                        if (skipReason) return t.skip(skipReason);
                        assert.ok(existsSync(join(projectDir, 'node_modules')), 'node_modules missing');
                        assert.ok(
                            existsSync(join(projectDir, 'node_modules', '.package-lock.json')),
                            'lockfile missing',
                        );
                    });

                    it('npm run build produces every declared artifact', (t) => {
                        if (skipReason) return t.skip(skipReason);
                        console.log(`  [${template}] npm run build…`);
                        execSync('npm run build', {
                            cwd: projectDir,
                            stdio: 'pipe',
                            timeout: 5 * 60 * 1000,
                        });
                        const artifacts = declaredArtifacts(projectDir);
                        assert.ok(artifacts.length > 0, 'template declares no build artifact');
                        for (const rel of artifacts) {
                            assert.ok(existsSync(join(projectDir, rel)), `${rel} missing after build`);
                        }
                    });

                    it('every declared runtime has a bundle behind it', (t) => {
                        if (skipReason) return t.skip(skipReason);
                        const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
                        const runtimes = pkg.gjsify?.example?.runtimes;
                        assert.ok(
                            Array.isArray(runtimes) && runtimes.length > 0,
                            'gjsify.example.runtimes not declared',
                        );
                        // node/bun/deno all consume the one `--app node` bundle, so a
                        // template claiming any of them owes exactly one extra entry.
                        if (runtimes.some((r) => r !== 'gjs')) {
                            assert.ok(
                                pkg.gjsify?.example?.node,
                                'claims a non-gjs runtime but declares no gjsify.example.node',
                            );
                        }
                        if (runtimes.includes('gjs')) {
                            assert.ok(pkg.gjsify?.main, 'claims gjs but declares no gjsify.main');
                        }
                    });

                    it('build output is valid JavaScript', (t) => {
                        if (skipReason) return t.skip(skipReason);
                        let checked = 0;
                        for (const rel of declaredArtifacts(projectDir)) {
                            const outFile = join(projectDir, rel);
                            if (!existsSync(outFile)) continue;
                            execFileSync('node', ['--check', outFile], { stdio: 'pipe' });
                            checked++;
                        }
                        if (checked === 0) return t.skip('build output missing');
                    });

                    // The assertion `node --check` could not make, and it caught two
                    // templates shipping a broken start-up: `cli` exited 1 on `npm start`
                    // for want of a `$0` default command, and every GTK one announced the
                    // same hardcoded application id.
                    it('the scaffolded app starts', async (t) => {
                        if (skipReason) return t.skip(skipReason);
                        const recipe = launchRecipe(template);
                        if (recipe.kind === 'gtk' && GUI_SKIP_REASON) {
                            // On CI the tooling is BAKED INTO THE IMAGE — `.docker/ci-fedora.Dockerfile`
                            // installs `xorg-x11-server-Xvfb`, `dbus-daemon`, `dbus-x11` and `glib2`
                            // (which is where `gdbus` comes from). So on the one host this leg exists
                            // for, the skip cannot legitimately fire: if it does, the image lost a
                            // package and every GTK template silently stopped being started. Skipping
                            // there would turn this into a check that reports green on the only run
                            // that matters, which is the failure class this suite was written against.
                            // Locally the skip is honest — a laptop without a display should not fail.
                            if (process.env.CI) {
                                assert.fail(
                                    `GTK launch cannot be skipped on CI: ${GUI_SKIP_REASON}. The CI image is ` +
                                        'built to carry Xvfb, dbus-daemon/dbus-x11 and glib2 — if one is gone, ' +
                                        'restore it in .docker/ci-fedora.Dockerfile rather than letting the ' +
                                        'GTK templates go unstarted.',
                                );
                            }
                            return t.skip(GUI_SKIP_REASON);
                        }

                        console.log(`  [${template}] npm start…`);
                        if (recipe.kind === 'gtk') return startGtkApp(projectDir, projectName, template);
                        if (recipe.kind === 'cli') return startCliApp(projectDir, recipe, template);
                        return startServerApp(projectDir, recipe, template);
                    });
                },
            );
        }

        async function startGtkApp(projectDir, projectName, template) {
            const appId = `org.gjsify.${projectName}`;
            const [command, ...args] = [...GUI_WRAPPER, 'npm', 'run', 'start'];
            const bus = startPrivateBus();
            let app;
            try {
                app = await spawnUntilReady(command, args, {
                    cwd: projectDir,
                    env: { ...process.env, ...GUI_ENV, DBUS_SESSION_BUS_ADDRESS: bus.address },
                    // The app prints nothing, so the bus is the only witness — and it
                    // is a display-backed one: with no display GTK4 fails to open one,
                    // `gjs` exits 1 and the name never appears, so this reports that
                    // exit instead of passing on a host that showed nothing.
                    probe: () => busNames(bus.address).some((n) => n.startsWith('org.gjsify.')),
                    timeoutMs: 3 * 60 * 1000,
                    label: `${template} npm start`,
                });
                const claimed = busNames(bus.address).filter((n) => n.startsWith('org.gjsify.'));
                assert.deepEqual(
                    claimed,
                    [appId],
                    `the scaffolded app must announce its OWN application id.\n${app.output()}`,
                );
            } finally {
                await app?.stop();
                process.kill(bus.pid, 'SIGTERM');
            }
        }

        async function startCliApp(projectDir, recipe, template) {
            const app = await spawnUntilReady('npm', ['run', 'start'], {
                cwd: projectDir,
                ready: recipe.expect,
                awaitExit: true,
                timeoutMs: 2 * 60 * 1000,
                label: `${template} npm start`,
            });
            assert.equal(app.code, 0, `\`npm start\` must succeed on a freshly scaffolded project.\n${app.output()}`);
        }

        async function startServerApp(projectDir, recipe, template) {
            const port = SERVER_PORT_BASE + TEMPLATES.indexOf(template);
            const app = await spawnUntilReady('npm', ['run', 'start'], {
                cwd: projectDir,
                env: { ...process.env, PORT: String(port) },
                ready: recipe.ready,
                timeoutMs: 2 * 60 * 1000,
                label: `${template} npm start`,
            });
            try {
                const res = await fetch(`http://localhost:${port}/api/ping`, { signal: AbortSignal.timeout(15_000) });
                assert.equal(res.status, 200, `GET /api/ping must answer 200.\n${app.output()}`);
                const body = await res.json();
                assert.equal(body.ok, true, `GET /api/ping must answer {ok:true}, got ${JSON.stringify(body)}`);
            } finally {
                await app.stop();
            }
        }
    },
);
