// The logic of `gjsify webext submit` (ADR 0077 § Amendment 1): every refusal that
// needs no network, in the order that keeps a bad run away from the store, then
// ONE call into the poll layer. The subcommand in `commands/webext/subcommands.ts`
// only builds a {@link SubmitProject} and prints nothing itself.
//
// ORDER, because a refusal after a network call is a refusal too late:
//   store known and implemented → `--submit` only on a tag → `store.json`
//   preflight → zip exists (upload only) → credentials → [dry-run: one read]
//   or [drive: upload, optionally publish].
//
// `store.json` is a PREFLIGHT, never a payload (ADR 0135): neither store takes
// listing text through its API, so nothing from it is sent. It only stops a
// release whose listing the dashboard would refuse a day later.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
    asStoreId,
    createStoreBackend,
    redactSecrets,
    STORE_CREDENTIALS,
    StoreUnsupportedError,
    STORES,
    type EnvLike,
    type StoreBackend,
    type StoreBackendOptions,
    type StoreId,
} from './stores/index.js';
import { driveSubmission, SUBMIT_EXIT_CODES, type SubmitResult } from './stores/poll.js';
import type { WebextTarget } from './targets.js';

/** The slice of `ResolvedWebext` this command reads, so a spec needs no project on disk. */
export interface SubmitProject {
    readonly root: string;
    readonly name: string;
    readonly version: string;
    readonly outDir: string;
    readonly targets: readonly WebextTarget[];
}

export interface SubmitCommandInput {
    readonly store: string;
    /** Absolute or cwd-relative zip; default is what `webext zip` writes for the store's target. */
    readonly zip?: string;
    readonly dryRun: boolean;
    readonly submit: boolean;
    readonly timeoutSeconds?: number;
    /** Where `webext listing` wrote its output (default `dist/listing` under the project root). */
    readonly listingDir?: string;
    readonly project: SubmitProject;
    readonly env: EnvLike;
    readonly createBackend?: (store: StoreId, env: EnvLike, options?: StoreBackendOptions) => StoreBackend;
    readonly fetchImpl?: typeof fetch;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly now?: () => number;
    readonly out: (line: string) => void;
    readonly err: (line: string) => void;
}

/** `webext listing` names the Chrome store `cws`. */
const LISTING_STORE: Readonly<Partial<Record<StoreId, string>>> = { chrome: 'cws', edge: 'edge' };

export function isTagRef(ref: string | undefined): boolean {
    return ref !== undefined && ref.startsWith('refs/tags/') && ref.length > 'refs/tags/'.length;
}

/** The zip `webext zip` writes for this store's target (see `buildWebext`). */
export function defaultZipPath(project: SubmitProject, store: StoreId): string {
    const target = project.targets.find((t) => t.browser === store);
    if (target === undefined) {
        throw new Error(
            `gjsify webext submit: gjsify.webext.targets has no ${store} target, so there is no zip to derive. ` +
                `Add ${store}-mv3 or pass --zip.`,
        );
    }
    return join(project.outDir, `${project.name}-${project.version}-${target.id}.zip`);
}

export interface StoreJsonPreflight {
    /** Reasons to stop. Empty = go. */
    readonly problems: readonly string[];
    /** Fields only the person can fill in the dashboard; informational. */
    readonly manual: readonly string[];
}

/** Checks a `store.json` text against what `StoreManifest` promises; pure so a spec needs no disk. */
export function preflightStoreJson(text: string, listingStore: string, path: string): StoreJsonPreflight {
    let json: unknown;
    try {
        json = JSON.parse(text);
    } catch {
        return { problems: [`${path} is not valid JSON — regenerate it with \`gjsify webext listing\`.`], manual: [] };
    }
    const doc = json as { version?: unknown; store?: unknown; fields?: unknown };
    if (doc.version !== 1 || !Array.isArray(doc.fields)) {
        return {
            problems: [`${path} is not a store.json (version 1) — regenerate it with \`gjsify webext listing\`.`],
            manual: [],
        };
    }
    if (doc.store !== listingStore) {
        return { problems: [`${path} is for store "${String(doc.store)}", expected "${listingStore}".`], manual: [] };
    }
    const problems: string[] = [];
    const manual: string[] = [];
    for (const field of doc.fields as { key?: string; label?: string; required?: boolean; status?: string }[]) {
        const name = field.label ?? field.key ?? '(unnamed field)';
        if (field.status === 'manual') manual.push(name);
        else if (field.required === true && field.status === 'missing') {
            problems.push(`required field "${name}" is missing in ${path}.`);
        }
    }
    return { problems, manual };
}

function secretsOf(store: StoreId, env: EnvLike): string[] {
    return STORE_CREDENTIALS[store]
        .filter((field) => field.secret)
        .map((field) => env[field.env])
        .filter((value): value is string => value !== undefined && value !== '');
}

function describeResult(result: SubmitResult, label: string): string[] {
    const lines = [`${label} ${result.version}: ${result.verdict} — ${result.detail}`];
    for (const phase of result.phases) {
        lines.push(`  ${phase.phase}: ${phase.detail} (${phase.requests} request(s), ${phase.elapsedMs} ms)`);
    }
    if (result.retryable) lines.push('  Calling again later, unchanged, can make progress.');
    return lines;
}

/** Runs the command and returns its exit code (`SUBMIT_EXIT_CODES` for a drive, 1 for any refusal). */
export async function runSubmit(input: SubmitCommandInput): Promise<number> {
    const { env, project } = input;
    const store = asStoreId(input.store);
    const secrets = store === null ? [] : secretsOf(store, env);
    const clean = (text: string): string => redactSecrets(text, secrets);
    const out = (line: string): void => input.out(clean(line));
    const err = (line: string): void => input.err(clean(line));

    try {
        if (store === null) throw new Error(`gjsify webext submit: unknown store "${input.store}".`);
        const descriptor = STORES[store];
        if (!descriptor.implemented) {
            throw new StoreUnsupportedError(
                store,
                'use `gjsify webext sign` for AMO; Firefox is distributed by the project itself',
            );
        }
        if (input.submit && !isTagRef(env['GITHUB_REF'])) {
            throw new Error(
                'gjsify webext submit: --submit asks the store for review and runs only on a tag ' +
                    '($GITHUB_REF must start with refs/tags/). Without --submit the zip is uploaded as a draft.',
            );
        }
        let timeoutMs: number | undefined;
        if (input.timeoutSeconds !== undefined) {
            if (!Number.isFinite(input.timeoutSeconds) || input.timeoutSeconds < 0) {
                throw new Error('gjsify webext submit: --timeout is a number of seconds, 0 or more.');
            }
            timeoutMs = input.timeoutSeconds * 1000;
        }

        const listingStore = LISTING_STORE[store] as string;
        const storeJson = join(resolve(project.root, input.listingDir ?? 'dist/listing'), listingStore, 'store.json');
        if (!existsSync(storeJson)) {
            throw new Error(
                `gjsify webext submit: ${storeJson} does not exist. Run \`gjsify webext listing --store ${listingStore}\` first; ` +
                    'it is the preflight for the listing the dashboard will ask about.',
            );
        }
        const pre = preflightStoreJson(readFileSync(storeJson, 'utf8'), listingStore, storeJson);
        if (pre.problems.length > 0) {
            throw new Error(
                `gjsify webext submit: preflight failed, nothing was sent:\n  ${pre.problems.join('\n  ')}`,
            );
        }
        if (pre.manual.length > 0) out(`  by hand in the dashboard: ${pre.manual.join(', ')}`);

        const zipPath = resolve(input.zip ?? defaultZipPath(project, store));
        if (!input.dryRun && !existsSync(zipPath)) {
            throw new Error(
                `gjsify webext submit: ${zipPath} does not exist. Run \`gjsify webext zip\` first or pass --zip.`,
            );
        }

        const log = env['GJSIFY_WEBEXT_DEBUG'] ? (msg: string): void => err(msg) : undefined;
        const options: StoreBackendOptions = { fetchImpl: input.fetchImpl, sleep: input.sleep, now: input.now, log };
        const backend = (input.createBackend ?? createStoreBackend)(store, env, options);

        if (input.dryRun) {
            if (backend.verifyCredentials === undefined) {
                out(
                    `${descriptor.label}: dry run — credentials are set; this backend has no read-only check, so they are unverified. Nothing was uploaded.`,
                );
                return 0;
            }
            await backend.verifyCredentials();
            out(
                `${descriptor.label}: dry run — credentials accepted (one read). ${existsSync(zipPath) ? 'The zip exists' : `No zip at ${zipPath} yet`}. Nothing was uploaded.`,
            );
            return 0;
        }

        const result = await driveSubmission(
            {
                backend,
                upload: { zipPath, version: project.version },
                publish: input.submit ? { version: project.version } : undefined,
            },
            { timeoutMs, sleep: input.sleep, now: input.now, log, secrets },
        );
        const write = result.exitCode === 0 ? out : err;
        for (const line of describeResult(result, descriptor.label)) write(line);
        return SUBMIT_EXIT_CODES[result.verdict];
    } catch (error) {
        err(error instanceof Error ? error.message : String(error));
        return 1;
    }
}
