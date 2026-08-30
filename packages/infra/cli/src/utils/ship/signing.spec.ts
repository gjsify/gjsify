// SPDX-License-Identifier: MIT
// The signing interface, at the level no e2e suite can reach.
//
// `tests/e2e/ship-signing` drives whole runs, so it can only see what a shipped
// artifact and a printed line reveal. Three things are decided here instead, and
// each was a decision ADR 0024's amendment argues for rather than an accident of
// implementation:
//
//   * the ARGV. `codesign --force --sign <identity> <file>` is the invocation
//     this tree already writes five times over; `signtool sign /n <identity>` is
//     the Windows shape and has never run anywhere, which is why its only
//     coverage is here and why the row says UNVERIFIED.
//   * the PRECEDENCE and the empty case. `--sign ''` and
//     `gjsify.ship.sign.<os>.identity: ""` are the same `[ -z "$SIGN" ]` the
//     reference guards on (§ A13), reached from two different sides.
//   * § A15's rule, as a test rather than as a sentence: **the guard must test
//     the credential the command actually consumes.** `refs/node`'s
//     `osx-notarize.sh` guards on three environment variables and then submits
//     with a `--keychain-profile` nothing checked — so it skips when the
//     credential it does NOT use is absent. The assertion below is that the
//     value `resolveNotaryPlan` guards on is the value that lands after
//     `--keychain-profile`, which is the property that trap violates.

import { describe, expect, it } from '@gjsify/unit';

import { NOTARIES, resolveNotaryPlan, resolveSignPlan, SIGNERS, type SignPlan } from './signing.js';

const DEVELOPER_ID = 'Developer ID Application: Example GmbH (ABCDE12345)';

export default async () => {
    await describe('ship signing: the signer table', async () => {
        await it('hands codesign an identity and a file, and forces over the existing signature', async () => {
            const darwin = SIGNERS.darwin;
            expect(darwin).toBeDefined();
            expect(darwin?.args('-', '/tmp/x/libfoo.dylib')).toStrictEqual([
                '--force',
                '--sign',
                '-',
                '/tmp/x/libfoo.dylib',
            ]);
            // `--force` is load-bearing rather than defensive: every image in the
            // shipped darwin closure is ALREADY ad-hoc signed (ADR 0024 § A4
            // measured 106 of 106), because `install_name_tool` invalidates the
            // original during relocation and the relocator re-signs. Without it
            // `codesign` refuses the file it is meant to replace.
            expect(darwin?.args(DEVELOPER_ID, '/a/b')[0]).toBe('--force');
            expect(darwin?.signs).toBe('macho');
            expect(darwin?.signOn).toStrictEqual(['darwin']);
        });

        await it('hands signtool a SUBJECT NAME and names the digest algorithm', async () => {
            const win32 = SIGNERS.win32;
            expect(win32?.args(DEVELOPER_ID, 'C:\\x\\app.exe')).toStrictEqual([
                'sign',
                '/n',
                DEVELOPER_ID,
                '/fd',
                'sha256',
                'C:\\x\\app.exe',
            ]);
            // Authenticode's default file digest is SHA-1, which no current
            // Windows accepts — so the flag is not decoration.
            expect(win32?.args('x', 'y')).toContain('sha256');
            expect(win32?.signs).toBe('pe');
        });

        await it('has no row for linux, and that is the decision rather than a gap', async () => {
            expect(SIGNERS.linux).toBeUndefined();
        });

        await it('makes every row say what its signature does not cover', async () => {
            for (const os of ['darwin', 'win32'] as const) {
                expect((SIGNERS[os]?.gap ?? '').length).toBeGreaterThan(0);
                expect((SIGNERS[os]?.installHint ?? '').length).toBeGreaterThan(0);
            }
        });
    });

    await describe('ship signing: resolving the identity', async () => {
        await it('takes the flag over the project default', async () => {
            const plan = resolveSignPlan({
                flag: '-',
                config: { darwin: { identity: DEVELOPER_ID } },
                layoutOs: 'darwin',
            });
            expect(plan.kind).toBe('sign');
            expect((plan as Extract<SignPlan, { kind: 'sign' }>).identity).toBe('-');
            expect((plan as Extract<SignPlan, { kind: 'sign' }>).source).toBe('flag');
        });

        await it('falls back to gjsify.ship.sign.<os>.identity', async () => {
            const plan = resolveSignPlan({ config: { darwin: { identity: DEVELOPER_ID } }, layoutOs: 'darwin' });
            expect(plan.kind).toBe('sign');
            expect((plan as Extract<SignPlan, { kind: 'sign' }>).identity).toBe(DEVELOPER_ID);
            expect((plan as Extract<SignPlan, { kind: 'sign' }>).source).toBe('config');
        });

        await it('reads the key for the LAYOUT being packed, not for the host', async () => {
            // The two namespaces must not meet: a Developer ID string handed to
            // `signtool /n` names no certificate, and an Authenticode subject
            // handed to `codesign` names no keychain identity.
            const plan = resolveSignPlan({
                config: { darwin: { identity: DEVELOPER_ID }, win32: { identity: 'Example GmbH' } },
                layoutOs: 'win32',
            });
            expect((plan as Extract<SignPlan, { kind: 'sign' }>).identity).toBe('Example GmbH');
        });

        await it('skips on an absent identity, and says so', async () => {
            const plan = resolveSignPlan({ layoutOs: 'darwin' });
            expect(plan.kind).toBe('skip');
            expect((plan as Extract<SignPlan, { kind: 'skip' }>).message).toContain('no identity was given');
            // The skip names the STEP it skipped. The reference's two scripts
            // both say "Skipping codesign", and one of them is skipping
            // `productsign` (§ A13).
            expect((plan as Extract<SignPlan, { kind: 'skip' }>).message).toContain('codesign');
        });

        await it('skips on an EMPTY identity from either side — `[ -z "$SIGN" ]`', async () => {
            const fromFlag = resolveSignPlan({ flag: '', layoutOs: 'darwin' });
            expect(fromFlag.kind).toBe('skip');
            expect((fromFlag as Extract<SignPlan, { kind: 'skip' }>).message).toContain('passed to --sign');
            const fromConfig = resolveSignPlan({ config: { darwin: { identity: '' } }, layoutOs: 'darwin' });
            expect(fromConfig.kind).toBe('skip');
            expect((fromConfig as Extract<SignPlan, { kind: 'skip' }>).message).toContain(
                'gjsify.ship.sign.darwin.identity',
            );
        });

        await it('says nothing at all for a layout that has no signature', async () => {
            expect(resolveSignPlan({ layoutOs: 'linux' }).kind).toBe('unsupported');
        });

        await it('refuses --sign for a layout that has no signature', async () => {
            expect(() => resolveSignPlan({ flag: DEVELOPER_ID, layoutOs: 'linux' })).toThrow();
        });
    });

    await describe('ship signing: notarisation is a second credential', async () => {
        await it('guards the value the command CONSUMES — ADR 0024 § A15', async () => {
            const notary = NOTARIES.darwin;
            expect(notary).toBeDefined();
            const args = notary?.args('MY_PROFILE', '/out/app.zip') ?? [];
            // The guarded value lands immediately after the flag that reads it.
            // `refs/node`'s script fails exactly this: it guards on
            // NOTARIZATION_ID / _PASSWORD / _TEAM_ID and submits with a
            // `--keychain-profile` nothing looked at.
            expect(args[args.indexOf('--keychain-profile') + 1]).toBe('MY_PROFILE');
            expect(args).toStrictEqual([
                'notarytool',
                'submit',
                '--keychain-profile',
                'MY_PROFILE',
                '--wait',
                '/out/app.zip',
            ]);
            // And the skip is reachable from that same value and no other input.
            const signed: SignPlan = {
                kind: 'sign',
                identity: '-',
                signer: SIGNERS.darwin!,
                source: 'flag',
            };
            expect(resolveNotaryPlan({ flag: '', layoutOs: 'darwin', sign: signed }).kind).toBe('skip');
            expect(resolveNotaryPlan({ layoutOs: 'darwin', sign: signed }).kind).toBe('skip');
            expect(resolveNotaryPlan({ flag: 'MY_PROFILE', layoutOs: 'darwin', sign: signed }).kind).toBe('notarize');
        });

        await it('refuses a credential with nothing signed to submit', async () => {
            expect(() =>
                resolveNotaryPlan({ flag: 'MY_PROFILE', layoutOs: 'darwin', sign: { kind: 'unsupported' } }),
            ).toThrow();
        });

        await it('refuses --notarize where nothing notarises', async () => {
            expect(() =>
                resolveNotaryPlan({ flag: 'MY_PROFILE', layoutOs: 'win32', sign: { kind: 'unsupported' } }),
            ).toThrow();
            expect(resolveNotaryPlan({ layoutOs: 'win32', sign: { kind: 'unsupported' } }).kind).toBe('unsupported');
        });
    });
};
