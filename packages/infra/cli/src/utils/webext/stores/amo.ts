// The addons.mozilla.org (AMO) backend: addons-server API v5, "Submission API".
//
// DOCUMENTED against https://mozilla.github.io/addons-server/topics/api/ — `auth.html`
// (JWT) and `addons.html` (Upload Create/Detail, Version Create/Detail, Version Sources,
// Add-on Detail), plus https://extensionworkshop.com/documentation/publish/source-code-submission/,
// read 2026-11-19. Nothing here has been sent to Mozilla yet.
//
// THE FLOW FOR AN ALREADY-EXISTING LISTED ADD-ON, and how it maps onto the three verbs:
//
//   upload()   POST /upload/ (multipart: upload=<zip>, channel=listed) → a uuid. The package is
//              then VALIDATED asynchronously; {@link StoreBackend.operation} reads
//              GET /upload/<uuid>/ until `processed` and checks `valid`. This creates NO version
//              and enters NO review: an upload is a validated, unused package. That is the honest
//              equivalent of Chrome's/Edge's "draft" (ADR 0148).
//   publish()  POST /addons/addon/<id>/versions/ {upload: uuid, approval_notes?}. For a LISTED
//              channel this is what puts the version into review, which is why `submit` never
//              calls it without `--submit`. If a source archive is given it is attached by a
//              second request (PATCH multipart `source`), because the docs say a multipart body
//              cannot carry the complex fields and only name `source`/`upload`/`license` there.
//
// WHAT IS NOT DOCUMENTED and is therefore a guess named as one:
//  - the shape of `validation` ("the validation results JSON blob"): {@link validationLines}
//    reads `messages[].message` defensively and falls back to the raw type counts;
//  - how long an unused upload stays valid;
//  - that GET .../versions/v<number>/ answers 404 for an unknown number (the docs give no status
//    for it; 404 is the usual DRF reply), used for the "already there" check. The `v` prefix is
//    DOCUMENTED: a number without a dot is otherwise read as a version id, and forces a number lookup.

import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import {
    redactHeaders,
    redactSecrets,
    secretValuesOf,
    StoreApiError,
    StoreVersionAlreadyThereError,
    type StoreBackend,
    type StoreBackendFactory,
    type StoreBackendOptions,
    type StoreCredentials,
    type StoreListingFieldResult,
    type StoreListingInput,
    type StoreListingResult,
    type StoreOperationKind,
    type StoreOperationResult,
    type StorePublishInput,
    type StorePublishResult,
    type StoreStatusResult,
    type StoreUploadInput,
    type StoreUploadResult,
} from './index.js';

const STORE = 'amo' as const;
const API_ROOT = 'https://addons.mozilla.org/api/v5';

/** Longest slice of vendor text a message carries. */
const MAX_VENDOR_TEXT = 400;

/** AMO accepts a JWT for at most five minutes (auth.html); a minute is plenty for one request. */
const JWT_LIFETIME_S = 60;

const AUTH_HINT =
    'the JWT was rejected — check AMO_WEB_EXT_API_KEY / AMO_WEB_EXT_API_SECRET (addons.mozilla.org → Developer Hub → ' +
    "Manage API Keys) and that this machine's clock is correct; AMO refuses a JWT whose iat/exp are off.";

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

/**
 * An HS256 JWT as auth.html describes it: `iss` = API key, `jti` unique per token, `iat` now (UTC
 * seconds), `exp` ≤ iat + 5 min. Exported for the spec, which verifies the signature itself.
 */
export function signJwt(key: string, secret: string, nowMs: number): string {
    const iat = Math.floor(nowMs / 1000);
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = b64url(
        JSON.stringify({ iss: key, jti: randomBytes(16).toString('hex'), iat, exp: iat + JWT_LIFETIME_S }),
    );
    const signature = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
    return `${header}.${payload}.${b64url(signature)}`;
}

interface AmoUploadBody {
    readonly uuid?: string;
    readonly processed?: boolean;
    readonly submitted?: boolean;
    readonly valid?: boolean;
    readonly validation?: unknown;
    readonly version?: string;
}

/** AMO normalises line endings and outer whitespace in translated text, so compare on that. */
const sameText = (a: string, b: string): boolean => normalizeText(a) === normalizeText(b);
export const normalizeText = (text: string): string => text.replace(/\r\n/g, '\n').trim();

/** The error lines of a `validation` blob, whatever its exact shape. */
export function validationLines(validation: unknown): string[] {
    if (typeof validation !== 'object' || validation === null) return [];
    const messages = (validation as { messages?: unknown }).messages;
    if (!Array.isArray(messages)) return [];
    const lines: string[] = [];
    for (const item of messages) {
        if (typeof item !== 'object' || item === null) continue;
        const m = item as { type?: unknown; message?: unknown; description?: unknown };
        if (m.type !== undefined && m.type !== 'error') continue;
        if (typeof m.message === 'string') lines.push(m.message);
        else if (typeof m.description === 'string') lines.push(m.description);
    }
    return lines;
}

export const createAmoBackend: StoreBackendFactory = (
    credentials: StoreCredentials,
    options: StoreBackendOptions = {},
): StoreBackend => {
    const addonId = credentials['AMO_ADDON_ID']!;
    const apiKey = credentials['AMO_WEB_EXT_API_KEY']!;
    const apiSecret = credentials['AMO_WEB_EXT_API_SECRET']!;
    const secrets = secretValuesOf(STORE, credentials);
    const now = options.now ?? ((): number => Date.now());
    const addon = `${API_ROOT}/addons/addon/${encodeURIComponent(addonId)}`;

    const clean = (text: string): string => redactSecrets(text, secrets).slice(0, MAX_VENDOR_TEXT);

    /** State carried from `upload()` to `publish()` and `status()` within one run. */
    let lastUpload: { uuid: string; version: string } | null = null;

    async function send(
        method: 'GET' | 'POST' | 'PATCH',
        url: string,
        extra: { json?: unknown; form?: FormData } = {},
        acceptable: readonly number[] = [],
    ): Promise<Response> {
        const headers: Record<string, string> = { Authorization: `JWT ${signJwt(apiKey, apiSecret, now())}` };
        let body: BodyInit | undefined;
        if (extra.json !== undefined) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(extra.json);
        } else if (extra.form !== undefined) {
            // No Content-Type: fetch sets the multipart boundary itself.
            body = extra.form;
        }
        options.log?.(`${method} ${url} ${JSON.stringify(redactHeaders(headers))}`);
        const fetchImpl = options.fetchImpl ?? globalThis.fetch;
        let response: Response;
        try {
            response = await fetchImpl(url, { method, headers, body });
        } catch (error) {
            throw new StoreApiError(STORE, undefined, clean(error instanceof Error ? error.message : String(error)));
        }
        options.log?.(`  → HTTP ${response.status}`);
        if ((response.status >= 200 && response.status < 300) || acceptable.includes(response.status)) return response;
        const text = await response.text().catch(() => '');
        throw new StoreApiError(STORE, response.status, failureDetail(response.status, text));
    }

    function failureDetail(status: number, text: string): string {
        const body = clean(text.trim());
        const said = body === '' ? '' : ` Store said: ${body}`;
        if (status === 401) return AUTH_HINT + said;
        if (status === 403) return `the account is not an author of ${clean(addonId)}, or lacks permission.${said}`;
        if (status === 404) return `unknown add-on or version — check AMO_ADDON_ID (slug, numeric id or GUID).${said}`;
        if (status === 429) return 'throttled — too many requests; retry later.';
        return body === '' ? 'the store gave no reason.' : body;
    }

    async function json<T>(response: Response, what: string): Promise<T> {
        try {
            return JSON.parse(await response.text()) as T;
        } catch {
            throw new StoreApiError(STORE, response.status, `${what} answered something that is not JSON.`);
        }
    }

    async function versionExists(version: string): Promise<boolean> {
        const response = await send('GET', `${addon}/versions/v${encodeURIComponent(version)}/`, {}, [404]);
        return response.status !== 404;
    }

    /** Classifies a finished validation: throws for a refusal, returns for a valid package. */
    function judge(body: AmoUploadBody, version: string): void {
        if (body.valid === true) return;
        const lines = validationLines(body.validation).map(clean);
        if (lines.some((line) => /already exists/i.test(line))) throw new StoreVersionAlreadyThereError(STORE, version);
        throw new StoreApiError(
            STORE,
            200,
            lines.length === 0
                ? 'AMO validation rejected the package and gave no message.'
                : `AMO validation rejected the package: ${lines.join(' | ')}`,
        );
    }

    async function upload(input: StoreUploadInput): Promise<StoreUploadResult> {
        if (await versionExists(input.version)) throw new StoreVersionAlreadyThereError(STORE, input.version);
        const form = new FormData();
        form.append('upload', new Blob([new Uint8Array(readFileSync(input.zipPath))]), basename(input.zipPath));
        form.append('channel', 'listed');
        const response = await send('POST', `${API_ROOT}/addons/upload/`, { form });
        const body = await json<AmoUploadBody>(response, 'the upload');
        if (typeof body.uuid !== 'string' || body.uuid === '') {
            throw new StoreApiError(STORE, response.status, 'the upload answered without a uuid.');
        }
        lastUpload = { uuid: body.uuid, version: input.version };
        if (body.processed === true) {
            judge(body, input.version);
            return {
                operationId: body.uuid,
                ingested: true,
                detail: `upload ${body.uuid} validated; no version created.`,
            };
        }
        return {
            operationId: body.uuid,
            ingested: false,
            detail: `HTTP ${response.status} — upload ${body.uuid} is being validated.`,
        };
    }

    async function operation(
        kind: StoreOperationKind,
        operationId: string,
        version?: string,
    ): Promise<StoreOperationResult> {
        if (kind !== 'upload') {
            throw new StoreApiError(
                STORE,
                undefined,
                'AMO has no publish operation to read; a version create answers directly.',
            );
        }
        const response = await send('GET', `${API_ROOT}/addons/upload/${encodeURIComponent(operationId)}/`);
        const body = await json<AmoUploadBody>(response, 'the upload detail');
        if (body.processed !== true) {
            return { state: 'in-progress', detail: `upload ${operationId} is still being validated.` };
        }
        judge(body, version ?? body.version ?? 'in the upload');
        return { state: 'succeeded', detail: `upload ${operationId} passed validation; no version created yet.` };
    }

    async function publish(input: StorePublishInput): Promise<StorePublishResult> {
        if (lastUpload === null) {
            throw new StoreApiError(STORE, undefined, 'publish needs an upload from this run; none was made.');
        }
        const created = await send('POST', `${addon}/versions/`, {
            json: {
                upload: lastUpload.uuid,
                ...(input.notes === undefined || input.notes === '' ? {} : { approval_notes: input.notes }),
            },
        });
        const version = await json<{ id?: number; version?: string }>(created, 'the version create');
        const ref = version.id ?? input.version;
        if (input.sourceZip !== undefined) {
            const form = new FormData();
            form.append('source', new Blob([new Uint8Array(readFileSync(input.sourceZip))]), basename(input.sourceZip));
            await send('PATCH', `${addon}/versions/${encodeURIComponent(String(ref))}/`, { form });
        }
        return {
            state: 'in-review',
            detail:
                `HTTP ${created.status} — version ${input.version} created from upload ${lastUpload.uuid}, which puts it into review` +
                (input.sourceZip === undefined ? ' (no source archive attached).' : '; source archive attached.'),
        };
    }

    async function status(): Promise<StoreStatusResult> {
        if (lastUpload === null) {
            const response = await send('GET', `${addon}/`);
            const body = await json<{ current_version?: { version?: string } }>(response, 'the add-on detail');
            return {
                state: 'unknown',
                version: body.current_version?.version,
                detail: `AMO reports ${body.current_version?.version ?? 'no public version'} as the current version.`,
            };
        }
        const { version } = lastUpload;
        const response = await send('GET', `${addon}/versions/v${encodeURIComponent(version)}/`, {}, [404]);
        if (response.status === 404) {
            return { state: 'draft', version, detail: `AMO has no version ${version}; only a validated upload.` };
        }
        const body = await json<{ file?: { status?: string } }>(response, 'the version detail');
        const fileStatus = body.file?.status;
        return {
            state: fileStatus === 'public' ? 'published' : 'in-review',
            version,
            detail: `AMO has version ${version} with file status ${clean(String(fileStatus))}.`,
        };
    }

    async function verifyCredentials(): Promise<void> {
        await send('GET', `${addon}/`);
    }

    /** A version id is digits; anything else is a version number, which AMO wants as `v<number>`. */
    const versionRef = (version: string): string =>
        /^\d+$/.test(version) ? version : `v${encodeURIComponent(version)}`;

    /** A GET whose failure means "not established", never a failure of the write that preceded it. */
    async function readBack<T>(url: string, what: string): Promise<{ body: T } | { unread: string }> {
        try {
            return { body: await json<T>(await send('GET', url), what) };
        } catch (error) {
            // The write already succeeded; a failed read must be reported as unread, not thrown.
            if (error instanceof StoreApiError) return { unread: error.message };
            throw error;
        }
    }

    function compareLocales(
        field: string,
        sent: Readonly<Record<string, string>>,
        stored: unknown,
        read: { unread: string } | null,
    ): StoreListingFieldResult[] {
        return Object.entries(sent).map(([locale, text]) => {
            const base = { field, locale, sent: text.length };
            if (read !== null) return { ...base, verdict: 'unread' as const, detail: read.unread };
            if (typeof stored !== 'object' || stored === null) {
                return { ...base, verdict: 'unread' as const, detail: `AMO returned no per-locale ${field}.` };
            }
            const value = (stored as Record<string, unknown>)[locale];
            if (typeof value !== 'string') {
                return { ...base, verdict: 'mismatch' as const, detail: `AMO holds no ${field} for ${locale}.` };
            }
            return sameText(value, text)
                ? { ...base, verdict: 'match' as const, detail: `read back ${value.length} chars.` }
                : {
                      ...base,
                      verdict: 'mismatch' as const,
                      detail: `AMO holds ${value.length} chars, sent ${text.length}.`,
                  };
        });
    }

    async function updateListing(input: StoreListingInput): Promise<StoreListingResult> {
        // `name` is never sent: AMO takes it from the manifest. `privacy_policy` is ignored here — it has its own endpoint.
        await send('PATCH', `${addon}/`, { json: { summary: input.summary, description: input.description } });
        if (input.privacyPolicy !== undefined) {
            await send('PATCH', `${addon}/eula_policy/`, { json: { privacy_policy: input.privacyPolicy } });
        }
        const notes = input.approvalNotes;
        const versionUrl = notes === undefined ? '' : `${addon}/versions/${versionRef(notes.version)}/`;
        if (notes !== undefined) await send('PATCH', versionUrl, { json: { approval_notes: notes.text } });

        const fields: StoreListingFieldResult[] = [];
        const detail = await readBack<{ summary?: unknown; description?: unknown }>(`${addon}/`, 'the add-on detail');
        const unread = 'unread' in detail ? detail : null;
        const stored = 'body' in detail ? detail.body : {};
        fields.push(...compareLocales('summary', input.summary, stored.summary, unread));
        fields.push(...compareLocales('description', input.description, stored.description, unread));
        if (input.privacyPolicy !== undefined) {
            const policy = await readBack<{ privacy_policy?: unknown }>(`${addon}/eula_policy/`, 'the eula_policy');
            fields.push(
                ...compareLocales(
                    'privacy_policy',
                    input.privacyPolicy,
                    'body' in policy ? policy.body.privacy_policy : undefined,
                    'unread' in policy ? policy : null,
                ),
            );
        }
        if (notes !== undefined) {
            const version = await readBack<{ approval_notes?: unknown }>(versionUrl, 'the version detail');
            const base = { field: 'approval_notes', sent: notes.text.length };
            if ('unread' in version) fields.push({ ...base, verdict: 'unread', detail: version.unread });
            else if (typeof version.body.approval_notes !== 'string') {
                fields.push({ ...base, verdict: 'unread', detail: 'AMO returned no approval_notes.' });
            } else if (sameText(version.body.approval_notes, notes.text)) {
                fields.push({
                    ...base,
                    verdict: 'match',
                    detail: `read back ${version.body.approval_notes.length} chars.`,
                });
            } else {
                fields.push({
                    ...base,
                    verdict: 'mismatch',
                    detail: `AMO holds ${version.body.approval_notes.length} chars.`,
                });
            }
        }
        return { fields };
    }

    return { store: STORE, upload, publish, status, operation, verifyCredentials, updateListing };
};
