#!/usr/bin/env node
// A widget exists on BOTH platforms, the `exports` map names both, and the base module
// refuses — or `@gjsify/adwaita-react-native` is not what it says it is.
//
// THE INCIDENT THIS EXISTS BEFORE, not after
//
// The package ships one API surface with two implementations: the real `Adw.*` widget
// on GTK4, React Native primitives on a phone. Which one a consumer gets is decided by
// the `exports` map's `react-native` condition, and every barrel names its platform
// files LITERALLY (`./widgets/clamp.native.js`, `./widgets/clamp.gtk.js`) rather than
// relying on a resolver to pick a sibling.
//
// That is a correction, and it is what makes this gate load-bearing. The design
// originally forked by FILE NAME — gjsify's `.gtk` chain on the desktop, Metro's
// `.native` step on the phone. Measured against `metro-resolver@0.87.0`:
// `resolveSourceFile` calls `resolveSourceFileForAllExts(context, '')` FIRST, with no
// platform and an empty source extension, which skips both the platform branch and the
// `preferNativePlatform` branch and resolves the literal path — extension included. Our
// shipped modules import each other WITH the `.js` extension, so Metro finds
// `clamp.js` and never looks at `clamp.native.js`. `.native` wins only for
// extensionless specifiers, which a `lib/esm` build does not emit.
//
// The replacement works — a package of this exact shape resolved through the real
// resolver with `@react-native/metro-config@0.87.1`'s `unstable_conditionNames:
// ['react-native']` lands on `clamp.native.js`, and without that condition on
// `clamp.gtk.js`. A stock React Native 0.87 application therefore needs NO
// configuration, and it is the React Native PRESET rather than metro that selects the
// phone half: `metro-config@0.87.0` `defaults/index.js:69` sets
// `unstable_enablePackageExports: true` while line 65 leaves `unstable_conditionNames`
// EMPTY — metro alone would take the `default` branch — and
// `@react-native/metro-config@0.87.1` `dist/index.js:49` supplies the condition.
//
// But the replacement moved the correctness from a resolver's algorithm into a
// HAND-MAINTAINED map and three hand-maintained barrels. That is the class that
// drifted three separate times in this repository in one day: the gallery against the
// storybook, the stories against their registration, the descriptors against GIR. So
// the gate is not a nicety here. It is the condition under which naming the files by
// hand is an admissible design at all.
//
// WHAT A MISSING HALF ACTUALLY COSTS, and why "half a widget" is worse than none.
// On the GTK path the specifier `react-native` is aliased onto `@gjsify/react-native`.
// A widget whose `.gtk` module is missing and whose base module re-exported the native
// one would therefore RUN on GTK — as a working, worse copy of the widget beside the
// real one. No import error, no type error, no failing test; a window that is subtly
// wrong. Hence rule 3 below: a base module refuses, and may not re-export a sibling.
//
// WHAT IT CHECKS — ten rules, each falsified in both directions before landing:
//
//   1. Every widget has all three modules (base, `.gtk.tsx`, `.native.tsx`), and no
//      platform module exists without the other two. Both directions, because a
//      `.gtk.tsx` with no `.native.tsx` and a `.native.tsx` with no `.gtk.tsx` are
//      different bugs with the same fix.
//   2. Every widget has an `exports` entry naming BOTH platform builds under the right
//      conditions, EVERY entry declares `types`, and every path any of them names has a
//      source module behind it. A map entry pointing at a file that does not exist is a
//      resolution failure in a consumer's bundler and nowhere else — and `types` is the
//      one condition whose target is not a build output of the half it describes, so it
//      is also the one a copy-paste can leave pointing at a declaration that was never
//      emitted.
//   3. The base modules refuse: each widget's `<name>.ts` calls the named-throw helper,
//      and neither it NOR the base barrel imports or re-exports a platform sibling.
//      The barrel half is not decoration: `index.ts` is a second place the same drift
//      lands, and rule 5 only asks whether the base modules are all NAMED there — a
//      barrel that names them and ALSO re-exports `./widgets/clamp.native.js` satisfies
//      it, which is the worse-copy case one file up. The PLATFORM barrels are held to
//      the same rule against each OTHER: `index.gtk.ts` re-exporting
//      `./widgets/clamp.native.js` was measured passing every other rule here, and it is
//      the worse-copy case in its most expensive form — the barrel every GTK consumer
//      actually loads.
//   4. Every platform module carries an explicit `@jsxImportSource` pragma, and the
//      right one. Measured: the per-file pragma beats the tsconfig option, and the two
//      halves need OPPOSITE values — `@gjsify/gtk-host/react` so `<div>` is a TS2339
//      on GTK, plain `react` so a phone bundle carries no GTK import. Neither half may
//      be right by inheriting a project default the other half contradicts.
//   5. The three barrels are complete: the base barrel names every base module, the
//      GTK barrel every `.gtk`, the native barrel every `.native`.
//   6. `module`/`main` point at the BASE barrel — the entry a condition-blind tool falls
//      back to, which is the only audience the refusal has left — and at least ONE of
//      them EXISTS. The presence half is not pedantry: measured, deleting `module`
//      outright left this gate at exit 0 while rules 3 and 5 went on guarding a barrel
//      no consumer could reach, which is this repository's most expensive failure class
//      wearing the uniform of a passing check.
//   7. `parity.spec.ts` carries a type-level assertion per widget per platform, and
//      `PARITY_ASSERTIONS` lists exactly those. That spec is what makes "one API
//      surface" a thing `tsc` refuses rather than a sentence, and it is per-widget —
//      so a widget added without its two aliases is a widget nothing holds to the
//      surface, and the spec would go on passing. Nothing else can see that.
//   8. The ORDER of the conditions inside each `exports` entry: `types` first,
//      `default` last. `exports` resolves by FIRST MATCH, and `default` matches
//      everything — so `{types, default, react-native}` is a map every rule above
//      accepts (the keys are all there, pointing at the right files) and which hands
//      the GTK build to every React Native application. Measured, not reasoned: with
//      that order, `metro-resolver@0.87.0` under `unstable_conditionNames:
//      ['react-native']` resolves `@gjsify/adwaita-react-native` to
//      `lib/esm/index.gtk.js` on both ios and android. A key lookup — which is all
//      rules 2 and 6 can do — cannot see order, so this rule is the only thing between
//      a one-line reordering and a phone bundle that imports `gi://Adw`.
//   9. Neither half imports the other's platform. Rule 4 is the NARROW version of this —
//      it keeps the JSX factory import off the phone — and it was the only version for
//      a while: measured, `bin.native.tsx` with a plain `import Adw from 'gi://Adw'`, or
//      with `@gjsify/gtk-host`, passed every rule above. On the phone that is a resolve
//      failure inside a consumer's Metro build; on GTK the mirror case is worse, because
//      the specifier `react-native` is ALIASED onto `@gjsify/react-native` there, so a
//      `.gtk` module importing it runs — as the working worse copy this whole file is
//      about. The pragma proves the JSX runtime; only this proves the module graph.
//  10. No barrel exports a widget CLASS flat. ADR 0034 § Amendment 8 removed the run of
//      `export { AdwClamp } from './widgets/clamp.js'` lines from all three barrels, so
//      `Adw.Clamp` is the only name the package root has for the widget. Rule 8 holds
//      the namespace and would not notice a flat export returning BESIDE it — that is
//      the shape the removal was reversing, and it is one line to write and invisible in
//      review. The widget's own `AdwClamp` identifier is untouched: `widgets/clamp.ts`
//      declares it, `exports['./widgets/clamp']` publishes it, `refuseBaseModule` prints
//      it, and at that entry point it is the widget's ONLY name. This rule is about the
//      three barrels and nothing else.
//
// A SCOPE THAT FINDS NOTHING IS A FAILURE. Zero widgets means a renamed directory or a
// reader that stopped matching, and printing OK over a tree nothing looked at is the
// same vacuity `check-adwaita-keyboard-contract.mjs` and
// `check-nativescript-theme-classes.mjs` both fail on. The count is asserted.
//
// Usage: node scripts/check-adwaita-rn-platform-split.mjs [--root <dir>]

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
if (rootFlag !== -1 && args[rootFlag + 1] === undefined) {
    console.error('check-adwaita-rn-platform-split: --root needs a directory.');
    process.exit(2);
}
const ROOT =
    rootFlag === -1
        ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
        : resolve(process.cwd(), args[rootFlag + 1]);

const PACKAGE_DIR = join(ROOT, 'packages', 'framework', 'adwaita-react-native');
const WIDGETS_DIR = join(PACKAGE_DIR, 'src', 'widgets');

/**
 * The two platforms, and everything that differs between them in one place.
 *
 * A second list of suffixes anywhere in this file is how the `exports` half and the
 * pragma half would come to know different platforms — the shape
 * `resolve-npm/lib/runtime-aliases.mjs` calls out as the reason its own target list is
 * exported rather than retyped.
 */
const PLATFORMS = [
    {
        name: 'gtk',
        suffix: '.gtk.tsx',
        /** The `exports` condition that selects it. `default`, i.e. everything else. */
        condition: 'default',
        buildSuffix: '.gtk.js',
        barrel: 'index.gtk.ts',
        jsxImportSource: '@gjsify/gtk-host/react',
        /** Rule 9. On GTK `react-native` is ALIASED onto `@gjsify/react-native` and RUNS. */
        forbiddenImports: ['react-native'],
    },
    {
        name: 'native',
        suffix: '.native.tsx',
        condition: 'react-native',
        buildSuffix: '.native.js',
        barrel: 'index.native.ts',
        jsxImportSource: 'react',
        /** Rule 9. `gi://` is a GJS scheme and gtk-host is its React adapter; neither is on a phone. */
        forbiddenImports: ['gi://', '@gjsify/gtk-host'],
    },
];

/** The helper a base module must route through. Named once; rule 3 reads it. */
const REFUSAL_HELPER = 'refuseBaseModule';

const problems = [];
const fail = (rule, message) => problems.push(`[${rule}] ${message}`);

const read = (path) => readFileSync(path, 'utf8');

/**
 * Module specifiers a file actually IMPORTS, comments excluded.
 *
 * A substring search was the first version and it was wrong in the direction that
 * costs most: `bin.ts`'s doc comment names `./bin.gtk.js` while explaining what the
 * parity assertion holds, and the gate reported the file as re-exporting its sibling.
 * A false alarm teaches the next reader to loosen the rule, which is how a gate stops
 * gating. So comments are removed FIRST — string-aware, because a `//` inside a
 * literal would otherwise swallow the rest of a line and turn this into a reader that
 * under-detects, which is the same failure pointing the other way.
 */
function moduleSpecifiers(source) {
    const code = withoutComments(source);
    const specifiers = new Set();
    // The backtick is in the class because `import(`./clamp.native.js`)` is a legal
    // specifier and was NOT read by the first version — measured: a base module reaching
    // its sibling that way passed rule 3 at exit 0. A reader that under-detects is worse
    // than no reader, because the rule it fronts for reads as enforced.
    for (const match of code.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*(['"`])([^'"`]+)\1/g)) {
        specifiers.add(match[2]);
    }
    return specifiers;
}

/**
 * `source` with comments removed and string literals kept, string-aware.
 *
 * Its own function because rule 10 needs the same view of a barrel that
 * {@link moduleSpecifiers} does, and the two must not disagree about what code is: a
 * second stripper is a second answer to "is this line real", and the rule that got the
 * looser one stops gating without saying so.
 */
function withoutComments(source) {
    let code = '';
    let index = 0;
    while (index < source.length) {
        const char = source[index];
        const next = source[index + 1];
        if (char === '/' && next === '/') {
            while (index < source.length && source[index] !== '\n') index += 1;
            continue;
        }
        if (char === '/' && next === '*') {
            index += 2;
            while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
            index += 2;
            continue;
        }
        if (char === '"' || char === "'" || char === '`') {
            const quote = char;
            code += char;
            index += 1;
            while (index < source.length && source[index] !== quote) {
                if (source[index] === '\\') {
                    code += source.slice(index, index + 2);
                    index += 2;
                    continue;
                }
                code += source[index];
                index += 1;
            }
            code += quote;
            index += 1;
            continue;
        }
        code += char;
        index += 1;
    }
    return code;
}

if (!existsSync(WIDGETS_DIR)) {
    console.error(
        `check-adwaita-rn-platform-split: ${WIDGETS_DIR} does not exist.\n` +
            'The package moved or was renamed. This gate names its own scope, so a moved tree\n' +
            'makes it silently check nothing — fix the path here in the same change.',
    );
    process.exit(2);
}

const files = readdirSync(WIDGETS_DIR).filter((name) => !name.includes('.spec.'));

/** Widget names, from every spelling on disk — so a stray half is FOUND, not skipped. */
const widgets = new Set();
for (const file of files) {
    if (file.endsWith('.gtk.tsx')) widgets.add(file.slice(0, -'.gtk.tsx'.length));
    else if (file.endsWith('.native.tsx')) widgets.add(file.slice(0, -'.native.tsx'.length));
    else if (file.endsWith('.ts')) widgets.add(file.slice(0, -'.ts'.length));
}

// ─── Rule 1 — all three modules, both directions ────────────────────────────
for (const widget of [...widgets].sort()) {
    if (!existsSync(join(WIDGETS_DIR, `${widget}.ts`))) {
        fail('modules', `${widget}: no base module \`src/widgets/${widget}.ts\``);
    }
    for (const platform of PLATFORMS) {
        if (!existsSync(join(WIDGETS_DIR, `${widget}${platform.suffix}`))) {
            fail('modules', `${widget}: no ${platform.name} module \`src/widgets/${widget}${platform.suffix}\``);
        }
    }
}

// ─── Rule 3 — the base modules refuse, and re-export no sibling ─────────────
/** Every `./widgets/<widget>.<platform>.js` a file must not name. Rule 3, twice. */
const refusesPlatformSiblings = (source, where, prefix, platforms, instead) => {
    const imported = moduleSpecifiers(source);
    for (const widget of [...widgets].sort()) {
        for (const platform of platforms) {
            const specifier = `${prefix}${widget}${platform.buildSuffix}`;
            if (imported.has(specifier)) {
                fail(
                    'refusal',
                    `${where}: reaches the ${platform.name} implementation of \`${widget}\` ` +
                        `(\`${specifier}\`) ${instead}`,
                );
            }
        }
    }
};

// The base BARREL, which rule 5 can only ask about completeness: it may name every base
// module and still re-export a platform one beside it, and that extra line is the
// "working worse copy" this file's header is about, one directory up.
const baseBarrelPath = join(PACKAGE_DIR, 'src', 'index.ts');
if (existsSync(baseBarrelPath)) {
    refusesPlatformSiblings(read(baseBarrelPath), '`src/index.ts`', './widgets/', PLATFORMS, 'instead of refusing');
}

// And each PLATFORM barrel against the OTHER platform. Rule 5 makes a barrel name its own
// half's modules; nothing made it name only those. Measured: `index.gtk.ts` with an extra
// `export … from './widgets/clamp.native.js'` passed every rule in this file, and it is
// the worse-copy case at its most expensive — that barrel is `exports["."]`'s `default`,
// i.e. what every GTK consumer loads.
for (const platform of PLATFORMS) {
    const barrelPath = join(PACKAGE_DIR, 'src', platform.barrel);
    if (!existsSync(barrelPath)) continue;
    const others = PLATFORMS.filter((other) => other.name !== platform.name);
    refusesPlatformSiblings(
        read(barrelPath),
        `\`src/${platform.barrel}\``,
        './widgets/',
        others,
        `beside its own — this barrel is what \`exports['.']['${platform.condition}']\` loads`,
    );
}

for (const widget of [...widgets].sort()) {
    const basePath = join(WIDGETS_DIR, `${widget}.ts`);
    if (!existsSync(basePath)) continue;
    const source = read(basePath);
    if (!source.includes(REFUSAL_HELPER)) {
        fail('refusal', `${widget}: \`src/widgets/${widget}.ts\` never calls \`${REFUSAL_HELPER}\``);
    }
    // A base module that resolves to a platform implementation is the "working worse
    // copy" case in this file's header, and it is spelled as an ordinary import — which
    // is why the check is on the specifier and not on a keyword.
    refusesPlatformSiblings(source, `${widget}: \`src/widgets/${widget}.ts\``, './', PLATFORMS, 'instead of refusing');
}

// ─── Rule 4 — the right JSX source, per platform module ─────────────────────
const PRAGMA_RE = /\/\*\*\s*@jsxImportSource\s+(\S+)\s*\*\//;
for (const widget of [...widgets].sort()) {
    for (const platform of PLATFORMS) {
        const path = join(WIDGETS_DIR, `${widget}${platform.suffix}`);
        if (!existsSync(path)) continue;
        const match = PRAGMA_RE.exec(read(path));
        if (match === null) {
            fail(
                'jsx-source',
                `${widget}${platform.suffix}: no \`@jsxImportSource\` pragma — it would inherit the ` +
                    `tsconfig's, which is the OTHER platform's element list`,
            );
        } else if (match[1] !== platform.jsxImportSource) {
            fail(
                'jsx-source',
                `${widget}${platform.suffix}: \`@jsxImportSource ${match[1]}\`, expected ` +
                    `\`${platform.jsxImportSource}\``,
            );
        }
    }
}

// ─── Rule 9 — neither half imports the other's platform ─────────────────────
// Rule 4 above proves the JSX FACTORY; this proves the module graph, and the two are
// different questions. A `.native.tsx` with the right pragma and a bare
// `import Adw from 'gi://Adw?version=1'` was measured passing every other rule here.
for (const widget of [...widgets].sort()) {
    for (const platform of PLATFORMS) {
        const path = join(WIDGETS_DIR, `${widget}${platform.suffix}`);
        if (!existsSync(path)) continue;
        for (const specifier of moduleSpecifiers(read(path))) {
            const forbidden = platform.forbiddenImports.find((prefix) => specifier.startsWith(prefix));
            if (forbidden === undefined) continue;
            fail(
                'platform-imports',
                `${widget}${platform.suffix}: imports \`${specifier}\`, which is the OTHER ` +
                    `platform's — a \`${forbidden}\` specifier has no meaning in a ${platform.name} build`,
            );
        }
    }
}

// ─── Rules 2, 6 and 8 — the `exports` map ───────────────────────────────────
const manifest = JSON.parse(read(join(PACKAGE_DIR, 'package.json')));
const exportsField = manifest.exports ?? {};

/**
 * The conditions whose POSITION decides the answer, and where they have to be.
 *
 * `types` first because TypeScript stops at the first key it understands; `default`
 * last because it matches everything, so anything after it is dead. Everything between
 * them is order-independent here — the package declares one real condition.
 */
const CONDITION_POSITION = [
    {
        condition: 'types',
        at: 0,
        where: 'first',
        because:
            'TypeScript takes the first condition it understands, so a runtime condition ahead of it decides the declarations',
    },
    {
        condition: 'default',
        at: -1,
        where: 'last',
        because:
            '`default` matches everything, so every condition after it is dead and the wrong half ships to one runtime only',
    },
];

/**
 * `./lib/esm/widgets/clamp.gtk.js` → the source module it is built from, `types` included.
 *
 * `./lib/types/**.d.ts` is emitted by a DIFFERENT command (`build:types`, i.e. `tsc`)
 * from the one that writes `lib/esm`, so a `types` target is the one condition whose
 * file can be absent while every runtime condition resolves. Reading it through the same
 * function is what lets rule 2 ask the same question of all of them.
 */
const sourceBehind = (target) => {
    const relative = String(target)
        .replace(/^\.\/lib\/(esm|types)\//, '')
        .replace(/\.d\.ts$/, '.js');
    for (const extension of ['.tsx', '.ts']) {
        const candidate = join(PACKAGE_DIR, 'src', relative.replace(/\.js$/, extension));
        if (existsSync(candidate)) return candidate;
    }
    return null;
};

for (const [subpath, entry] of Object.entries(exportsField)) {
    if (typeof entry !== 'object' || entry === null) {
        fail('exports', `${subpath}: not a conditional entry, so it can name only one platform`);
        continue;
    }
    // Rule 8 — ORDER, which no key lookup below can see. `exports` takes the FIRST
    // matching condition, so `default` before `react-native` gives a React Native app
    // the GTK build with every other rule here still green: measured through
    // `metro-resolver@0.87.0` with `unstable_conditionNames: ['react-native']`, that
    // ordering resolves this package to `lib/esm/index.gtk.js` on ios and android alike.
    const conditions = Object.keys(entry);
    for (const { condition, at, where, because } of CONDITION_POSITION) {
        const index = conditions.indexOf(condition);
        if (index === -1) continue;
        if (index !== (at === -1 ? conditions.length - 1 : at)) {
            fail(
                'exports',
                `${subpath}: \`${condition}\` is condition ${index + 1} of ${conditions.length} ` +
                    `(${conditions.join(', ')}), and must be ${where} — ${because}`,
            );
        }
    }
    if (entry.types === undefined) {
        fail(
            'exports',
            `${subpath}: declares no \`types\` condition, so this subpath ships no declarations — ` +
                'and the one surface both halves are held to is the one nothing would then describe',
        );
    }
    for (const [condition, target] of Object.entries(entry)) {
        if (sourceBehind(target) === null) {
            fail('exports', `${subpath} → ${condition}: \`${target}\` has no source module under \`src/\``);
        }
    }
}

for (const widget of [...widgets].sort()) {
    const subpath = `./widgets/${widget}`;
    const entry = exportsField[subpath];
    if (entry === undefined) {
        fail('exports', `${widget}: \`exports["${subpath}"]\` is missing, so no consumer can reach it directly`);
        continue;
    }
    for (const platform of PLATFORMS) {
        const expected = `./lib/esm/widgets/${widget}${platform.buildSuffix}`;
        if (entry[platform.condition] !== expected) {
            fail(
                'exports',
                `${widget}: \`exports["${subpath}"]["${platform.condition}"]\` is ` +
                    `${JSON.stringify(entry[platform.condition])}, expected ${JSON.stringify(expected)}`,
            );
        }
    }
}

const rootEntry = exportsField['.'] ?? {};
for (const platform of PLATFORMS) {
    const expected = `./lib/esm/index${platform.buildSuffix}`;
    if (rootEntry[platform.condition] !== expected) {
        fail(
            'exports',
            `\`exports["."]["${platform.condition}"]\` is ${JSON.stringify(rootEntry[platform.condition])}, ` +
                `expected ${JSON.stringify(expected)}`,
        );
    }
}
const BASE_ENTRY_FIELDS = ['module', 'main'];
for (const field of BASE_ENTRY_FIELDS) {
    const value = manifest[field];
    if (value !== undefined && value !== 'lib/esm/index.js') {
        fail(
            'base-entry',
            `\`${field}\` is ${JSON.stringify(value)}, expected "lib/esm/index.js" — the base barrel is ` +
                'what a tool that ignores export conditions falls back to, and the refusal is written for it',
        );
    }
}
// The PRESENCE half, which the loop above cannot express: with neither field declared,
// every rule in this file stayed green (measured, exit 0) over a package whose base
// barrel no consumer could reach — so `refuse.ts`, rule 3 and half of rule 5 were
// guarding a file with no audience. A gate that goes on passing after its subject
// disappears is the failure this repository pays for most often.
if (!BASE_ENTRY_FIELDS.some((field) => manifest[field] !== undefined)) {
    fail(
        'base-entry',
        `neither \`module\` nor \`main\` is declared, so nothing points at the base barrel — the ` +
            'refusal in `src/refuse.ts` then has no audience at all, and the rules that keep the base ' +
            'modules free of platform siblings guard a file no tool can reach',
    );
}

// ─── Rule 5 — the barrels are complete ──────────────────────────────────────
const barrelCheck = (barrel, suffixOf) => {
    const path = join(PACKAGE_DIR, 'src', barrel);
    if (!existsSync(path)) {
        fail('barrels', `\`src/${barrel}\` does not exist`);
        return;
    }
    const imported = moduleSpecifiers(read(path));
    for (const widget of [...widgets].sort()) {
        const specifier = `./widgets/${widget}${suffixOf}`;
        if (!imported.has(specifier)) {
            fail('barrels', `\`src/${barrel}\` does not name \`${specifier}\``);
        }
    }
};
barrelCheck('index.ts', '.js');
for (const platform of PLATFORMS) barrelCheck(platform.barrel, platform.buildSuffix);

// ─── Rule 7 — a parity assertion per widget per platform ────────────────────
const parityPath = join(PACKAGE_DIR, 'src', 'parity.spec.ts');
if (!existsSync(parityPath)) {
    fail('parity', '`src/parity.spec.ts` does not exist — nothing holds the two halves to one surface');
} else {
    const parity = read(parityPath);
    // The alias name a widget's assertion must carry: `clamp` + `native` →
    // `ClampNativeSatisfiesBase`. Derived rather than listed, so adding a widget cannot
    // be half-done.
    const pascal = (name) => name.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
    const expected = [];
    for (const widget of [...widgets].sort()) {
        for (const platform of PLATFORMS) expected.push(`${pascal(widget)}${pascal(platform.name)}SatisfiesBase`);
    }
    for (const alias of expected) {
        if (!new RegExp(`export type ${alias}\\b`).test(parity)) {
            fail('parity', `\`src/parity.spec.ts\` exports no \`${alias}\` — that half of that widget is unheld`);
        }
        if (!parity.includes(`'${alias}'`)) {
            fail(
                'parity',
                `\`PARITY_ASSERTIONS\` does not list \`${alias}\`, so the runtime completeness check misses it`,
            );
        }
    }
    // The other direction: a listed name with no alias behind it reads as coverage
    // that does not exist — the same shape as an `exports` entry naming a missing file.
    for (const match of parity.matchAll(/'(\w+SatisfiesBase)'/g)) {
        if (!expected.includes(match[1])) {
            fail('parity', `\`PARITY_ASSERTIONS\` lists \`${match[1]}\`, which no widget on disk corresponds to`);
        }
    }
}

// ─── Rule 8 — the namespace export mirrors the widgets, in both directions ──
// ADR 0034 clause 2. `Adw` is a second spelling of the same set, and a second spelling
// is a second list unless something holds it: the members are derived from the widgets
// on disk here, so adding a widget without adding its member fails, and a member with
// no widget behind it fails too. The second direction is the one that matters — a
// leftover member survives a widget's deletion and reads as coverage that is gone.
//
// Held on ALL THREE barrels, because each must build `Adw` from its OWN platform
// modules. A base-module member on the GTK barrel would hand `Adw.Bin` the component
// that refuses at first render, which is the exact failure rule 3 exists for, arriving
// through the one door rule 3 does not watch.
const namespaceMember = (widget) => widget.replace(/(^|[-_])(\w)/g, (_, __, c) => c.toUpperCase());
const namespaceCheck = (barrel, suffixOf) => {
    const path = join(PACKAGE_DIR, 'src', barrel);
    if (!existsSync(path)) return; // rule 6 already failed for this barrel
    const source = read(path);
    const declaration = /export const Adw = \{([^}]*)\}/.exec(source);
    if (!declaration) {
        fail('namespace', `\`src/${barrel}\` exports no \`Adw\` namespace — ADR 0034 clause 2 is unheld there`);
        return;
    }
    const members = new Set(
        declaration[1]
            .split(',')
            .map((part) => part.split(':')[0].trim())
            .filter((name) => name !== ''),
    );
    for (const widget of [...widgets].sort()) {
        const member = namespaceMember(widget);
        if (!members.has(member)) {
            fail(
                'namespace',
                `\`src/${barrel}\`'s \`Adw\` has no \`${member}\`, so that widget is namespace-only in name`,
            );
        }
        // The member must come from THIS barrel's platform module, not the base one.
        const specifier = `./widgets/${widget}${suffixOf}`;
        if (
            !new RegExp(`import \\{[^}]*\\bas ${member}\\b[^}]*\\} from '${specifier.replace(/[.]/g, '\\.')}'`).test(
                source,
            )
        ) {
            fail(
                'namespace',
                `\`src/${barrel}\`'s \`Adw.${member}\` is not bound from \`${specifier}\` — a namespace member ` +
                    'reaching a different platform half is the refusal rule 3 catches, through a door rule 3 does not watch',
            );
        }
        members.delete(member);
    }
    for (const orphan of [...members].sort()) {
        fail('namespace', `\`src/${barrel}\`'s \`Adw\` names \`${orphan}\`, which no widget on disk corresponds to`);
    }
};
namespaceCheck('index.ts', '.js');
for (const platform of PLATFORMS) namespaceCheck(platform.barrel, platform.buildSuffix);

// ─── Rule 10 — no barrel exports a widget class flat ────────────────────────
// ADR 0034 § Amendment 8. Rule 8 above holds what the namespace CONTAINS; nothing held
// what sits beside it, and the flat run this replaced was one `export … from` line per
// widget — the cheapest possible thing to put back, and the whole of what was removed.
//
// It is derived from the widgets on disk rather than matching `/^Adw[A-Z]/`, because the
// barrels legitimately export `AdwClampProps` and `AdwToastOverlayHandle` beside the
// namespace, and a rule that refused a shape instead of a NAME would be one prop type
// away from a false alarm. A false alarm is how a gate gets loosened.
/** `clamp` → `AdwClamp`: the identifier a widget module exports, and rule 10's subject. */
const widgetClassName = (widget) => `Adw${namespaceMember(widget)}`;
/** `export { A, B as C }` and `export type { … }` — a clause, and both halves of a name. */
const EXPORT_CLAUSE = /export\s*(?:type\s*)?\{([^}]*)\}/g;
const flatWidgetCheck = (barrel) => {
    const path = join(PACKAGE_DIR, 'src', barrel);
    if (!existsSync(path)) return; // rule 6 already failed for this barrel
    const classes = new Map([...widgets].map((widget) => [widgetClassName(widget), widget]));
    for (const [, names] of withoutComments(read(path)).matchAll(EXPORT_CLAUSE)) {
        for (const entry of names.split(',')) {
            const name = entry.trim().replace(/^type\s+/, '');
            if (name === '') continue;
            // BOTH halves, not only the exported one: `export { AdwClamp as Clamp }`
            // publishes no `AdwClamp` and is still the barrel re-exporting a widget class
            // beside the namespace — a bare `Clamp` at the root would be a THIRD spelling
            // rather than the removed one, which is not an improvement on two.
            const halves = name.split(/\s+as\s+/).map((half) => half.trim());
            const exported = halves.find((half) => classes.has(half)) ?? halves[halves.length - 1];
            const widget = classes.get(exported);
            if (widget !== undefined) {
                fail(
                    'flat',
                    `\`src/${barrel}\` exports \`${exported}\` flat, beside \`Adw.${namespaceMember(widget)}\`. ` +
                        'ADR 0034 § Amendment 8 removed that spelling from the package root: two names for one ' +
                        'widget is the second vocabulary clause 1 exists to remove, and the namespace is where ' +
                        `this one lives. The component keeps the identifier \`${exported}\` in ` +
                        `\`src/widgets/${widget}.ts\` and on the \`./widgets/${widget}\` subpath, which is a ` +
                        "different question — there it is the widget's only name.",
                );
            }
        }
    }
};
flatWidgetCheck('index.ts');
for (const platform of PLATFORMS) flatWidgetCheck(platform.barrel);

// ─── Vacuity ────────────────────────────────────────────────────────────────
if (widgets.size === 0) {
    console.error(
        `check-adwaita-rn-platform-split: found NO widgets under ${WIDGETS_DIR}.\n` +
            'Every rule below is then vacuously satisfied, which is what a broken reader looks\n' +
            'like from the outside. Fix the reader, not this message.',
    );
    process.exit(2);
}

if (problems.length > 0) {
    console.error(`check-adwaita-rn-platform-split: ${problems.length} problem(s) in @gjsify/adwaita-react-native.\n`);
    for (const problem of problems.sort()) console.error(`  ${problem}`);
    console.error(
        '\nThe package promises one API surface with two implementations. Each rule above is a\n' +
            'way for that promise to be false while everything still compiles — the header of\n' +
            'this file says which one, and what it costs.\n',
    );
    process.exit(1);
}

console.log(
    `check-adwaita-rn-platform-split: ${widgets.size} widget(s) — ` +
        `${[...widgets].sort().join(', ')} — each with a base module that refuses, a ` +
        `${PLATFORMS.map((p) => p.name).join(' and a ')} module, an \`exports\` entry naming both ` +
        'in an order that resolves to them, the JSX source its platform needs, no import ' +
        `from the other platform, and a member of \`Adw\` on each of the ${PLATFORMS.length + 1} barrels bound ` +
        "from that barrel's own module — and no flat widget class beside it on any of them.",
);
