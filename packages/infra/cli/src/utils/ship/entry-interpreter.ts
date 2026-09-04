// Can the interpreter this target execs load the entry this target ships?
//
// THE DEFECT (#1545, measured on a React-Native-on-GTK application at 0.47.0).
// `gjsify ship` chose the runtime and the payload independently and never
// compared them. `gjsify.ship.app.darwin: "node"` made the `.app`'s launcher
// `exec node`, while the payload came from the project's `main`, which for a
// project whose primary target is Linux is its `--app gjs` bundle. The run
// printed one line on the subject and it read as CONFIRMATION —
// "runtime for darwin: node — `gjsify.ship.app.darwin` overrides `gjsify.app`" —
// then produced an artifact that dies before a line of application code:
//
//     Error [ERR_UNSUPPORTED_ESM_URL_SCHEME]: Only URLs with a scheme in: file,
//     data, and node are supported by the default ESM loader. Received protocol 'gi:'
//
// So the artifact is built, reported as built, and cannot start. That is the
// class this repository pays most for: a step that reports success while having
// measured nothing.
//
// THE DISCRIMINATOR IS THE SPECIFIER THE OTHER HOST'S LOADER REFUSES, and it is
// exact in both directions — measured on this machine, GJS 1.86 / Node 24:
//
//     node   ← `import … from 'gi://Gtk?version=4.0'`
//              ERR_UNSUPPORTED_ESM_URL_SCHEME … Received protocol 'gi:'
//     node   ← `import system from 'system'`
//              ERR_MODULE_NOT_FOUND — a GJS built-in is not a package
//     gjs    ← `import … from 'node:fs'`
//              ImportError: Unsupported URI scheme for importing: node
//
// None is a heuristic about how the bundle was built: it is the specifier the
// running loader rejects, read out of the file that will be installed. And none
// can appear in a bundle the OTHER target built for itself — `--app node`
// rewrites every `gi://` into `requireGi()` and every bare GJS built-in into an
// `@gjsify/node-gi` shim (`gjs-gi-node.ts`), `--app gjs` resolves every `node:`
// builtin to its `@gjsify/*` implementation — so the evidence is present exactly
// when the pair is wrong.
//
// THE BARE BUILT-INS ARE NOT DECORATION. A GJS bundle that reaches GI through the
// legacy `imports.gi` object carries no `gi://` at all, and a `--app gjs` build of
// one imports `system` and nothing else this reader would have seen — so #1545's
// own pair (a GJS payload under a node launcher) passed the guard written for it
// until they were added. What is deliberately NOT read is the ambient `imports`
// object itself: node fails on it at the first USE, not at load, so a refusal
// citing it would be making a claim this file cannot keep.
//
// WHY A REFUSAL AND NOT A WARNING. There is no reading of this artifact under
// which it works. A warning at the end of a `ship` run competes with the
// artifact path printed beside it, and the artifact is what gets uploaded.

import { importedSpecifier, walkModuleAst } from '../cli-runtime-closure.js';
import type { HostOs } from './types.js';

/** What a shipped artifact's `bin/<name>` can exec. */
export type ShipInterpreter = 'gjs' | 'node';

/**
 * The GJS built-in modules, which are bare specifiers rather than a scheme.
 *
 * `cairo` is deliberately absent: it is also an ordinary npm package name, so a
 * node bundle can legitimately import it and refusing that would fail a working
 * artifact. `system` and `gettext` have no npm counterpart a real project
 * imports, which is what makes them evidence rather than a guess.
 */
const GJS_BUILTINS = new Set(['system', 'gettext']);

/** The specifiers in an entry that only ONE of the two hosts can resolve. */
export interface EntryEvidence {
    /** `gi://…` and the bare GJS built-ins — resolvable under GJS, refused by node. */
    gi: string[];
    /** `node:…` specifiers — resolvable under Node, refused by GJS's loader. */
    node: string[];
}

/** Host-only specifiers of `source`, deduplicated and sorted. */
export function entryEvidence(source: string): EntryEvidence {
    const gi = new Set<string>();
    const node = new Set<string>();
    walkModuleAst(source, (astNode) => {
        const specifier = importedSpecifier(astNode);
        if (specifier === null) return;
        if (specifier.startsWith('gi://') || GJS_BUILTINS.has(specifier)) gi.add(specifier);
        else if (specifier.startsWith('node:')) node.add(specifier);
    });
    return { gi: [...gi].sort(), node: [...node].sort() };
}

/** Everything the refusal names, so it can point at the key that decides each half. */
export interface EntryCheckInput {
    /** The resolved interpreter of THIS target. */
    interpreter: ShipInterpreter;
    /** The entry's source, as it will be installed. */
    source: string;
    /** How the entry is spelled in the project, for the message. */
    entry: string;
    /** The config key the interpreter came from — `gjsify.app` or `gjsify.ship.app.<os>`. */
    appKey: string;
    /** The config key the entry came from — `gjsify.main`, `gjsify.ship.bundle[.<os>]`, … */
    bundleKey: string;
    /**
     * The layout being assembled, which is the key a per-target fix goes under.
     *
     * {@link HostOs} and not `string`: an OS spelling this command does not
     * assemble for is the silent defect the two resolvers refuse by name, and a
     * message that offers `gjsify.ship.bundle.<whatever-was-passed>` as the fix
     * would be the one place that hands the reader the typo back.
     */
    layoutOs: HostOs;
}

/**
 * Refuse a payload the target's own interpreter cannot load.
 *
 * ASYMMETRIC LIKE `assertLauncherMatchesInterpreter`, and for the same reason:
 * evidence FOR the wrong host is a refusal, absence of evidence is not. A bundle
 * that imports neither scheme — a pure-JS CLI, a bundle whose GI reach is all
 * dynamic — passes, because nothing here observed a contradiction. This function
 * reports what it read, never what it failed to read.
 */
export function assertEntryRunsUnder(input: EntryCheckInput): void {
    const evidence = entryEvidence(input.source);
    const refused = input.interpreter === 'node' ? evidence.gi : evidence.node;
    if (refused.length === 0) return;

    const other: ShipInterpreter = input.interpreter === 'node' ? 'gjs' : 'node';
    // The error the reader will actually see, which differs WITHIN the node case:
    // a `gi:` specifier is refused as an unknown URL scheme, a bare GJS built-in
    // as a package that does not exist. Naming the wrong one sends them looking
    // for the wrong thing in a log they have not opened yet.
    const loader =
        input.interpreter === 'gjs'
            ? 'GJS\'s loader refuses it: ImportError, "Unsupported URI scheme for importing: node"'
            : refused.some((specifier) => specifier.startsWith('gi://'))
              ? 'node\'s ESM loader refuses it: ERR_UNSUPPORTED_ESM_URL_SCHEME, "Only URLs with a scheme in: ' +
                'file, data, and node are supported by the default ESM loader"'
              : "node's ESM loader refuses it: ERR_MODULE_NOT_FOUND — a GJS built-in is not a package";
    const shown = refused.slice(0, 3).join(', ');
    const more = refused.length > 3 ? `, and ${refused.length - 3} more` : '';

    throw new Error(
        `gjsify ship: this target execs \`${input.interpreter}\` (\`${input.appKey}\`), and the entry it ` +
            `would ship — ${input.entry} (\`${input.bundleKey}\`) — imports ${shown}${more}.\n` +
            `    ${loader}, before a line of application code runs.\n` +
            '    The artifact would be built, reported as built, and fail at launch on every machine.\n' +
            `    Either ship this target the \`--app ${input.interpreter}\` build of the app — ` +
            `\`gjsify.ship.bundle.${input.layoutOs}\` selects the entry per target, the way ` +
            `\`gjsify.ship.app.${input.layoutOs}\` selects the runtime —\n` +
            `    or set \`gjsify.ship.app.${input.layoutOs}\` to "${other}" if this bundle is the one ` +
            'that should ship.',
    );
}
