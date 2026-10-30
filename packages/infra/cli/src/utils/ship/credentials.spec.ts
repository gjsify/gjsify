// SPDX-License-Identifier: MIT
// `gjsify ship credentials` (ADR 0126 § D1, § D4).
//
// The pure half (table, planners, parsers) is tested directly. The effectful
// half is tested against FAKE `gh`, `security`, `xcrun` and `az` on PATH that
// record argv and stdin, with a CANARY value as every secret: the property
// under test is that it reaches the child's stdin (or, for `security import -P`,
// the documented argv slot) and appears nowhere in what WE print or throw.

import { describe, expect, it } from '@gjsify/unit';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    CREDENTIALS,
    evaluateCheck,
    parseIdentityName,
    parseKeychainList,
    parseNameList,
    planDarwinInstall,
    planDarwinRemove,
    planUpload,
    renderCommand,
    scrub,
} from './credentials.js';
import { defaultIo, runCheck, runInstall, runUpload, type CredentialIo } from './credentials-run.js';

const CANARY = 'canary-secret-9f3a';
const IDENTITY = 'Developer ID Application: Example GmbH (ABCDE12345)';
const AZURE = 'azure:eus.codesigning.azure.net#example-account/example-profile';

const FAKE_SH = (name: string, body: string): string => `#!/bin/sh\n${body.replace(/NAME/g, name)}\n`;

interface Harness {
    dir: string;
    io: CredentialIo;
    out: string[];
    err: string[];
    exits: number[];
    log: () => string;
    cleanup: () => void;
}

function harness(extraEnv: Record<string, string> = {}, prompts: string[] = []): Harness {
    const dir = mkdtempSync(join(tmpdir(), 'cred-spec-'));
    const bin = join(dir, 'bin');
    mkdirSync(bin);
    const logFile = join(dir, 'calls.log');
    writeFileSync(logFile, '');
    const fake = (name: string, body: string): void =>
        writeFileSync(join(bin, name), FAKE_SH(name, body), { mode: 0o755 });

    fake(
        'gh',
        `echo "gh $*" >> "$FAKE_LOG"
case "$*" in
  *"secret set"*|*"variable set"*) echo "  stdin=$(cat)" >> "$FAKE_LOG" ;;
  *"secret list"*) echo "$FAKE_GH_SECRETS" ;;
  *"variable list"*) echo "$FAKE_GH_VARIABLES" ;;
esac
[ "$FAKE_FAIL" = "gh" ] && { echo "boom $FAKE_ECHO" >&2; exit 1; }
exit 0`,
    );
    fake(
        'security',
        `echo "security $*" >> "$FAKE_LOG"
sub="$1"
[ "$FAKE_FAIL" = "$sub" ] && { echo "boom $FAKE_ECHO" >&2; exit 1; }
case "$sub" in
  create-keychain) eval "kc=\\\${$#}"; : > "$kc" ;;
  import) echo "  p12mode=$(stat -c %a "$2") dirmode=$(stat -c %a "$(dirname "$2")")" >> "$FAKE_LOG" ;;
  list-keychains) case "$*" in *" -s "*) ;; *) echo '    "/Users/runner/login.keychain-db"' ;; esac ;;
  default-keychain) case "$*" in *" -s "*) ;; *) echo '    "/Users/runner/login.keychain-db"' ;; esac ;;
  find-identity) echo '  1) 0123ABCD "${IDENTITY}"' ;;
esac
exit 0`,
    );
    fake(
        'xcrun',
        `echo "xcrun $*" >> "$FAKE_LOG"
[ "$FAKE_FAIL" = "xcrun" ] && { echo "boom $FAKE_ECHO" >&2; exit 1; }
for a in "$@"; do [ -f "$a" ] && echo "  keyfile-present" >> "$FAKE_LOG"; done
exit 0`,
    );
    fake('az', `echo "az $*" >> "$FAKE_LOG"\n[ "$FAKE_AZ_FAIL" = "1" ] && exit 1\necho "az-token-value"`);

    const out: string[] = [];
    const err: string[] = [];
    const exits: number[] = [];
    const base = defaultIo();
    const queue = [...prompts];
    const io: CredentialIo = {
        ...base,
        env: { PATH: `${bin}:${process.env.PATH ?? ''}`, FAKE_LOG: logFile, ...extraEnv },
        out: (l) => out.push(l),
        err: (l) => err.push(l),
        prompt: async () => queue.shift() ?? '',
        onPath: () => true,
        exit: (c) => void exits.push(c),
        ci: true,
        stateDir: join(dir, 'state'),
        scratchRoot: join(dir, 'scratch'),
    };
    mkdirSync(io.scratchRoot);
    return {
        dir,
        io,
        out,
        err,
        exits,
        log: () => readFileSync(logFile, 'utf8'),
        cleanup: () => rmSync(dir, { recursive: true, force: true }),
    };
}

const darwinEnv = (): Record<string, string> => ({
    APPLE_DEVELOPER_ID_P12_BASE64: Buffer.from(`p12-${CANARY}`).toString('base64'),
    APPLE_DEVELOPER_ID_P12_PASSWORD: CANARY,
    APPLE_NOTARY_KEY_P8: `-----BEGIN PRIVATE KEY-----\n${CANARY}\n-----END PRIVATE KEY-----\n`,
    APPLE_NOTARY_KEY_ID: 'KEYID12345',
    APPLE_NOTARY_ISSUER_ID: '11111111-2222-3333-4444-555555555555',
});

const everything = (h: Harness): string => [...h.out, ...h.err].join('\n');
const posix = process.platform !== 'win32';

export default async () => {
    await describe('ship credentials: the table', async () => {
        await it('has the five darwin secrets and two win32 variables, and no win32 secret', async () => {
            expect(CREDENTIALS.darwin?.entries.map((e) => e.name)).toStrictEqual([
                'APPLE_DEVELOPER_ID_P12_BASE64',
                'APPLE_DEVELOPER_ID_P12_PASSWORD',
                'APPLE_NOTARY_KEY_P8',
                'APPLE_NOTARY_KEY_ID',
                'APPLE_NOTARY_ISSUER_ID',
            ]);
            expect(CREDENTIALS.darwin?.entries.every((e) => e.kind === 'secret')).toBe(true);
            expect(CREDENTIALS.win32?.entries.every((e) => e.kind === 'variable')).toBe(true);
            expect(CREDENTIALS.linux).toBeUndefined();
        });

        await it('plans gh with the value on stdin, never in argv', async () => {
            const darwin = CREDENTIALS.darwin!.entries[1]!;
            const cmd = planUpload(darwin, 'owner/name');
            expect(cmd.argv).toStrictEqual([
                'gh',
                'secret',
                'set',
                'APPLE_DEVELOPER_ID_P12_PASSWORD',
                '--repo',
                'owner/name',
            ]);
            expect(cmd.stdin).toStrictEqual({ ref: 'APPLE_DEVELOPER_ID_P12_PASSWORD' });
            expect(renderCommand(cmd)).toContain('< $APPLE_DEVELOPER_ID_P12_PASSWORD');
            expect(planUpload(CREDENTIALS.win32!.entries[0]!, 'o/r').argv.slice(0, 3)).toStrictEqual([
                'gh',
                'variable',
                'set',
            ]);
        });

        await it('plans the darwin keychain in the ADR order with values as refs', async () => {
            const plan = planDarwinInstall({
                keychain: '/k',
                p12File: '/s/a.p12',
                p8File: '/s/a.p8',
                previous: { defaultKeychain: '/d', searchList: ['/d', '/e'] },
            });
            expect(plan.setup.map((c) => c.label)).toStrictEqual([
                'create-keychain',
                'set-keychain-settings',
                'unlock-keychain',
                'import',
                'set-key-partition-list',
                'list-keychains',
                'default-keychain',
            ]);
            expect(plan.setup[5]!.argv).toStrictEqual([
                'security',
                'list-keychains',
                '-d',
                'user',
                '-s',
                '/k',
                '/d',
                '/e',
            ]);
            expect(plan.notary.argv.slice(0, 4)).toStrictEqual([
                'xcrun',
                'notarytool',
                'store-credentials',
                'gjsify-notary',
            ]);
            const rendered = [...plan.setup, plan.notary].map(renderCommand).join('\n');
            expect(rendered).toContain('$KEYCHAIN_PASSWORD');
            expect(rendered).toContain('$APPLE_DEVELOPER_ID_P12_PASSWORD');
        });

        await it('plans the removal from the saved state, and still deletes without one', async () => {
            expect(
                planDarwinRemove('/k', { defaultKeychain: '/d', searchList: ['/d'] }).map((c) => c.label),
            ).toStrictEqual(['restore search list', 'restore default keychain', 'delete-keychain']);
            expect(planDarwinRemove('/k', null).map((c) => c.label)).toStrictEqual(['delete-keychain']);
        });

        await it('parses keychain lists, identities and gh name lists', async () => {
            expect(parseKeychainList('    "/a/login.keychain-db"\n    "/b/x.keychain"\n')).toStrictEqual([
                '/a/login.keychain-db',
                '/b/x.keychain',
            ]);
            expect(parseIdentityName(`  1) 0123ABCD "${IDENTITY}"\n     1 valid identities found\n`)).toBe(IDENTITY);
            expect(parseIdentityName('     0 valid identities found\n')).toBeNull();
            expect(parseNameList('[{"name":"A"},{"name":"B"},{"x":1}]')).toStrictEqual(['A', 'B']);
        });

        await it('treats a partial set and an empty set as incomplete', async () => {
            const set = CREDENTIALS.darwin!;
            expect(evaluateCheck('darwin', set, new Set(set.entries.map((e) => e.name))).complete).toBe(true);
            expect(evaluateCheck('darwin', set, new Set(['APPLE_NOTARY_KEY_ID'])).complete).toBe(false);
            expect(evaluateCheck('darwin', set, new Set()).complete).toBe(false);
        });

        await it('scrubs a value and its base64 form', async () => {
            expect(scrub(`x ${CANARY} y ${Buffer.from(CANARY).toString('base64')}`, [CANARY])).toBe('x *** y ***');
        });
    });

    await describe('ship credentials: upload against a fake gh', async () => {
        await it('pushes every value on stdin, base64-encodes the p12, prints only names', async () => {
            if (!posix) return;
            const h = harness({}, ['key-id-1', 'issuer-1']);
            try {
                const p12 = join(h.dir, 'cert.p12');
                const p8 = join(h.dir, 'key.p8');
                writeFileSync(p12, `p12-${CANARY}`);
                writeFileSync(p8, `pem-${CANARY}\n`);
                h.io.env.PW_ENV = CANARY;
                const code = await runUpload(h.io, {
                    os: 'darwin',
                    repo: 'owner/name',
                    dryRun: false,
                    sources: { 'p12-file': p12, 'p12-password-env': 'PW_ENV', 'notary-key-file': p8 },
                });
                expect(code).toBe(0);
                const log = h.log();
                expect(log).toContain('gh secret set APPLE_DEVELOPER_ID_P12_BASE64 --repo owner/name');
                expect(log).toContain(`stdin=${Buffer.from(`p12-${CANARY}`).toString('base64')}`);
                expect(log).toContain(`stdin=${CANARY}`);
                // The value is on stdin only: no gh argv line carries it.
                for (const line of log.split('\n').filter((l) => l.startsWith('gh '))) {
                    expect(line).not.toContain(CANARY);
                    expect(line).not.toContain('--body');
                }
                expect(everything(h)).not.toContain(CANARY);
                expect(h.out.join('\n')).toContain('APPLE_NOTARY_KEY_ID');
            } finally {
                h.cleanup();
            }
        });

        await it('calls gh for nothing when one value is missing', async () => {
            if (!posix) return;
            const h = harness();
            try {
                const code = await runUpload(h.io, { os: 'darwin', repo: 'o/r', dryRun: false, sources: {} });
                expect(code).toBe(1);
                expect(h.log()).toBe('');
                expect(h.err.join('\n')).toContain('APPLE_DEVELOPER_ID_P12_BASE64');
            } finally {
                h.cleanup();
            }
        });

        await it('scrubs a secret that gh echoes into its error', async () => {
            if (!posix) return;
            const h = harness({ FAKE_FAIL: 'gh', FAKE_ECHO: CANARY });
            try {
                const p12 = join(h.dir, 'cert.p12');
                writeFileSync(p12, 'bytes');
                h.io.env.A = CANARY;
                const code = await runUpload(h.io, {
                    os: 'darwin',
                    repo: 'o/r',
                    dryRun: false,
                    sources: {
                        'p12-file': p12,
                        'p12-password-env': 'A',
                        'notary-key-env': 'A',
                        'notary-key-id-env': 'A',
                        'notary-issuer-id-env': 'A',
                    },
                });
                expect(code).toBe(1);
                expect(h.err.join('\n')).toContain('failed');
                expect(everything(h)).not.toContain(CANARY);
            } finally {
                h.cleanup();
            }
        });

        await it('prints the plan on --dry-run and touches nothing', async () => {
            if (!posix) return;
            const h = harness();
            try {
                const code = await runUpload(h.io, { os: 'darwin', repo: 'o/r', dryRun: true, sources: {} });
                expect(code).toBe(0);
                expect(h.log()).toBe('');
                expect(h.out.length).toBe(5);
                expect(h.out[0]).toContain('$APPLE_DEVELOPER_ID_P12_BASE64');
            } finally {
                h.cleanup();
            }
        });
    });

    await describe('ship credentials: check', async () => {
        await it('reads the environment: complete is 0, partial and empty are 1', async () => {
            const h = harness(darwinEnv());
            expect(runCheck(h.io, { os: 'darwin', json: false })).toBe(0);
            const partial = harness({ APPLE_NOTARY_KEY_ID: 'x' });
            expect(runCheck(partial.io, { os: 'darwin', json: false })).toBe(1);
            expect(partial.out.join('\n')).toContain('PARTIAL');
            const empty = harness();
            expect(runCheck(empty.io, { os: 'darwin', json: true })).toBe(1);
            expect(JSON.parse(empty.out[0] ?? '{}').present).toStrictEqual([]);
            // Names only, never a value.
            expect(everything(h)).not.toContain(CANARY);
            for (const x of [h, partial, empty]) x.cleanup();
        });

        await it('reads gh secret list and gh variable list with --repo', async () => {
            if (!posix) return;
            const names = CREDENTIALS.darwin!.entries.map((e) => ({ name: e.name }));
            const h = harness({ FAKE_GH_SECRETS: JSON.stringify(names), FAKE_GH_VARIABLES: '[]' });
            try {
                expect(runCheck(h.io, { os: 'darwin', repo: 'o/r', json: true })).toBe(0);
                expect(JSON.parse(h.out[0] ?? '{}').complete).toBe(true);
                expect(h.log()).toContain('gh secret list --repo o/r --json name');
                const half = harness({ FAKE_GH_SECRETS: JSON.stringify(names.slice(0, 2)) });
                expect(runCheck(half.io, { os: 'darwin', repo: 'o/r', json: false })).toBe(1);
                half.cleanup();
            } finally {
                h.cleanup();
            }
        });

        await it('checks the win32 variables, not secrets', async () => {
            const h = harness({ AZURE_CLIENT_ID: 'c', AZURE_TENANT_ID: 't' });
            expect(runCheck(h.io, { os: 'win32', json: false })).toBe(0);
            expect(runCheck(h.io, { os: 'windows', json: false })).toBe(0);
            h.cleanup();
        });
    });

    await describe('ship credentials: install darwin against fake security and xcrun', async () => {
        await it('refuses outside CI without --force and touches nothing', async () => {
            if (!posix) return;
            const h = harness(darwinEnv());
            try {
                h.io.ci = false;
                expect(await runInstall(h.io, { os: 'darwin', remove: false, dryRun: false, force: false })).toBe(1);
                expect(h.log()).toBe('');
                expect(existsSync(h.io.stateDir)).toBe(false);
            } finally {
                h.cleanup();
            }
        });

        await it('runs the ADR sequence, keeps key files 0600 in a 0700 dir, and leaves none behind', async () => {
            if (!posix) return;
            const h = harness(darwinEnv());
            try {
                expect(await runInstall(h.io, { os: 'darwin', remove: false, dryRun: false, force: false })).toBe(0);
                const calls = h
                    .log()
                    .split('\n')
                    .filter((l) => /^(security|xcrun) /.test(l))
                    .map((l) => l.split(' ').slice(0, 2).join(' '));
                expect(calls).toStrictEqual([
                    'security list-keychains',
                    'security default-keychain',
                    'security create-keychain',
                    'security set-keychain-settings',
                    'security unlock-keychain',
                    'security import',
                    'security set-key-partition-list',
                    'security list-keychains',
                    'security default-keychain',
                    'xcrun notarytool',
                    'security find-identity',
                ]);
                expect(h.log()).toContain('p12mode=600 dirmode=700');
                expect(h.log()).toContain('keyfile-present');
                expect(h.out.join('\n')).toContain(IDENTITY);
                // The key files are gone the moment notarytool has them.
                expect(readdirSync(h.io.scratchRoot)).toStrictEqual([]);
                // The keychain and the state survive for `--remove`, and hold no secret.
                const state = readFileSync(join(h.io.stateDir, 'state.json'), 'utf8');
                expect(state).not.toContain(CANARY);
                expect(state).toContain('login.keychain-db');
                expect(everything(h)).not.toContain(CANARY);
                expect(await runInstall(h.io, { os: 'darwin', remove: false, dryRun: false, force: false })).toBe(1);

                expect(await runInstall(h.io, { os: 'darwin', remove: true, dryRun: false, force: false })).toBe(0);
                expect(existsSync(h.io.stateDir)).toBe(false);
                const tail = h
                    .log()
                    .split('\n')
                    .filter((l) => l.startsWith('security'))
                    .slice(-3);
                expect(tail[0]).toContain('list-keychains -d user -s /Users/runner/login.keychain-db');
                expect(tail[1]).toContain('default-keychain -d user -s /Users/runner/login.keychain-db');
                expect(tail[2]).toContain('delete-keychain');
            } finally {
                h.cleanup();
            }
        });

        await it('rolls back and exits non-zero when a step fails, without leaking the secret', async () => {
            if (!posix) return;
            for (const failing of ['import', 'xcrun']) {
                const h = harness({ ...darwinEnv(), FAKE_FAIL: failing, FAKE_ECHO: CANARY });
                try {
                    expect(await runInstall(h.io, { os: 'darwin', remove: false, dryRun: false, force: false })).toBe(
                        1,
                    );
                    expect(existsSync(h.io.stateDir)).toBe(false);
                    expect(readdirSync(h.io.scratchRoot)).toStrictEqual([]);
                    expect(h.log()).toContain('delete-keychain');
                    expect(everything(h)).not.toContain(CANARY);
                    expect(h.err.join('\n')).toContain('failed');
                } finally {
                    h.cleanup();
                }
            }
        });

        await it('removes the temp dirs and the keychain when a signal arrives mid-install', async () => {
            if (!posix) return;
            const h = harness(darwinEnv());
            try {
                const inner = h.io.run;
                h.io.run = (argv, opts) => {
                    const result = inner(argv, opts);
                    if (argv[1] === 'import') process.emit('SIGTERM');
                    return result;
                };
                expect(await runInstall(h.io, { os: 'darwin', remove: false, dryRun: false, force: false })).toBe(1);
                expect(h.exits).toStrictEqual([143]);
                expect(existsSync(h.io.stateDir)).toBe(false);
                expect(readdirSync(h.io.scratchRoot)).toStrictEqual([]);
                expect(h.log()).not.toContain('notarytool');
            } finally {
                h.cleanup();
            }
        });

        await it('names the missing variables and prints a value-free plan on --dry-run', async () => {
            if (!posix) return;
            const h = harness({ APPLE_NOTARY_KEY_ID: 'x' });
            try {
                expect(await runInstall(h.io, { os: 'darwin', remove: false, dryRun: false, force: false })).toBe(1);
                expect(h.err.join('\n')).toContain('APPLE_DEVELOPER_ID_P12_BASE64');
                const dry = harness(darwinEnv());
                expect(await runInstall(dry.io, { os: 'darwin', remove: false, dryRun: true, force: false })).toBe(0);
                expect(dry.log()).toBe('');
                expect(dry.out.join('\n')).toContain('$KEYCHAIN_PASSWORD');
                expect(everything(dry)).not.toContain(CANARY);
                expect(existsSync(dry.io.stateDir)).toBe(false);
                dry.cleanup();
            } finally {
                h.cleanup();
            }
        });
    });

    await describe('ship credentials: install win32 validates only', async () => {
        const ids = { AZURE_CLIENT_ID: 'c', AZURE_TENANT_ID: 't' };

        await it('passes when jsign, java, the identity and a token resolve — and prints no token', async () => {
            if (!posix) return;
            const h = harness({ ...ids, AZURE_ACCESS_TOKEN: CANARY });
            try {
                expect(
                    await runInstall(h.io, { os: 'win32', remove: false, dryRun: false, force: false, sign: AZURE }),
                ).toBe(0);
                expect(everything(h)).not.toContain(CANARY);
            } finally {
                h.cleanup();
            }
        });

        await it('takes the token from az when the variable is absent, and fails when az does', async () => {
            if (!posix) return;
            const ok = harness(ids);
            const bad = harness({ ...ids, FAKE_AZ_FAIL: '1' });
            try {
                expect(
                    await runInstall(ok.io, { os: 'win32', remove: false, dryRun: false, force: false, sign: AZURE }),
                ).toBe(0);
                expect(ok.log()).toContain('az account get-access-token --resource https://codesigning.azure.net');
                expect(everything(ok)).not.toContain('az-token-value');
                expect(
                    await runInstall(bad.io, { os: 'win32', remove: false, dryRun: false, force: false, sign: AZURE }),
                ).toBe(1);
            } finally {
                ok.cleanup();
                bad.cleanup();
            }
        });

        await it('fails on a bad identity, a missing tool and missing variables, listing each', async () => {
            if (!posix) return;
            const h = harness({ AZURE_ACCESS_TOKEN: 'x' });
            try {
                h.io.onPath = (cmd) => cmd !== 'jsign';
                expect(
                    await runInstall(h.io, {
                        os: 'win32',
                        remove: false,
                        dryRun: false,
                        force: false,
                        sign: 'Example GmbH',
                    }),
                ).toBe(1);
                const text = h.err.join('\n');
                expect(text).toContain('`jsign` is not on PATH');
                expect(text).toContain('bare subject');
                expect(text).toContain('AZURE_CLIENT_ID');
            } finally {
                h.cleanup();
            }
        });

        await it('makes --remove a no-op that says so', async () => {
            const h = harness();
            expect(await runInstall(h.io, { os: 'win32', remove: true, dryRun: false, force: false })).toBe(0);
            expect(h.out.join('\n')).toContain('nothing to undo');
            h.cleanup();
        });
    });
};
