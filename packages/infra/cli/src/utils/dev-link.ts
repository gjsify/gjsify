// `gjsify link` — a development OVERRIDE that points a consumer's `@gjsify/*`
// dependencies at a local gjsify checkout, without touching what the consumer
// COMMITS.
//
// THE NEED (ADR 0065). A consumer repo — Learn6502 is the measured one — pins
// `@gjsify/*` to registry versions (`^0.51.1`) and commits `gjsify-lock.json`.
// Developing a change that spans the platform and the app then means waiting for
// an npm release for every iteration, because the installer knows exactly two
// spec shapes: a registry range and `workspace:`. ADR 0060 § P6 recommended
// against `link:`/`portal:` "unless a specific unfixable need appears" — this is
// that need, and the answer it takes is deliberately NOT a resolution protocol.
//
// WHY AN OVERRIDE AND NOT A MANIFEST EDIT. A `link:` spec in `package.json` (or a
// rewritten lockfile) makes the development tree part of what CI, Flatpak and
// `--immutable` build. Those three must keep building exactly what is committed,
// so the override lives in a local, git-ignored file — `.gjsify-link.json` — that
// only the developer's own installs read.
//
// THE TRAP THIS EXISTS TO CLOSE. A bare `npm link` is undone by the next
// `npm install`: the link is replaced by the registry copy and nothing says so.
// Here the installer READS the override, excludes the linked names from its
// fetch/extract set and re-wires the links on every run — and says which ones, so
// a linked tree is never a silent build input.
//
// WHY THE INSTALLER MUST EXCLUDE THEM RATHER THAN RE-LINK AFTERWARDS. Measured:
// with `node_modules/@gjsify/<name>` a symlink OUT of `node_modules`,
// `assertNodeModulesDest` (install-backend-native.ts) refuses the extract and
// aborts the WHOLE install — correctly, since `rmSync` through that link would
// delete the checkout's own source. Re-linking after the fact is therefore not an
// option: there is no "after" to link in.
//
// WHY THE EXCLUSION IS NOT `workspaceNames`. That option is also handed to
// `resolveDeps`, which drops the whole subtree from the RESOLVE — and the resolve
// is what writes `gjsify-lock.json`. Reusing it would rewrite the consumer's
// committed lockfile the moment a link is active, which is the one thing this
// feature promises not to do. `linkedNames` therefore applies after the lockfile
// is written and only to what gets fetched.

import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import { discoverWorkspaces, filterWorkspaces, type Workspace } from '@gjsify/workspace';

import { linkDirSync } from './dir-link.js';
import { readPackageJson } from './pkg-json.js';
import { scanPrefix } from './prune-prefix.js';
import { findWorkspaceRoot } from './workspace-root.js';

/** The consumer-local override file. Git-ignored; never committed. */
export const DEV_LINK_FILE = '.gjsify-link.json';

/**
 * What `.gjsify-link.json` holds.
 *
 * A POINTER plus a selector, never a materialised list of package names: `link`
 * and `install` then derive the same set from the same two inputs, so a checkout
 * that gains or loses a workspace package cannot leave the two disagreeing about
 * what is linked.
 */
export interface DevLinkOverride {
    /** Format version — an unknown one is refused rather than guessed at. */
    version: 1;
    /** The gjsify checkout to link from. Absolute, as written by `gjsify link`. */
    checkout: string;
    /**
     * Name globs selecting which of its workspace packages take part. EMPTY means
     * every one of them — deliberately not `["*"]`, which would select NOTHING:
     * measured, `@gjsify/workspace`'s glob dialect maps `*` to `[^/]*`, so a bare
     * star never matches a SCOPED name. The spelling for a whole scope is
     * `@gjsify/*`, the same dialect `gjsify foreach --include` takes.
     */
    packages: string[];
}

/** One `node_modules/<name>` → checkout package directory link. */
export interface DevLink {
    name: string;
    /** Absolute path of the workspace package in the checkout. */
    target: string;
    /** Absolute path of the link inside the consumer's `node_modules`. */
    linkPath: string;
}

/** An override that has been read, validated and turned into a link plan. */
export interface ActiveDevLinks {
    /** Absolute path of the override file, for every message that names it. */
    overridePath: string;
    /** The consumer root the override belongs to. */
    consumerRoot: string;
    /** The validated checkout it points at. */
    checkout: string;
    links: DevLink[];
    /** Just the names — what the installer excludes from its fetch set. */
    names: Set<string>;
}

export function devLinkPath(root: string): string {
    return join(root, DEV_LINK_FILE);
}

/**
 * Read the override at `root`, or `null` when there is none.
 *
 * A file that exists but does not parse is an ERROR, not a `null`: this decides
 * where a build's inputs come from, and "unreadable" must never be answered with
 * the registry's copy while the developer believes their checkout is in play.
 */
export function readDevLinkOverride(root: string): DevLinkOverride | null {
    const path = devLinkPath(root);
    if (!existsSync(path)) return null;
    let raw: unknown;
    try {
        raw = JSON.parse(readFileSync(path, 'utf-8'));
    } catch (err) {
        throw new Error(
            `gjsify link: ${path} is not valid JSON (${err instanceof Error ? err.message : String(err)}). Fix it or run \`gjsify unlink\`.`,
        );
    }
    if (!raw || typeof raw !== 'object') {
        throw new Error(`gjsify link: ${path} must contain a JSON object.`);
    }
    const record = raw as Partial<DevLinkOverride>;
    if (record.version !== 1) {
        throw new Error(
            `gjsify link: ${path} declares version ${JSON.stringify(record.version)}; this CLI understands version 1 only.`,
        );
    }
    if (typeof record.checkout !== 'string' || record.checkout.trim() === '') {
        throw new Error(`gjsify link: ${path} has no "checkout" path.`);
    }
    return {
        version: 1,
        // Relative is tolerated on the READ side — a hand-edited file is a
        // legitimate way to move a link — and resolved against the consumer root,
        // which is the only directory the file's own location pins down.
        checkout: isAbsolute(record.checkout) ? record.checkout : resolve(root, record.checkout),
        packages: Array.isArray(record.packages)
            ? record.packages.filter((p): p is string => typeof p === 'string')
            : [],
    };
}

export function writeDevLinkOverride(root: string, override: DevLinkOverride): string {
    const path = devLinkPath(root);
    writeFileSync(path, JSON.stringify(override, null, 2) + '\n');
    return path;
}

/** Remove the override file; returns its path when one was there. */
export function removeDevLinkOverride(root: string): string | null {
    const path = devLinkPath(root);
    if (!existsSync(path)) return null;
    rmSync(path);
    return path;
}

/**
 * Which directory's override governs an install started in `startDir`.
 *
 * Same walk `projectInstallNative` does for the install itself: a member of a
 * workspace installs the workspace, so the override that applies is the
 * workspace root's — otherwise `gjsify install` inside a member would silently
 * ignore a link the root declares.
 */
export function devLinkRoot(startDir: string): string {
    if (existsSync(devLinkPath(startDir))) return startDir;
    const wsRoot = findWorkspaceRoot(startDir);
    if (wsRoot && existsSync(devLinkPath(wsRoot))) return wsRoot;
    return startDir;
}

/**
 * Turn `override.checkout` into the workspace list behind it, or refuse.
 *
 * A DEAD LINK IS AN ERROR WITH A PATH, never a quiet fall back to the registry:
 * the developer asked for their checkout, and installing the published copy
 * instead produces a build that looks like the one they wanted and is not. Both
 * refusals print the measured path, because "it points somewhere wrong" is only
 * actionable with the somewhere in it.
 */
export function resolveCheckoutWorkspaces(checkout: string, overridePath: string): Workspace[] {
    if (!existsSync(checkout)) {
        throw new Error(
            `gjsify link: the linked checkout ${checkout} does not exist (named by ${overridePath}). ` +
                `Point it at a gjsify checkout, or run \`gjsify unlink\`.`,
        );
    }
    const manifest = readPackageJson(join(checkout, 'package.json'));
    if (!manifest || manifest.workspaces === undefined) {
        throw new Error(
            `gjsify link: ${checkout} is not a gjsify workspace — ${join(checkout, 'package.json')} ` +
                `${manifest ? 'declares no "workspaces" field' : 'is missing or unreadable'} (named by ${overridePath}).`,
        );
    }
    let workspaces: Workspace[];
    try {
        workspaces = discoverWorkspaces(checkout);
    } catch (err) {
        throw new Error(
            `gjsify link: ${checkout} declares "workspaces" but they could not be discovered ` +
                `(${err instanceof Error ? err.message : String(err)}); named by ${overridePath}.`,
        );
    }
    if (workspaces.length === 0) {
        throw new Error(
            `gjsify link: ${checkout} declares "workspaces" but none were found (named by ${overridePath}).`,
        );
    }
    return workspaces;
}

/**
 * The dependency names the consumer would otherwise take from the registry.
 *
 * Two readers, one answer: what its manifests DECLARE (so a fresh clone can be
 * linked before it has ever installed) and what its `node_modules` already HOLDS
 * (so transitive `@gjsify/*` packages — the ones nobody declares and every build
 * loads — are covered too).
 */
export function consumerKnownNames(consumerRoot: string): Set<string> {
    const names = new Set<string>();
    const manifests = [readPackageJson(join(consumerRoot, 'package.json'))];
    try {
        for (const ws of discoverWorkspaces(consumerRoot)) manifests.push(ws.manifest as never);
    } catch {
        // Not a workspace, or an unreadable member — the root manifest and the
        // installed tree still answer the question.
    }
    for (const manifest of manifests) {
        if (!manifest) continue;
        for (const kind of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'] as const) {
            const block = (manifest as Record<string, unknown>)[kind];
            if (!block || typeof block !== 'object') continue;
            for (const name of Object.keys(block as Record<string, unknown>)) names.add(name);
        }
    }
    for (const pkg of scanPrefix(consumerRoot)) names.add(pkg.name);
    return names;
}

/**
 * The links an override asks for: the checkout's workspace packages, narrowed by
 * the name globs, INTERSECTED with what the consumer actually depends on.
 *
 * The intersection is the point. Linking every workspace package of a 200-member
 * monorepo into a consumer that uses eight would put 200 directories it never
 * declared into its tree, and leave `gjsify unlink` with no honest answer about
 * what to restore. Pure, so every selection rule is decidable without a
 * filesystem.
 */
export function planDevLinks(opts: {
    consumerRoot: string;
    workspaces: readonly Workspace[];
    patterns: readonly string[];
    knownNames: ReadonlySet<string>;
}): DevLink[] {
    // No pattern is NOT `['*']` — see {@link DevLinkOverride.packages}: a bare star
    // matches no scoped name, so spelling the default as one would select nothing.
    const selected =
        opts.patterns.length > 0
            ? filterWorkspaces(opts.workspaces, { include: [...opts.patterns] })
            : [...opts.workspaces];
    const links: DevLink[] = [];
    for (const ws of selected) {
        if (!ws.name) continue;
        if (!opts.knownNames.has(ws.name)) continue;
        links.push({
            name: ws.name,
            target: ws.location,
            linkPath: join(opts.consumerRoot, 'node_modules', ws.name),
        });
    }
    links.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return links;
}

/**
 * Read + validate the override at `consumerRoot` and plan its links, or `null`
 * when no override is there. Throws for every other shape — see
 * {@link resolveCheckoutWorkspaces}.
 */
export function prepareDevLinks(consumerRoot: string): ActiveDevLinks | null {
    const override = readDevLinkOverride(consumerRoot);
    if (!override) return null;
    const overridePath = devLinkPath(consumerRoot);
    const workspaces = resolveCheckoutWorkspaces(override.checkout, overridePath);
    const links = planDevLinks({
        consumerRoot,
        workspaces,
        patterns: override.packages,
        knownNames: consumerKnownNames(consumerRoot),
    });
    return {
        overridePath,
        consumerRoot,
        checkout: override.checkout,
        links,
        names: new Set(links.map((l) => l.name)),
    };
}

/**
 * (Re)create every planned link. Idempotent — a link already pointing at the
 * right target is left alone, so a re-run costs no unlink/relink race against a
 * process reading through it.
 *
 * Returns the links it actually wrote.
 */
export function applyDevLinks(links: readonly DevLink[]): DevLink[] {
    // FAIL CLOSED, over EVERY link and before the first write. Not only over the
    // ones this call would rewrite: the idempotent skip below is exactly how the
    // measured defect stayed invisible — the link was already correct, the checkout
    // had meanwhile lost its `dist/`, `gjsify install` re-ran, skipped the write,
    // printed "development link ACTIVE" and left a tree whose first import died
    // with MODULE_NOT_FOUND. `dist/`/`lib/` are git-ignored, so a branch switch in
    // the checkout produces this state as a matter of course.
    assertDevLinksBuilt(links);
    const written: DevLink[] = [];
    for (const link of links) {
        if (linkAlreadyPointsAt(link.linkPath, link.target)) continue;
        mkdirSync(dirname(link.linkPath), { recursive: true });
        // Whatever is there — the registry copy, a stale link, a leftover file.
        // `force` so a missing entry is not an error on the first link.
        rmSync(link.linkPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        linkDirSync(link.linkPath, link.target);
        written.push(link);
    }
    return written;
}

/**
 * Remove the links an override produced.
 *
 * ONLY a symlink whose target is inside the checkout is removed. A real
 * directory at that path is the registry copy — some other tool's, or an install
 * that ran with the override already gone — and deleting it would turn `unlink`
 * into a destructive command for a tree it did not create. Same asymmetry
 * `install-extraneous.ts` reasons from: a wrong deletion loses work, a wrong
 * refusal costs one message.
 */
export function removeDevLinks(links: readonly DevLink[]): DevLink[] {
    const removed: DevLink[] = [];
    for (const link of links) {
        let isLink = false;
        try {
            isLink = lstatSync(link.linkPath).isSymbolicLink();
        } catch {
            continue; // Not there at all.
        }
        if (!isLink) continue;
        if (!linkAlreadyPointsAt(link.linkPath, link.target)) continue;
        rmSync(link.linkPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        removed.push(link);
    }
    return removed;
}

/**
 * Does `linkPath` already resolve to `target`?
 *
 * Compares REAL paths, not the stored string: `dirLinkTarget` spells a POSIX
 * target relative to the link's own directory and a Windows junction absolutely,
 * so a string comparison would answer "different" on one platform and "same" on
 * the other for the identical link.
 */
function linkAlreadyPointsAt(linkPath: string, target: string): boolean {
    try {
        if (!lstatSync(linkPath).isSymbolicLink()) return false;
        return realpathSync(linkPath) === realpathSync(target);
    } catch {
        return false;
    }
}

/** A linked package that cannot be imported, and why not. */
export interface UnbuiltDevLink {
    link: DevLink;
    reason: string;
}

/**
 * Which of these links point at something that is not built.
 *
 * Candidates are the string entry points a manifest can carry — `main`, `module`
 * and the string leaves under `exports["."]`. ANY of them existing is enough: a
 * package legitimately declares entries it does not ship on every platform, and a
 * refusal that fires on a healthy tree is a refusal people learn to route around.
 * An entry-LESS manifest is fine, because nothing was promised that could be
 * missing.
 *
 * An UNREADABLE manifest is NOT fine, and that is a flip from the first draft,
 * which answered "built" for it. "I could not tell" is not "yes" in a check whose
 * whole job is to stop a silently unusable tree.
 */
export function unbuiltDevLinks(links: readonly DevLink[]): UnbuiltDevLink[] {
    const out: UnbuiltDevLink[] = [];
    for (const link of links) {
        let manifest: Record<string, unknown>;
        try {
            manifest = JSON.parse(readFileSync(join(link.target, 'package.json'), 'utf-8')) as Record<string, unknown>;
        } catch (err) {
            out.push({
                link,
                reason: `its package.json is missing or unreadable (${err instanceof Error ? err.message : String(err)})`,
            });
            continue;
        }
        const candidates: string[] = [];
        for (const key of ['main', 'module'] as const) {
            const value = manifest[key];
            if (typeof value === 'string') candidates.push(value);
        }
        const exportsField = manifest.exports;
        if (typeof exportsField === 'string') candidates.push(exportsField);
        else if (exportsField && typeof exportsField === 'object') {
            collectStringLeaves((exportsField as Record<string, unknown>)['.'], candidates);
        }
        if (candidates.length === 0) continue;
        if (candidates.some((rel) => existsSync(join(link.target, rel)))) continue;
        out.push({ link, reason: `none of its declared entry points exist yet (${candidates.join(', ')})` });
    }
    return out;
}

/** The refusal text for {@link unbuiltDevLinks}, naming every path and the build. */
export function formatUnbuiltDevLinks(unbuilt: readonly UnbuiltDevLink[]): string {
    const rows = unbuilt.map((u) => `  ${u.link.name}  ${u.link.target}\n      ${u.reason}`).join('\n');
    return (
        `gjsify link: ${unbuilt.length} linked package(s) are not built, so linking them would hand the ` +
        `consumer a tree whose first import fails with MODULE_NOT_FOUND:\n${rows}\n` +
        `  Build them in the checkout (\`gjsify run build\` there) and re-run, or narrow the selection with ` +
        `\`gjsify link <checkout> --packages <glob>\`. A link does not build.`
    );
}

/**
 * FAIL CLOSED on a link to something unbuilt.
 *
 * `dist/`/`lib/` are git-ignored in a gjsify checkout, so "the entry point is not
 * there right now" is the ordinary consequence of a branch switch, not an exotic
 * state. Measured: with the entry file deleted, `gjsify install` re-linked and
 * printed only "development link ACTIVE"; the consumer then died on
 * MODULE_NOT_FOUND with a message naming the consumer, not the checkout.
 */
export function assertDevLinksBuilt(links: readonly DevLink[]): void {
    const unbuilt = unbuiltDevLinks(links);
    if (unbuilt.length === 0) return;
    throw new Error(formatUnbuiltDevLinks(unbuilt));
}

function collectStringLeaves(value: unknown, out: string[]): void {
    if (typeof value === 'string') {
        out.push(value);
        return;
    }
    if (!value || typeof value !== 'object') return;
    for (const nested of Object.values(value as Record<string, unknown>)) collectStringLeaves(nested, out);
}

/**
 * Make `.gjsify-link.json` invisible to git WITHOUT editing a tracked file.
 *
 * `.git/info/exclude` is git's own per-clone ignore list: it is not committed and
 * not shared, which is exactly the lifetime of the thing it hides. Writing to
 * `.gitignore` instead would put a developer's local override into everyone
 * else's diff — the manifest edit this whole feature exists to avoid, one file
 * over.
 *
 * Returns what it did, so the caller can say so. A consumer that is not a git
 * repository is not an error: nothing can commit the file there either.
 */
export function ensureLocallyIgnored(consumerRoot: string): 'added' | 'already-ignored' | 'no-git' {
    const gitDir = resolveGitDir(consumerRoot);
    if (!gitDir) return 'no-git';
    const gitignore = join(consumerRoot, '.gitignore');
    if (existsSync(gitignore) && fileMentionsPattern(gitignore, DEV_LINK_FILE)) return 'already-ignored';
    const excludePath = join(gitDir, 'info', 'exclude');
    if (existsSync(excludePath) && fileMentionsPattern(excludePath, DEV_LINK_FILE)) return 'already-ignored';
    mkdirSync(dirname(excludePath), { recursive: true });
    const existing = existsSync(excludePath) ? readFileSync(excludePath, 'utf-8') : '';
    const prefix = existing === '' || existing.endsWith('\n') ? '' : '\n';
    writeFileSync(
        excludePath,
        `${existing}${prefix}# gjsify link — local development override, never commit\n${DEV_LINK_FILE}\n`,
    );
    return 'added';
}

/** A line naming exactly this pattern, ignoring comments and whitespace. */
function fileMentionsPattern(file: string, pattern: string): boolean {
    let text: string;
    try {
        text = readFileSync(file, 'utf-8');
    } catch {
        return false;
    }
    return text.split(/\r?\n/).some((line) => {
        const trimmed = line.trim();
        return trimmed === pattern || trimmed === `/${pattern}`;
    });
}

/**
 * The `.git` directory for `root` — following the `gitdir:` pointer file a
 * worktree or submodule has in place of a directory. Skipping that indirection
 * would write an `info/exclude` inside a plain file's parent and silently ignore
 * nothing at all.
 */
function resolveGitDir(root: string): string | null {
    const dotGit = join(root, '.git');
    let stat;
    try {
        stat = statSync(dotGit);
    } catch {
        return null;
    }
    if (stat.isDirectory()) return dotGit;
    try {
        const pointer = readFileSync(dotGit, 'utf-8').trim();
        const match = /^gitdir:\s*(.+)$/.exec(pointer);
        if (!match?.[1]) return null;
        const target = match[1].trim();
        return isAbsolute(target) ? target : resolve(root, target);
    } catch {
        return null;
    }
}

/**
 * `--immutable` must never accept an active override — FAIL CLOSED.
 *
 * CI, a Flatpak build and a release all run `--immutable`, and all three exist to
 * build exactly what is committed. An override is a developer's local tree, so
 * consuming one here would produce an artifact whose inputs are not in any
 * commit and whose build reported nothing unusual. Refusing names the file,
 * because the fix is to delete it and the message is the only place its path
 * appears.
 */
export function assertNoDevLinkUnderImmutable(startDir: string): void {
    const root = devLinkRoot(startDir);
    const path = devLinkPath(root);
    if (!existsSync(path)) return;
    let checkout = '(unreadable)';
    try {
        checkout = readDevLinkOverride(root)?.checkout ?? checkout;
    } catch {
        // A malformed override still blocks: the question `--immutable` asks is
        // "is a development tree in play", and an unparseable answer is not a no.
    }
    throw new Error(
        `gjsify install --immutable: a development link override is active — ${path}\n` +
            `It points at ${checkout}, so this install would build from a local checkout instead of ` +
            `what ${join(root, 'gjsify-lock.json')} pins. --immutable builds only what is committed.\n` +
            `Run \`gjsify unlink\` (in ${root}) or delete ${DEV_LINK_FILE}, then re-run.`,
    );
}
