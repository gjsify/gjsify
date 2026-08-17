// Remove what an install prefix holds that THIS host cannot use.
//
// An install prefix is a write-only union today: `applyPlatformFilter` keeps a
// foreign-platform package from being installed, and nothing ever removes one that
// an EARLIER install placed. Measured on a workstation whose user-global prefix was
// created in May and whose CLI was current: 638 MB, of which `@rolldown` alone was
// 258 MB across sixteen platform bindings on a host that can load exactly one.
//
// The residue is ACCRETION, not a live filter defect, and the on-disk versions are
// what prove it: the foreign `@rolldown/binding-*` dirs were a minor version behind
// the `rolldown` that pins all of them, and every foreign `@gjsify/*-<os>-<arch>`
// was at the release that first SHIPPED the filter. They were written by the
// previous CLI, during the self-update that installed the fix. A filter cannot
// remove what predates it, which is why this exists as its own pass.
//
// ## What this is allowed to decide
//
// One rule, and it is a pure manifest read: npm's own `os`/`cpu`/`libc` fields,
// through the SAME `checkPlatform` the installer filters with — so a pruned prefix
// converges on what a fresh install would have placed, rather than on this module's
// opinion. A package that declares nothing is never touched: `@rolldown/binding-
// wasm32-wasi` is unusable here and says so nowhere, and guessing from its name is
// how a prune starts deleting things it cannot justify.
//
// Reachability ("nothing installed points at this any more") would catch that one
// and more, but it needs a record of what the prefix was ASSEMBLED FROM, which no
// prefix carries yet. Uncertain means keep — see ADR 0025 and
// `status/open-todos.md`.

import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import {
    type PlatformDeclaration,
    type PlatformTarget,
    type PlatformVerdict,
    checkPlatform,
    declaresPlatform,
    describePlatformTarget,
    readPlatformOverrides,
} from './platform-check.js';

/** One package directory found under a prefix's `node_modules` tree. */
export interface InstalledPackage {
    /** `name` from its manifest, or the directory path when the manifest is unreadable. */
    name: string;
    version: string;
    /** Absolute path to the package directory. */
    dir: string;
    /**
     * A symlink, i.e. a workspace source tree linked into `node_modules` rather than
     * a copy the installer extracted. Never pruned and never descended: the installer
     * refuses to remove one for the same reason, and following it would walk the
     * user's own sources.
     */
    linked: boolean;
    /** The `os`/`cpu`/`libc` slice, absent when the manifest declares none. */
    platform?: PlatformDeclaration;
}

export interface PruneEntry {
    pkg: InstalledPackage;
    /** Apparent size of the package directory, summed from `statSync().size`. */
    bytes: number;
    verdict: PlatformVerdict;
}

export interface PrunePlan {
    prefix: string;
    target: PlatformTarget;
    /** How many package directories were examined, so an empty plan is distinguishable from an empty scan. */
    scanned: number;
    entries: PruneEntry[];
    bytes: number;
}

export interface PruneResult {
    plan: PrunePlan;
    removed: PruneEntry[];
    failed: Array<{ entry: PruneEntry; error: string }>;
    bytes: number;
    /** `.bin` entries removed because they were symlinks with no target left. */
    binLinks: string[];
}

/** Directory entries under `node_modules` that are never packages. */
function isReservedEntry(name: string): boolean {
    // `.bin` holds launchers, `.gjsify-install-lock` is the LIVE cross-process lock
    // directory — removing it mid-install would hand the prefix to a second writer.
    return name.startsWith('.');
}

function readManifest(dir: string): { name?: string; version?: string; platform?: PlatformDeclaration } | null {
    try {
        const raw = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
        const platform: PlatformDeclaration = {
            os: raw.os as PlatformDeclaration['os'],
            cpu: raw.cpu as PlatformDeclaration['cpu'],
            libc: raw.libc as PlatformDeclaration['libc'],
        };
        return {
            name: typeof raw.name === 'string' ? raw.name : undefined,
            version: typeof raw.version === 'string' ? raw.version : undefined,
            platform: declaresPlatform(platform) ? platform : undefined,
        };
    } catch {
        // An unreadable or half-written manifest declares nothing, which makes the
        // package un-prunable by the only rule this module has. That is the safe
        // direction: the one thing worse than 638 MB of residue is deleting a
        // package because its manifest could not be parsed.
        return null;
    }
}

function collect(nodeModules: string, out: InstalledPackage[]): void {
    let entries;
    try {
        entries = readdirSync(nodeModules, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        if (isReservedEntry(entry.name)) continue;
        const full = join(nodeModules, entry.name);
        if (entry.name.startsWith('@')) {
            let scoped;
            try {
                scoped = readdirSync(full, { withFileTypes: true });
            } catch {
                continue;
            }
            for (const inner of scoped) {
                if (isReservedEntry(inner.name)) continue;
                addPackage(join(full, inner.name), out);
            }
            continue;
        }
        addPackage(full, out);
    }
}

function addPackage(dir: string, out: InstalledPackage[]): void {
    let linked = false;
    try {
        linked = lstatSync(dir).isSymbolicLink();
    } catch {
        return;
    }
    const manifest = readManifest(dir);
    out.push({
        name: manifest?.name ?? dir,
        version: manifest?.version ?? '0.0.0',
        dir,
        linked,
        platform: manifest?.platform,
    });
    // A linked package is the user's own source tree — its `node_modules` is not
    // this prefix's to prune.
    if (!linked) collect(join(dir, 'node_modules'), out);
}

/** Every package directory under `<prefix>/node_modules`, at any depth. */
export function scanPrefix(prefix: string): InstalledPackage[] {
    const out: InstalledPackage[] = [];
    collect(join(prefix, 'node_modules'), out);
    return out;
}

/**
 * The packages `target` cannot use. Pure — no filesystem, no `process.*` — so every
 * OS/arch/libc branch is decidable from any host.
 */
export function planPlatformPrune(pkgs: readonly InstalledPackage[], target: PlatformTarget): PruneEntry[] {
    const entries: PruneEntry[] = [];
    for (const pkg of pkgs) {
        if (pkg.linked || !pkg.platform) continue;
        const verdict = checkPlatform(pkg.platform, target);
        if (!verdict.ok) entries.push({ pkg, bytes: 0, verdict });
    }
    return entries;
}

/** Apparent size of a directory tree — what the files claim, not what the block device spent. */
export function dirBytes(dir: string): number {
    let total = 0;
    const stack = [dir];
    while (stack.length > 0) {
        const current = stack.pop() as string;
        let entries;
        try {
            entries = readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const entry of entries) {
            const full = join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (entry.isFile()) {
                try {
                    total += statSync(full).size;
                } catch {
                    // A file that vanished mid-walk contributes nothing; a size is a
                    // report, and refusing to produce one over a race would be worse.
                }
            }
        }
    }
    return total;
}

export function planPrune(opts: { prefix: string; target: PlatformTarget }): PrunePlan {
    const pkgs = scanPrefix(opts.prefix);
    const entries = planPlatformPrune(pkgs, opts.target);
    for (const entry of entries) entry.bytes = dirBytes(entry.pkg.dir);
    return {
        prefix: opts.prefix,
        target: opts.target,
        scanned: pkgs.length,
        entries,
        bytes: entries.reduce((sum, e) => sum + e.bytes, 0),
    };
}

/**
 * Remove a plan's entries.
 *
 * `remove` is injected so the failure path is testable without a filesystem that
 * can fail on demand. Nothing here throws: this runs as housekeeping at the end of
 * an install, and an install that already succeeded must not be reported as failed
 * because a directory could not be unlinked.
 */
export function executePrune(
    plan: PrunePlan,
    opts: { dryRun?: boolean; remove?: (dir: string) => void } = {},
): PruneResult {
    const removed: PruneEntry[] = [];
    const failed: PruneResult['failed'] = [];
    const binLinks: string[] = [];
    // `maxRetries` mirrors the installer's own removal: on Windows a handle held by
    // a virus scanner or an indexer makes the first unlink fail and the third work.
    const remove = opts.remove ?? ((dir: string) => rmSync(dir, { recursive: true, force: true, maxRetries: 10 }));

    if (!opts.dryRun) {
        for (const entry of plan.entries) {
            try {
                remove(entry.pkg.dir);
                removed.push(entry);
            } catch (err) {
                failed.push({ entry, error: (err as Error).message });
            }
        }
        binLinks.push(...pruneDeadBinLinks(plan.prefix));
    }

    return {
        plan,
        removed,
        failed,
        bytes: removed.reduce((sum, e) => sum + e.bytes, 0),
        binLinks,
    };
}

/**
 * Drop `.bin` entries that are SYMLINKS whose target is gone.
 *
 * Only symlinks, and only dangling ones: that is the case where deadness is
 * provable from the filesystem alone. A `.bin` entry that is a real file may be a
 * launcher script this prefix still needs, and deciding that would mean reading it —
 * a second, weaker rule for a few hundred bytes.
 */
function pruneDeadBinLinks(prefix: string): string[] {
    const binDir = join(prefix, 'node_modules', '.bin');
    const dropped: string[] = [];
    let entries;
    try {
        entries = readdirSync(binDir, { withFileTypes: true });
    } catch {
        return dropped;
    }
    for (const entry of entries) {
        const full = join(binDir, entry.name);
        try {
            if (!lstatSync(full).isSymbolicLink()) continue;
            if (existsSync(full)) continue;
            unlinkSync(full);
            dropped.push(entry.name);
        } catch {
            // Same reasoning as `executePrune`: housekeeping never fails the caller.
        }
    }
    return dropped;
}

function humanBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(1)} ${units[unit]}`;
}

/** How many entries a non-verbose report lists before summarising the rest. */
const REPORT_HEAD = 10;

export function formatPruneReport(result: PruneResult, opts: { dryRun: boolean; verbose: boolean }): string {
    const { plan } = result;
    const lines: string[] = [
        `${plan.prefix} · target ${describePlatformTarget(plan.target)} · scanned ${plan.scanned} package(s)`,
    ];

    if (plan.entries.length === 0) {
        // Not "every package declares a platform this host can use": most declare
        // none at all, and saying otherwise reports a check that did not happen.
        lines.push('nothing to prune — no installed package declares a platform this target cannot use.');
        return lines.join('\n');
    }

    const shown = opts.verbose ? plan.entries : plan.entries.slice(0, REPORT_HEAD);
    for (const entry of shown) {
        const required = JSON.stringify(entry.verdict.required);
        lines.push(`  ${entry.pkg.name}@${entry.pkg.version}  ${humanBytes(entry.bytes)}  requires ${required}`);
    }
    if (shown.length < plan.entries.length) {
        lines.push(`  … and ${plan.entries.length - shown.length} more (--verbose to list them)`);
    }

    // The byte figure is APPARENT size, summed from the files themselves. `du`
    // reports allocated blocks and will disagree; saying so here is cheaper than
    // the bug report that difference otherwise produces.
    lines.push(
        opts.dryRun
            ? `would free ${humanBytes(plan.bytes)} across ${plan.entries.length} package(s) (apparent size)`
            : `freed ${humanBytes(result.bytes)} across ${result.removed.length} package(s) (apparent size)`,
    );
    if (result.binLinks.length > 0) {
        lines.push(`removed ${result.binLinks.length} dangling .bin link(s): ${result.binLinks.join(', ')}`);
    }
    for (const f of result.failed) {
        lines.push(`FAILED ${f.entry.pkg.name}: ${f.error}`);
    }
    return lines.join('\n');
}

/** Why an automatic pass declined to run, or null when it may proceed. */
export function automaticPruneRefusal(env: Record<string, string | undefined>, immutable: boolean): string | null {
    // THE data-loss guard. `--os/--cpu/--libc` are legal on `gjsify install -g`, and
    // they reach here as npm config keys. Pruning against a target the USER TYPED
    // would make `gjsify install -g foo --os=darwin` delete every linux package in
    // the real shared prefix — the engine set, the bundler bindings, the CLI's own.
    // An explicit `gjsify prune --os=darwin` stays legal; it is a request, not a
    // side effect.
    if (Object.keys(readPlatformOverrides(env)).length > 0) {
        return 'the platform target was overridden on the command line';
    }
    // `--immutable` promises the tree is not modified. Resolution-only would be a
    // defensible reading, but it is not the one the flag's users have, and
    // `ensureProjectGjsEngine` already declines under it for the same reason.
    if (immutable) return '--immutable';
    return null;
}

/**
 * The automatic pass: prune what this install would not have placed, report one
 * line, and never fail the install that called it.
 */
export function pruneAfterInstall(
    prefix: string,
    target: PlatformTarget,
    opts: { env?: Record<string, string | undefined>; immutable?: boolean; hint?: string } = {},
): void {
    try {
        const refusal = automaticPruneRefusal(opts.env ?? process.env, opts.immutable ?? false);
        if (refusal) return;
        const plan = planPrune({ prefix, target });
        if (plan.entries.length === 0) return;
        const result = executePrune(plan);
        if (result.removed.length === 0) return;
        const hint = opts.hint ? ` (${opts.hint} to review)` : '';
        console.log(
            `gjsify: pruned ${result.removed.length} package(s) this host cannot use, ` +
                `freeing ${humanBytes(result.bytes)}${hint}`,
        );
    } catch (err) {
        if (process.env.GJSIFY_DEBUG) console.error(`gjsify: prune skipped — ${(err as Error).message}`);
    }
}
