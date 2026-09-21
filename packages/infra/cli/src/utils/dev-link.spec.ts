// SPDX-License-Identifier: MIT
// Unit tests for the `gjsify link` development override.
//
// The rules worth holding here are the ones whose failure is SILENT. A link that
// quietly falls back to the registry, an `--immutable` build that quietly accepts
// a developer's checkout, an `unlink` that quietly deletes a real package
// directory — each produces a tree that looks right and is not. So every refusal
// is asserted on its MESSAGE carrying the measured path, because a refusal
// without the path is only half an answer.
//
// The intersection rule gets its own arm: linking is the checkout's workspace set
// ∩ what the consumer depends on, and "∩" is the whole reason a 200-member
// monorepo does not dump 200 directories into a consumer that uses two.
//
// Three rows are named REGRESSION and run through a real entry point, because the
// defects they hold down all lived in a SEQUENCE rather than in a function: a
// second `link` with a narrower selection, and an `applyDevLinks` whose idempotent
// skip hid an unbuilt target. A unit of either piece passed while the sequence was
// broken, which is how both shipped.

import { describe, it, expect } from '@gjsify/unit';
import {
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    realpathSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    applyDevLinks,
    assertNoDevLinkUnderImmutable,
    consumerKnownNames,
    DEV_LINK_FILE,
    ensureLocallyIgnored,
    planDevLinks,
    prepareDevLinks,
    readDevLinkOverride,
    removeDevLinks,
    resolveCheckoutWorkspaces,
    scanDevLinks,
    writeDevLinkOverride,
} from './dev-link.js';
import { linkCommand } from '../commands/link.js';

/** `realpathSync` because macOS `tmpdir()` is `/var/…` → `/private/var/…`. */
function scratch(): string {
    return realpathSync(mkdtempSync(join(tmpdir(), 'gjsify-dev-link-')));
}

function writeJson(path: string, value: unknown): void {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(value, null, 2));
}

/** A minimal gjsify-shaped checkout with two workspace packages. */
function makeCheckout(root: string): string {
    writeJson(join(root, 'package.json'), { name: 'gjsify-fixture', version: '0.0.0', workspaces: ['packages/*'] });
    for (const name of ['utils', 'gtk-host']) {
        writeJson(join(root, 'packages', name, 'package.json'), { name: `@gjsify/${name}`, version: '0.51.1' });
    }
    return root;
}

const workspacesOf = (checkout: string) => resolveCheckoutWorkspaces(checkout, join(checkout, 'irrelevant.json'));

/**
 * Run `gjsify link` the way a terminal does — real handler, real cwd — with the
 * output swallowed.
 *
 * Through the COMMAND on purpose. The two rules below are about what a SECOND
 * `link` does to what the first one left, and no unit of `dev-link.ts` owns that
 * sequence; testing the pieces would have passed while the sequence stayed broken,
 * which is exactly how it shipped.
 */
function runLink(consumerRoot: string, args: { checkout: string; packages?: string[] }): void {
    const previousCwd = process.cwd();
    const quiet = (): void => {};
    const saved = { log: console.log, warn: console.warn, error: console.error };
    try {
        process.chdir(consumerRoot);
        console.log = quiet;
        console.warn = quiet;
        console.error = quiet;
        linkCommand.handler({ ...args, 'dry-run': false } as never);
    } finally {
        console.log = saved.log;
        console.warn = saved.warn;
        console.error = saved.error;
        process.chdir(previousCwd);
    }
}

/** A consumer that declares `names` as dependencies and has a `node_modules`. */
function makeConsumer(root: string, names: readonly string[]): string {
    writeJson(join(root, 'package.json'), {
        name: 'consumer',
        version: '1.0.0',
        dependencies: Object.fromEntries(names.map((n) => [n, '^1.0.0'])),
    });
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    return root;
}

export default async () => {
    await describe('planDevLinks', async () => {
        await it('links only the checkout packages the consumer actually depends on', async () => {
            const root = scratch();
            const checkout = makeCheckout(join(root, 'checkout'));
            const links = planDevLinks({
                consumerRoot: join(root, 'consumer'),
                workspaces: workspacesOf(checkout),
                patterns: [],
                knownNames: new Set(['@gjsify/utils', 'some-other-package']),
            });
            expect(links.length).toBe(1);
            expect(links[0]?.name).toBe('@gjsify/utils');
            expect(links[0]?.target).toBe(join(checkout, 'packages', 'utils'));
            expect(links[0]?.linkPath).toBe(join(root, 'consumer', 'node_modules', '@gjsify/utils'));
            rmSync(root, { recursive: true, force: true });
        });

        await it('narrows further by --packages glob', async () => {
            const root = scratch();
            const checkout = makeCheckout(join(root, 'checkout'));
            const links = planDevLinks({
                consumerRoot: join(root, 'consumer'),
                workspaces: workspacesOf(checkout),
                patterns: ['@gjsify/gtk-*'],
                knownNames: new Set(['@gjsify/utils', '@gjsify/gtk-host']),
            });
            expect(links.map((l) => l.name).join(',')).toBe('@gjsify/gtk-host');
            rmSync(root, { recursive: true, force: true });
        });
    });

    await describe('the override file', async () => {
        await it('round-trips, and resolves a hand-written relative checkout against the consumer', async () => {
            const root = scratch();
            const consumer = join(root, 'consumer');
            mkdirSync(consumer, { recursive: true });
            writeDevLinkOverride(consumer, { version: 1, checkout: join(root, 'checkout'), packages: [] });
            expect(readDevLinkOverride(consumer)?.checkout).toBe(join(root, 'checkout'));

            writeFileSync(join(consumer, DEV_LINK_FILE), JSON.stringify({ version: 1, checkout: '../checkout' }));
            const relative = readDevLinkOverride(consumer);
            expect(relative?.checkout).toBe(join(root, 'checkout'));
            // An absent selector means EVERY package, spelled as the empty list:
            // `['*']` would select none, since the glob dialect's `*` does not
            // cross the `/` in a scoped name.
            expect(relative?.packages.length).toBe(0);
            rmSync(root, { recursive: true, force: true });
        });

        await it('refuses a malformed or future-versioned file instead of answering null', async () => {
            // `null` here would mean "no link", i.e. a silent fall back to the
            // registry while the developer believes their checkout is in play.
            const root = scratch();
            writeFileSync(join(root, DEV_LINK_FILE), '{ not json');
            expect(() => readDevLinkOverride(root)).toThrow();
            writeFileSync(join(root, DEV_LINK_FILE), JSON.stringify({ version: 2, checkout: '/somewhere' }));
            expect(() => readDevLinkOverride(root)).toThrow();
            writeFileSync(join(root, DEV_LINK_FILE), JSON.stringify({ version: 1 }));
            expect(() => readDevLinkOverride(root)).toThrow();
            rmSync(root, { recursive: true, force: true });
        });
    });

    await describe('resolveCheckoutWorkspaces', async () => {
        await it('names the measured path when the checkout is gone', async () => {
            const root = scratch();
            const missing = join(root, 'not-here');
            let message = '';
            try {
                resolveCheckoutWorkspaces(missing, join(root, DEV_LINK_FILE));
            } catch (err) {
                message = String(err);
            }
            expect(message).toContain(missing);
            expect(message).toContain(DEV_LINK_FILE);
            rmSync(root, { recursive: true, force: true });
        });

        await it('names the path when the directory is not a gjsify workspace', async () => {
            const root = scratch();
            writeJson(join(root, 'plain', 'package.json'), { name: 'plain', version: '1.0.0' });
            let message = '';
            try {
                resolveCheckoutWorkspaces(join(root, 'plain'), join(root, DEV_LINK_FILE));
            } catch (err) {
                message = String(err);
            }
            expect(message).toContain(join(root, 'plain'));
            expect(message).toContain('workspaces');
            rmSync(root, { recursive: true, force: true });
        });
    });

    await describe('applyDevLinks / removeDevLinks', async () => {
        await it('replaces an installed registry copy with a link, and is idempotent', async () => {
            const root = scratch();
            const checkout = makeCheckout(join(root, 'checkout'));
            const consumer = join(root, 'consumer');
            // The registry copy, as an install would have left it.
            writeJson(join(consumer, 'node_modules', '@gjsify/utils', 'package.json'), {
                name: '@gjsify/utils',
                version: '0.51.1',
            });
            const links = planDevLinks({
                consumerRoot: consumer,
                workspaces: workspacesOf(checkout),
                patterns: [],
                knownNames: new Set(['@gjsify/utils']),
            });
            expect(applyDevLinks(links).length).toBe(1);
            const linkPath = join(consumer, 'node_modules', '@gjsify/utils');
            expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
            expect(realpathSync(linkPath)).toBe(join(checkout, 'packages', 'utils'));
            // A second call writes nothing: an unlink/relink would race anything
            // reading through the link.
            expect(applyDevLinks(links).length).toBe(0);
            rmSync(root, { recursive: true, force: true });
        });

        await it('refuses to delete a REAL directory sitting where a link belongs', async () => {
            // The asymmetry install-extraneous.ts reasons from: a wrong deletion
            // loses work a wrong refusal only reports.
            const root = scratch();
            const checkout = makeCheckout(join(root, 'checkout'));
            const consumer = join(root, 'consumer');
            const pkgDir = join(consumer, 'node_modules', '@gjsify/utils');
            writeJson(join(pkgDir, 'package.json'), { name: '@gjsify/utils', version: '0.51.1' });
            const links = planDevLinks({
                consumerRoot: consumer,
                workspaces: workspacesOf(checkout),
                patterns: [],
                knownNames: new Set(['@gjsify/utils']),
            });
            expect(removeDevLinks(links).length).toBe(0);
            expect(existsSync(join(pkgDir, 'package.json'))).toBe(true);
            rmSync(root, { recursive: true, force: true });
        });
    });

    await describe('prepareDevLinks', async () => {
        await it("reads the override and plans from the consumer's declared deps", async () => {
            const root = scratch();
            const checkout = makeCheckout(join(root, 'checkout'));
            const consumer = join(root, 'consumer');
            writeJson(join(consumer, 'package.json'), {
                name: 'consumer',
                version: '1.0.0',
                dependencies: { '@gjsify/utils': '^0.51.1' },
            });
            writeDevLinkOverride(consumer, { version: 1, checkout, packages: [] });
            const active = prepareDevLinks(consumer);
            expect(active?.links.length).toBe(1);
            expect(active?.names.has('@gjsify/utils')).toBe(true);
            // gtk-host is in the checkout and NOT a dependency here.
            expect(active?.names.has('@gjsify/gtk-host')).toBe(false);
            expect(consumerKnownNames(consumer).has('@gjsify/utils')).toBe(true);
            rmSync(root, { recursive: true, force: true });
        });

        await it('is null when no override exists', async () => {
            const root = scratch();
            expect(prepareDevLinks(root)).toBe(null);
            rmSync(root, { recursive: true, force: true });
        });
    });

    await describe('assertNoDevLinkUnderImmutable', async () => {
        await it('refuses an active override and names the file and the checkout', async () => {
            const root = scratch();
            writeJson(join(root, 'package.json'), { name: 'consumer', version: '1.0.0' });
            writeDevLinkOverride(root, { version: 1, checkout: join(root, 'checkout'), packages: [] });
            let message = '';
            try {
                assertNoDevLinkUnderImmutable(root);
            } catch (err) {
                message = String(err);
            }
            expect(message).toContain(join(root, DEV_LINK_FILE));
            expect(message).toContain(join(root, 'checkout'));
            rmSync(root, { recursive: true, force: true });
        });

        await it('still refuses when the override is unparseable', async () => {
            // "Is a development tree in play" cannot be answered `no` by a file
            // that cannot be read.
            const root = scratch();
            writeFileSync(join(root, DEV_LINK_FILE), '{ broken');
            expect(() => assertNoDevLinkUnderImmutable(root)).toThrow();
            rmSync(root, { recursive: true, force: true });
        });

        await it('passes when there is no override', async () => {
            const root = scratch();
            assertNoDevLinkUnderImmutable(root);
            rmSync(root, { recursive: true, force: true });
        });
    });

    await describe('re-linking with a narrower --packages', async () => {
        await it('retires the link the new selection drops', async () => {
            // REGRESSION, blocker 2 of the #1730 review. MEASURED before the fix:
            // link everything, relink with `--packages 'is-odd'`, and
            // `node_modules/is-number` stayed a symlink into the checkout while
            // nothing named it any more. From there `assertNodeModulesDest` aborted
            // EVERY later `gjsify install` with exit 1, blaming "a workspace source
            // tree"; `gjsify unlink` removed the override first and then hit the
            // same abort, so the escape route was gone too. Only a hand-written
            // `rm` recovered the project.
            const root = scratch();
            const checkout = makeCheckout(join(root, 'checkout'));
            const consumer = makeConsumer(join(root, 'consumer'), ['@gjsify/utils', '@gjsify/gtk-host']);

            runLink(consumer, { checkout });
            expect(lstatSync(join(consumer, 'node_modules', '@gjsify/utils')).isSymbolicLink()).toBe(true);
            expect(lstatSync(join(consumer, 'node_modules', '@gjsify/gtk-host')).isSymbolicLink()).toBe(true);

            runLink(consumer, { checkout, packages: ['@gjsify/gtk-*'] });
            // The kept one is still linked...
            expect(lstatSync(join(consumer, 'node_modules', '@gjsify/gtk-host')).isSymbolicLink()).toBe(true);
            // ...and the dropped one is GONE, not an orphan pointing out of the
            // tree. A hole is fine: the reinstall fills it from the registry.
            expect(existsSync(join(consumer, 'node_modules', '@gjsify/utils'))).toBe(false);
            // The census that the plan alone could not give: nothing the new
            // override does not name still points into the checkout.
            expect(
                scanDevLinks(consumer, [checkout])
                    .map((l) => l.name)
                    .join(','),
            ).toBe('@gjsify/gtk-host');
            rmSync(root, { recursive: true, force: true });
        });
    });

    await describe('a link to an UNBUILT checkout', async () => {
        await it('refuses instead of linking, and keeps refusing on the idempotent re-run', async () => {
            // REGRESSION, blocker 3 of the #1730 review. `dist/`/`lib/` are
            // git-ignored in a gjsify checkout, so an unbuilt package is what an
            // ordinary branch switch leaves behind. MEASURED before the fix: delete
            // the entry file, run `gjsify install`, and it re-linked while printing
            // only "development link ACTIVE" — the consumer then died on
            // MODULE_NOT_FOUND naming the consumer, not the checkout.
            //
            // Asserted on `applyDevLinks` because that is the ONE function through
            // which a dev link is ever written: `commands/install.ts` reaches it
            // from all three of its call sites, `commands/link.ts` from the fourth.
            //
            // The second half is the half that was measured. `applyDevLinks` skips
            // a link that already points at the right target, so a check that only
            // ran on the links it WRITES would have stayed silent in precisely the
            // state that produced the defect.
            const root = scratch();
            const checkout = join(root, 'checkout');
            writeJson(join(checkout, 'package.json'), {
                name: 'gjsify-fixture',
                version: '0.0.0',
                workspaces: ['packages/*'],
            });
            writeJson(join(checkout, 'packages', 'utils', 'package.json'), {
                name: '@gjsify/utils',
                version: '0.51.1',
                main: 'dist/index.js',
            });
            const consumer = makeConsumer(join(root, 'consumer'), ['@gjsify/utils']);
            writeDevLinkOverride(consumer, { version: 1, checkout, packages: [] });
            const links = prepareDevLinks(consumer)?.links ?? [];
            expect(links.length).toBe(1);

            let message = '';
            try {
                applyDevLinks(links);
                message = '<no error: linked an unbuilt package>';
            } catch (err) {
                message = err instanceof Error ? err.message : String(err);
            }
            // Path and remedy, because "not built" is only actionable with the
            // where and the what-to-run in it.
            expect(message).toContain(join(checkout, 'packages', 'utils'));
            expect(message).toContain('dist/index.js');
            expect(message).toContain('gjsify run build');
            expect(existsSync(join(consumer, 'node_modules', '@gjsify/utils'))).toBe(false);

            // Now BUILD it, link it for real, then unbuild it: the link is already
            // correct, so nothing is rewritten — and the refusal must still fire.
            mkdirSync(join(checkout, 'packages', 'utils', 'dist'), { recursive: true });
            writeFileSync(join(checkout, 'packages', 'utils', 'dist', 'index.js'), 'export default 1;\n');
            expect(applyDevLinks(links).length).toBe(1);
            expect(applyDevLinks(links).length).toBe(0); // idempotent, as documented
            rmSync(join(checkout, 'packages', 'utils', 'dist'), { recursive: true, force: true });
            expect(() => applyDevLinks(links)).toThrow();
            rmSync(root, { recursive: true, force: true });
        });
    });

    await describe('ensureLocallyIgnored', async () => {
        await it('writes .git/info/exclude rather than the tracked .gitignore', async () => {
            const root = scratch();
            mkdirSync(join(root, '.git'), { recursive: true });
            expect(ensureLocallyIgnored(root)).toBe('added');
            expect(readFileSync(join(root, '.git', 'info', 'exclude'), 'utf-8')).toContain(DEV_LINK_FILE);
            // The consumer's committed ignore file is untouched — the whole point.
            expect(existsSync(join(root, '.gitignore'))).toBe(false);
            expect(ensureLocallyIgnored(root)).toBe('already-ignored');
            rmSync(root, { recursive: true, force: true });
        });

        await it('accepts an existing .gitignore entry and adds nothing', async () => {
            const root = scratch();
            mkdirSync(join(root, '.git'), { recursive: true });
            writeFileSync(join(root, '.gitignore'), `node_modules/\n${DEV_LINK_FILE}\n`);
            expect(ensureLocallyIgnored(root)).toBe('already-ignored');
            expect(existsSync(join(root, '.git', 'info', 'exclude'))).toBe(false);
            rmSync(root, { recursive: true, force: true });
        });

        await it('follows a `gitdir:` pointer file, as a worktree or submodule has', async () => {
            // Writing `info/exclude` beside the POINTER would ignore nothing at all.
            const root = scratch();
            const realGitDir = join(root, 'real-gitdir');
            mkdirSync(realGitDir, { recursive: true });
            const consumer = join(root, 'consumer');
            mkdirSync(consumer, { recursive: true });
            writeFileSync(join(consumer, '.git'), `gitdir: ${realGitDir}\n`);
            expect(ensureLocallyIgnored(consumer)).toBe('added');
            expect(readFileSync(join(realGitDir, 'info', 'exclude'), 'utf-8')).toContain(DEV_LINK_FILE);
            rmSync(root, { recursive: true, force: true });
        });

        await it('reports a non-git consumer instead of pretending to ignore', async () => {
            const root = scratch();
            expect(ensureLocallyIgnored(root)).toBe('no-git');
            rmSync(root, { recursive: true, force: true });
        });
    });
};
