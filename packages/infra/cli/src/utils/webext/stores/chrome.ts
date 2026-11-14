// Chrome Web Store backend, Publish API V2 (ADR 0077 § Amendment 1).
//
// Everything here is DOCUMENTED, none of it MEASURED against a live item
// (developer.chrome.com/docs/webstore/api and /using-api, read 2026-11-13):
// refresh token → access token at oauth2.googleapis.com, `:upload` with the zip
// as the body, `:publish`, `:fetchStatus`. The upload is asynchronous
// (`uploadState: IN_PROGRESS`); this file reports that state and never polls —
// the shared poll loop owns the waiting.

import { readFileSync } from 'node:fs';

import {
    type StoreBackend,
    type StoreBackendOptions,
    type StoreCredentials,
    type StorePublishInput,
    type StorePublishResult,
    type StoreStatusResult,
    type StoreSubmissionState,
    type StoreUploadInput,
    type StoreUploadResult,
    redactHeaders,
    redactSecrets,
    secretValuesOf,
    StoreApiError,
    StoreInReviewError,
    StoreVersionAlreadyThereError,
} from './index.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_ROOT = 'https://chromewebstore.googleapis.com';

const TOKEN_HINT =
    'Create a new OAuth client in the Google Cloud Console (APIs & Services → Credentials) and a new refresh token ' +
    'with the scope https://www.googleapis.com/auth/chromewebstore, e.g. in https://developers.google.com/oauthplayground ' +
    '("Use your own OAuth credentials"); then update CHROME_WEB_STORE_CLIENT_ID, CHROME_WEB_STORE_CLIENT_SECRET and CHROME_WEB_STORE_REFRESH_TOKEN.';

const VISIBILITY_HINT =
    'If the visibility was changed in the Developer Dashboard, the API refuses to publish until the item has been ' +
    'published by hand once with the new visibility: publish once in the Developer Dashboard by hand (einmal im Dashboard von Hand veröffentlichen), then retry.';

interface RevisionStatus {
    state?: string;
    distributionChannels?: { deployPercentage?: number; crxVersion?: string }[];
}

interface FetchStatusBody {
    publishedItemRevisionStatus?: RevisionStatus;
    submittedItemRevisionStatus?: RevisionStatus;
    lastAsyncUploadState?: string;
    takenDown?: boolean;
    warned?: boolean;
}

const versionOf = (revision: RevisionStatus | undefined): string | undefined =>
    revision?.distributionChannels?.find((channel) => channel.crxVersion !== undefined)?.crxVersion;

export function createChromeBackend(credentials: StoreCredentials, options: StoreBackendOptions = {}): StoreBackend {
    const publisher = credentials['CHROME_WEB_STORE_PUBLISHER_ID'] as string;
    const item = credentials['CHROME_WEB_STORE_ITEM_ID'] as string;
    const name = `publishers/${encodeURIComponent(publisher)}/items/${encodeURIComponent(item)}`;
    const secrets: string[] = [...secretValuesOf('chrome', credentials)];
    const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
    let accessToken: string | undefined;

    const scrub = (text: string): string => redactSecrets(text, secrets);

    const fail = (status: number | undefined, detail: string): StoreApiError =>
        new StoreApiError('chrome', status, scrub(detail));

    /** The vendor's own error message when the body carries one, else a short slice of the text. */
    const describe = async (res: Response): Promise<string> => {
        const text = await res.text().catch(() => '');
        try {
            const parsed = JSON.parse(text) as { error?: { message?: string } | string; error_description?: string };
            const message =
                typeof parsed.error === 'string'
                    ? [parsed.error, parsed.error_description].filter(Boolean).join(': ')
                    : parsed.error?.message;
            if (message) return message.slice(0, 400);
        } catch {
            // not JSON — fall through to the raw slice
        }
        return text.trim().slice(0, 200) || 'empty response';
    };

    const send = async (url: string, init: RequestInit & { headers: Record<string, string> }): Promise<Response> => {
        options.log?.(`${init.method ?? 'GET'} ${url} ${JSON.stringify(redactHeaders(init.headers))}`);
        try {
            return await doFetch(url, init);
        } catch (error) {
            throw fail(undefined, error instanceof Error ? error.message : String(error));
        }
    };

    const token = async (): Promise<string> => {
        if (accessToken !== undefined) return accessToken;
        const body = new URLSearchParams({
            client_id: credentials['CHROME_WEB_STORE_CLIENT_ID'] as string,
            client_secret: credentials['CHROME_WEB_STORE_CLIENT_SECRET'] as string,
            refresh_token: credentials['CHROME_WEB_STORE_REFRESH_TOKEN'] as string,
            grant_type: 'refresh_token',
        });
        const res = await send(TOKEN_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: body.toString(),
        });
        if (!res.ok) {
            const detail = await describe(res);
            const hint = res.status === 400 || res.status === 401 ? ` ${TOKEN_HINT}` : '';
            throw fail(res.status, `token exchange refused: ${detail}.${hint}`);
        }
        const parsed = (await res.json().catch(() => ({}))) as { access_token?: string };
        if (typeof parsed.access_token !== 'string' || parsed.access_token === '') {
            throw fail(res.status, 'token exchange answered without an access_token');
        }
        accessToken = parsed.access_token;
        secrets.push(accessToken);
        return accessToken;
    };

    const call = async (
        url: string,
        init: { method: string; headers?: Record<string, string>; body?: BodyInit },
    ): Promise<Response> => {
        const bearer = await token();
        return send(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${bearer}` } });
    };

    const readStatus = async (): Promise<FetchStatusBody> => {
        const res = await call(`${API_ROOT}/v2/${name}:fetchStatus`, { method: 'GET' });
        if (!res.ok) throw fail(res.status, `fetchStatus failed: ${await describe(res)}`);
        return (await res.json().catch(() => {
            throw fail(res.status, 'fetchStatus answered with something that is not JSON');
        })) as FetchStatusBody;
    };

    /** The two idempotent outcomes, read from the store before anything is sent. */
    const refuseIfBusy = (body: FetchStatusBody, version: string): void => {
        const submitted = body.submittedItemRevisionStatus;
        const submittedVersion = versionOf(submitted);
        if (submitted?.state === 'PENDING_REVIEW') {
            if (submittedVersion === version) throw new StoreVersionAlreadyThereError('chrome', version);
            throw new StoreInReviewError(
                'chrome',
                `version ${submittedVersion ?? '(unknown)'} is pending review; wait for it or cancel it in the Developer Dashboard.`,
            );
        }
        if (versionOf(body.publishedItemRevisionStatus) === version || submittedVersion === version) {
            throw new StoreVersionAlreadyThereError('chrome', version);
        }
    };

    const classify = (state: string | undefined): StoreSubmissionState => {
        switch (state) {
            case 'PENDING_REVIEW':
                return 'in-review';
            case 'PUBLISHED':
            case 'PUBLISHED_TO_TESTERS':
                return 'published';
            case 'REJECTED':
                return 'rejected';
            // STAGED (approved, waiting for the developer) and CANCELLED both mean
            // "nothing is in flight"; the detail line names which one.
            case 'STAGED':
            case 'CANCELLED':
                return 'draft';
            default:
                return 'unknown';
        }
    };

    return {
        store: 'chrome',

        async upload(input: StoreUploadInput): Promise<StoreUploadResult> {
            refuseIfBusy(await readStatus(), input.version);
            const res = await call(`${API_ROOT}/upload/v2/${name}:upload`, {
                method: 'POST',
                headers: { 'content-type': 'application/zip' },
                body: readFileSync(input.zipPath) as unknown as BodyInit,
            });
            if (!res.ok) throw fail(res.status, `upload failed: ${await describe(res)}`);
            const body = (await res.json().catch(() => ({}))) as {
                name?: string;
                crxVersion?: string;
                uploadState?: string;
            };
            switch (body.uploadState) {
                case 'SUCCEEDED':
                    return {
                        operationId: body.name,
                        ingested: true,
                        detail: `uploadState SUCCEEDED, crxVersion ${body.crxVersion ?? '(not reported)'}`,
                    };
                case 'IN_PROGRESS':
                    return {
                        operationId: body.name,
                        ingested: false,
                        detail: 'uploadState IN_PROGRESS — poll fetchStatus',
                    };
                case 'FAILED':
                    throw fail(
                        res.status,
                        'upload accepted but the store reports uploadState FAILED; check the package in the Developer Dashboard',
                    );
                default:
                    throw fail(
                        res.status,
                        `upload answered with uploadState ${body.uploadState ?? '(none)'}, which is not a state this client knows`,
                    );
            }
        },

        async publish(input: StorePublishInput): Promise<StorePublishResult> {
            const before = (await readStatus()).submittedItemRevisionStatus;
            if (before?.state === 'PENDING_REVIEW') {
                throw new StoreInReviewError(
                    'chrome',
                    `version ${versionOf(before) ?? '(unknown)'} is pending review already.`,
                );
            }
            const payload =
                input.deployPercentage !== undefined && input.deployPercentage < 100
                    ? { deployInfos: [{ deployPercentage: input.deployPercentage }] }
                    : {};
            const res = await call(`${API_ROOT}/v2/${name}:publish`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (!res.ok) {
                const detail = await describe(res);
                const hint =
                    res.status === 400 || res.status === 409 || res.status === 412 ? ` ${VISIBILITY_HINT}` : '';
                throw fail(res.status, `publish refused: ${detail}.${hint}`);
            }
            const body = (await res.json().catch(() => ({}))) as { state?: string };
            return { state: classify(body.state), detail: `publish answered state ${body.state ?? '(none)'}` };
        },

        async status(): Promise<StoreStatusResult> {
            const body = await readStatus();
            if (body.takenDown === true) {
                return {
                    state: 'rejected',
                    detail: 'takenDown is true — a policy violation; see the Developer Dashboard',
                };
            }
            if (body.lastAsyncUploadState === 'IN_PROGRESS') {
                return { state: 'unknown', ingesting: true, detail: 'lastAsyncUploadState IN_PROGRESS' };
            }
            if (body.lastAsyncUploadState === 'FAILED') {
                return {
                    state: 'rejected',
                    detail: 'lastAsyncUploadState FAILED — the store could not ingest the package',
                };
            }
            const submitted = body.submittedItemRevisionStatus;
            if (submitted?.state !== undefined) {
                return {
                    state: classify(submitted.state),
                    version: versionOf(submitted),
                    detail: `submittedItemRevisionStatus.state ${submitted.state}`,
                };
            }
            const published = body.publishedItemRevisionStatus;
            if (published?.state !== undefined) {
                return {
                    state: classify(published.state),
                    version: versionOf(published),
                    detail: `publishedItemRevisionStatus.state ${published.state}`,
                };
            }
            return {
                state: 'unknown',
                detail: 'fetchStatus carried no revision status and no upload state in the past 24 h',
            };
        },
    };
}
