// Resolver-layer guard: an unresolvable `@gjsify/*` edge is a build ERROR,
// never a silent external.
//
// ## The failure this closes
//
// Rolldown (like Rollup) treats an import nothing resolves as EXTERNAL: it
// emits an `UNRESOLVED_IMPORT` **warning**, re-emits the ORIGINAL specifier
// into the output, and exits 0. For a normal bundler that is a reasonable
// default — the specifier might be provided by the host. For `gjsify build` it
// is not, because the `@gjsify/*` edge that failed is precisely the SUBSTITUTION
// that makes the bundle runnable on the target:
//
//     import { readFileSync } from 'node:fs'
//        → aliasPlugin rewrites to `@gjsify/fs`
//        → `@gjsify/fs` cannot be resolved (no `node_modules`, or the workspace
//          package has no built `lib/` so its `exports["."]` points at a file
//          that does not exist)
//        → aliasPlugin falls through, nothing else claims it
//        → `node:fs` is externalised, the build "succeeds"
//
// Measured on `packages/infra/cli/dist/cli.gjs.mjs` (repo task #63): 1 bare
// `node:` import on `origin/main` vs 11 from a worktree with no `node_modules`
// — a bundle stock GJS aborts on before one line runs
// (`ImportError: Unsupported URI scheme for importing: node`). The pre-commit
// hook then rebuilt and AUTO-STAGED it, and nothing local objected: tsc, lint,
// format, unit and e2e all run the Node entry, never the emitted GJS bundle.
//
// ## Why this is upstream of the `--app gjs` `node:` guard (PR #828)
//
// `utils/gjs-bundle-guard.ts` reads the finished module graph and refuses to
// EMIT a `--app gjs` bundle that still statically imports a bare `node:`
// specifier. That is the right last line of defence, and it stays. But it is:
//
//   - **gjs-only** — the same silent externalisation happens on `--app node`
//     and `--app browser`, where a surviving bare `@gjsify/foo` is equally
//     unloadable and no `node:`-shaped symptom exists to detect;
//   - **symptom-shaped** — it names `node:fs`, not the `@gjsify/fs` edge that
//     actually failed, and cannot name the importer;
//   - **post-tree-shake** — an unresolved edge that gets shaken out leaves no
//     trace at all, so the artefact passes while the build is still wrong.
//
// This guard fires at RESOLUTION time instead: it names the specifier, the
// substitution target, the importer, and the likely cause.
//
// ## The legitimate-vs-broken line
//
// A blanket "fail on any external" would break every real build — externals are
// load-bearing on every target (`gi://*`, `cairo`/`system`/`gettext` on gjs; the
// whole `EXTERNALS_NODE` set plus `@gjsify/node-gi*` and `node-datachannel` on
// node; whatever the user passed to `--external`). Those never reach the
// unresolved fallback by accident — a `resolveId` hook or the `external` option
// CLAIMS them, deliberately. So the distinction drawn here is:
//
//   DECLARED external  → legitimate, ignored. Asked via the target's own
//                        externals predicate (`isExternal`), i.e. exactly the
//                        policy `externalsPlugin` enforces, so the guard and the
//                        policy cannot drift.
//   PROMISED, missing  → broken. Either (a) the specifier has an entry in the
//                        target's substitution table and that target does not
//                        resolve, or (b) the specifier IS a bare `@gjsify/*`
//                        workspace package that does not resolve.
//   anything else      → not our business. A missing `lodash` is a plain
//                        dependency bug that `UNRESOLVED_IMPORT` already
//                        reports; widening to every bare specifier would turn a
//                        genuinely optional peer into a hard build failure, and
//                        this guard's whole claim is that the `@gjsify/*` edge
//                        is NOT optional — the target cannot run without it.
//
// On (a): the check is keyed on the ALIAS TARGET being a `@gjsify/*` package,
// not merely on the entry existing. Every value in the curated + derived tables
// is a `@gjsify/*` specifier today, so this is a distinction without a
// difference for them — but it keeps a user `--alias foo=./some/local.js` (or a
// shim path like `random-access-file/index.js`) on the old fall-through
// behaviour instead of promoting a user's own mapping mistake to a fatal error
// in a plugin they did not ask for.
//
// ## Not registered for `--library`
//
// Library mode PRESERVES imports on purpose (`preserveModules`, bare specifiers
// kept so the consumer resolves them). An unresolved `@gjsify/*` there is the
// contract, not a bug, so `library/lib.ts` deliberately does not compose this
// plugin.

import { dirname } from 'node:path';
import type { Plugin } from 'rolldown';

/** Bare `@gjsify/*` package specifier — the workspace edge this guard protects. */
const WORKSPACE_SCOPE = '@gjsify/';

/**
 * How many reverse-looked-up source specifiers the error may name before the
 * list stops being evidence and becomes noise. A per-builtin target inverts to
 * 2 (`fs` + `node:fs`); a shared sink like `@gjsify/empty` inverts to ~50.
 */
const MAX_REPORTED_ALIAS_SOURCES = 4;

/** Build targets that compose this guard. Used only for the error message. */
export type WorkspaceImportGuardTarget = 'gjs' | 'node' | 'browser' | 'nativescript';

export interface WorkspaceImportGuardOptions {
    /** `--app <target>` this build is for; named verbatim in the error. */
    target: WorkspaceImportGuardTarget;
    /**
     * The substitution table this target promised (specifier → target), already
     * merged across tiers exactly as `aliasPlugin` received it. A miss here is
     * fine — case (b) still covers a direct `@gjsify/*` import.
     */
    aliases?: Record<string, string>;
    /**
     * The target's own externals policy. Anything it claims is a DELIBERATE
     * external and is ignored. Pass the same predicate `externalsPlugin` gets
     * (plus exact-name membership) so the two cannot drift.
     */
    isExternal?: (id: string) => boolean;
}

/**
 * Is `id` a bare `@gjsify/*` package specifier (root or subpath)?
 *
 * Deliberately excludes disk paths and synthetic ids: a resolved
 * `/…/node_modules/@gjsify/fs/lib/esm/index.js` is already resolved, and a
 * `\0gjsify-*` virtual id belongs to the plugin that emitted it.
 */
export function isWorkspaceSpecifier(id: string): boolean {
    if (!id.startsWith(WORKSPACE_SCOPE)) return false;
    if (id.includes('\0')) return false;
    // `@gjsify/fs` and `@gjsify/fs/register/x` qualify; `@gjsify/` and
    // `@gjsify//x` do not (no package name). A resolved disk path can never
    // reach here — it is absolute or `./`-relative, so it never starts with the
    // scope in the first place.
    const rest = id.slice(WORKSPACE_SCOPE.length);
    return rest.length > 0 && !rest.startsWith('/');
}

/** What the guard decided about one specifier. */
export type ImportVerdict =
    | { verdict: 'ignore'; reason: 'entry' | 'not-bare' | 'declared-external' | 'out-of-scope' }
    | { verdict: 'check'; candidate: string; aliasTarget?: string };

export interface ClassifyImportInput {
    source: string;
    importer: string | undefined;
    aliases?: Record<string, string>;
    isExternal?: (id: string) => boolean;
}

/**
 * Pure decision: does this import edge have to resolve, and to what?
 *
 * Split out from the plugin so the legitimate-vs-broken line is unit-testable
 * without a bundler (`packages/infra/cli/src/unresolved-workspace-import.spec.ts`).
 */
export function classifyImport(input: ClassifyImportInput): ImportVerdict {
    const { source, importer, aliases, isExternal } = input;
    // Entry modules are files the caller named; they are resolved by the
    // orchestrator, never externalised.
    if (importer === undefined) return { verdict: 'ignore', reason: 'entry' };
    // Relative / absolute / synthetic ids are not workspace edges.
    if (source.startsWith('.') || source.startsWith('/') || source.startsWith('\0')) {
        return { verdict: 'ignore', reason: 'not-bare' };
    }
    // A specifier the target DECLARES external is a deliberate external.
    if (isExternal?.(source)) return { verdict: 'ignore', reason: 'declared-external' };

    const aliasTarget = aliases?.[source];
    const candidate = aliasTarget ?? source;
    // The alias target may itself be declared external (`system` →
    // `@gjsify/node-gi/system` on the node target).
    if (candidate !== source && isExternal?.(candidate)) {
        return { verdict: 'ignore', reason: 'declared-external' };
    }
    if (!isWorkspaceSpecifier(candidate)) return { verdict: 'ignore', reason: 'out-of-scope' };
    return aliasTarget === undefined ? { verdict: 'check', candidate } : { verdict: 'check', candidate, aliasTarget };
}

export interface UnresolvedWorkspaceImportDetails {
    target: WorkspaceImportGuardTarget;
    /** The specifier as written in the importing module. */
    source: string;
    /** What actually had to resolve (the alias target, or `source` itself). */
    candidate: string;
    /** Set when `source` was rewritten by the substitution table. */
    aliasTarget?: string;
    /**
     * Specifiers whose substitution-table entry names `candidate`, discovered by
     * REVERSE lookup — the half of the story `source` alone cannot tell.
     *
     * `aliasPlugin` resolves its target through `this.resolve(target, importer)`,
     * so when `node:fs` → `@gjsify/fs` fails, the id that reaches THIS hook is
     * `@gjsify/fs` with no alias entry of its own: the message would name the
     * missing package but not the `node:fs` the user actually wrote, which is
     * the specifier that survives into the bundle and the one they will grep
     * for. Reversing the table recovers it (`['fs', 'node:fs']` — both forms
     * route to the same target, and naming both is accurate).
     */
    aliasedFrom?: readonly string[];
    importer: string;
}

/** A `@gjsify/*` edge the build promised to substitute could not be resolved. */
export class UnresolvedWorkspaceImportError extends Error {
    readonly details: UnresolvedWorkspaceImportDetails;
    constructor(details: UnresolvedWorkspaceImportDetails) {
        super(formatUnresolvedWorkspaceImport(details));
        this.name = 'UnresolvedWorkspaceImportError';
        this.details = details;
    }
}

/**
 * The actionable message. Names the specifier, the importer and the likely
 * cause — the three things `UNRESOLVED_IMPORT` (and the post-hoc `node:` guard)
 * cannot tell you.
 */
export function formatUnresolvedWorkspaceImport(details: UnresolvedWorkspaceImportDetails): string {
    const { target, source, candidate, aliasTarget, aliasedFrom, importer } = details;
    // The specifiers `candidate` was standing in for: `source` itself when IT
    // carried the table entry, else whatever the reverse lookup recovered.
    //
    // The reverse lookup is only reported when its fan-in is SMALL. A shared
    // sink inverts to a useless wall of text — `@gjsify/empty` is the browser
    // target for 49 specifiers, and printing all of them says nothing about
    // which one this importer wrote, while `@gjsify/fs` inverts to exactly
    // `['fs','node:fs']` (the two spellings of one builtin), which is the
    // information the reader needs. Above the threshold, fall back to naming
    // the package alone rather than guessing.
    const reversed = aliasedFrom ?? [];
    const substitutedFor =
        aliasTarget === undefined ? (reversed.length <= MAX_REPORTED_ALIAS_SOURCES ? reversed : []) : [source];
    const quoted = substitutedFor.map((s) => `\`${s}\``).join(', ');
    const headline =
        substitutedFor.length === 0
            ? `gjsify build --app ${target}: cannot resolve the workspace package \`${candidate}\`.`
            : `gjsify build --app ${target}: cannot resolve \`${candidate}\`, the \`--app ${target}\` ` +
              `substitution for ${quoted}.`;
    // The symptom is a property of the SPECIFIER that would survive, not of the
    // target: only a `node:` specifier reaching stock GJS produces the URI-scheme
    // abort; a bare `@gjsify/*` or `<pkg>/register` one produces `Module not
    // found` (GJS's ESM loader has no node_modules walker and does not follow
    // `exports` maps). Naming the wrong one sends the reader hunting the wrong bug.
    const surviving = substitutedFor.length === 0 ? [source] : substitutedFor;
    const symptom =
        target !== 'gjs'
            ? ''
            : surviving.some((s) => s.startsWith('node:'))
              ? ' Stock GJS aborts the whole module graph at load: ' +
                '"ImportError: Unsupported URI scheme for importing: node".'
              : ' Stock GJS would fail at load with "Module not found" — its ESM loader has no node_modules ' +
                'walker and does not follow `package.json#exports` for bare specifiers.';
    const consequence =
        (substitutedFor.length === 0
            ? `Leaving it unresolved would silently externalise \`${source}\` into the bundle, which the ` +
              `\`--app ${target}\` runtime cannot resolve.`
            : `Leaving it unresolved would silently externalise the ORIGINAL ${
                  substitutedFor.length === 1 ? 'specifier' : 'specifiers'
              } ${quoted} into the ` +
              `bundle, defeating the substitution the \`--app ${target}\` target exists to perform.`) + symptom;
    return [
        headline,
        `  imported by: ${importer}`,
        '',
        consequence,
        '',
        'Likely causes:',
        '  - `node_modules` is missing or incomplete — run `gjsify install` (`--immutable` in CI).',
        `  - the workspace package is not built: its \`exports["."]\` names a \`lib/\` that does not exist —`,
        '    run `gjsify run build:infra`, or `gjsify workspace <pkg> build` for the one package.',
        `  - \`${candidate}\` is genuinely not a dependency of this project — add it.`,
    ].join('\n');
}

/**
 * Reverse the substitution table: alias TARGET → the specifiers that route to it.
 *
 * Built once per plugin instance (the tables run to ~150 entries per target, and
 * the guard only consults this on the failure path).
 */
export function buildReverseAliasIndex(aliases: Record<string, string> | undefined): Map<string, string[]> {
    const index = new Map<string, string[]>();
    if (!aliases) return index;
    for (const [from, to] of Object.entries(aliases)) {
        const existing = index.get(to);
        if (existing) existing.push(from);
        else index.set(to, [from]);
    }
    for (const list of index.values()) list.sort();
    return index;
}

/**
 * Refuse a build whose `@gjsify/*` substitution could not be resolved.
 *
 * `order: 'post'` so every deliberate claim — `aliasPlugin` (`pre`),
 * `napiNodeAddonPlugin` (`pre`), `gjsGiNodePlugin` (`pre`),
 * `gjsImportsEmptyPlugin`, `externalsPlugin` — gets first refusal. Only ids that
 * NOTHING claimed reach this hook, i.e. exactly the ones headed for the
 * unresolved-import fallback.
 *
 * The hook re-runs the full resolution chain via `this.resolve(…, { skipSelf })`
 * — which is what Rolldown's builtin resolver would have done next — and returns
 * its result when it succeeds, so a healthy build resolves the specifier exactly
 * once and behaves identically. Only a genuine `null` throws.
 */
export function unresolvedWorkspaceImportPlugin(options: WorkspaceImportGuardOptions): Plugin {
    const { target, aliases, isExternal } = options;
    // Re-entrancy belt: `skipSelf: true` is supposed to keep our own
    // `this.resolve` from re-entering this hook, but a hang is a far worse
    // failure than a missed check, so the in-flight candidate is tracked
    // explicitly. Keyed by `candidate\0importer` — the same package legitimately
    // resolves from many importers.
    const inFlight = new Set<string>();
    // Alias TARGET → the specifiers that route to it. Only read on the failure
    // path, to recover the `node:fs` behind a failed `@gjsify/fs`.
    const reverseAliases = buildReverseAliasIndex(aliases);
    // Successful resolutions, memoized per (candidate, importer DIRECTORY) —
    // the pair node resolution actually depends on, so a hit is the answer the
    // chain would have recomputed. Without it this hook was the single most
    // expensive plugin in a CLI-bundle build (32% of plugin time): `@gjsify/*`
    // edges repeat across hundreds of modules, and each miss re-runs the whole
    // `pre`-order chain (alias, napi-addon, gi-node) for the same target. Same
    // shape + rationale as `napiNodeAddonPlugin`'s `bareEntryCache` (#840).
    // Only POSITIVE results are cached: a failure throws, so it is never hot,
    // and caching it could outlive a package appearing mid-watch.
    const resolvedCache = new Map<string, { id: string }>();
    return {
        name: 'gjsify-unresolved-workspace-import',
        resolveId: {
            order: 'post' as const,
            async handler(source, rawImporter, extraOptions) {
                // The two engines disagree on "no importer": npm `rolldown`
                // passes `undefined`, `@gjsify/rolldown-native` passes `null`
                // (its hook payload round-trips through JSON, which has no
                // `undefined`). `classifyImport` reads an absent importer as
                // "this is an ENTRY, never externalised" via `=== undefined`,
                // and `null` fails that test — so under the GJS bundler an
                // entry module would have been resolved as a normal edge and
                // could throw this plugin's error for a file the caller named
                // explicitly. Normalise once, at the boundary — same fix as
                // `napiNodeAddonPlugin` (#840), whose `dirname(null)` threw
                // and took the whole GJS build down as an UNHANDLEABLE_ERROR.
                const importer = typeof rawImporter === 'string' ? rawImporter : undefined;
                if (extraOptions?.isEntry) return null;
                const verdict = classifyImport({ source, importer, aliases, isExternal });
                if (verdict.verdict === 'ignore') return null;
                // `kind` participates in the key: it selects the `import`
                // vs `require` export condition, so the same specifier can
                // legitimately resolve to different files from one directory.
                const key = `${verdict.candidate}\0${importer === undefined ? '' : dirname(importer)}\0${
                    extraOptions?.kind ?? ''
                }`;
                const cached = resolvedCache.get(key);
                if (cached) return cached;
                if (inFlight.has(key)) return null;
                inFlight.add(key);
                let resolved: { id: string } | null;
                try {
                    resolved = await this.resolve(verdict.candidate, importer, {
                        skipSelf: true,
                        kind: extraOptions?.kind,
                    });
                } finally {
                    inFlight.delete(key);
                }
                if (resolved) {
                    resolvedCache.set(key, resolved);
                    return resolved;
                }
                throw new UnresolvedWorkspaceImportError({
                    target,
                    source,
                    candidate: verdict.candidate,
                    aliasTarget: verdict.aliasTarget,
                    aliasedFrom: reverseAliases.get(verdict.candidate)?.filter((s) => s !== source),
                    importer: importer ?? '<entry>',
                });
            },
        },
    };
}
