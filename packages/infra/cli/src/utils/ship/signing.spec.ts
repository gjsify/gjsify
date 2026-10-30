// SPDX-License-Identifier: MIT
// The signing interface, at the level no e2e suite can reach.
//
// `tests/e2e/ship-signing` drives whole runs, so it can only see what a shipped
// artifact and a printed line reveal. Three things are decided here instead, and
// each was a decision ADR 0024's amendment argues for rather than an accident of
// implementation:
//
//   * the ARGV. `codesign --force --sign <identity> <file>` is the invocation
//     this tree already writes five times over; the jsign invocation (ADR 0126
//     § D3) is the Windows shape and has never run against the real service,
//     which is why its only coverage is here and why the row says UNVERIFIED.
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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    AZURE_TIMESTAMP_URL,
    AZURE_TOKEN_ENV,
    NOTARIES,
    parseAzureIdentity,
    partitionSignedFileSet,
    resolveNotaryPlan,
    resolveSignPlan,
    signArtifactFile,
    signPayload,
    SIGNERS,
    type SignPlan,
} from './signing.js';

const DEVELOPER_ID = 'Developer ID Application: Example GmbH (ABCDE12345)';
const AZURE = 'azure:https://eus.codesigning.azure.net#example-account/example-profile';

export default async () => {
    await describe('ship signing: the signer table', async () => {
        await it('hands codesign an identity and a file, and forces over the existing signature', async () => {
            const darwin = SIGNERS.darwin;
            expect(darwin).toBeDefined();
            expect(
                darwin?.args({ identity: '-', files: ['/tmp/x/libfoo.dylib'], adhoc: true, entitlements: '/e.plist' }),
            ).toStrictEqual([
                '--force',
                '--sign',
                '-',
                // The hardened runtime is a bit in the CODE DIRECTORY, which an
                // ad-hoc signature has — so this flag is sent for both identities.
                '--options',
                'runtime',
                '--entitlements',
                '/e.plist',
                '/tmp/x/libfoo.dylib',
            ]);
            // …and `--timestamp` is NOT, because a timestamp is a CMS
            // countersignature over a certificate and an ad-hoc signature has
            // neither. The pair of assertions is the whole rule: same flag list,
            // one difference, and it moves with `adhoc`.
            expect(
                darwin?.args({ identity: DEVELOPER_ID, files: ['/a/b'], adhoc: false, entitlements: '/e.plist' }),
            ).toContain('--timestamp');
            expect(
                darwin?.args({ identity: '-', files: ['/a/b'], adhoc: true, entitlements: '/e.plist' }),
            ).not.toContain('--timestamp');
            // No entitlements file, no flag — rather than an `--entitlements`
            // pointing at a path nothing wrote.
            expect(darwin?.args({ identity: '-', files: ['/a/b'], adhoc: true })).not.toContain('--entitlements');
            // `--force` is load-bearing rather than defensive: every image in the
            // shipped darwin closure is ALREADY ad-hoc signed (ADR 0024 § A4
            // measured 106 of 106), because `install_name_tool` invalidates the
            // original during relocation and the relocator re-signs. Without it
            // `codesign` refuses the file it is meant to replace.
            expect(darwin?.args({ identity: DEVELOPER_ID, files: ['/a/b'], adhoc: false })[0]).toBe('--force');
            expect(darwin?.signs).toBe('macho');
            expect(darwin?.signOn).toStrictEqual(['darwin']);
        });

        await it('grants four entitlements, a fifth for ad-hoc, and refuses the sixth', async () => {
            const darwin = SIGNERS.darwin;
            // THE FOUR BOTH IDENTITIES SHARE.
            const shared = [
                'com.apple.security.cs.allow-jit',
                'com.apple.security.cs.allow-unsigned-executable-memory',
                'com.apple.security.cs.disable-executable-page-protection',
                'com.apple.security.cs.allow-dyld-environment-variables',
            ];
            expect(darwin?.entitlements(false)).toStrictEqual(shared);
            // `get-task-allow` is a DEBUGGING entitlement and Apple's notarisation
            // rules refuse a Developer-ID artifact carrying it, so granting it
            // would trade a working local build for one that cannot be shipped.
            expect(darwin?.entitlements(false)).not.toContain('com.apple.security.cs.get-task-allow');
            // § A16 IS ANSWERED, IN ONE DIRECTION AND MEASURED: library validation
            // compares the loaded dylib's team against the process's, and an ad-hoc
            // signature has no team at all, so the same-closure argument § A4 makes
            // does not hold for `--sign -` — the load is refused with *"mapping
            // process and mapped file (non-platform) have different Team IDs"*.
            // So it is granted WHERE IT IS NEEDED.
            expect(darwin?.entitlements(true)).toStrictEqual([
                ...shared,
                'com.apple.security.cs.disable-library-validation',
            ]);
            // …and NOT for a named identity, which is the direction that cannot be
            // measured without a certificate: one Developer ID signs the whole
            // closure with one team, and Apple's notarisation rules read this
            // entitlement on a Developer-ID artifact as shipping unsigned code.
            expect(darwin?.entitlements(false)).not.toContain('com.apple.security.cs.disable-library-validation');
            // Both identities refuse the debugging one.
            for (const adhoc of [true, false]) {
                expect(darwin?.entitlements(adhoc)).not.toContain('com.apple.security.cs.get-task-allow');
            }
        });

        await it('lets the seal add its own directory and nothing else', async () => {
            const planned = ['Ship Demo.app/Contents/MacOS/ship-demo', 'Ship Demo.app/Contents/Helpers/Ship Demo'];
            const sealPrefix = 'Ship Demo.app/Contents/_CodeSignature/';
            const seal = [`${sealPrefix}CodeResources`, `${sealPrefix}CodeDirectory`];

            // A bundle seal writes regular files (Apple TN3126: a bundle with no
            // Mach-O main executable keeps its signature in `_CodeSignature/`), so
            // they have to reach the payload — a `.zip` and a `.dmg` both carry
            // them, and dropping them would ship a bundle that verifies as broken.
            const sealed = partitionSignedFileSet({ arrived: [...planned, ...seal], planned, sealPrefix });
            expect(sealed.sealed.length).toBe(2);
            expect(sealed.unexpected).toStrictEqual([]);
            expect(sealed.removed).toStrictEqual([]);

            // …and ONLY that directory. Anything else appearing means something
            // other than the seal ran, and it would be packed with no mode from
            // the plan.
            const stray = partitionSignedFileSet({
                arrived: [...planned, ...seal, 'Ship Demo.app/Contents/stray'],
                planned,
                sealPrefix,
            });
            expect(stray.unexpected).toStrictEqual(['Ship Demo.app/Contents/stray']);

            // A signer that seals nothing keeps the old rule verbatim: every
            // addition is unexpected. `jsign` rewrites images in place and
            // writes no sidecar at all.
            const windows = partitionSignedFileSet({ arrived: [...planned, ...seal], planned });
            expect(windows.sealed).toStrictEqual([]);
            expect(windows.unexpected.length).toBe(2);

            // A vanished file is refused whether or not there is a seal — it
            // would otherwise be packed as absent.
            expect(partitionSignedFileSet({ arrived: [], planned, sealPrefix }).removed.length).toBe(2);
        });

        await it('seals the bundle on darwin and nothing on win32', async () => {
            expect(SIGNERS.darwin?.sealsBundle).toBe(true);
            expect(SIGNERS.darwin?.sealAddPrefix('Ship Demo.app')).toBe('Ship Demo.app/Contents/_CodeSignature/');
            // A Windows program directory is a directory and nothing more: no
            // manifest to seal, and no per-directory signature format.
            expect(SIGNERS.win32?.sealsBundle).toBe(false);
            expect(SIGNERS.win32?.entitlements(false)).toStrictEqual([]);
            expect(SIGNERS.win32?.entitlements(true)).toStrictEqual([]);
        });

        await it('hands jsign the endpoint, the account/profile alias and a timestamp', async () => {
            const win32 = SIGNERS.win32;
            const argv = win32?.args({ identity: AZURE, files: ['C:\\x\\a.exe', 'C:\\x\\b.dll'], adhoc: false });
            expect(argv).toStrictEqual([
                '--storetype',
                'TRUSTEDSIGNING',
                '--keystore',
                'eus.codesigning.azure.net',
                '--alias',
                'example-account/example-profile',
                '--storepass',
                `env:${AZURE_TOKEN_ENV}`,
                '--alg',
                'SHA-256',
                '--tsaurl',
                AZURE_TIMESTAMP_URL,
                '--tsmode',
                'RFC3161',
                'C:\\x\\a.exe',
                'C:\\x\\b.dll',
            ]);
            // The timestamp is not optional: a signature without one dies with the
            // short-lived certificate (ADR 0126 § D3).
            expect(argv).toContain('--tsaurl');
            expect(win32?.signs).toBe('pe');
            expect(win32?.batch).toBe(true);
            expect(win32?.needs).toContain('java');
            expect(win32?.signOn).toStrictEqual(['linux', 'darwin', 'win32']);
        });

        await it('never puts the access token in argv, only the name of its variable', async () => {
            const argv = SIGNERS.win32?.args({ identity: AZURE, files: ['x.exe'], adhoc: false }) ?? [];
            const env = await SIGNERS.win32?.childEnv?.(AZURE, {
                [AZURE_TOKEN_ENV]: 'canary-token-value',
                PATH: '/bin',
            });
            expect(env?.[AZURE_TOKEN_ENV]).toBe('canary-token-value');
            expect(argv.join(' ')).not.toContain('canary-token-value');
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
            // `jsign --alias` names no keychain identity, and an Authenticode subject
            // handed to `codesign` names no keychain identity.
            const plan = resolveSignPlan({
                config: { darwin: { identity: DEVELOPER_ID }, win32: { identity: AZURE } },
                layoutOs: 'win32',
            });
            expect((plan as Extract<SignPlan, { kind: 'sign' }>).identity).toBe(AZURE);
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

    await describe('ship signing: the Azure identity', async () => {
        await it('parses azure:<host>#<account>/<profile>, with or without https://', async () => {
            const want = {
                endpoint: 'eus.codesigning.azure.net',
                account: 'example-account',
                profile: 'example-profile',
            };
            expect(parseAzureIdentity(AZURE)).toStrictEqual(want);
            expect(parseAzureIdentity('azure:eus.codesigning.azure.net#example-account/example-profile')).toStrictEqual(
                want,
            );
        });

        await it('refuses a bare subject, an unknown prefix, and a missing # or /', async () => {
            for (const bad of [
                'Example GmbH',
                DEVELOPER_ID,
                'pkcs11:host#a/b',
                'azure:host',
                'azure:host#account',
                'azure:#a/b',
                'azure:host#/profile',
            ]) {
                expect(() => parseAzureIdentity(bad)).toThrow();
            }
        });

        await it('skips an absent win32 identity and names `ship credentials check`', async () => {
            const plan = resolveSignPlan({ layoutOs: 'win32' });
            expect(plan.kind).toBe('skip');
            const message = (plan as Extract<SignPlan, { kind: 'skip' }>).message;
            expect(message).toContain('no identity was given');
            expect(message).toContain('ship credentials check win32');
            expect(message).not.toContain('ad-hoc');
        });

        await it('refuses a bare subject name at plan time rather than at signing time', async () => {
            expect(() => resolveSignPlan({ flag: 'Example GmbH', layoutOs: 'win32' })).toThrow();
        });
    });

    await describe('ship signing: jsign order, against a fake jsign', async () => {
        await it('signs the PE images in ONE batch and the .msi last', async () => {
            if (process.platform === 'win32') return;
            const dir = mkdtempSync(join(tmpdir(), 'jsign-order-'));
            const bin = join(dir, 'bin');
            mkdirSync(bin);
            const log = join(dir, 'calls.log');
            writeFileSync(join(bin, 'jsign'), `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\n`, { mode: 0o755 });
            const saved = { PATH: process.env.PATH, token: process.env[AZURE_TOKEN_ENV] };
            process.env.PATH = `${bin}:${process.env.PATH ?? ''}`;
            process.env[AZURE_TOKEN_ENV] = 'canary-token-value';
            try {
                const signer = SIGNERS.win32!;
                const pe = (n: number): Uint8Array => new Uint8Array([0x4d, 0x5a, n, 0]);
                const signed = await signPayload({
                    payload: [
                        { path: 'app.exe', mode: 0o755, data: pe(1) },
                        { path: 'lib/x.dll', mode: 0o644, data: pe(2) },
                        { path: 'readme.txt', mode: 0o644, data: new Uint8Array([1, 2, 3, 4]) },
                    ],
                    identity: AZURE,
                    signer,
                    workDir: join(dir, 'work'),
                    bundleRoot: '',
                    entitlementsPath: join(dir, 'e.plist'),
                    verbose: false,
                    log: () => {},
                });
                expect(signed.length).toBe(3);
                await signArtifactFile({
                    identity: AZURE,
                    signer,
                    file: join(dir, 'app.msi'),
                    verbose: false,
                    log: () => {},
                });
                const calls = readFileSync(log, 'utf8').trim().split('\n');
                expect(calls.length).toBe(2);
                expect(calls[0]).toContain('app.exe');
                expect(calls[0]).toContain('x.dll');
                expect(calls[0]).not.toContain('readme.txt');
                expect(calls[0]).not.toContain('.msi');
                expect(calls[1]).toContain('app.msi');
                expect(calls[1]).not.toContain('app.exe');
                for (const call of calls) expect(call).not.toContain('canary-token-value');
            } finally {
                if (saved.PATH !== undefined) process.env.PATH = saved.PATH;
                if (saved.token === undefined) delete process.env[AZURE_TOKEN_ENV];
                else process.env[AZURE_TOKEN_ENV] = saved.token;
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });
};
