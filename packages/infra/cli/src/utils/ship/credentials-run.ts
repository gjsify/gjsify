// The effectful half of `gjsify ship credentials` (ADR 0126): runs the plans
// from `credentials.ts` against `gh`, `security` and `xcrun`.
//
// Three rules from the ADR hold for every verb here, and the tests pin each:
//   - a secret is never in OUR argv or output, nor in a thrown message: child
//     output is scrubbed of the known values, and an error names the step, not
//     the command line (the one exception, `security import -P`, is documented
//     at `planDarwinInstall`);
//   - a secret is written to disk only under a 0700 directory that this same
//     run removes, also on failure and on a signal;
//   - `--dry-run` prints the plan with values as `$NAME` and touches nothing.
//
// Child processes run through `spawnSync`: a credential step is blocking by
// nature, it arms no event loop under GJS, and the value goes in via `input`
// (stdin), never argv.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isOnPath } from '../check-system-deps.js';
import { promptHidden, promptLine } from '../prompt.js';
import {
    CREDENTIALS,
    KEYCHAIN_PASSWORD_REF,
    evaluateCheck,
    parseIdentityName,
    parseKeychainList,
    parseNameList,
    planDarwinInstall,
    planDarwinRemove,
    planList,
    planUpload,
    renderCommand,
    resolveArgv,
    scrub,
    sourceOption,
    type CheckResult,
    type CredentialEntry,
    type CredentialSet,
    type KeychainPrevious,
    type PlannedCommand,
} from './credentials.js';
import { parseAzureIdentity, resolveAzureAccessToken } from './signing.js';
import type { HostOs } from './types.js';

const LOG = 'gjsify ship credentials:';
const KEYCHAIN_FILE = 'gjsify-signing.keychain-db';
const STATE_FILE = 'state.json';

export interface RunResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

export interface CredentialIo {
    env: NodeJS.ProcessEnv;
    out(line: string): void;
    err(line: string): void;
    prompt(question: string, hidden: boolean): Promise<string>;
    run(argv: readonly string[], opts: { input?: string; env: NodeJS.ProcessEnv }): RunResult;
    onPath(cmd: string): boolean;
    /** Called by the signal path after cleanup. Real: `process.exit`. */
    exit(code: number): void;
    ci: boolean;
    /** Holds the keychain and `state.json` from `install` until `install --remove`. */
    stateDir: string;
    /** Parent of the short-lived key-file directory. */
    scratchRoot: string;
}

export function defaultIo(): CredentialIo {
    return {
        env: process.env,
        out: (line) => console.log(line),
        err: (line) => console.error(line),
        prompt: (question, hidden) => (hidden ? promptHidden(question) : promptLine(question)),
        run: (argv, opts) => {
            const [cmd, ...rest] = argv;
            const r = spawnSync(cmd ?? '', rest, {
                input: opts.input,
                env: opts.env,
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
        },
        onPath: (cmd) => isOnPath(cmd),
        exit: (code) => process.exit(code),
        ci: process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true',
        stateDir: join(tmpdir(), 'gjsify-ship-credentials-darwin'),
        scratchRoot: tmpdir(),
    };
}

/** A failure whose message is already safe to print. */
class CredentialError extends Error {}

function setFor(io: CredentialIo, os: string): { os: HostOs; set: CredentialSet } | null {
    // `windows` is the layout spelling `ship` prints; `win32` is the key.
    const key = (os === 'windows' ? 'win32' : os) as HostOs;
    const set = CREDENTIALS[key];
    if (set === undefined) {
        io.err(`${LOG} no credential set for "${os}" (known: ${Object.keys(CREDENTIALS).join(', ')}).`);
        return null;
    }
    return { os: key, set };
}

function exec(
    io: CredentialIo,
    cmd: PlannedCommand,
    values: Readonly<Record<string, string>>,
    secrets: readonly string[],
): RunResult {
    const argv = resolveArgv(cmd.argv, values);
    const input = cmd.stdin === undefined ? undefined : values[cmd.stdin.ref];
    const r = io.run(argv, { input, env: io.env });
    if (r.status !== 0) {
        const why = r.status === null ? `could not start \`${argv[0]}\`` : `exit ${r.status}`;
        const detail = scrub(r.stderr, secrets).trim().split('\n').slice(0, 5).join('\n');
        throw new CredentialError(`${cmd.label} failed (${why})${detail === '' ? '' : `:\n${detail}`}`);
    }
    return r;
}

function yieldToLoop(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Run `fn` with SIGINT / SIGTERM / SIGHUP wired to `cleanup` + `io.exit`.
 * `fn` gets an `aborted()` probe: the steps are blocking, so a signal is only
 * delivered at the yields between them, and the loop must stop once it has.
 */
async function withSignalCleanup<T>(
    io: CredentialIo,
    cleanup: () => void,
    fn: (aborted: () => boolean) => Promise<T>,
): Promise<T> {
    let aborted = false;
    const handlers = new Map<NodeJS.Signals, () => void>();
    for (const [signal, code] of [
        ['SIGINT', 130],
        ['SIGTERM', 143],
        ['SIGHUP', 129],
    ] as const) {
        const handler = (): void => {
            aborted = true;
            cleanup();
            io.exit(code);
        };
        handlers.set(signal, handler);
        process.on(signal, handler);
    }
    try {
        return await fn(() => aborted);
    } finally {
        for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    }
}

// ─── upload ─────────────────────────────────────────────────────────────────

export interface UploadOptions {
    os: string;
    repo?: string;
    dryRun: boolean;
    /** Parsed option values by generated option name, e.g. `p12-password-env`. */
    sources: Readonly<Record<string, string | undefined>>;
}

async function readEntryValue(io: CredentialIo, entry: CredentialEntry, o: UploadOptions): Promise<string> {
    const given = (['file', 'env'] as const).flatMap((source) => {
        const v = entry.sources.includes(source) ? o.sources[sourceOption(entry, source)] : undefined;
        return v === undefined ? [] : [{ source, v }];
    });
    if (given.length > 1) {
        throw new CredentialError(
            `${entry.name}: give one source, not ${given.map((g) => `--${sourceOption(entry, g.source)}`).join(' and ')}.`,
        );
    }
    let raw: string;
    const only = given[0];
    if (only?.source === 'file') {
        const bytes = readFileSync(only.v);
        if (entry.transform === 'base64') return bytes.toString('base64');
        raw = bytes.toString('utf8');
    } else if (only?.source === 'env') {
        const v = io.env[only.v];
        if (v === undefined || v === '')
            throw new CredentialError(`${entry.name}: environment variable ${only.v} is not set.`);
        raw = v;
    } else if (entry.sources.includes('prompt')) {
        raw = await io.prompt(`${entry.label}: `, entry.kind === 'secret');
    } else {
        const options = entry.sources
            .filter((s) => s !== 'prompt')
            .map((s) => `--${sourceOption(entry, s as 'file' | 'env')}`);
        throw new CredentialError(`${entry.name}: no source — give ${options.join(' or ')}.`);
    }
    if (entry.transform === 'line') raw = raw.replace(/\r?\n$/, '');
    if (raw === '') throw new CredentialError(`${entry.name}: the value is empty.`);
    return raw;
}

export async function runUpload(io: CredentialIo, o: UploadOptions): Promise<number> {
    const found = setFor(io, o.os);
    if (found === null) return 1;
    if (o.repo === undefined || o.repo === '') {
        io.err(`${LOG} upload needs --repo <owner/name>.`);
        return 1;
    }
    const repo = o.repo;
    if (o.dryRun) {
        for (const entry of found.set.entries) io.out(renderCommand(planUpload(entry, repo)));
        return 0;
    }
    const values: Record<string, string> = {};
    try {
        // Resolve everything BEFORE the first `gh` call: a missing third value
        // must not leave a repository holding two thirds of a set.
        for (const entry of found.set.entries) values[entry.name] = await readEntryValue(io, entry, o);
        const secrets = Object.values(values);
        for (const entry of found.set.entries) {
            exec(io, planUpload(entry, repo), values, secrets);
            io.out(`${LOG} set ${entry.kind} ${entry.name}`);
        }
        return 0;
    } catch (e) {
        io.err(`${LOG} ${scrub(e instanceof Error ? e.message : String(e), Object.values(values))}`);
        return 1;
    }
}

// ─── check ──────────────────────────────────────────────────────────────────

export interface CheckOptions {
    os: string;
    repo?: string;
    json: boolean;
}

export function runCheck(io: CredentialIo, o: CheckOptions): number {
    const found = setFor(io, o.os);
    if (found === null) return 1;
    const present = new Set<string>();
    try {
        if (o.repo !== undefined && o.repo !== '') {
            for (const kind of new Set(found.set.entries.map((e) => e.kind))) {
                const r = exec(io, planList(kind, o.repo), {}, []);
                for (const name of parseNameList(r.stdout)) present.add(name);
            }
        } else {
            for (const e of found.set.entries) if ((io.env[e.name] ?? '') !== '') present.add(e.name);
        }
    } catch (e) {
        io.err(`${LOG} ${e instanceof Error ? e.message : String(e)}`);
        return 1;
    }
    const result = evaluateCheck(found.os, found.set, present);
    if (o.json) {
        io.out(JSON.stringify(result));
    } else {
        io.out(describeCheck(result));
    }
    return result.complete ? 0 : 1;
}

function describeCheck(r: CheckResult): string {
    if (r.complete) return `${LOG} ${r.os}: complete (${r.present.join(', ')})`;
    if (r.present.length === 0) return `${LOG} ${r.os}: none present — missing ${r.missing.join(', ')}`;
    return `${LOG} ${r.os}: PARTIAL — present ${r.present.join(', ')}; missing ${r.missing.join(', ')}`;
}

// ─── install ────────────────────────────────────────────────────────────────

export interface InstallOptions {
    os: string;
    remove: boolean;
    dryRun: boolean;
    force: boolean;
    /** Signing identity for the win32 probes; the caller falls back to the config. */
    sign?: string;
}

export async function runInstall(io: CredentialIo, o: InstallOptions): Promise<number> {
    const found = setFor(io, o.os);
    if (found === null) return 1;
    if (found.os === 'darwin') return o.remove ? removeDarwin(io, false) : installDarwin(io, found.set, o);
    if (found.os === 'win32') return installWin32(io, found.set, o);
    io.err(`${LOG} install is not implemented for ${found.os}.`);
    return 1;
}

async function installDarwin(io: CredentialIo, set: CredentialSet, o: InstallOptions): Promise<number> {
    for (const tool of ['security', 'xcrun']) {
        if (!io.onPath(tool)) {
            io.err(`${LOG} \`${tool}\` is not on PATH — install darwin runs on a macOS host.`);
            return 1;
        }
    }
    if (!o.dryRun && !io.ci && !o.force) {
        io.err(
            `${LOG} refusing to run outside CI: install makes a new keychain the user's default. ` +
                'Pass --force if this machine is meant to be changed, and `install darwin --remove` restores it.',
        );
        return 1;
    }

    const keychain = join(io.stateDir, KEYCHAIN_FILE);
    if (o.dryRun) {
        const plan = planDarwinInstall({
            keychain,
            p12File: '<scratch>/developer-id.p12',
            p8File: '<scratch>/notary.p8',
            previous: { defaultKeychain: '<previous default>', searchList: ['<previous search list>'] },
        });
        io.out('security list-keychains -d user');
        io.out('security default-keychain -d user');
        for (const cmd of [...plan.setup, plan.notary, plan.identity]) io.out(renderCommand(cmd));
        return 0;
    }

    const missing = set.entries.filter((e) => (io.env[e.name] ?? '') === '').map((e) => e.name);
    if (missing.length > 0) {
        io.err(`${LOG} missing in the environment: ${missing.join(', ')} (run \`ship credentials check darwin\`).`);
        return 1;
    }
    const values: Record<string, string> = {};
    for (const e of set.entries) values[e.name] = io.env[e.name] ?? '';
    values[KEYCHAIN_PASSWORD_REF] = randomBytes(24).toString('hex');
    const secrets = Object.values(values);

    if (existsSync(io.stateDir)) {
        io.err(
            `${LOG} ${io.stateDir} already exists — an earlier install is still in place. Run \`install darwin --remove\` first.`,
        );
        return 1;
    }
    mkdirSync(io.stateDir, { mode: 0o700 });
    chmodSync(io.stateDir, 0o700);
    const scratch = mkdtempSync(join(io.scratchRoot, 'gjsify-keys-'));
    chmodSync(scratch, 0o700);

    let done = false;
    const cleanup = (): void => {
        rmSync(scratch, { recursive: true, force: true });
        if (!done) removeDarwin(io, true);
        done = true;
    };

    try {
        return await withSignalCleanup(io, cleanup, async (aborted) => {
            const p12File = join(scratch, 'developer-id.p12');
            const p8File = join(scratch, 'notary.p8');
            writeFileSync(p12File, Buffer.from(values.APPLE_DEVELOPER_ID_P12_BASE64 ?? '', 'base64'), { mode: 0o600 });
            writeFileSync(p8File, values.APPLE_NOTARY_KEY_P8 ?? '', { mode: 0o600 });

            // Remembered BEFORE anything changes, so a rollback at any later step can restore it.
            const searchList = parseKeychainList(
                exec(
                    io,
                    { label: 'list-keychains', argv: ['security', 'list-keychains', '-d', 'user'] },
                    values,
                    secrets,
                ).stdout,
            );
            const defaults = parseKeychainList(
                exec(
                    io,
                    { label: 'default-keychain', argv: ['security', 'default-keychain', '-d', 'user'] },
                    values,
                    secrets,
                ).stdout,
            );
            const previous: KeychainPrevious = { defaultKeychain: defaults[0] ?? null, searchList };
            writeFileSync(join(io.stateDir, STATE_FILE), JSON.stringify({ keychain, previous }), { mode: 0o600 });

            const plan = planDarwinInstall({ keychain, p12File, p8File, previous });
            for (const cmd of [...plan.setup, plan.notary]) {
                await yieldToLoop();
                if (aborted()) return 1;
                exec(io, cmd, values, secrets);
                // The key files go the moment nothing needs them (§ D1 step 7).
                if (cmd === plan.notary) rmSync(scratch, { recursive: true, force: true });
            }
            const identity = parseIdentityName(exec(io, plan.identity, values, secrets).stdout);
            if (identity === null)
                throw new CredentialError('the keychain holds no code-signing identity after the import.');
            done = true;
            io.out(`${LOG} darwin installed: signing identity ${identity}`);
            return 0;
        });
    } catch (e) {
        io.err(`${LOG} ${scrub(e instanceof Error ? e.message : String(e), secrets)}`);
        return 1;
    } finally {
        if (!done) cleanup();
        rmSync(scratch, { recursive: true, force: true });
    }
}

/** Restore the keychain state saved by `install` and delete what it made. Best effort when `quiet`. */
function removeDarwin(io: CredentialIo, quiet: boolean): number {
    if (!existsSync(io.stateDir)) {
        if (!quiet) io.out(`${LOG} nothing to remove.`);
        return 0;
    }
    let previous: KeychainPrevious | null = null;
    try {
        previous = (JSON.parse(readFileSync(join(io.stateDir, STATE_FILE), 'utf8')) as { previous: KeychainPrevious })
            .previous;
    } catch {
        // No readable state: only the keychain itself can be deleted.
    }
    const keychain = join(io.stateDir, KEYCHAIN_FILE);
    let code = 0;
    for (const cmd of planDarwinRemove(keychain, previous)) {
        if (cmd.label === 'delete-keychain' && !existsSync(keychain)) continue;
        try {
            exec(io, cmd, {}, []);
        } catch (e) {
            code = 1;
            if (!quiet) io.err(`${LOG} ${e instanceof Error ? e.message : String(e)}`);
        }
    }
    rmSync(io.stateDir, { recursive: true, force: true });
    if (!quiet && code === 0) io.out(`${LOG} darwin keychain removed, defaults restored.`);
    return code;
}

/** ADR 0126 § D4: nothing to import with federated login, so install is `check` plus probes. */
async function installWin32(io: CredentialIo, set: CredentialSet, o: InstallOptions): Promise<number> {
    if (o.remove) {
        io.out(`${LOG} win32 stores nothing on the host, so --remove has nothing to undo.`);
        return 0;
    }
    if (o.dryRun) {
        io.out('probe: jsign and java on PATH');
        io.out('probe: signing identity parses (azure:<host>#<account>/<profile>)');
        io.out(`probe: an access token is obtainable (${'AZURE_ACCESS_TOKEN'} or \`az account get-access-token\`)`);
        io.out(`probe: ${set.entries.map((e) => e.name).join(', ')} present in the environment`);
        return 0;
    }
    const problems: string[] = [];
    for (const tool of ['jsign', 'java']) if (!io.onPath(tool)) problems.push(`\`${tool}\` is not on PATH`);
    if (o.sign === undefined || o.sign === '') {
        problems.push('no signing identity — pass --sign or set gjsify.ship.sign.win32.identity');
    } else {
        try {
            parseAzureIdentity(o.sign);
        } catch (e) {
            problems.push(e instanceof Error ? e.message : String(e));
        }
    }
    try {
        await resolveAzureAccessToken(io.env);
    } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e));
    }
    const present = new Set(set.entries.filter((e) => (io.env[e.name] ?? '') !== '').map((e) => e.name));
    const check = evaluateCheck('win32', set, present);
    if (!check.complete) problems.push(`missing in the environment: ${check.missing.join(', ')}`);
    if (problems.length > 0) {
        for (const p of problems) io.err(`${LOG} ${p}`);
        return 1;
    }
    io.out(`${LOG} win32 ready: jsign, java, identity and access token all resolve.`);
    return 0;
}
