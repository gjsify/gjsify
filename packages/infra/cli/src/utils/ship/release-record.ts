// The release record — ADR 0124.
//
// ONE FILE BESIDE EVERY FILE ARTIFACT, `<artifact>.gjsify-release.json`, saying
// what this run did to it: which signature it carries, whether Apple accepted
// it, whether a ticket was stapled. `@gjsify/site` reads it to decide whether a
// download needs the "how to open an unsigned app" hint.
//
// WRITTEN LAST, from outcomes and not from flags. The hash is taken from the
// bytes on disk after `stapler` wrote into them, because a hash from before
// the staple describes a file nobody downloads. A step that fails throws
// before this runs, so a record never claims a step that did not finish.
//
// Per artifact rather than per run or per release: a release is assembled by
// several jobs on several hosts, and a file named by its artifact cannot
// collide with another job's.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import type { FormatId, HostOs } from './types.js';

/** The suffix a record's name adds to its artifact's. The site matches on it. */
export const RELEASE_RECORD_SUFFIX = '.gjsify-release.json';

export const RELEASE_RECORD_SCHEMA = 1;

export type RecordedSignature = { kind: 'none' } | { kind: 'adhoc' } | { kind: 'identity'; identity: string };

export interface ReleaseRecord {
    schema: typeof RELEASE_RECORD_SCHEMA;
    /** The artifact's file name, which is also its release asset name. */
    artifact: string;
    /** Lower-case hex SHA-256 of the artifact as written. */
    sha256: string;
    size: number;
    format: FormatId;
    os: HostOs;
    /** `process.arch` spelling, or `noarch` for a payload with no native code. */
    arch: string;
    signature: RecordedSignature;
    notarized: boolean;
    stapled: boolean;
    /** `@gjsify/cli <version>` — who wrote this record. */
    generator: string;
}

export interface ReleaseRecordInput {
    /** Absolute path of the finished artifact file. */
    file: string;
    format: FormatId;
    os: HostOs;
    arch: string;
    signature: RecordedSignature;
    notarized: boolean;
    stapled: boolean;
    generator: string;
}

export function releaseRecordPath(artifact: string): string {
    return `${artifact}${RELEASE_RECORD_SUFFIX}`;
}

/** Map a run's signing identity to what the record says; `-` is ad-hoc. */
export function recordedSignature(identity: string | undefined, adhocIdentity: string): RecordedSignature {
    if (identity === undefined) return { kind: 'none' };
    if (identity === adhocIdentity) return { kind: 'adhoc' };
    return { kind: 'identity', identity };
}

/** Build the record from the bytes at `input.file`. Pure apart from reading that file. */
export function buildReleaseRecord(input: ReleaseRecordInput): ReleaseRecord {
    const bytes = readFileSync(input.file);
    return {
        schema: RELEASE_RECORD_SCHEMA,
        artifact: basename(input.file),
        sha256: createHash('sha256').update(bytes).digest('hex'),
        size: bytes.length,
        format: input.format,
        os: input.os,
        arch: input.arch,
        signature: input.signature,
        notarized: input.notarized,
        stapled: input.stapled,
        generator: input.generator,
    };
}

/** Write the record beside its artifact and return the record's path. */
export function writeReleaseRecord(input: ReleaseRecordInput): string {
    const path = releaseRecordPath(input.file);
    writeFileSync(path, `${JSON.stringify(buildReleaseRecord(input), null, 4)}\n`);
    return path;
}
