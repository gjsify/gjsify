/**
 * Rule `polyfill-peers` — every `gjsify.polyfillPeers` entry names a real `@gjsify/*`
 * builtin polyfill the declaring package depends on, and says why.
 *
 * WHY THIS EXISTS. Some polyfills do not merely CALL another builtin, they ADOPT its
 * objects: `@gjsify/tls` upgrades a given socket by claiming the Gio connection inside a
 * `@gjsify/net` Socket. Anywhere `node:tls` is the polyfill, `node:net` has to be too. On
 * GJS that holds by construction; the node-gi consumer harness retargets only the package
 * under test, so it built `@gjsify/tls`'s specs against the runtime's own `node:net`, and
 * #1837's STARTTLS specs failed with `_claimConnection is not a function` on node, bun
 * and deno. The package declares the coupling in `gjsify.polyfillPeers` and the harness
 * retargets each peer too. A declaration is a promise that can be false while every build
 * exits 0, so this rule holds it to the manifest:
 *
 *   1. the value is an object mapping a bare builtin name to a non-empty reason;
 *   2. `@gjsify/<peer>` is a workspace package declaring `gjsify.runtimes` (a builtin
 *      polyfill, not an arbitrary library) — a misspelled peer would alias
 *      `node:<typo>` onto nothing and fail far from the manifest;
 *   3. the declaring package lists it in `dependencies`: a polyfill cannot adopt
 *      objects from a package it does not import.
 *
 * REPO-SCOPED because the only consumer is this tree's harness.
 */

import { defineRule } from '../../../packages/infra/manifest-conformance/lib/index.mjs';

/**
 * @param {import('../../../packages/infra/manifest-conformance/lib/context.mjs').ConformanceContext} ctx
 */
export function auditPolyfillPeers(ctx) {
    const failures = [];
    let declared = 0;
    let peers = 0;
    const byName = new Map(ctx.packages.map((p) => [p.manifest.name, p]));

    for (const pkg of ctx.packages) {
        const block = pkg.manifest.gjsify?.polyfillPeers;
        if (block === undefined) continue;
        declared++;
        const where = `${pkg.rel}/package.json: \`gjsify.polyfillPeers\``;

        if (typeof block !== 'object' || block === null || Array.isArray(block)) {
            failures.push(`${where} must be an object mapping a builtin name to the reason it is a peer.`);
            continue;
        }

        for (const [peer, reason] of Object.entries(block)) {
            peers++;
            const peerName = `@gjsify/${peer}`;
            if (typeof reason !== 'string' || reason.trim() === '') {
                failures.push(`${where}.${peer} needs a non-empty reason: which object the polyfill adopts.`);
            }
            const peerPkg = byName.get(peerName);
            if (!peerPkg) {
                failures.push(`${where}.${peer}: no workspace package is named \`${peerName}\`.`);
                continue;
            }
            if (!peerPkg.manifest.gjsify?.runtimes) {
                failures.push(
                    `${where}.${peer}: \`${peerName}\` declares no \`gjsify.runtimes\`, so it is not a builtin polyfill a \`node:${peer}\` alias could name.`,
                );
            }
            if (!Object.hasOwn(pkg.manifest.dependencies ?? {}, peerName)) {
                failures.push(
                    `${where}.${peer}: \`${peerName}\` is not in \`dependencies\`, so the polyfill cannot adopt its objects.`,
                );
            }
        }
    }

    return { failures, stats: { declared, peers } };
}

export const polyfillPeersRule = defineRule({
    id: 'polyfill-peers',
    scope: 'repo',
    fields: ['gjsify.polyfillPeers'],
    description: 'every `gjsify.polyfillPeers` entry names a builtin polyfill the package depends on, with a reason',
    run(ctx) {
        const { failures, stats } = auditPolyfillPeers(ctx);
        return {
            failures,
            stats,
            summary:
                stats.declared === 0
                    ? 'polyfill-peers: no package declares `gjsify.polyfillPeers`'
                    : `polyfill-peers: ${stats.declared} package(s), ${stats.peers} peer(s) checked`,
        };
    },
});
