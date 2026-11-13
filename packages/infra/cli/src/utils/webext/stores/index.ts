// The store seam of `gjsify webext submit`: one `StoreBackend` per store, the
// credential names each one reads from the ENVIRONMENT, and the three outcomes a
// submission can have (ADR 0077 § 7 and § Amendment 1).
//
// THIS FILE IS THE INTERFACE AND NOTHING ELSE. The Chrome and Edge backends are
// written separately against it, so every type here is meant to be read by
// somebody who cannot change it: keep it small, add a store as a ROW in
// `STORES`/`STORE_CREDENTIALS` rather than a branch, and put a vendor's quirks in
// that vendor's file. What the two vendor references actually say — V2 endpoints,
// `UPLOAD_IN_PROGRESS`, Edge's 202 + `Location`, and the two claims that are
// documented nowhere — is in ADR 0077 § Amendment 1 and not repeated per backend.
//
// THREE THINGS THE SHAPE IS CHOSEN FOR, each from an incident in this tree rather
// than from taste:
//
//  1. `fetchImpl` is injected, the way `utils/publish-readback.ts` injects it, so
//     a backend is testable with no network and no account. A store backend that
//     can only be exercised against a live listing is a backend nobody exercises.
//  2. Submitting the same version twice is SURVIVABLE. A dropped connection after
//     a 202 leaves a draft whose state the client did not read, so "already at
//     this version" and "a submission is in review" are their own errors, not a
//     non-zero exit: see {@link isIdempotentSkip}.
//  3. Credentials never reach a log, a debug dump or a thrown message. Everything
//     a backend prints about a request goes through {@link redactHeaders} or
//     {@link redactSecrets} first. `publish-readback.ts`'s rule carries over
//     unchanged: never claim what was not established.

/** The stores `webext submit` knows by name. A store it does not know is refused by name, not by a missing case. */
export type StoreId = 'chrome' | 'edge' | 'amo';

export const STORE_IDS: readonly StoreId[] = ['chrome', 'edge', 'amo'];

/** One environment variable a store needs, and whether its value may ever be printed. */
export interface StoreCredentialField {
    /** The variable's name, as a CI secret and as a shell export. */
    readonly env: string;
    /**
     * False for an identifier that appears in a URL anyway (a publisher, item or
     * product id), true for anything that AUTHORISES. Only `secret: false` values
     * are allowed into a message; the rest are replaced by {@link redactSecrets}.
     */
    readonly secret: boolean;
    /** What it is, in the words the vendor's dashboard uses — this is what a missing-credential error prints. */
    readonly what: string;
}

/**
 * Credentials per store, read from the environment and NEVER from
 * `package.json#gjsify.webext`: that file is committed, and a token in a
 * committed file is a token in the published package too.
 *
 * Deliberately NOT ADR 0126's `CREDENTIALS` table, which is keyed by `HostOs`
 * because a signing identity is per host. A store credential is the same on every
 * host and differs per STORE, it has no `install` counterpart (there is no
 * keychain to build), and it can only touch one listing. The full argument, and
 * the fact that `ship credentials` is accepted-but-unbuilt, is ADR 0077
 * § Amendment 1.
 */
export const STORE_CREDENTIALS: Readonly<Record<StoreId, readonly StoreCredentialField[]>> = {
    chrome: [
        { env: 'CHROME_WEB_STORE_PUBLISHER_ID', secret: false, what: 'the publisher the item belongs to' },
        { env: 'CHROME_WEB_STORE_ITEM_ID', secret: false, what: 'the item id from the Developer Dashboard' },
        { env: 'CHROME_WEB_STORE_CLIENT_ID', secret: false, what: 'the OAuth client id' },
        { env: 'CHROME_WEB_STORE_CLIENT_SECRET', secret: true, what: 'the OAuth client secret' },
        {
            env: 'CHROME_WEB_STORE_REFRESH_TOKEN',
            secret: true,
            what: 'the refresh token the access token is minted from',
        },
    ],
    edge: [
        { env: 'EDGE_ADDONS_PRODUCT_ID', secret: false, what: 'the product id from Partner Center' },
        { env: 'EDGE_ADDONS_CLIENT_ID', secret: false, what: 'the client id sent as X-ClientID' },
        { env: 'EDGE_ADDONS_API_KEY', secret: true, what: 'the API key sent as `Authorization: ApiKey …`' },
    ],
    /**
     * AMO has a ROW and no backend in this slice, on purpose: the shape of a third
     * store is fixed before one is written, and `submit --store amo` then refuses
     * with a sentence instead of falling off the end of a switch. `webext sign`
     * keeps calling `web-ext`, which reads these two itself — they are listed so
     * nobody adds a second spelling later.
     */
    amo: [
        { env: 'WEB_EXT_API_KEY', secret: false, what: "the AMO JWT issuer (`web-ext`'s own name for it)" },
        { env: 'WEB_EXT_API_SECRET', secret: true, what: 'the AMO JWT secret' },
    ],
};

export interface StoreDescriptor {
    readonly id: StoreId;
    /** As a message names it: "Chrome Web Store", not "chrome". */
    readonly label: string;
    /**
     * False while no backend implements this store. `submit` reads this to refuse
     * early with {@link StoreUnsupportedError} rather than after reading
     * credentials it would not use.
     */
    readonly implemented: boolean;
    /**
     * Whether the API can CREATE the listing. Both implemented stores answer no —
     * a first version goes through the vendor's dashboard by hand — so `submit`
     * says that in words instead of surfacing a 404 from an upload.
     */
    readonly createsListings: false;
}

export const STORES: Readonly<Record<StoreId, StoreDescriptor>> = {
    chrome: { id: 'chrome', label: 'Chrome Web Store', implemented: true, createsListings: false },
    edge: { id: 'edge', label: 'Edge Add-ons', implemented: false, createsListings: false },
    amo: { id: 'amo', label: 'addons.mozilla.org', implemented: false, createsListings: false },
};

/** `id` as a {@link StoreId}, or null — the caller owns the message, same contract as `parseWebextTarget`'s callers. */
export function asStoreId(id: string): StoreId | null {
    return (STORE_IDS as readonly string[]).includes(id) ? (id as StoreId) : null;
}

/* ------------------------------------------------------------------ credentials */

/** A store's resolved credentials: `env` name → value, every field of its row present. */
export type StoreCredentials = Readonly<Record<string, string>>;

/** Just enough of an environment to resolve credentials from — `process.env` satisfies it on both runtimes. */
export type EnvLike = Readonly<Record<string, string | undefined>>;

/**
 * Every variable a store's row names, or a refusal listing ALL the missing ones.
 *
 * One run per fix, not one per variable — the same reason `resolveWebextConfig`
 * collects its problems before throwing. An empty string counts as missing: a CI
 * secret that was never set expands to one, and treating that as a credential
 * sends an `Authorization: ApiKey ` header whose 401 says nothing about the cause.
 */
export function resolveStoreCredentials(store: StoreId, env: EnvLike): StoreCredentials {
    const fields = STORE_CREDENTIALS[store];
    const resolved: Record<string, string> = {};
    const missing: StoreCredentialField[] = [];
    for (const field of fields) {
        const value = env[field.env];
        if (value === undefined || value === '') missing.push(field);
        else resolved[field.env] = value;
    }
    if (missing.length > 0) throw new StoreCredentialsMissingError(store, missing);
    return resolved;
}

/** The values of a store's `secret: true` fields, for {@link redactSecrets}. */
export function secretValuesOf(store: StoreId, credentials: StoreCredentials): readonly string[] {
    return STORE_CREDENTIALS[store]
        .filter((field) => field.secret)
        .map((field) => credentials[field.env])
        .filter((value): value is string => value !== undefined && value !== '');
}

/* -------------------------------------------------------------------- redaction */

export const REDACTED = '<redacted>';

/**
 * Header names whose VALUE is never printed, lower-cased.
 *
 * `x-clientid` is on the list although Edge's client id is not a secret on its
 * own: the pair is what authenticates, and a log that carries one half invites
 * pasting the other next to it. `x-goog-api-key` and `cookie` are here because a
 * backend that grows one should not have to remember to extend this list.
 */
const SECRET_HEADERS: readonly string[] = ['authorization', 'x-clientid', 'x-goog-api-key', 'cookie', 'set-cookie'];

/** Just enough of `Headers`/a plain object to redact — a backend may hold either. */
export type HeadersLike = Readonly<Record<string, string>>;

/**
 * A copy of `headers` safe to print: every authorising value replaced, every
 * other value verbatim, names lower-cased so two spellings of one header cannot
 * disagree about whether they are secret.
 *
 * A name containing `token`, `secret` or `key` is redacted too, so a header added
 * by a later backend is secret by DEFAULT and has to be named explicitly to be
 * printed. The failure mode this prevents is the quiet one: a new header leaks
 * because nobody edited a list.
 */
export function redactHeaders(headers: HeadersLike): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
        const key = name.toLowerCase();
        const secret = SECRET_HEADERS.includes(key) || /token|secret|key/.test(key);
        out[key] = secret ? REDACTED : value;
    }
    return out;
}

/**
 * `text` with every value in `secrets` replaced, for a log line, a debug dump or
 * the message of a thrown error.
 *
 * Longest first, because a short secret that is a substring of a long one would
 * otherwise leave the long one's remainder in the text. Empty and one-character
 * values are skipped: redacting those rewrites the whole message into noise and
 * says nothing, and a credential that short is not a credential.
 */
export function redactSecrets(text: string, secrets: readonly string[]): string {
    let out = text;
    for (const secret of [...secrets].filter((s) => s.length > 1).sort((a, b) => b.length - a.length)) {
        out = out.split(secret).join(REDACTED);
    }
    return out;
}

/* ----------------------------------------------------------------------- errors */

/** The store's row named variables this environment does not set. Lists all of them, with what each is. */
export class StoreCredentialsMissingError extends Error {
    constructor(
        readonly store: StoreId,
        readonly missing: readonly StoreCredentialField[],
    ) {
        super(
            `gjsify webext submit: ${STORES[store].label} needs ${missing.length} environment variable(s) this run does not set:\n` +
                missing.map((field) => `  ${field.env} — ${field.what}`).join('\n') +
                `\nSet them in the environment, never in package.json (ADR 0077 § Amendment 1).`,
        );
        this.name = 'StoreCredentialsMissingError';
    }
}

/** A store with a row and no backend — the AMO slot, or a store declared before its file exists. */
export class StoreUnsupportedError extends Error {
    constructor(
        readonly store: StoreId,
        detail: string,
    ) {
        super(`gjsify webext submit: ${STORES[store].label} is not implemented — ${detail}`);
        this.name = 'StoreUnsupportedError';
    }
}

/**
 * The store already holds this exact version, so there is nothing to do.
 *
 * NOT a failure. A `submit` retried after a dropped connection must be able to
 * reach this and exit 0, because the alternative is a second upload against a
 * draft whose state the client never read.
 */
export class StoreVersionAlreadyThereError extends Error {
    constructor(
        readonly store: StoreId,
        readonly version: string,
    ) {
        super(`${STORES[store].label}: version ${version} is already there — nothing to submit.`);
        this.name = 'StoreVersionAlreadyThereError';
    }
}

/**
 * A submission is in review, so this version cannot be uploaded or published now.
 *
 * Also not a failure of this run: the previous submit worked and the store is
 * busy with it. Cancelling it is the user's decision (Chrome has
 * `:cancelSubmission`; Edge does not document one), never this command's.
 */
export class StoreInReviewError extends Error {
    constructor(
        readonly store: StoreId,
        detail: string,
    ) {
        super(`${STORES[store].label}: a submission is in review — ${detail}`);
        this.name = 'StoreInReviewError';
    }
}

/**
 * A real failure: a 4xx that is not one of the two above, a 5xx, a timeout, an
 * answer that did not parse.
 *
 * `detail` is built by the backend and MUST have passed through
 * {@link redactSecrets} — it is the one field that carries vendor text, and
 * vendor text is where an echoed credential would appear.
 */
export class StoreApiError extends Error {
    constructor(
        readonly store: StoreId,
        readonly httpStatus: number | undefined,
        detail: string,
    ) {
        super(
            `${STORES[store].label}: ${httpStatus === undefined ? 'request failed' : `HTTP ${httpStatus}`} — ${detail}`,
        );
        this.name = 'StoreApiError';
    }
}

/** True for the two outcomes a retried `submit` may report and exit 0 on. */
export function isIdempotentSkip(error: unknown): error is StoreVersionAlreadyThereError | StoreInReviewError {
    return error instanceof StoreVersionAlreadyThereError || error instanceof StoreInReviewError;
}

/* ---------------------------------------------------------------------- backend */

/** What a submission is doing, classified. `unknown` is a state, not an error — the store did not say. */
export type StoreSubmissionState =
    /** Uploaded and not submitted: a draft the store holds. */
    | 'draft'
    /** The store is reviewing it. */
    | 'in-review'
    /** Live, or rolling out. */
    | 'published'
    /** The store refused it; `detail` carries the reason it gave. */
    | 'rejected'
    /**
     * Nothing was established. Chrome's `lastAsyncUploadState` is only set for
     * uploads from the past 24 h, so a poll that starts late legitimately has no
     * state to read — reporting that as `draft` would invent a fact.
     */
    | 'unknown';

export interface StoreStatusResult {
    readonly state: StoreSubmissionState;
    /** The version the store reports, when it reports one. */
    readonly version?: string;
    /** True while the store is still ingesting an async upload (Chrome `lastAsyncUploadState: IN_PROGRESS`); the shared poll loop keeps waiting on it. */
    readonly ingesting?: boolean;
    /** One line naming the evidence this state rests on — it goes in the report verbatim. */
    readonly detail: string;
}

export interface StoreUploadResult {
    /**
     * The store's handle for this upload, when it has one: Chrome's item resource
     * name, Edge's operation id from the `Location` header. A backend that polls
     * its own operation passes this to {@link StoreBackend.status}.
     */
    readonly operationId?: string;
    /** True once the store has fully ingested the package, false while an async upload is still running. */
    readonly ingested: boolean;
    readonly detail: string;
}

export interface StorePublishResult {
    readonly state: StoreSubmissionState;
    readonly detail: string;
}

export interface StoreUploadInput {
    /** Absolute path of the zip `webext zip` wrote. The backend reads it; it never builds one. */
    readonly zipPath: string;
    /** The version in the zip's manifest, for the "already there" check and for messages. */
    readonly version: string;
}

export interface StorePublishInput {
    readonly version: string;
    /** What Chrome calls a staged rollout; a backend whose store has none refuses a value below 100. */
    readonly deployPercentage?: number;
    /** Edge's submission `notes`. Stores that take no note ignore it. */
    readonly notes?: string;
}

/**
 * What every store backend answers to. Three verbs, because that is what both
 * vendor APIs expose: push the package, ask for review, read what happened.
 *
 * Each verb either returns its result or throws one of the error classes above —
 * a backend never returns a half-success, and never reports "published" from
 * anything but a store answer that said so.
 */
export interface StoreBackend {
    readonly store: StoreId;
    upload(input: StoreUploadInput): Promise<StoreUploadResult>;
    publish(input: StorePublishInput): Promise<StorePublishResult>;
    status(): Promise<StoreStatusResult>;
}

/** What every backend's factory takes, beside its credentials. */
export interface StoreBackendOptions {
    /** Injected in tests; resolved at call time so a `globalThis.fetch` stub is honoured (as in `publish-readback.ts`). */
    readonly fetchImpl?: typeof fetch;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly now?: () => number;
    /** Called for each request under `GJSIFY_WEBEXT_DEBUG`. Whatever it prints has been redacted first. */
    readonly log?: (msg: string) => void;
}

/** A store's backend factory, registered in {@link STORE_BACKENDS} by its own file. */
export type StoreBackendFactory = (credentials: StoreCredentials, options?: StoreBackendOptions) => StoreBackend;

/**
 * Backend per store, EMPTY in this slice: the interface lands before the two
 * implementations so they can be written against a file neither of them owns.
 * `chrome.ts` and `edge.ts` each add their own row; nothing else changes.
 */
export const STORE_BACKENDS: Partial<Record<StoreId, StoreBackendFactory>> = {};

/**
 * The backend for a store, with its credentials resolved from `env`.
 *
 * The order matters: a store with no backend is refused BEFORE credentials are
 * read, so `submit --store amo` says "not implemented" rather than asking for two
 * variables it would not use.
 */
export function createStoreBackend(store: StoreId, env: EnvLike, options?: StoreBackendOptions): StoreBackend {
    const factory = STORE_BACKENDS[store];
    if (factory === undefined) {
        throw new StoreUnsupportedError(
            store,
            store === 'amo'
                ? 'use `gjsify webext sign` for AMO; this slice ships the Chrome and Edge backends only (ADR 0077 § Amendment 1)'
                : 'no backend is registered for it',
        );
    }
    return factory(resolveStoreCredentials(store, env), options);
}
