// The credential procedure behind `gjsify ship credentials` (ADR 0126 § D1, § D4).
//
// This file is the PURE half: the `CREDENTIALS` table, the argv planners and
// the text parsers. Nothing here spawns, reads a file or touches the
// environment; `credentials-run.ts` does, with an injected io so a test can
// drive it against fake `gh` / `security` binaries.
//
// One table row per OS, keyed by the layout's OS exactly as `SIGNERS` is, and
// all three verbs (`upload`, `install`, `check`) read that one table so they
// cannot disagree about which names exist. A credential is per RUN and per
// HOST, which is why this is not a column of `SIGNERS` (§ A14's argument for
// keeping `FORMATS` and `SIGNERS` apart, applied once more).

import type { HostOs } from './types.js';

/** Where an `upload` may take a value from. Never a flag's own value. */
export type CredentialSource = 'file' | 'env' | 'prompt';

/**
 * How the bytes read from a source become the value that is stored:
 * `base64` encodes a binary file in memory, `text` keeps it verbatim (a PEM
 * key), `line` drops one trailing newline (a one-line password in a file).
 */
export type CredentialTransform = 'base64' | 'text' | 'line';

export interface CredentialEntry {
    /** The `gh secret` / `gh variable` name; also the environment variable `install` and `check` read. */
    name: string;
    /** `secret` is stored with `gh secret set` and never printed; `variable` is an identifier. */
    kind: 'secret' | 'variable';
    /** Base of the generated `--<flag>-file` / `--<flag>-env` options. */
    flag: string;
    sources: readonly CredentialSource[];
    transform: CredentialTransform;
    /** What the prompt asks for, and the option help. */
    label: string;
}

export interface CredentialSet {
    entries: readonly CredentialEntry[];
}

export const CREDENTIALS: Partial<Record<HostOs, CredentialSet>> = {
    darwin: {
        entries: [
            {
                name: 'APPLE_DEVELOPER_ID_P12_BASE64',
                kind: 'secret',
                flag: 'p12',
                sources: ['file'],
                transform: 'base64',
                label: 'Developer ID Application certificate (.p12)',
            },
            {
                name: 'APPLE_DEVELOPER_ID_P12_PASSWORD',
                kind: 'secret',
                flag: 'p12-password',
                sources: ['file', 'env', 'prompt'],
                transform: 'line',
                label: 'password of the .p12',
            },
            {
                name: 'APPLE_NOTARY_KEY_P8',
                kind: 'secret',
                flag: 'notary-key',
                sources: ['file', 'env'],
                transform: 'text',
                label: 'App Store Connect API key (.p8)',
            },
            {
                name: 'APPLE_NOTARY_KEY_ID',
                kind: 'secret',
                flag: 'notary-key-id',
                sources: ['file', 'env', 'prompt'],
                transform: 'line',
                label: 'App Store Connect key id',
            },
            {
                name: 'APPLE_NOTARY_ISSUER_ID',
                kind: 'secret',
                flag: 'notary-issuer-id',
                sources: ['file', 'env', 'prompt'],
                transform: 'line',
                label: 'App Store Connect issuer id',
            },
        ],
    },
    // Federated login leaves no secret to store (ADR 0126 § D4): only the two
    // identifiers `azure/login` needs, as repository variables.
    win32: {
        entries: [
            {
                name: 'AZURE_CLIENT_ID',
                kind: 'variable',
                flag: 'azure-client-id',
                sources: ['file', 'env', 'prompt'],
                transform: 'line',
                label: 'Entra application (client) id',
            },
            {
                name: 'AZURE_TENANT_ID',
                kind: 'variable',
                flag: 'azure-tenant-id',
                sources: ['file', 'env', 'prompt'],
                transform: 'line',
                label: 'Entra tenant id',
            },
        ],
    },
};

/** Every distinct option base in the table, with the sources it accepts — for the command's builder. */
export function credentialFlags(): { flag: string; sources: readonly CredentialSource[]; label: string }[] {
    const seen = new Map<string, { flag: string; sources: readonly CredentialSource[]; label: string }>();
    for (const set of Object.values(CREDENTIALS)) {
        for (const entry of set?.entries ?? []) {
            seen.set(entry.flag, { flag: entry.flag, sources: entry.sources, label: entry.label });
        }
    }
    return [...seen.values()];
}

/** The option name a source is read from, e.g. `p12-password-file`. */
export function sourceOption(
    entry: Pick<CredentialEntry, 'flag'>,
    source: Exclude<CredentialSource, 'prompt'>,
): string {
    return `${entry.flag}-${source}`;
}

/**
 * A command argument: a literal, or a NAMED value resolved at run time. The
 * dry-run prints the name, the run substitutes the value, so one planner
 * serves both and a printed plan cannot contain a secret.
 */
export type Arg = string | { ref: string };

export interface PlannedCommand {
    /** Short human label for progress and error messages. */
    label: string;
    argv: Arg[];
    /** The value written to the child's stdin, by name. */
    stdin?: { ref: string };
}

export function renderArg(arg: Arg): string {
    return typeof arg === 'string' ? arg : `$${arg.ref}`;
}

/** The dry-run line for a command: argv with values as `$NAME`, stdin as `< $NAME`. */
export function renderCommand(cmd: PlannedCommand): string {
    const line = cmd.argv.map(renderArg).join(' ');
    return cmd.stdin === undefined ? line : `${line} < $${cmd.stdin.ref}`;
}

export function resolveArgv(argv: readonly Arg[], values: Readonly<Record<string, string>>): string[] {
    return argv.map((arg) => {
        if (typeof arg === 'string') return arg;
        const value = values[arg.ref];
        if (value === undefined) throw new Error(`gjsify ship credentials: no value for ${arg.ref}`);
        return value;
    });
}

/** `gh secret set NAME --repo R` / `gh variable set NAME --repo R`, the value on stdin (never `--body`). */
export function planUpload(entry: CredentialEntry, repo: string): PlannedCommand {
    return {
        label: `${entry.kind === 'secret' ? 'secret' : 'variable'} ${entry.name}`,
        argv: ['gh', entry.kind, 'set', entry.name, '--repo', repo],
        stdin: { ref: entry.name },
    };
}

/** `gh secret list` / `gh variable list`, names only. */
export function planList(kind: CredentialEntry['kind'], repo: string): PlannedCommand {
    return { label: `${kind} list`, argv: ['gh', kind, 'list', '--repo', repo, '--json', 'name'] };
}

/** Parse the `--json name` output of `gh {secret,variable} list` into names. */
export function parseNameList(stdout: string): string[] {
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed)) throw new Error('expected a JSON array');
    return parsed.flatMap((row: unknown) =>
        typeof row === 'object' && row !== null && typeof (row as { name?: unknown }).name === 'string'
            ? [(row as { name: string }).name]
            : [],
    );
}

export interface CheckResult {
    os: HostOs;
    present: string[];
    missing: string[];
    /** Every entry present. A partial set and an empty one are both `false`. */
    complete: boolean;
}

export function evaluateCheck(os: HostOs, set: CredentialSet, present: ReadonlySet<string>): CheckResult {
    const names = set.entries.map((e) => e.name);
    const have = names.filter((n) => present.has(n));
    const missing = names.filter((n) => !present.has(n));
    return { os, present: have, missing, complete: missing.length === 0 };
}

/** Name of the notarytool profile `ship` looks for; lives in the default keychain and dies with it. */
export const NOTARY_PROFILE = 'gjsify-notary';

export interface KeychainPrevious {
    defaultKeychain: string | null;
    searchList: string[];
}

/** What the planner needs to name; paths are literals, values are refs. */
export interface DarwinInstallContext {
    keychain: string;
    p12File: string;
    p8File: string;
    previous: KeychainPrevious;
}

export interface DarwinInstallPlan {
    /** Create and populate the keychain, then make it first and default. */
    setup: PlannedCommand[];
    notary: PlannedCommand;
    identity: PlannedCommand;
}

export const KEYCHAIN_PASSWORD_REF = 'KEYCHAIN_PASSWORD';

/**
 * The `security` / `xcrun` sequence of ADR 0126 § D1 `install darwin`.
 *
 * `security import -P` and `create-keychain -p` take their password in argv —
 * the tool has no stdin or file form. On an ephemeral single-job runner that
 * is the same exposure `codesign` itself has; it is the one place a secret
 * reaches an argv, and it is why `install` refuses a non-CI host.
 */
export function planDarwinInstall(ctx: DarwinInstallContext): DarwinInstallPlan {
    const kc = ctx.keychain;
    const kcPass: Arg = { ref: KEYCHAIN_PASSWORD_REF };
    return {
        setup: [
            { label: 'create-keychain', argv: ['security', 'create-keychain', '-p', kcPass, kc] },
            { label: 'set-keychain-settings', argv: ['security', 'set-keychain-settings', '-lut', '21600', kc] },
            { label: 'unlock-keychain', argv: ['security', 'unlock-keychain', '-p', kcPass, kc] },
            {
                label: 'import',
                argv: [
                    'security',
                    'import',
                    ctx.p12File,
                    '-k',
                    kc,
                    '-P',
                    { ref: 'APPLE_DEVELOPER_ID_P12_PASSWORD' },
                    '-f',
                    'pkcs12',
                    '-T',
                    '/usr/bin/codesign',
                    '-T',
                    '/usr/bin/security',
                ],
            },
            {
                label: 'set-key-partition-list',
                argv: [
                    'security',
                    'set-key-partition-list',
                    '-S',
                    'apple-tool:,apple:,codesign:',
                    '-s',
                    '-k',
                    kcPass,
                    kc,
                ],
            },
            {
                label: 'list-keychains',
                argv: ['security', 'list-keychains', '-d', 'user', '-s', kc, ...ctx.previous.searchList],
            },
            { label: 'default-keychain', argv: ['security', 'default-keychain', '-d', 'user', '-s', kc] },
        ],
        notary: {
            label: 'notarytool store-credentials',
            argv: [
                'xcrun',
                'notarytool',
                'store-credentials',
                NOTARY_PROFILE,
                '--key',
                ctx.p8File,
                '--key-id',
                { ref: 'APPLE_NOTARY_KEY_ID' },
                '--issuer',
                { ref: 'APPLE_NOTARY_ISSUER_ID' },
            ],
        },
        identity: {
            label: 'find-identity',
            argv: ['security', 'find-identity', '-v', '-p', 'codesigning', kc],
        },
    };
}

/** The reverse of {@link planDarwinInstall}'s step 5, from the saved state. Commands that cannot apply are omitted. */
export function planDarwinRemove(keychain: string, previous: KeychainPrevious | null): PlannedCommand[] {
    const cmds: PlannedCommand[] = [];
    if (previous !== null) {
        cmds.push({
            label: 'restore search list',
            argv: ['security', 'list-keychains', '-d', 'user', '-s', ...previous.searchList],
        });
        if (previous.defaultKeychain !== null) {
            cmds.push({
                label: 'restore default keychain',
                argv: ['security', 'default-keychain', '-d', 'user', '-s', previous.defaultKeychain],
            });
        }
    }
    cmds.push({ label: 'delete-keychain', argv: ['security', 'delete-keychain', keychain] });
    return cmds;
}

/** Quoted paths of `security list-keychains` / `default-keychain` output. */
export function parseKeychainList(stdout: string): string[] {
    return [...stdout.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '');
}

/**
 * The common name of the first identity in `security find-identity` output,
 * e.g. `Developer ID Application: Example Org (TEAMID1234)`. Public in every
 * signed file, so printing it is fine.
 */
export function parseIdentityName(stdout: string): string | null {
    const m = /^\s*\d+\)\s+[0-9A-Fa-f]+\s+"([^"]+)"/m.exec(stdout);
    return m === null ? null : (m[1] ?? null);
}

/**
 * Replace every known secret value (and its base64 form) in `text` with
 * `***`. Applied to everything we print or throw that a child process
 * influenced, because a tool's error output sometimes echoes its input.
 */
export function scrub(text: string, secrets: readonly string[]): string {
    let out = text;
    for (const secret of secrets) {
        if (secret.length < 3) continue;
        for (const form of [secret, Buffer.from(secret).toString('base64')]) {
            out = out.split(form).join('***');
        }
    }
    return out;
}
