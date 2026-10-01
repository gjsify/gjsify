#!/usr/bin/env node
/**
 * Make a Mach-O image's `LC_UUID` a function of the image.
 *
 * WHY THIS EXISTS. ld64 writes an `LC_UUID` into every image it links, and the
 * value is NOT a function of the bytes it emits: two links whose emitted images
 * are byte-identical outside that load command still get different UUIDs.
 * MEASURED here (macOS 27, arm64, rustc 1.98.1, `ld` 27037.1) by building
 * `@gjsify/lightningcss-native`'s cargo cdylib into two target directories whose
 * names differ in LENGTH — the images matched byte for byte outside the 16-byte
 * UUID payload and the 32 signature bytes that hash it, and the UUIDs differed.
 * So the shipped artifact carried an identity of the BUILD rather than of the
 * artifact, which is what `scripts/check-prebuild-reproducible.mjs` red-lined on
 * the three Rust bridges: 48 bytes, first at the `LC_UUID`, with no code change.
 *
 * The two obvious repairs are both unavailable on this toolchain:
 *
 *  - PIN IT — `-Wl,-uuid <32 hex>` does not exist here (`ld: unknown options:
 *    -uuid`), and no `ld64.lld` ships with a CommandLineTools host.
 *  - DROP IT — `-Wl,-no_uuid` is the only identity flag ld64 has, and an arm64
 *    link against a cdylib that lacks `LC_UUID` is REFUSED outright (`ld:
 *    missing LC_UUID load command in '…'`), which is exactly the library each of
 *    those bridges links its Vala half against.
 *
 * `install_name_tool` cannot help either: it runs AFTER the link and recomputes
 * neither the UUID nor the signature, so a pinned install name fixes the load
 * command and the layout and leaves this last 48 bytes moving.
 *
 * So the UUID is written here, last, as a digest of the image that is about to
 * ship. The digest covers the whole file with the UUID payload and the
 * code-signature blob blanked: blanking the signature is not optional, because
 * the signature hashes the page holding the UUID and the two cannot both be
 * derived from the other. md5 is deliberate — it is 16 bytes, the size of the
 * field, and it is the digest ld64 itself puts there; nothing here is a
 * security boundary.
 *
 * Re-signing is `codesign --force --sign -`, and ONLY for an image that arrived
 * signed: ld64 signs arm64 output and leaves x86_64 output unsigned, and adding
 * a signature to an image that had none grows it by a page-aligned `__LINKEDIT`
 * tail. That is the same rule `scripts/relocate-macho.mjs` follows, for the same
 * reason.
 *
 * Usage: node scripts/macho-set-uuid.mjs <mach-o>
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { readMachOLayout } from '../packages/infra/manifest-conformance/lib/binary.mjs';

/** `LC_UUID`'s payload sits directly after `cmd` + `cmdsize`. */
const UUID_PAYLOAD_OFFSET = 8;
const UUID_BYTES = 16;

/**
 * The UUID this image should carry: a digest of its own bytes, with the two
 * regions that cannot be derived from it blanked.
 *
 * @param {Buffer} data a whole Mach-O image
 * @returns {{ uuidOffset: number, uuid: Buffer, wasSigned: boolean }}
 */
export function contentUuid(data) {
    const { uuid, codeSignature } = readMachOLayout(data);
    if (!uuid) {
        throw new Error('no LC_UUID load command — this image cannot be given a content-derived one');
    }
    const uuidOffset = uuid.offset + UUID_PAYLOAD_OFFSET;
    const masked = Buffer.from(data);
    masked.fill(0, uuidOffset, uuidOffset + UUID_BYTES);
    if (codeSignature) {
        masked.fill(0, codeSignature.dataoff, codeSignature.dataoff + codeSignature.datasize);
    }
    return { uuidOffset, uuid: createHash('md5').update(masked).digest(), wasSigned: codeSignature !== null };
}

/**
 * @param {string} file
 * @returns {{ changed: boolean, wasSigned: boolean }} `changed` is false when the
 *   image already carried this UUID, so the step is idempotent and a second run
 *   cannot churn the bytes the gate compares.
 */
export function setContentUuid(file) {
    const before = readFileSync(file);
    const { uuidOffset, uuid, wasSigned } = contentUuid(before);
    if (before.subarray(uuidOffset, uuidOffset + UUID_BYTES).equals(uuid)) {
        return { changed: false, wasSigned };
    }
    const after = Buffer.from(before);
    uuid.copy(after, uuidOffset);
    writeFileSync(file, after);
    // The UUID lives in page 0, which the signature covers, so writing it
    // invalidates the signature ld64 produced. Re-sign only what was signed.
    if (wasSigned) execFileSync('codesign', ['--force', '--sign', '-', file], { stdio: 'inherit' });
    return { changed: true, wasSigned };
}

function main() {
    const file = process.argv[2];
    if (!file || process.argv.length > 3) {
        console.error('usage: node scripts/macho-set-uuid.mjs <mach-o>');
        process.exit(2);
    }
    const { changed, wasSigned } = setContentUuid(resolve(file));
    console.log(
        `[macho-set-uuid] ${resolve(file)}: UUID ${changed ? 'set from content' : 'already current'}` +
            `${wasSigned ? ', re-signed (ad-hoc)' : ' (unsigned image left unsigned)'}`,
    );
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('macho-set-uuid.mjs')) main();
