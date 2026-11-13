// The Edge Add-ons backend: Update REST API v1.1 (ADR 0077 § Amendment 1).
//
// DOCUMENTED against learn.microsoft.com `microsoft-edge/extensions/update/api/`
// `using-addons-api` and `addons-api-reference` (ms.date 2024-09-19 / 2024-09-05),
// read 2026-11-13. Nothing here has been sent to Microsoft yet.
//
// Every write is a `202 Accepted` whose operation id is in the `Location` header,
// and the outcome is a SECOND request. This file performs one request per verb and
// POLLS NOTHING: {@link StoreBackend.operation} reads an operation once and says
// `in-progress` or `succeeded`, and the shared polling layer (step S5) loops on it.
//
// WHAT THE VENDOR PAGES DISAGREE ABOUT, and what this file does about it:
//
//  - Publish body. The overview page says "Notes for certification, in JSON
//    format" (and shows `{ "notes"="text value" }`, which is not valid JSON); the
//    reference says "in plain text format". Both are the vendor's words, so the
//    format is one constant, {@link PUBLISH_NOTES_FORMAT}. It is `json` because the
//    ADR and the overview's endpoint description say so; if the first real
//    submission answers 400, flip it to `text` and nothing else changes.
//  - The `Location` value. The reference says `Location: {operationID}` and the
//    PowerShell sample keeps the whole header. A real header might be a path or URL
//    ending in the id, so {@link operationIdFrom} keeps the last path segment — an
//    id that is already bare passes through unchanged.
//  - Key lifetime. The pages show an "Expiry" column and state no lifetime. The
//    72 days in {@link expiredKeyHint} come from Microsoft's announcement as relayed
//    to us and are UNVERIFIED against the docs.
//  - The status codes of the two operation GETs: the reference says 200, the
//    PowerShell sample tests for 202. Any 2xx is read.

import { readFileSync } from 'node:fs';

import {
    redactHeaders,
    redactSecrets,
    secretValuesOf,
    StoreApiError,
    StoreInReviewError,
    StoreVersionAlreadyThereError,
    type StoreBackend,
    type StoreBackendFactory,
    type StoreBackendOptions,
    type StoreCredentials,
    type StoreOperationKind,
    type StoreOperationResult,
    type StorePublishInput,
    type StorePublishResult,
    type StoreStatusResult,
    type StoreUploadInput,
    type StoreUploadResult,
} from './index.js';

const STORE = 'edge' as const;
const API_ROOT = 'https://api.addons.microsoftedge.microsoft.com';

/** How the publish body carries the certification notes. See the file header. */
export type PublishNotesFormat = 'json' | 'text';
export const PUBLISH_NOTES_FORMAT: PublishNotesFormat = 'json';

/** An operation id no product has: a GET on it answers 404 for a live key and 401 for a dead one. */
const UNKNOWN_OPERATION_ID = '00000000-0000-0000-0000-000000000000';

/** Longest slice of vendor text a message carries. */
const MAX_VENDOR_TEXT = 400;

const expiredKeyHint =
    'The API key was rejected. API keys expire (Microsoft announced 72 days — unverified in the API docs); ' +
    'renew it in Partner Center → Microsoft Edge → Publish API → "Create API credentials", then update EDGE_ADDONS_API_KEY.';

interface EdgeOperationBody {
    readonly status?: string;
    readonly message?: string | null;
    readonly errorCode?: string | null;
    readonly errors?: unknown;
}

/** The last path segment of a `Location` value, or null when there is none. */
export function operationIdFrom(location: string | null): string | null {
    if (location === null) return null;
    const segments = location.trim().split('?')[0]!.split('/').filter(Boolean);
    return segments.length > 0 ? segments[segments.length - 1]! : null;
}

function errorLines(errors: unknown): string[] {
    if (!Array.isArray(errors)) return [];
    return errors.map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object' && item !== null && typeof (item as { message?: unknown }).message === 'string') {
            return (item as { message: string }).message;
        }
        return JSON.stringify(item);
    });
}

export const createEdgeBackend: StoreBackendFactory = (
    credentials: StoreCredentials,
    options: StoreBackendOptions = {},
): StoreBackend => {
    const productId = credentials['EDGE_ADDONS_PRODUCT_ID']!;
    const clientId = credentials['EDGE_ADDONS_CLIENT_ID']!;
    const apiKey = credentials['EDGE_ADDONS_API_KEY']!;
    const secrets = [...secretValuesOf(STORE, credentials), clientId];
    const base = `${API_ROOT}/v1/products/${encodeURIComponent(productId)}`;

    const clean = (text: string): string => redactSecrets(text, secrets).slice(0, MAX_VENDOR_TEXT);

    /** The operation published last by THIS backend, which `status()` reads. */
    let lastPublish: { operationId: string; version: string } | null = null;

    async function send(
        method: 'GET' | 'POST',
        url: string,
        extra: { contentType?: string; body?: Uint8Array | string } = {},
    ): Promise<Response> {
        const headers: Record<string, string> = {
            Authorization: `ApiKey ${apiKey}`,
            'X-ClientID': clientId,
        };
        if (extra.contentType !== undefined) headers['Content-Type'] = extra.contentType;
        options.log?.(`${method} ${url} ${JSON.stringify(redactHeaders(headers))}`);
        const fetchImpl = options.fetchImpl ?? globalThis.fetch;
        let response: Response;
        try {
            response = await fetchImpl(url, { method, headers, body: extra.body as BodyInit | undefined });
        } catch (error) {
            throw new StoreApiError(STORE, undefined, clean(error instanceof Error ? error.message : String(error)));
        }
        options.log?.(`  → HTTP ${response.status}`);
        if (response.status >= 200 && response.status < 300) return response;
        const text = await response.text().catch(() => '');
        throw new StoreApiError(STORE, response.status, failureDetail(response.status, text));
    }

    function failureDetail(status: number, text: string): string {
        const body = clean(text.trim());
        if (status === 401) return body === '' ? expiredKeyHint : `${expiredKeyHint} Store said: ${body}`;
        if (status === 404) {
            return (
                'the product id or operation id is unknown, or the product is not yours — check EDGE_ADDONS_PRODUCT_ID.' +
                (body === '' ? '' : ` Store said: ${body}`)
            );
        }
        if (status === 429) return 'throttled — too many requests; retry later.';
        return body === '' ? 'the store gave no reason.' : body;
    }

    async function accepted(response: Response, what: string): Promise<string> {
        const operationId = operationIdFrom(response.headers.get('location'));
        if (operationId === null) {
            throw new StoreApiError(
                STORE,
                response.status,
                `${what} was accepted but the response has no Location header.`,
            );
        }
        return operationId;
    }

    async function upload(input: StoreUploadInput): Promise<StoreUploadResult> {
        const zip = new Uint8Array(readFileSync(input.zipPath));
        const response = await send('POST', `${base}/submissions/draft/package`, {
            contentType: 'application/zip',
            body: zip,
        });
        const operationId = await accepted(response, 'the upload');
        return {
            operationId,
            ingested: false,
            detail: `HTTP ${response.status} accepted — upload operation ${operationId} is pending.`,
        };
    }

    async function publish(input: StorePublishInput): Promise<StorePublishResult> {
        const notes = input.notes ?? '';
        const body = PUBLISH_NOTES_FORMAT === 'json' ? JSON.stringify({ notes }) : notes;
        const response = await send('POST', `${base}/submissions`, {
            contentType: PUBLISH_NOTES_FORMAT === 'json' ? 'application/json' : 'text/plain',
            body,
        });
        const operationId = await accepted(response, 'the publish request');
        lastPublish = { operationId, version: input.version };
        return {
            state: 'unknown',
            operationId,
            detail: `HTTP ${response.status} accepted — publish operation ${operationId} is pending; the submission is not confirmed yet.`,
        };
    }

    async function operation(
        kind: StoreOperationKind,
        operationId: string,
        version?: string,
    ): Promise<StoreOperationResult> {
        const path = kind === 'upload' ? 'submissions/draft/package/operations' : 'submissions/operations';
        const response = await send('GET', `${base}/${path}/${encodeURIComponent(operationId)}`);
        const text = await response.text();
        let parsed: EdgeOperationBody;
        try {
            parsed = JSON.parse(text) as EdgeOperationBody;
        } catch {
            throw new StoreApiError(
                STORE,
                response.status,
                `the ${kind} operation answered something that is not JSON.`,
            );
        }
        const message = clean(parsed.message ?? '');
        switch (parsed.status) {
            case 'InProgress':
                return { state: 'in-progress', detail: `${kind} operation ${operationId} is still running.` };
            case 'Succeeded':
                return { state: 'succeeded', detail: message === '' ? `${kind} operation succeeded.` : message };
            case 'Failed':
                throw failure(parsed, message, version);
            default:
                throw new StoreApiError(
                    STORE,
                    response.status,
                    `the ${kind} operation has an unrecognised status: ${clean(String(parsed.status))}.`,
                );
        }
    }

    function failure(parsed: EdgeOperationBody, message: string, version: string | undefined): Error {
        const code = parsed.errorCode ?? '';
        if (code === 'NoModulesUpdated') return new StoreVersionAlreadyThereError(STORE, version ?? 'in the draft');
        if (code === 'InProgressSubmission') {
            return new StoreInReviewError(STORE, message === '' ? 'a submission is already in progress.' : message);
        }
        const lines = errorLines(parsed.errors).map(clean);
        const detail = [code === '' ? null : `${code}:`, message === '' ? null : message, ...lines]
            .filter((part): part is string => part !== null)
            .join(' ');
        return new StoreApiError(STORE, 200, detail === '' ? 'the operation failed without a reason.' : detail);
    }

    async function status(): Promise<StoreStatusResult> {
        if (lastPublish === null) {
            return {
                state: 'unknown',
                detail: 'Edge Add-ons has no endpoint that reads a product; only an operation id can be read, and this run has none.',
            };
        }
        const result = await operation('publish', lastPublish.operationId, lastPublish.version);
        return result.state === 'succeeded'
            ? { state: 'in-review', version: lastPublish.version, detail: result.detail }
            : { state: 'unknown', version: lastPublish.version, detail: result.detail };
    }

    async function verifyCredentials(): Promise<void> {
        try {
            await send('GET', `${base}/submissions/operations/${UNKNOWN_OPERATION_ID}`);
        } catch (error) {
            if (error instanceof StoreApiError && error.httpStatus === 404) return;
            throw error;
        }
    }

    return { store: STORE, upload, publish, status, operation, verifyCredentials };
};
