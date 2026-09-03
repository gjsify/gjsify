#!/usr/bin/env node
// The signed-arrival comparator — `gjsify ship --sign`'s oracle (ADR 0024 § A17).
//
// WHAT IT ANSWERS. Signing is a MUTATION of a payload somebody already
// inspected (§ A4): the darwin leg re-signs every Mach-O image inside the stage
// before the container is built. `codesign --verify` answers "is the result
// signed"; nothing answers "did signing change anything ELSE", and that is the
// question an artifact's user is actually exposed to — a re-signer that also
// rewrote a byte of `__TEXT` produces a perfectly valid signature over a
// different program.
//
//   every non-Mach-O file  →  byte-identical
//   every Mach-O image     →  identical outside LC_CODE_SIGNATURE and LC_UUID
//
// The rule and its one derived addition (`__LINKEDIT`'s size fields, which are a
// function of the signature's length) are written out on
// `compareMachOAfterResign` in `packages/infra/manifest-conformance/lib/binary.mjs`,
// which is where the Mach-O parser lives and whose header says in so many words:
// extend this file, never add a second parser.
//
// AND IT NEEDS NO CERTIFICATE. `codesign --sign -` is ad-hoc and requires no
// Apple Developer Program membership — `docs/poc/webkit-hardened-runtime-darwin.sh`
// uses it "because it needs no developer identity, so this runs on any machine
// and in CI". So the whole pipeline plus this oracle is a green CI leg with no
// secret in it, which is § A17's argument for settling the interface now.
//
// THE ANTI-VACUITY FLOOR IS NOT OPTIONAL. A comparator run over a tree nothing
// signed reports "everything identical" and exits 0 — the loudest possible
// instance of this repository's most expensive failure class. `--min-signed <n>`
// is therefore how CI calls it: fewer than `n` images came back `signature-only`
// is a FAILURE, whatever the rest said.
//
// Usage:
//   node .github/ship-oracle/verify-signed-arrival.mjs <before-dir> <after-dir> \
//        [--allow-added <relpath>]... [--allow-added-prefix <reldir>]...
//        [--min-signed <n>] [--quiet]
//
// Exit 0 = every file arrived as it must. Exit 1 = a difference, or too few
// signatures. Exit 2 = the invocation itself was wrong.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const { compareMachOAfterResign } = await import(
    join(HERE, '..', '..', 'packages', 'infra', 'manifest-conformance', 'lib', 'binary.mjs')
);

function usage(message) {
    console.error(`verify-signed-arrival: ${message}`);
    console.error(
        'usage: verify-signed-arrival.mjs <before-dir> <after-dir> [--allow-added <p>]… ' +
            '[--allow-added-prefix <d>]… [--min-signed <n>]',
    );
    process.exit(2);
}

const argv = process.argv.slice(2);
/** @type {string[]} */ const positional = [];
/** @type {Set<string>} */ const allowAdded = new Set();
// A DIRECTORY rather than a path, and it exists for exactly one producer: a
// bundle seal writes `Contents/_CodeSignature/{CodeResources,CodeDirectory,
// CodeRequirements,CodeRequirements-1,CodeSignature}` and WHICH of those five it
// writes is `codesign`'s decision, not ours (ADR 0040). Naming the five would be
// this repository asserting a set it does not control; naming the directory is
// the claim it can actually make — the seal writes there and nowhere else.
/** @type {string[]} */ const allowAddedPrefixes = [];
let minSigned = 0;
let quiet = false;
for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--allow-added') {
        const value = argv[++i];
        if (value === undefined) usage('--allow-added needs a path');
        allowAdded.add(value);
    } else if (arg === '--allow-added-prefix') {
        const value = argv[++i];
        if (value === undefined) usage('--allow-added-prefix needs a directory');
        // Normalised with the separator, so `Contents/_CodeSignatureX/evil` does
        // not pass as `Contents/_CodeSignature`.
        allowAddedPrefixes.push(value.endsWith('/') ? value : `${value}/`);
    } else if (arg === '--min-signed') {
        const value = argv[++i];
        if (value === undefined || !/^\d+$/.test(value)) usage('--min-signed needs a non-negative integer');
        minSigned = Number(value);
    } else if (arg === '--quiet') {
        quiet = true;
    } else if (arg.startsWith('--')) {
        usage(`unknown flag ${arg}`);
    } else {
        positional.push(arg);
    }
}
if (positional.length !== 2) usage(`expected two directories, got ${positional.length}`);
const [beforeDir, afterDir] = positional;

/** Every regular file below `root`, as POSIX-separated relative paths. */
function walk(root) {
    /** @type {string[]} */ const out = [];
    const visit = (dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) visit(full);
            else if (entry.isFile()) out.push(relative(root, full).split(sep).join('/'));
        }
    };
    for (const dir of [root]) {
        try {
            if (!statSync(dir).isDirectory()) usage(`${dir} is not a directory`);
        } catch {
            usage(`${dir} does not exist`);
        }
        visit(dir);
    }
    return out.sort();
}

/** Mach-O by MAGIC, never by suffix: the closure's images are `.dylib`, `.so`, `.node` and bare. */
function isMachO(buf) {
    if (buf.length < 4) return false;
    const be = buf.readUInt32BE(0);
    return be === 0xfeedfacf || be === 0xcffaedfe || be === 0xfeedface || be === 0xcefaedfe || be === 0xcafebabe;
}

const before = new Set(walk(beforeDir));
const after = walk(afterDir);

/** @type {string[]} */ const problems = [];
const counts = { identical: 0, signatureOnly: 0, added: 0 };

for (const rel of after) {
    if (!before.has(rel)) {
        if (allowAdded.has(rel) || allowAddedPrefixes.some((prefix) => rel.startsWith(prefix))) {
            counts.added++;
            if (!quiet) console.log(`  added (declared): ${rel}`);
        } else {
            problems.push(
                `${rel}: is in the signed tree and not in the tree it was signed from. Signing mutates the ` +
                    'files that are already in the payload; a file that appeared has no mode from the plan.',
            );
        }
        continue;
    }
    before.delete(rel);
    const a = readFileSync(join(beforeDir, rel.split('/').join(sep)));
    const b = readFileSync(join(afterDir, rel.split('/').join(sep)));
    if (isMachO(a) || isMachO(b)) {
        const { verdict, reasons } = compareMachOAfterResign(a, b);
        if (verdict === 'identical') counts.identical++;
        else if (verdict === 'signature-only') {
            counts.signatureOnly++;
            if (!quiet) console.log(`  signature-only: ${rel}`);
        } else {
            problems.push(`${rel}: ${reasons.join('; ')}`);
        }
        continue;
    }
    if (a.equals(b)) {
        counts.identical++;
        continue;
    }
    problems.push(
        `${rel}: is not a Mach-O image and its bytes changed (${a.length} → ${b.length} bytes). ` +
            "Nothing outside a Mach-O signature is the signer's to touch.",
    );
}

for (const rel of before) {
    problems.push(`${rel}: was in the tree that was signed and is missing from the signed one.`);
}

// THE FLOOR IS A PROBLEM LIKE ANY OTHER, and folding it in rather than exiting
// early is what leaves exactly ONE `process.exit` in this file — the shape
// `oxlint-plugin-gjsify`'s `deferred-process-exit` rule asks for, because under
// GJS a bare `process.exit` does not halt and every statement after it still
// runs. It also reads better: a run can be BOTH vacuous and wrong, and reporting
// one of the two would send the reader to the wrong repair.
if (counts.signatureOnly < minSigned) {
    problems.push(
        `${counts.signatureOnly} image(s) came back signature-only and at least ${minSigned} was required. ` +
            'A comparison over a tree nothing signed reports "all identical" and would otherwise pass — ' +
            'this floor is what stops that.',
    );
}

console.log(
    `verify-signed-arrival: ${counts.identical} identical, ${counts.signatureOnly} signature-only, ` +
        `${counts.added} declared-added, ${problems.length} problem(s)`,
);

if (problems.length > 0) {
    console.error('verify-signed-arrival: the signed tree is not the tree that was signed:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
}
