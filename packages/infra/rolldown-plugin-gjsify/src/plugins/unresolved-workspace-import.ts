// Resolver-layer guard: an unresolvable `@gjsify/*` edge is a build ERROR, never a
// silent external. Full rationale, the measured incident and the legitimate-vs-broken
// line: ../../AGENTS.md § "Unresolvable `@gjsify/*` edge".
//
// Why this sits UPSTREAM of `utils/gjs-bundle-guard.ts` (which refuses to EMIT a
// `--app gjs` bundle still importing a bare `node:` specifier, and stays as the last
// line of defence). That guard is:
//   - gjs-only — the same silent externalisation happens on `--app node`/`browser`,
//     where a surviving bare `@gjsify/foo` is equally unloadable and no
//     `node:`-shaped symptom exists to detect;
//   - symptom-shaped — it names `node:fs`, not the `@gjsify/fs` edge that failed,
//     and cannot name the importer;
//   - post-tree-shake — an unresolved edge that gets shaken out leaves no trace, so
//     the artefact passes while the build is still wrong.
//
// Case (a) of the fatal line keys on the ALIAS TARGET being a `@gjsify/*` package,
// not merely on the entry existing. Every value in the curated + derived tables is
// `@gjsify/*` today, so it makes no difference for them — but it keeps a user
// `--alias foo=./some/local.js` (or a shim path like `random-access-file/index.js`)
// on the old fall-through instead of promoting a user's own mapping mistake to a
// fatal error in a plugin they did not ask for.

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
 * Is `id` a bare `@gjsify/*` package specifier (root or subpath)? Excludes disk
 * paths and synthetic ids: a resolved `…/node_modules/@gjsify/fs/…` is already
 * resolved, and a `\0gjsify-*` virtual id belongs to the plugin that emitted it.
 */
export function isWorkspaceSpecifier(id: string): boolean {
    if (!id.startsWith(WORKSPACE_SCOPE)) return false;
    if (id.includes('\0')) return false;
    // `@gjsify/fs/register/x` qualifies; `@gjsify/` and `@gjsify//x` do not.
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
 * Pure decision: does this import edge have to resolve, and to what? Split out from
 * the plugin so the legitimate-vs-broken line is unit-testable without a bundler
 * (`packages/infra/cli/src/unresolved-workspace-import.spec.ts`).
 */
export function classifyImport(input: ClassifyImportInput): ImportVerdict {
    const { source, importer, aliases, isExternal } = input;
    // Entry modules are files the caller named — resolved by the orchestrator, never
    // externalised.
    if (importer === undefined) return { verdict: 'ignore', reason: 'entry' };
    if (source.startsWith('.') || source.startsWith('/') || source.startsWith('\0')) {
        return { verdict: 'ignore', reason: 'not-bare' };
    }
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
     * Specifiers whose substitution-table entry names `candidate`, by REVERSE lookup.
     * `aliasPlugin` resolves its target through `this.resolve(target, importer)`, so
     * when `node:fs` → `@gjsify/fs` fails the id reaching this hook is `@gjsify/fs`
     * with no alias entry of its own — the message would name the missing package but
     * not the `node:fs` the user wrote, which is what survives into the bundle and
     * what they will grep for.
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
 * The actionable message: names the specifier, the importer and the likely cause —
 * the three things `UNRESOLVED_IMPORT` and the post-hoc `node:` guard cannot.
 */
export function formatUnresolvedWorkspaceImport(details: UnresolvedWorkspaceImportDetails): string {
    const { target, source, candidate, aliasTarget, aliasedFrom, importer } = details;
    // The specifiers `candidate` stood in for: `source` when IT carried the table
    // entry, else the reverse lookup — but only when its fan-in is SMALL. A shared
    // sink inverts to a wall of text (`@gjsify/empty` is the browser target for 49
    // specifiers) that says nothing about which one this importer wrote, while
    // `@gjsify/fs` inverts to exactly the two spellings of one builtin. Above the
    // threshold, name the package alone rather than guess.
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
    // target: only a `node:` specifier reaching stock GJS gives the URI-scheme abort,
    // while a bare `@gjsify/*` gives `Module not found`. Naming the wrong one sends
    // the reader hunting the wrong bug.
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

/** Reverse the substitution table: alias TARGET → the specifiers that route to it. */
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
 * `order: 'post'` so every deliberate claim (alias/napi/gi-node at `pre`,
 * imports-empty/externals at normal) gets first refusal — only ids NOTHING claimed
 * reach this hook. It then re-runs the resolution Rolldown would have run next
 * (`this.resolve(…, { skipSelf })`) and returns that, so a healthy build resolves
 * each specifier exactly once and behaves identically. Only a genuine `null` throws.
 */
export function unresolvedWorkspaceImportPlugin(options: WorkspaceImportGuardOptions): Plugin {
    const { target, aliases, isExternal } = options;
    // Re-entrancy belt: `skipSelf: true` should keep our own `this.resolve` out of
    // this hook, but a hang is a far worse failure than a missed check. Keyed by
    // `candidate\0importer` — the same package legitimately resolves from many.
    const inFlight = new Set<string>();
    // Read only on the failure path, to recover the `node:fs` behind a failed
    // `@gjsify/fs`.
    const reverseAliases = buildReverseAliasIndex(aliases);
    // Successful resolutions memoized per (candidate, importer DIRECTORY) — the pair
    // node resolution actually depends on, so a hit is the answer the chain would have
    // recomputed. Without it this hook was the most expensive plugin in a CLI-bundle
    // build (32% of plugin time): `@gjsify/*` edges repeat across hundreds of modules
    // and each miss re-runs the whole `pre`-order chain. POSITIVE results only — a
    // failure throws, so it is never hot, and caching it could outlive a package
    // appearing mid-watch.
    const resolvedCache = new Map<string, { id: string }>();
    return {
        name: 'gjsify-unresolved-workspace-import',
        resolveId: {
            order: 'post' as const,
            async handler(source, rawImporter, extraOptions) {
                // The two engines disagree on "no importer": npm `rolldown` passes
                // `undefined`, `@gjsify/rolldown-native` passes `null` (its hook
                // payload round-trips through JSON, which has no `undefined`).
                // `classifyImport` reads an absent importer as "ENTRY, never
                // externalised" via `=== undefined`, which `null` fails — so under
                // the GJS bundler an entry module got treated as a normal edge and
                // could throw this plugin's error for a file the caller named.
                // Normalise once, at the boundary (same fix as `napiNodeAddonPlugin`).
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
