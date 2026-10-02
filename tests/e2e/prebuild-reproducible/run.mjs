// E2E test for `scripts/check-prebuild-reproducible.mjs` — specifically for the half that
// says WHY two builds of one tree differ.
//
// THE INCIDENT. That script carried ONE hardcoded explanation for every red: ld64's debug
// map, whose `N_OSO` stabs hold each intermediate object's mtime. It is the right cause for
// the thirteen Vala-linked darwin dylibs it was measured on, and it is wrong for the three
// cargo cdylibs — `nm -a` reads zero `N_OSO` stabs in them, as `status/open-todos/prebuilds.md`
// had already recorded. So when `main` went red on exactly those three, the gate named a
// cause its own ledger contradicted, and a plausible wrong fix would have landed silently.
//
// The fix is structural rather than a better sentence: `classifyMachOBuildDiff` parses the
// load commands of BOTH builds and attributes every differing byte to a region. A check that
// narrows its own hypothesis from the artifact cannot misattribute. These tests drive that
// classifier over images whose differing region is known by construction — which is the only
// way to test it from Linux, where no Mach-O can be linked, let alone linked twice.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prebuildDir } from '../helpers.mjs';
import { signedMachO, machO, buildVersion, LC_UUID, SYSTEM_DYLIB, TEXT_BODY_OFFSET } from '../macho.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MONOREPO_ROOT = join(__dirname, '..', '..', '..');

const { classifyMachOBuildDiff, describeMachOOffset, readMachOLayout } = await import(
    `file://${join(MONOREPO_ROOT, 'packages', 'infra', 'manifest-conformance', 'lib', 'binary.mjs')}`
);
const { diffStagedSets, channelHint } = await import(
    `file://${join(MONOREPO_ROOT, 'scripts', 'check-prebuild-reproducible.mjs')}`
);

/** An `uuid_command` carrying `fill` as its 16-byte payload. */
function uuidCommand(fill) {
    const b = Buffer.alloc(24);
    b.writeUInt32LE(LC_UUID, 0);
    b.writeUInt32LE(24, 4);
    b.fill(fill, 8, 24);
    return { cmd: LC_UUID, bytes: b };
}

/** Two UNSIGNED images differing only in their `LC_UUID` payload — the darwin-x64 cargo shape. */
function uuidOnlyPair() {
    const commands = (fill) => [buildVersion('15.0'), uuidCommand(fill), SYSTEM_DYLIB];
    return [machO(commands(0x11)), machO(commands(0x22))];
}

describe('classifyMachOBuildDiff — the region, read off the artifact', () => {
    it('calls two identical images identical', () => {
        const [a] = uuidOnlyPair();
        const { verdict, regions } = classifyMachOBuildDiff(a, Buffer.from(a));
        assert.equal(verdict, 'identical');
        assert.deepEqual(regions, []);
    });

    // The shape `main` actually went red on: unsigned, 16 bytes, nothing else. An
    // unsigned image is why this classifier exists beside `compareMachOAfterResign`,
    // which needs an `LC_CODE_SIGNATURE` on both sides before it can answer at all.
    it('names the LC_UUID payload when that is the whole difference', () => {
        const [a, b] = uuidOnlyPair();
        const { verdict, regions } = classifyMachOBuildDiff(a, b);
        assert.equal(verdict, 'uuid-only');
        assert.equal(regions.length, 1);
        assert.match(regions[0], /^16 byte\(s\) in the LC_UUID payload/);
    });

    // arm64 adds the ad-hoc signature, which HASHES the UUID — so it is a consequence
    // of the first difference, not a second one, and must not read as program drift.
    it('separates the signature computed over a changed UUID from the UUID', () => {
        const signature = Buffer.alloc(64, 0xaa);
        const a = signedMachO({ signature, uuid: Buffer.alloc(16, 0x33) });
        const b = signedMachO({ signature: Buffer.alloc(64, 0xbb), uuid: Buffer.alloc(16, 0x44) });
        const { verdict, regions } = classifyMachOBuildDiff(a, b);
        assert.equal(verdict, 'uuid-and-signature');
        assert.ok(regions.some((r) => r.includes('the LC_UUID payload')));
        assert.ok(regions.some((r) => r.includes('the LC_CODE_SIGNATURE blob')));
    });

    // The one that must stay loud. A changed instruction is what the gate is FOR, and
    // the old hardcoded paragraph would have printed the same debug-map text for it.
    it('refuses an image whose __TEXT changed, and says where', () => {
        const signature = Buffer.alloc(64, 0xaa);
        const uuid = Buffer.alloc(16, 0x33);
        const a = signedMachO({ signature, uuid });
        const b = signedMachO({ signature, uuid });
        b[TEXT_BODY_OFFSET] = b[TEXT_BODY_OFFSET] ^ 0xff;
        const { verdict, regions } = classifyMachOBuildDiff(a, b);
        assert.equal(verdict, 'differs');
        assert.ok(regions.some((r) => r.includes('section data or __LINKEDIT')));
    });

    it('reports rather than guesses when the load-command tables disagree', () => {
        const a = machO([buildVersion('15.0'), SYSTEM_DYLIB]);
        const b = machO([buildVersion('15.0'), uuidCommand(0x11), SYSTEM_DYLIB]);
        const { verdict, reasons, regions } = classifyMachOBuildDiff(a, b);
        assert.equal(verdict, 'differs');
        assert.deepEqual(regions, []);
        assert.equal(reasons.length, 1);
    });

    it('says so about a file that is not a Mach-O at all, instead of inventing a region', () => {
        const { verdict, reasons } = classifyMachOBuildDiff(Buffer.from('a typelib'), Buffer.from('b typelib'));
        assert.equal(verdict, 'unreadable');
        assert.match(reasons[0], /not readable as a thin 64-bit Mach-O/);
    });
});

describe('the committed darwin cargo cdylibs', () => {
    // The anchor of the whole diagnosis, kept STRUCTURAL rather than numeric: the first
    // differing offsets CI reported (0x670 for lightningcss, 0x768 for oxfmt) were each
    // that image's `LC_UUID` payload, measured here on Linux. Asserting those numbers
    // would pin bytes that `commit-prebuilds` legitimately moves; asserting that the
    // command is present and that the reader names its payload does not.
    for (const bridge of ['lightningcss-native', 'oxfmt-native', 'rolldown-native']) {
        const leaf = `libgjsify_${bridge.replace('-native', '')}.dylib`;
        for (const target of ['darwin-x64', 'darwin-arm64']) {
            it(`${bridge} ${target}: carries an LC_UUID the reader can name`, (t) => {
                const file = prebuildDir('infra', bridge, target, leaf);
                let data;
                try {
                    data = readFileSync(file);
                } catch {
                    t.skip(`${file} is not committed on this checkout`);
                    return;
                }
                const layout = readMachOLayout(data);
                assert.notEqual(layout.uuid, null, 'a cargo cdylib with no LC_UUID would retire this story');
                assert.equal(describeMachOOffset(layout, layout.uuid.offset + 8), 'the LC_UUID payload');
                assert.equal(describeMachOOffset(layout, layout.uuid.offset + 23), 'the LC_UUID payload');
            });
        }
    }
});

describe('diffStagedSets — what the gate reports', () => {
    it('classifies a differing Mach-O and still counts the bytes once', () => {
        const [a, b] = uuidOnlyPair();
        const dirA = mkdtempSync(join(tmpdir(), 'gjsify-repro-a-'));
        const dirB = mkdtempSync(join(tmpdir(), 'gjsify-repro-b-'));
        try {
            writeFileSync(join(dirA, 'libgjsify_x.dylib'), a);
            writeFileSync(join(dirB, 'libgjsify_x.dylib'), b);
            writeFileSync(join(dirA, 'Gjsify-1.0.typelib'), Buffer.from('same'));
            writeFileSync(join(dirB, 'Gjsify-1.0.typelib'), Buffer.from('same'));
            const [only, ...rest] = diffStagedSets(dirA, dirB);
            assert.deepEqual(rest, [], 'the identical typelib must not be reported');
            assert.equal(only.file, 'libgjsify_x.dylib');
            assert.equal(only.bytes, 16);
            assert.equal(only.verdict, 'uuid-only');
        } finally {
            rmSync(dirA, { recursive: true, force: true });
            rmSync(dirB, { recursive: true, force: true });
        }
    });
});

describe('channelHint — names the measured cause', () => {
    it('names the UUID fix, never a debug map', () => {
        const hint = channelHint([{ verdict: 'uuid-only', regions: ['16 byte(s) in the LC_UUID payload'] }]);
        assert.ok(hint.includes('LC_UUID'));
        assert.ok(hint.includes('NOT a debug map'), 'a UUID difference must not be read as a debug map');
        // The cause is measured since the cargo cdylibs pin their install name: the hint names
        // the step that fixes it instead of listing candidates.
        assert.ok(hint.includes('macho-set-uuid.mjs'), 'the hint must name the measured fix');
        assert.ok(!hint.includes('buildtype=plain'), 'the debug-map reading does not belong to this shape');
    });

    // The old text was printed for every red. It is RIGHT for the thirteen Vala
    // images, so it survives — gated on the region the artifact reports.
    it('offers the debug-map reading only where the symbol table moved', () => {
        const symbolRow = { verdict: 'differs', regions: ['3 byte(s) in the symbol table (an nlist_64 entry'] };
        assert.ok(channelHint([symbolRow]).includes('N_OSO'));
        const textRow = { verdict: 'differs', regions: ['9 byte(s) in section data or __LINKEDIT'] };
        assert.ok(!channelHint([textRow]).includes('N_OSO'));
    });

    it('is empty when nothing differed', () => {
        assert.equal(channelHint([]), '');
    });
});
