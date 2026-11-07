// Staging darwin's nested bundles and helper executables into the payload
// (ADR 0024 amendment, "nested bundles and helper executables"; the beifahrer
// ADR this answers: 0026 § 6).
//
// A consumer whose Xcode-built shell was discarded in favour of ADR 0026's "one
// app" decision still has ONE bundle `gjsify ship darwin` cannot carry on its
// own: a Safari Web Extension `.appex`, which macOS registers only when it
// sits under the PARENT app's `Contents/PlugIns/`. This module is the staging
// half of that gap — copy the built `.appex` (or any other nested bundle) and
// any prebuilt helper executable into the layout's own slots for them
// (`Layout.dirs().plugins` / `.helpers`), tree-preserving for the former and
// flat for the latter, because a bundle is a DIRECTORY and a helper is a FILE.
//
// SIGNING is a separate concern, in `signing.ts`: this module only decides
// WHERE the bytes land, never how they are signed. `stagedSubordinates` hands
// back the stage-relative paths `commands/ship.ts` passes to `signPayload` as
// `nestedBundles`/`helperExecutables`, so the two modules cannot drift on what
// a "nested bundle" or a "helper executable" even IS.

import { join, posix } from 'node:path';

import { listFilesRecursive } from './discover.js';
import { stagedMode } from './app-runtime.js';
import type { Layout, LayoutIdentity } from './layout.js';
import type { PayloadEntry } from './payload.js';
import type { RecordedNestedBundle } from './release-record.js';
import type { SignedSubordinate } from './signing.js';
import type {
    ShipHelperExecutable,
    ShipHelperExecutableFacts,
    ShipNestedBundle,
    ShipNestedBundleFacts,
    StagedFile,
} from './types.js';

/** The staged files, and what `signPayload` needs to sign them with their OWN entitlements. */
export interface StagedSubordinates {
    files: StagedFile[];
    nestedBundles: SignedSubordinate[];
    helperExecutables: SignedSubordinate[];
}

/**
 * Stage every `gjsify.ship.nestedBundles` entry and `gjsify.ship.helperExecutables`
 * entry into the layout's `plugins`/`helpers` slots.
 *
 * `[]` for both inputs is the common case and produces `{ files: [], ... }` —
 * cheap enough that `commands/ship.ts` can call this unconditionally rather than
 * branching on whether a project declares either key.
 */
export function stageSubordinates(input: {
    layout: Layout;
    identity: LayoutIdentity;
    nestedBundles: readonly ShipNestedBundle[];
    helperExecutables: readonly ShipHelperExecutable[];
}): StagedSubordinates {
    const dirs = input.layout.dirs(input.identity);
    const files: StagedFile[] = [];
    const nestedBundles: SignedSubordinate[] = [];
    const helperExecutables: SignedSubordinate[] = [];

    for (const bundle of input.nestedBundles) {
        if (dirs.plugins === '') {
            throw new Error(
                `gjsify ship: the ${input.layout.name} layout has no \`Contents/PlugIns\` equivalent, so ` +
                    `the nested bundle "${bundle.name}" has nowhere to go. ` +
                    '`gjsify.ship.nestedBundles` is darwin-only; `resolveShipNestedBundles` should have ' +
                    'resolved this to `[]` already — report this as a gjsify bug if it did not.',
            );
        }
        const bundleRoot = posix.join(dirs.plugins, bundle.name);
        for (const rel of listFilesRecursive(bundle.source)) {
            const abs = join(bundle.source, ...rel.split(posix.sep));
            files.push({
                path: posix.join(bundleRoot, rel),
                // A bundle's own executable is executable whatever the source's mode
                // says: NTFS carries no POSIX bits, so `stagedMode` reads 0o644 there
                // and a darwin stage assembled on win32 would ship a dead `.appex`.
                mode: /^Contents\/MacOS\/[^/]+$/.test(rel) ? 0o755 : stagedMode(rel, abs),
                source: { kind: 'file', path: abs },
            });
        }
        nestedBundles.push({ path: bundleRoot, entitlements: bundle.entitlements });
    }

    for (const helper of input.helperExecutables) {
        if (dirs.helpers === '') {
            throw new Error(
                `gjsify ship: the ${input.layout.name} layout has no \`Contents/Helpers\` equivalent, so ` +
                    `the helper executable "${helper.name}" has nowhere to go. ` +
                    '`gjsify.ship.helperExecutables` is darwin-only; `resolveShipHelperExecutables` should have ' +
                    'resolved this to `[]` already — report this as a gjsify bug if it did not.',
            );
        }
        const path = posix.join(dirs.helpers, helper.name);
        files.push({ path, mode: 0o755, source: { kind: 'file', path: helper.source } });
        helperExecutables.push({ path, entitlements: helper.entitlements });
    }

    return { files, nestedBundles, helperExecutables };
}

/**
 * What `signPayload` needs to sign the subordinates `stageSubordinates` staged —
 * DERIVED from the layout and the facts alone, never carried as a separate
 * closure.
 *
 * This is what lets `PackSettings` carry only `{ name, entitlements }` (see
 * `types.ts`): the stage-relative PATH is `layout.dirs(settings).plugins` (or
 * `.helpers`) joined with the name, which both the assembling host (which also
 * has the absolute `source`) and a `--from-stage` finishing host (which has
 * neither) can compute from data they already hold. Calling this twice — once
 * in `assemble()`, once in `packOne` — can therefore never disagree with where
 * {@link stageSubordinates} put the bytes.
 */
export function signedSubordinatesFor(
    layout: Layout,
    identity: LayoutIdentity,
    facts: {
        nestedBundles: readonly ShipNestedBundleFacts[];
        helperExecutables: readonly ShipHelperExecutableFacts[];
    },
): { nestedBundles: SignedSubordinate[]; helperExecutables: SignedSubordinate[] } {
    const dirs = layout.dirs(identity);
    return {
        nestedBundles: facts.nestedBundles.map((bundle) => ({
            path: posix.join(dirs.plugins, bundle.name),
            entitlements: bundle.entitlements,
        })),
        helperExecutables: facts.helperExecutables.map((helper) => ({
            path: posix.join(dirs.helpers, helper.name),
            entitlements: helper.entitlements,
        })),
    };
}

/**
 * One `<key>NAME</key>` entry's string value, read with a REGEX rather than a
 * plist parser — the same tradeoff this tree already makes in `plist.ts`
 * (renders XML by string template, never parses it): a release record is
 * additive metadata, not a signature the pack path depends on, so a plist this
 * reader cannot follow degrades to an absent field rather than a build failure.
 */
function plistStringValue(xml: string, key: string): string | undefined {
    const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(xml);
    return match?.[1];
}

/**
 * The `Info.plist` of one nested bundle, read back off the PACKED payload —
 * after `signPayload` has run, so this sees exactly the bytes the artifact
 * ships, never the assembling host's copy.
 */
function nestedBundlePlist(payload: readonly PayloadEntry[], bundlePath: string): string | undefined {
    const entry = payload.find((file) => file.path === posix.join(bundlePath, 'Contents', 'Info.plist'));
    return entry === undefined ? undefined : new TextDecoder().decode(entry.data);
}

/**
 * What the release record says about each nested bundle, read off its OWN
 * `Info.plist` rather than off `gjsify.ship.nestedBundles` — the declaration
 * names a `source` directory and an entitlements list, neither of which is the
 * bundle identifier or its extension point, and both of THOSE only exist inside
 * the `.appex` the project built.
 *
 * `extensionPoint` comes from `NSExtension.NSExtensionPointIdentifier`, Apple's
 * own nesting for every extension point (`com.apple.Safari.web-extension` is
 * one value among several, not a special case this reader has to know). A
 * nested bundle that is not an extension at all — or whose `Info.plist` this
 * reader cannot find or parse — simply omits the key, which is the same
 * additive contract the field's own doc states (`release-record.ts`).
 */
export function recordedNestedBundles(
    payload: readonly PayloadEntry[],
    nestedBundles: readonly SignedSubordinate[],
): RecordedNestedBundle[] {
    return nestedBundles.map((bundle) => {
        const name = posix.basename(bundle.path);
        const xml = nestedBundlePlist(payload, bundle.path);
        if (xml === undefined) return { name };
        const bundleId = plistStringValue(xml, 'CFBundleIdentifier');
        const extensionPoint = plistStringValue(xml, 'NSExtensionPointIdentifier');
        return {
            name,
            ...(bundleId === undefined ? {} : { bundleId }),
            ...(extensionPoint === undefined ? {} : { extensionPoint }),
        };
    });
}
