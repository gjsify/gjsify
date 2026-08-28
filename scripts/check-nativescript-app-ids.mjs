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

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname } from 'node:path';

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

const tracked = (glob) =>
    execSync(`git ls-files -- ${glob}`, { maxBuffer: 1 << 28 })
        .toString()
        .split('\n')
        .filter((f) => f && !f.includes('node_modules/'));

const configs = tracked("'**/nativescript.config.ts'");
const problems = [];

if (configs.length === 0) {
    process.stderr.write(
        'check-nativescript-app-ids: no nativescript.config.ts found — this check cannot see the ids it exists to hold.\n',
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
    const root = dirname(config);
    for (const file of tracked(`'${root}/**'`)) {
        if (!/\.(ts|tsx|mts|js|mjs|xml|json|md|gradle)$/.test(file)) continue;
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
