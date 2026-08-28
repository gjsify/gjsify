#!/usr/bin/env node
// Every NativeScript application id belongs to gjsify, and every copy of it agrees.
//
// THE INCIDENT (two halves, one id)
//
// The three NativeScript projects shipped under `studio.artandcode.gjsify.*` — the
// reverse-DNS of a DIFFERENT organisation, which has nothing to do with this project.
// Every other application id in the tree is `org.gjsify.<PascalName>`
// (`org.gjsify.AdwaitaStorybook`, `org.gjsify.AdwaitaAppStorybook`,
// `org.gjsify.Devtools`, declared in `package.json#gjsify.storybook.appId`), so the
// NativeScript half was the only place the convention did not hold, and nothing said so.
//
// The second half is why the id is checked rather than merely renamed. An application
// id is not one string: `nativescript.config.ts` declares it and the code that DRIVES
// the app on a device repeats it (`adb`-driving `APP_ID` constants, the devtools agent's
// `appId`). A device probe built into the storybook showcase's own app directory took
// over `studio.artandcode.gjsify.adwaita.storybook` and was left installed under it, so
// the icon on the emulator launched a throwaway XML-inflation probe while calling itself
// the storybook — and the storybook was reported broken. A per-project id that only one
// file knows is what makes that class of confusion possible.
//
// WHAT IT CHECKS
//
//   1. every tracked `nativescript.config.ts` declares an `id` under `org.gjsify.`
//      that is a legal Android application id;
//   2. inside that project, every OTHER quoted application-id-shaped literal naming
//      gjsify equals the declared one.
//
//   node scripts/check-nativescript-app-ids.mjs
//
// IT READS THE GIT INDEX, NOT `git ls-files`. The first draft shelled out, and
// `windows-suites.yml` runs this on a leg that strips every `\Git\` entry from PATH on
// purpose — so the subprocess produced nothing, the scope came back EMPTY, and the run
// died on the refusal below rather than on an id. This repo had already settled that
// question once: `scripts/manifest-conformance/git-index.mjs` is the one reader of
// `.git/index`, and `check-build-infra-order.mjs` says so in its own header. Reusing it
// keeps this check running on every leg and drops a subprocess.

import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readIndexPaths } from './manifest-conformance/git-index.mjs';

/** The namespace every application id in this repo lives under. */
const NAMESPACE = 'org.gjsify.';

/** A legal Android application id: at least two dot-separated segments, each starting with a letter. */
const APPLICATION_ID = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

/** `id: 'x'` / `id: "x"` in a NativeScript config. */
const CONFIG_ID = /\bid\s*:\s*['"]([^'"]+)['"]/;

/**
 * A quoted literal SHAPED like an application id and naming this project. Scoped to
 * `gjsify` on purpose: an NS bridge quotes real Java/ObjC coordinates
 * (`java.io.File`, `androidx.core.view.ViewCompat`) that share the shape and are not ids.
 */
const APP_ID_LITERAL = /['"]([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*\.?gjsify[A-Za-z0-9_.]*)['"]/g;

/**
 * The iOS half of an application id, which is never QUOTED. `Info.plist`'s
 * `CFBundleIdentifier` and `build.xcconfig`'s `PRODUCT_BUNDLE_IDENTIFIER` are
 * NativeScript's two documented iOS override points, and both spell the value bare
 * (`<string>x</string>`, `KEY = x`), so the quoted scan cannot see either: measured by
 * putting a stale id in each file and watching the gate stay green. Without these the
 * check held the whole Android side of every project and none of the iOS side — the
 * same one-sided coverage `nativescript-platforms` exists to stop.
 *
 * Matched by KEY rather than by shape, so there is no new false-positive surface: the
 * rule fires only when the key is present AND names something other than the declared
 * id. An Xcode variable (`$(…)`, `${…}`) is a DELEGATION to that id, not a second
 * spelling of it, and is what both files carry today.
 */
const IOS_ID_KEYS = [
    { file: /\.plist$/, key: 'CFBundleIdentifier', re: /<key>CFBundleIdentifier<\/key>\s*<string>([^<]*)<\/string>/g },
    {
        file: /\.xcconfig$/,
        key: 'PRODUCT_BUNDLE_IDENTIFIER',
        re: /^[^\S\n]*PRODUCT_BUNDLE_IDENTIFIER[^\S\n]*=[^\S\n]*(.+?)[^\S\n]*;?[^\S\n]*$/gm,
    },
];

/** The line `index` falls on, 1-based. */
const lineAt = (src, index) => src.slice(0, index).split('\n').length;

/**
 * Every tracked path, read once. `readIndexPaths` yields forward-slashed, repo-relative
 * paths on every platform, so the matching below needs no path normalisation.
 */
const tracked = [...readIndexPaths(process.cwd())].filter((f) => !f.includes('node_modules/'));

const configs = tracked.filter((f) => f === 'nativescript.config.ts' || f.endsWith('/nativescript.config.ts'));
const problems = [];

// An empty scope is a FAILURE, not a pass: a check that found nothing to check has not
// held anything, and saying so at exit 0 is how a gate goes quiet without anyone noticing.
if (configs.length === 0) {
    process.stderr.write(
        `check-nativescript-app-ids: no nativescript.config.ts among ${tracked.length} tracked path(s) — ` +
            'this check cannot see the ids it exists to hold.\n',
    );
    process.exit(1);
}

for (const config of configs) {
    const declared = CONFIG_ID.exec(readFileSync(config, 'utf8'))?.[1];
    if (!declared) {
        problems.push({ file: config, text: 'no `id:` found in the NativeScript config' });
        continue;
    }
    if (!declared.startsWith(NAMESPACE) || !APPLICATION_ID.test(declared)) {
        problems.push({ file: config, text: `id "${declared}" is not a legal id under "${NAMESPACE}"` });
    }

    // Every other copy of the id inside the project must be the SAME string.
    //
    // `plist` and `xcconfig` are in the list because that is where the iOS half of an
    // application id lives: `App_Resources/iOS/build.xcconfig`'s
    // `PRODUCT_BUNDLE_IDENTIFIER` is NativeScript's documented override and `Info.plist`
    // carries `CFBundleIdentifier`. Without them the check read the whole Android side of
    // every project and none of the iOS side — measured by putting a stale id in each of
    // those two files and watching the gate stay green.
    const root = dirname(config);
    for (const file of tracked.filter((f) => f.startsWith(`${root}/`))) {
        if (!/\.(ts|tsx|mts|js|mjs|xml|json|md|gradle|plist|xcconfig)$/.test(file)) continue;
        let src;
        try {
            src = readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        src.split('\n').forEach((line, i) => {
            for (const m of line.matchAll(APP_ID_LITERAL)) {
                const found = m[1];
                // `@gjsify/*` package names carry a slash and never reach this regex;
                // a bare `gjsify` word is not id-shaped either.
                if (!found.includes('.') || found === declared) continue;
                problems.push({
                    file,
                    line: i + 1,
                    text: `"${found}" does not match the project id "${declared}" declared in ${config}`,
                });
            }
        });

        for (const { file: pattern, key, re } of IOS_ID_KEYS) {
            if (!pattern.test(file)) continue;
            re.lastIndex = 0;
            for (const m of src.matchAll(re)) {
                const found = m[1].trim().replace(/^["']|["']$/g, '');
                if (!found || found.includes('$(') || found.includes('${') || found === declared) continue;
                problems.push({
                    file,
                    line: lineAt(src, m.index ?? 0),
                    text: `${key} "${found}" does not match the project id "${declared}" declared in ${config}`,
                });
            }
        }
    }
}

if (problems.length === 0) {
    process.stdout.write(
        `check-nativescript-app-ids: ${configs.length} NativeScript project(s), every id under ${NAMESPACE} and consistent.\n`,
    );
    process.exit(0);
}

process.stderr.write(
    `check-nativescript-app-ids: ${problems.length} problem(s).\n` +
        `  An application id is what adb installs, launches and uninstalls, so a second spelling\n` +
        `  leaves a stale package on the device wearing another app's name. Fix the id — do not\n` +
        `  silence the check.\n\n`,
);
for (const p of problems) process.stderr.write(`  ${p.file}${p.line ? `:${p.line}` : ''}  ${p.text}\n`);
process.exit(1);
