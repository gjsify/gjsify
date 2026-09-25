// REQUIRED PEER EDGES and what they mean for optionality.
//
// THE DEFECT: `wxt` declares `vite` as a required peer, the native backend never
// read `peerDependencies`, and `wxt prepare` died with "Builder not found" after
// an install that exited 0. Placement is pinned from outside by the
// `install-peer-deps` e2e; these rows pin the two readings of a manifest that the
// resolve walk and the optionality fixpoint must share — injected graphs, no
// registry. The fixpoint half matters beyond this defect: a peer reached ONLY
// through a peer edge that came out `optional` would be silently inerted by the
// platform filter where npm fails loudly.
import { describe, it, expect } from '@gjsify/unit';

import {
    applyPlatformFilter,
    computeOptionalFlags,
    requiredPeerEntries,
    type ResolvedNode,
} from './install-backend-native.js';
import type { PlatformTarget } from './platform-check.js';

const LINUX_X64: PlatformTarget = { os: 'linux', cpu: 'x64', libc: 'glibc' };
const silent = () => {};

function node(name: string, spec: Partial<ResolvedNode> = {}): ResolvedNode {
    return {
        name,
        version: '1.0.0',
        tarballUrl: `https://registry.example/${name}.tgz`,
        installPath: `node_modules/${name}`,
        dependencies: {},
        optionalDependencies: {},
        ...spec,
    };
}

export default async () => {
    await describe('requiredPeerEntries', async () => {
        await it('keeps a required peer and drops one peerDependenciesMeta marks optional', () => {
            // The wxt shape: vite required, the rest optional.
            const wxt = {
                dependencies: {},
                optionalDependencies: {},
                peerDependencies: { vite: '^7.0.0', eslint: '*', 'web-ext': '*' },
                peerDependenciesMeta: { eslint: { optional: true }, 'web-ext': { optional: true } },
            };
            expect(requiredPeerEntries(wxt)).toStrictEqual([['vite', '^7.0.0']]);
        });

        await it('yields nothing for the @gjsify/cli shape, where every peer is optional', () => {
            // ADR 0020: the engine set must stay NOT auto-installed.
            const cli = {
                dependencies: {},
                optionalDependencies: {},
                peerDependencies: { '@gjsify/rolldown-native': '^0.52.0' },
                peerDependenciesMeta: { '@gjsify/rolldown-native': { optional: true } },
            };
            expect(requiredPeerEntries(cli)).toStrictEqual([]);
        });

        await it('leaves a name the node also depends on to the dependency walk', () => {
            const both = {
                dependencies: { react: '^18' },
                optionalDependencies: { fsevents: '^2' },
                peerDependencies: { react: '^18', fsevents: '^2', 'react-dom': '^18' },
            };
            expect(requiredPeerEntries(both)).toStrictEqual([['react-dom', '^18']]);
        });
    });

    await describe('computeOptionalFlags with peer edges', async () => {
        await it('makes a peer of a required package required', () => {
            const nodes = [node('wxt', { peerDependencies: { vite: '^7' } }), node('vite', { optional: true })];
            computeOptionalFlags(nodes, new Set(['wxt']), silent);
            expect(nodes.map((n) => n.optional)).toStrictEqual([false, false]);
        });

        await it("makes a peer's own required peer required (transitive)", () => {
            const nodes = [
                node('host', { peerDependencies: { lib: '^2' } }),
                node('lib', { peerDependencies: { core: '^3' } }),
                node('core', { optional: true }),
            ];
            computeOptionalFlags(nodes, new Set(['host']), silent);
            expect(nodes.every((n) => n.optional === false)).toBe(true);
        });

        await it('credits a nested dependent with the peer placed beside it', () => {
            const nodes = [
                node('parent', { dependencies: { host: '2.0.0' } }),
                node('host', { installPath: 'node_modules/parent/node_modules/host', peerDependencies: { lib: '^1' } }),
                node('lib', { installPath: 'node_modules/parent/node_modules/lib', optional: true }),
            ];
            computeOptionalFlags(nodes, new Set(['parent']), silent);
            expect(nodes.every((n) => n.optional === false)).toBe(true);
        });

        await it('keeps an optional peer optional, so a foreign-platform one stays inert', () => {
            const nodes = [
                node('host', {
                    peerDependencies: { engine: '^1' },
                    peerDependenciesMeta: { engine: { optional: true } },
                }),
                node('engine', { platform: { os: ['darwin'] } }),
            ];
            computeOptionalFlags(nodes, new Set(['host']), silent);
            expect(nodes[1].optional).toBe(true);
            expect(applyPlatformFilter(nodes, LINUX_X64, false, silent).map((n) => n.name)).toStrictEqual(['host']);
        });

        await it('fails a REQUIRED foreign-platform peer instead of inerting it', () => {
            const nodes = [
                node('host', { peerDependencies: { engine: '^1' } }),
                node('engine', { platform: { os: ['darwin'] } }),
            ];
            computeOptionalFlags(nodes, new Set(['host']), silent);
            expect(() => applyPlatformFilter(nodes, LINUX_X64, false, silent)).toThrow();
        });
    });
};
