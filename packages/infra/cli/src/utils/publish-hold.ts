// Do not publish a package whose dependency closure contains a version nobody can install.
//
// THE INCIDENT (v0.59.0 / v0.59.1). `@gjsify/adwaita-fonts@0.59.x` was accepted
// by npm (202) and never served — it sits in "Validating". The sweep published
// its dependents anyway: `publish-pins.ts` asks whether the NAME exists, and
// `adwaita-fonts` has existed since 0.5x, so the guard passed. `adwaita-web` and
// `adwaita-nativescript` 0.59.x went live pinning a version the registry does not
// serve, and are uninstallable. A name guard cannot see that; a VERSION guard can,
// at the price the name guard was designed to avoid — a version is eventually
// consistent for minutes after its own 2xx (see `publish-readback.ts`), so this
// one WAITS for the pin before it holds, and consults the status endpoint
// (`publish-status.ts`) so a version that is terminally unavailable does not cost
// the wait.
//
// The sweep is one `gjsify publish` PROCESS per package (`foreach --exec`), so a
// verdict reached by one process cannot reach the next in memory. The ledger is
// how it does: a JSONL file named by `GJSIFY_PUBLISH_LEDGER`, appended by every
// process that finds a version unserved or holds a package. A dependent of a held
// package then holds at once from the ledger instead of waiting out the budget
// again — but only for a TERMINAL class; a `validating` entry is re-probed, and a
// confirmed re-probe appends `served`. The end-of-job summary is rendered from
// the same file.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { REQUIRED_BLOCK, type DependencyBlock, type WorkspacePin } from './publish-pins.js';
import { verifyPublishedVersion } from './publish-readback.js';
import {
    classifyUnserved,
    describeClass,
    fetchVersionStatus,
    isTerminalClass,
    type Classification,
    type UnservedClass,
} from './publish-status.js';

/** Wait for a pin this long before holding. Covers the measured 252 s write lag (publish-readback.ts). */
export const DEFAULT_HOLD_WAIT_MS = 300_000;

/** `verifyPublishedVersion` needs a budget > 0; this makes it exactly one probe. */
const SINGLE_PROBE_BUDGET_MS = 1;

export interface HoldReason {
    /** The dependency that is not installable. */
    name: string;
    version: string;
    block: DependencyBlock;
    /** `held` = the dependency was itself held in this run, so nothing of it was published. */
    cls: UnservedClass | 'held';
    detail: string;
}

export type LedgerEntry =
    /** This run PUT the version, npm accepted it, and the packument does not serve it. */
    | {
          ev: 'unserved';
          name: string;
          version: string;
          cls: UnservedClass;
          detail: string;
      }
    /** This run did NOT publish the package, because of the listed dependencies. */
    | { ev: 'held'; name: string; version: string; reasons: HoldReason[] }
    /**
     * The version is now served; it supersedes an earlier `unserved` OR `held` entry (last entry
     * wins) — a later probe found it, or the held-package second pass published it.
     */
    | { ev: 'served'; name: string; version: string };

export function appendLedger(path: string | undefined, entry: LedgerEntry): void {
    if (!path) return;
    appendFileSync(path, `${JSON.stringify(entry)}\n`);
}

/** Tolerates a missing file (no entries yet) and skips unparseable lines rather than losing the rest. */
export function readLedger(path: string | undefined): LedgerEntry[] {
    if (!path || !existsSync(path)) return [];
    const entries: LedgerEntry[] = [];
    for (const line of readFileSync(path, 'utf-8').split('\n')) {
        if (!line.trim()) continue;
        try {
            const parsed = JSON.parse(line) as LedgerEntry;
            if (parsed.ev === 'unserved' || parsed.ev === 'held' || parsed.ev === 'served') entries.push(parsed);
        } catch {
            /* a torn line from a killed process must not hide the entries around it */
        }
    }
    return entries;
}

/**
 * The version a rewritten pin asks for, when the spec names exactly one:
 * `0.59.1`, `^0.59.1`, `~0.59.1`. `undefined` for a range, tag or URL — those are
 * not decidable against one version and the name-level guard covers them.
 */
export function pinVersion(spec: string): string | undefined {
    const match = /^[\^~]?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(spec.trim());
    return match?.[1];
}

export interface FindUnavailablePinsInput {
    registry: string;
    pins: readonly WorkspacePin[];
    ledger: readonly LedgerEntry[];
    /** Where a re-probe that finds a ledger-`unserved` version served records it, so later dependents skip the probe. */
    ledgerPath?: string;
    /** Forwarded to the packument GETs, as the publish's own read-back does. */
    authorization?: string;
    statusToken?: string;
    /** How long to wait for a pin that may merely be late. 0 = one probe, no waiting. */
    waitBudgetMs: number;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    log?: (msg: string) => void;
}

/**
 * Every pin whose exact version the registry does not serve (after waiting for
 * one that may be late), with the reason. Empty = safe to publish.
 *
 * Three cheap exits come first, in order: the ledger already knows this version
 * is unserved or held; one packument probe finds it served (nine in ten); the
 * status endpoint says it can never be served. Only a pin that is none of those —
 * possibly just late — pays the wait.
 */
export async function findUnavailablePins(input: FindUnavailablePinsInput): Promise<HoldReason[]> {
    const reasons: HoldReason[] = [];
    const seen = new Map<string, HoldReason | null>();
    for (const pin of input.pins) {
        const version = pinVersion(pin.spec);
        if (!version) {
            input.log?.(`gjsify publish: ${pin.name}@${pin.spec} names no single version — not checked for hold`);
            continue;
        }
        const key = `${pin.name}@${version}`;
        // An optional/peer edge is reported but never holds (see `holdsPublish`),
        // so it does not earn the wait either: one probe.
        const cacheKey = pin.block === REQUIRED_BLOCK ? key : `${key}#nowait`;
        if (!seen.has(cacheKey)) {
            const probe = pin.block === REQUIRED_BLOCK ? input : { ...input, waitBudgetMs: 0 };
            seen.set(cacheKey, await judgePin(probe, pin.name, version));
        }
        const verdict = seen.get(cacheKey);
        // One reason per EDGE: the same target in two blocks costs different things
        // at install time, and the operator should see both.
        if (verdict) reasons.push({ ...verdict, block: pin.block });
    }
    return reasons;
}

async function judgePin(input: FindUnavailablePinsInput, name: string, version: string): Promise<HoldReason | null> {
    const base = { name, version, block: 'dependencies' as DependencyBlock };
    // The LAST entry wins: a `served` entry supersedes the `unserved` one before it.
    const known = [...input.ledger].reverse().find((e) => e.name === name && e.version === version);
    if (known?.ev === 'served') return null;
    // Only a terminal class short-circuits. npm holds EVERY new version in
    // `validating` for 30–90 s, and the publisher's own read-back runs inside
    // that window, so a non-terminal entry is stale by the time a dependent
    // looks (v0.60.0: 92 of 215 packages held on it). Fall through and re-probe.
    if (known?.ev === 'unserved' && isTerminalClass(known.cls)) {
        return { ...base, cls: known.cls, detail: known.detail };
    }
    if (known?.ev === 'held') {
        return {
            ...base,
            cls: 'held',
            detail: `was itself held — ${summariseReasons(known.reasons)}`,
        };
    }

    const probeInput = {
        registry: input.registry,
        name,
        version,
        authorization: input.authorization,
        fetchImpl: input.fetchImpl,
        sleep: input.sleep,
        now: input.now,
        log: input.log,
    };
    let readback = await verifyPublishedVersion({
        ...probeInput,
        budgetMs: SINGLE_PROBE_BUDGET_MS,
    });
    if (readback.confirmed) return confirmedServed(input, known, name, version);

    const ask = () =>
        fetchVersionStatus({
            registry: input.registry,
            name,
            version,
            token: input.statusToken,
            fetchImpl: input.fetchImpl,
        });
    let classification = classifyUnserved(readback.verdict, await ask());
    if (!classification.terminal && input.waitBudgetMs > 0) {
        readback = await verifyPublishedVersion({
            ...probeInput,
            budgetMs: input.waitBudgetMs,
        });
        if (readback.confirmed) return confirmedServed(input, known, name, version);
        classification = classifyUnserved(readback.verdict, await ask());
    }
    return { ...base, cls: classification.cls, detail: classification.detail };
}

function confirmedServed(
    input: FindUnavailablePinsInput,
    known: LedgerEntry | undefined,
    name: string,
    version: string,
): null {
    if (known?.ev === 'unserved') appendLedger(input.ledgerPath, { ev: 'served', name, version });
    return null;
}

/** Only a `dependencies` edge holds a publish, as in the name-level guard; the rest are reported. */
export const holdsPublish = (reason: HoldReason): boolean => reason.block === REQUIRED_BLOCK;

export function summariseReasons(reasons: readonly HoldReason[]): string {
    return reasons
        .map((r) => `${r.name}@${r.version} is ${r.cls === 'held' ? 'held' : describeClass(r.cls)}`)
        .join('; ');
}

/** Classify a version THIS process PUT and could not read back, and write it to the ledger. */
export async function recordUnserved(input: {
    ledgerPath: string | undefined;
    registry: string;
    name: string;
    version: string;
    verdict: Parameters<typeof classifyUnserved>[0];
    statusToken?: string;
    fetchImpl?: typeof fetch;
}): Promise<Classification> {
    const status = await fetchVersionStatus({
        registry: input.registry,
        name: input.name,
        version: input.version,
        token: input.statusToken,
        fetchImpl: input.fetchImpl,
    });
    const classification = classifyUnserved(input.verdict, status);
    appendLedger(input.ledgerPath, {
        ev: 'unserved',
        name: input.name,
        version: input.version,
        cls: classification.cls,
        detail: classification.detail,
    });
    return classification;
}

/**
 * The job-summary markdown for a ledger: what is unserved and why, what was held
 * and why, and the exact command that publishes the held set once their
 * dependencies are installable. `undefined` when nothing needs saying.
 */
type UnservedEntry = Extract<LedgerEntry, { ev: 'unserved' }>;
type HeldEntry = Extract<LedgerEntry, { ev: 'held' }>;

/** One entry per `name@version` — the LAST one — keeping only those still not served. */
export function pendingEntries(entries: readonly LedgerEntry[]): { unserved: UnservedEntry[]; held: HeldEntry[] } {
    const last = new Map<string, LedgerEntry>();
    for (const e of entries) last.set(`${e.name}@${e.version}`, e);
    const pending = [...last.values()];
    return {
        unserved: pending.filter((e): e is UnservedEntry => e.ev === 'unserved'),
        held: pending.filter((e): e is HeldEntry => e.ev === 'held'),
    };
}

/**
 * Record that a package this run once HELD has now been published, so its dependents stop
 * holding on it (`judgePin` reads the last entry) and the end-of-job check stops naming it.
 */
export function markHeldPublished(path: string | undefined, name: string, version: string): void {
    const last = [...readLedger(path)].reverse().find((e) => e.name === name && e.version === version);
    if (last?.ev === 'held') appendLedger(path, { ev: 'served', name, version });
}

export interface SettleUnservedInput {
    entries: readonly LedgerEntry[];
    ledgerPath: string | undefined;
    /** Registry for a package name (scoped registries differ). */
    registryFor: (name: string) => string;
    /** One shared deadline: the entries poll concurrently, so the cost is the longest lag, not the sum. */
    budgetMs: number;
    authorization?: string;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    log?: (msg: string) => void;
}

/**
 * Wait for versions npm ACCEPTED but did not serve inside the sweep's 5 s read-back, and append
 * `served` for each one that shows up. This is the longer read-back the sweep deliberately defers
 * (publishing.md: lags reach 252–368 s). A TERMINAL class (blocked/deleted/staged/missing) is a
 * spent number — waiting cannot help, so it is skipped. Returns the names confirmed.
 */
export async function settleUnserved(input: SettleUnservedInput): Promise<string[]> {
    const waiting = pendingEntries(input.entries).unserved.filter((e) => !isTerminalClass(e.cls));
    const confirmed = await Promise.all(
        waiting.map(async (e) => {
            const readback = await verifyPublishedVersion({
                registry: input.registryFor(e.name),
                name: e.name,
                version: e.version,
                budgetMs: input.budgetMs,
                authorization: input.authorization,
                fetchImpl: input.fetchImpl,
                sleep: input.sleep,
                now: input.now,
                log: input.log,
            });
            if (!readback.confirmed) return undefined;
            appendLedger(input.ledgerPath, { ev: 'served', name: e.name, version: e.version });
            return `${e.name}@${e.version}`;
        }),
    );
    return confirmed.filter((x): x is string => x !== undefined);
}

export function renderLedgerSummary(entries: readonly LedgerEntry[], ref: string): string | undefined {
    const { unserved, held } = pendingEntries(entries);
    if (unserved.length === 0 && held.length === 0) return undefined;
    const lines: string[] = ['### npm versions that were accepted but are not installable', ''];
    if (unserved.length > 0) {
        lines.push('| Package | Version | State | Detail |', '| --- | --- | --- | --- |');
        for (const e of unserved) {
            lines.push(`| \`${e.name}\` | ${e.version} | ${describeClass(e.cls)} | ${e.detail} |`);
        }
        lines.push('');
    }
    if (held.length > 0) {
        lines.push(
            '### Held — NOT published in this run',
            '',
            'Each package below depends on a version npm does not serve, so publishing it would have shipped a package that cannot be installed.',
            '',
            '| Package | Version | Because |',
            '| --- | --- | --- |',
        );
        for (const e of held) lines.push(`| \`${e.name}\` | ${e.version} | ${summariseReasons(e.reasons)} |`);
        lines.push(
            '',
            'Once the dependencies above are served by npm (a `validating` version appears on its own, or is approved/released by a maintainer), publish the held set with:',
            '',
            '```sh',
            `gh workflow run release.yml --ref ${ref} -f skip_publish=false -f only='${[...new Set(held.map((e) => e.name))].join(' ')}'`,
            '```',
        );
        if (unserved.some((e) => e.cls === 'blocked' || e.cls === 'deleted')) {
            lines.push(
                '',
                'A `blocked` or `deleted` version is a spent number: re-running the release cannot serve it, the package needs a version bump.',
            );
        }
    }
    return lines.join('\n');
}
