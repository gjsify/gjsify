// Unit tests for TRANSITIVE OPTIONALITY and what it means for the platform
// verdict — `requiredDepEntries` + `computeOptionalFlags` + `applyPlatformFilter`
// from install-backend-native.ts, plus `optionalDependencyNames` (the same rule at
// the root edge) from commands/install.ts.
//
// THE DEFECT THESE PIN: `@parcel/rust@2.16.4` declares all eight of its
// per-platform napi packages in BOTH `dependencies` and `optionalDependencies`.
// npm treats a name in both blocks as OPTIONAL ("entries in optionalDependencies
// will override entries of the same name in dependencies") — measured: `npm
// install` of a project whose only dependency is `@parcel/rust@2.16.4` exits 0,
// installs `@parcel/rust-linux-x64-gnu`, and writes `"optional": true` for all
// eight in its package-lock. `gjsify install` walked `dependencies` only, so
// `@parcel/rust-darwin-x64` came out REQUIRED and every Linux install of any tree
// containing parcel died with EBADPLATFORM.
//
// INJECTED GRAPHS, NO REGISTRY. The two functions decide fatal-vs-inert in
// composition, and the composition is what a fix can get half right: making the
// optional case inert while quietly demoting the REQUIRED case is a silent
// missing binary, which is the worse defect. So every row below states both
// halves, and the `--force` asymmetry is asserted in both directions.
import { describe, it, expect } from '@gjsify/unit';

import {
    applyPlatformFilter,
    computeOptionalFlags,
    requiredDepEntries,
    type ResolvedNode,
} from './install-backend-native.js';
import { optionalDependencyNames } from '../commands/install.js';
import type { PlatformDeclaration, PlatformTarget } from './platform-check.js';

/** This host for the tests below — fixed, never probed (platform-check.ts's rule). */
const LINUX_X64: PlatformTarget = { os: 'linux', cpu: 'x64', libc: 'glibc' };

const DARWIN: PlatformDeclaration = { os: ['darwin'], cpu: ['x64'] };
const LINUX: PlatformDeclaration = { os: ['linux'], cpu: ['x64'] };

/**
 * Collecting logger — the skip is only ever reported through the debug log, so
 * the placeholders are substituted the way `makeLogger` does it.
 */
function capture() {
    const lines: string[] = [];
    const log = (fmt: string, ...args: unknown[]) => {
        const rest = [...args];
        lines.push(fmt.replace(/%s|%d/g, () => String(rest.shift())));
    };
    return { log, lines };
}

interface NodeSpec {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    platform?: PlatformDeclaration;
    /** Non-root placement, for the nested-copy row. */
    installPath?: string;
}

/** A hoisted node at `node_modules/<name>`, or wherever `installPath` says. */
function node(name: string, spec: NodeSpec = {}): ResolvedNode {
    return {
        name,
        version: '1.0.0',
        tarballUrl: `https://registry.example/${name}.tgz`,
        installPath: spec.installPath ?? `node_modules/${name}`,
        dependencies: spec.dependencies ?? {},
        optionalDependencies: spec.optionalDependencies ?? {},
        platform: spec.platform,
    };
}

/** The `@parcel/rust` shape: platform siblings in BOTH blocks. */
function parcelTree(): ResolvedNode[] {
    const platformDeps = {
        '@parcel/rust-darwin-x64': '2.16.4',
        '@parcel/rust-linux-x64-gnu': '2.16.4',
    };
    return [
        node('@parcel/rust', { dependencies: platformDeps, optionalDependencies: platformDeps }),
        node('@parcel/rust-darwin-x64', { platform: DARWIN }),
        node('@parcel/rust-linux-x64-gnu', { platform: LINUX }),
    ];
}

/** Flags, then filter — the production order (see installPackagesNativeLocked). */
function classify(nodes: ResolvedNode[], requiredTopLevel: string[], force = false) {
    const cap = capture();
    computeOptionalFlags(nodes, new Set(requiredTopLevel), cap.log);
    const installable = applyPlatformFilter(nodes, LINUX_X64, force, cap.log);
    return {
        installable: installable.map((n) => n.name),
        optional: nodes.filter((n) => n.optional).map((n) => n.name),
        inert: nodes.filter((n) => n.inert).map((n) => n.name),
    };
}

/** Same, but keeps the log lines — only the rows that assert on them use it. */
function classifyLogged(nodes: ResolvedNode[], requiredTopLevel: string[]) {
    const cap = capture();
    computeOptionalFlags(nodes, new Set(requiredTopLevel), cap.log);
    applyPlatformFilter(nodes, LINUX_X64, false, cap.log);
    return cap.lines;
}

export default async () => {
    await describe('requiredDepEntries', async () => {
        await it('drops the names optionalDependencies overrides', () => {
            const both = { sibling: '1.0.0' };
            expect(
                requiredDepEntries({ dependencies: { ...both, real: '^2' }, optionalDependencies: both }),
            ).toStrictEqual([['real', '^2']]);
        });

        await it('keeps a plain dependency and ignores an optional-only name', () => {
            expect(
                requiredDepEntries({ dependencies: { real: '^2' }, optionalDependencies: { extra: '^3' } }),
            ).toStrictEqual([['real', '^2']]);
        });
    });

    await describe('transitive optionality → platform verdict', async () => {
        await it('a both-blocks incompatible sibling goes INERT, not fatal (the @parcel/rust defect)', () => {
            const nodes = parcelTree();
            const r = classify(nodes, ['@parcel/rust']);
            // The parent is required; its platform children are not.
            expect(r.optional).toStrictEqual(['@parcel/rust-darwin-x64', '@parcel/rust-linux-x64-gnu']);
            expect(r.inert).toStrictEqual(['@parcel/rust-darwin-x64']);
            // The matching sibling still installs — the point of the whole feature
            // is that the tree gets THINNER, not that it loses its binary.
            expect(r.installable).toStrictEqual(['@parcel/rust', '@parcel/rust-linux-x64-gnu']);
        });

        await it('an optional-block-only sibling behaves identically (the oxlint/rollup shape)', () => {
            // Same tree, WITHOUT the `dependencies` duplication — this shape always
            // worked, and it must keep answering the same thing, or the fix has
            // just moved the asymmetry somewhere else.
            const nodes = [
                node('oxlint', { optionalDependencies: { 'binding-darwin': '1', 'binding-linux': '1' } }),
                node('binding-darwin', { platform: DARWIN }),
                node('binding-linux', { platform: LINUX }),
            ];
            expect(classify(nodes, ['oxlint'])).toStrictEqual({
                installable: ['oxlint', 'binding-linux'],
                optional: ['binding-darwin', 'binding-linux'],
                inert: ['binding-darwin'],
            });
        });

        await it('a REQUIRED incompatible dependency still raises EBADPLATFORM', () => {
            // The honest half. A required dep the host cannot run is a broken
            // install, not a smaller one — weakening this trades a loud failure for
            // a silently missing binary.
            const nodes = [node('app', { dependencies: { 'win-only': '1' } }), node('win-only', { platform: DARWIN })];
            let thrown: unknown;
            try {
                classify(nodes, ['app']);
            } catch (e) {
                thrown = e;
            }
            expect((thrown as { code?: string } | undefined)?.code).toBe('EBADPLATFORM');
            expect((thrown as { pkgid?: string } | undefined)?.pkgid).toBe('win-only@1.0.0');
        });

        await it('optionality is INHERITED: an optional parent makes its plain deps optional too', () => {
            // `fsevents`-shaped: the subtree under an optional edge is resolved on
            // purpose (the lockfile must stay portable) but nothing in it may be
            // fatal — including a grandchild reached through a REQUIRED edge.
            const nodes = [
                node('watcher', { optionalDependencies: { 'darwin-only': '1' } }),
                node('darwin-only', { platform: DARWIN, dependencies: { 'darwin-helper': '1' } }),
                node('darwin-helper', { platform: DARWIN }),
            ];
            expect(classify(nodes, ['watcher'])).toStrictEqual({
                installable: ['watcher'],
                optional: ['darwin-only', 'darwin-helper'],
                inert: ['darwin-only', 'darwin-helper'],
            });
        });

        await it('required wins over an optional edge to the SAME node, whatever the visit order', () => {
            // The fixpoint's reason to exist, restated for the both-blocks rule: one
            // requester declares the name optional, another requires it. The node is
            // REQUIRED, so an incompatible platform must still fail loudly.
            const nodes = [
                node('lenient', { dependencies: { shared: '1' }, optionalDependencies: { shared: '1' } }),
                node('strict', { dependencies: { shared: '1' } }),
                node('shared', { platform: LINUX }),
            ];
            computeOptionalFlags(nodes, new Set(['lenient', 'strict']), capture().log);
            expect(nodes.find((n) => n.name === 'shared')?.optional).toBe(false);
        });

        await it('reports the skip through the debug log in the npm payload shape', () => {
            // Silence is what made the original over-installation invisible; an
            // absent package must always be recoverable from --verbose.
            const lines = classifyLogged(parcelTree(), ['@parcel/rust']);
            expect(lines.some((l) => l.startsWith('platform-skip: @parcel/rust-darwin-x64@1.0.0'))).toBeTruthy();
            expect(lines.some((l) => l.includes('{"os":"linux","cpu":"x64","libc":"glibc"}'))).toBeTruthy();
        });

        await it('credits a NESTED copy to the requester that nested it', () => {
            // `findVisible` semantics: the hoisted copy is optional-only even though
            // a required requester depends on the NAME, because that requester
            // resolves to its own nested copy.
            const nodes = [
                node('opt-parent', { optionalDependencies: { dep: '^1' } }),
                node('dep', { platform: DARWIN }),
                node('req-parent', { dependencies: { dep: '^2' } }),
                node('dep', { installPath: 'node_modules/req-parent/node_modules/dep' }),
            ];
            const r = classify(nodes, ['opt-parent', 'req-parent']);
            expect(r.inert).toStrictEqual(['dep']);
            expect(r.installable).toStrictEqual(['opt-parent', 'req-parent', 'dep']);
        });
    });

    await describe('--force is asymmetric, on purpose', async () => {
        await it('installs an incompatible REQUIRED dependency', () => {
            const nodes = [node('app', { dependencies: { 'win-only': '1' } }), node('win-only', { platform: DARWIN })];
            expect(classify(nodes, ['app'], true).installable).toStrictEqual(['app', 'win-only']);
        });

        await it('does NOT lift the skip on an incompatible OPTIONAL dependency', () => {
            // npm: "We ignore the --force and --engine-strict flags" for these, and
            // it is right — forcing a binary that cannot load buys a download.
            const nodes = parcelTree();
            const r = classify(nodes, ['@parcel/rust'], true);
            expect(r.inert).toStrictEqual(['@parcel/rust-darwin-x64']);
            expect(r.installable).toStrictEqual(['@parcel/rust', '@parcel/rust-linux-x64-gnu']);
        });
    });

    await describe('optionalDependencyNames (the same rule at the root edge)', async () => {
        await it('treats a name in BOTH blocks of ONE manifest as optional', () => {
            const names = optionalDependencyNames([
                { name: 'p', version: '1', dependencies: { fsevents: '^2' }, optionalDependencies: { fsevents: '^2' } },
            ]);
            expect([...names]).toStrictEqual(['fsevents']);
        });

        await it('lets a REQUIRED edge in ANOTHER manifest win', () => {
            // Two real edges in a workspace: if one member may not miss it, the
            // install may not silently miss it.
            const names = optionalDependencyNames([
                { name: 'a', version: '1', optionalDependencies: { shared: '^1' } },
                { name: 'b', version: '1', dependencies: { shared: '^1' } },
            ]);
            expect([...names]).toStrictEqual([]);
        });

        await it('keeps a devDependency required', () => {
            const names = optionalDependencyNames([
                { name: 'a', version: '1', devDependencies: { tool: '^1' }, optionalDependencies: { extra: '^1' } },
            ]);
            expect([...names]).toStrictEqual(['extra']);
        });
    });
};
