// Signing the payload, and submitting the artifact for notarisation
// (ADR 0024 § A12–§ A17).
//
// FOUR PROPERTIES, each one a decision the ADR settles and this file implements:
//
//  1. `--sign` takes an IDENTITY, not a certificate (§ A12). `codesign` is handed
//     a STRING and looks the private key up itself; `-` is the reserved value for
//     ad-hoc, and this tree already writes `codesign --force --sign -` in five
//     places. So there is no `--certificate`, no `--p12` and no `--password`
//     anywhere on this surface — getting a key into a keychain is the signing
//     HOST's job (§ A14), and nothing here can leak a secret it is never given.
//  2. An absent identity SKIPS, loudly, at exit 0 (§ A13). Unsigned is the
//     default path and a legitimate deliverable; what § 5 refuses is the other
//     direction — claiming a signature that was not made.
//  3. Signing is a payload MUTATION, not a wrapper (§ A4). Under hardened
//     runtime a Developer-ID-signed main executable will not load ad-hoc-signed
//     dylibs, and all 106 Mach-O images in the shipped darwin GTK closure carry
//     an ad-hoc `LC_CODE_SIGNATURE` already (they must — `install_name_tool`
//     invalidates the original during relocation). So the darwin leg re-signs
//     every image, and the result is new BYTES for the packer rather than a
//     container around the old ones.
//  4. THE ORDER IS STRUCTURAL, not conventional (§ A17). `readStage` compares
//     each file's SIZE against `.gjsify-ship-stage.json`, and a size is no more
//     re-sign-proof than a digest — measured on this tree: append one byte to a
//     staged file and `readStage` refuses with "… is 6 bytes in the stage and 5
//     in its manifest". {@link signPayload} therefore TAKES what `readStage`
//     returned and RETURNS what the packer consumes: the signed bytes cannot
//     exist before the validation, because they are computed from its output,
//     and the arriving stage is never written to at all.
//
// WHAT THIS DELIBERATELY DOES NOT DO, each with its reason:
//
//  * It does not seal the `<App>.app` BUNDLE. `codesign` on a bundle writes
//    `Contents/_CodeSignature/CodeResources` and — for a main executable that is
//    a shell script, which every layout's launcher is — stores that script's own
//    signature in an extended attribute (Apple's documented behaviour, not
//    measured here). What IS measured here is our side of it: the payload round
//    trip is `readStage` → bytes + mode → `writePayload`, and it carries no
//    extended attributes at all, so a bundle seal made now would not survive into
//    the `.zip` beside the `.app`. The images the dynamic loader validates are
//    the ones signed, which is what § A4's argument is about.
//  * It passes no `--options runtime`, no `--entitlements` and no `--timestamp`.
//    § A16 leaves library validation vs. hardened runtime explicitly unmeasured,
//    and a secure timestamp needs a real Developer ID plus network. Adding any of
//    them would be code no run in this repository has ever executed.
//  * It does not staple, and the reason is NOT that stapling is unevidenced.
//    Measured here on `refs/node` at the pinned `0618e9f0`, against the ADR's own
//    control of 16 files for `codesign`: `stapler` returns 4 files, of which
//    `tools/osx-notarize.sh:58` is real code — `xcrun stapler staple
//    "node-$pkgid.pkg"`, three lines past where § A15 stopped quoting; the other
//    three are changelog entries. What is NOT measured is whether it accepts
//    OUR container: the reference staples a `.pkg`, and the only file-shaped
//    darwin artifact this command produces is a `.zip`. Adding a call that may
//    refuse the one artifact it would run on is code no run in this repository
//    has exercised, deciding something it cannot justify. Recorded in
//    `status/open-todos.md` instead.

import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

import { isOnPath } from '../check-system-deps.js';
import { describeExit, spawnToCompletion } from '../spawn.js';
import { listFilesRecursive } from './discover.js';
import { classifyBinary, type PayloadEntry } from './payload.js';
import { writePayload } from './stage-writer.js';
import type { HostOs } from './types.js';

/**
 * Everything that is per-OS about making a signature, as data.
 *
 * The same shape argument `FormatDescriptor` makes one directory over: a second
 * OS is a row, not a branch. It is a separate table from `FORMATS` on purpose —
 * § A14 measured that a format declares where it can be PACKED and never what it
 * can be signed with, and darwin has two format rows that must not be able to
 * disagree about their signature.
 */
export interface SignerDescriptor {
    /** The layout whose payload this signer signs. */
    layoutOs: HostOs;
    /** The command that makes the signature. */
    tool: string;
    /** OSes whose tooling can run {@link tool}. */
    signOn: readonly HostOs[];
    /** Where {@link tool} comes from, in this signer's own words. */
    installHint: string;
    /**
     * Which payload files carry a signature on this OS.
     *
     * `classifyBinary`'s vocabulary, so the predicate is the magic number and
     * not a filename pattern: a darwin closure names its images `.dylib`,
     * `.so`, `.node` and nothing at all (the interpreter), and a suffix list
     * would sign three of those four.
     */
    signs: 'macho' | 'pe';
    /** argv after {@link tool}, for ONE file. */
    args: (identity: string, file: string) => readonly string[];
    /** The config key a project spells its default identity under. */
    configKey: string;
    /** What a signature from this signer does NOT yet cover — printed once per run. */
    gap: string;
}

/**
 * The signers, keyed by the LAYOUT they sign — never by the host they run on.
 *
 * Linux is deliberately absent rather than present-and-empty. A `.deb` and an
 * `.rpm` carry no per-file signature: the artifact is signed as a whole, by the
 * repository that serves it (`debsigs`, `rpmsign`), with a key that belongs to
 * that repository and not to this build. A row here would make `--sign` on Linux
 * look like it did something.
 */
export const SIGNERS: Partial<Record<HostOs, SignerDescriptor>> = {
    darwin: {
        layoutOs: 'darwin',
        tool: 'codesign',
        // The tool is Apple's and ships with the Command Line Tools. There is no
        // Linux `codesign`, so unlike every other step of the darwin leg this one
        // really is host-bound — which is why it lives on the FINISH phase and
        // `gjsify ship darwin --stage` needs none of it.
        signOn: ['darwin'],
        installHint: 'install the Xcode Command Line Tools (`xcode-select --install`) on a macOS host',
        signs: 'macho',
        // `--force` because every image in the shipped closure is ALREADY signed
        // ad-hoc (§ A4: 106 of 106) — `install_name_tool` invalidates the original
        // during relocation and the relocator re-signs. Without it `codesign`
        // refuses a file that already carries a signature.
        args: (identity, file) => ['--force', '--sign', identity, file],
        configKey: 'gjsify.ship.sign.darwin.identity',
        gap:
            'the images are signed; the `.app` bundle itself is not sealed and no entitlements are ' +
            'granted (ADR 0024 § A16 leaves library validation unmeasured)',
    },
    win32: {
        layoutOs: 'win32',
        tool: 'signtool',
        signOn: ['win32'],
        installHint: 'install the Windows SDK (signtool.exe ships in its `bin/<version>/x64` directory)',
        signs: 'pe',
        // `/n` takes a SUBJECT NAME and looks the certificate up in a store, which
        // is the same shape as `codesign --sign <identity>` and the reason § A12's
        // interface is one flag for both OSes. `/fd sha256` names the file digest;
        // Authenticode's default is SHA-1, which no current Windows accepts.
        //
        // ⚠️ UNVERIFIED. Nothing in this repository has ever run `signtool`: it
        // needs a certificate, there is no ad-hoc mode on Windows, and § A5
        // records that SmartScreen only WARNS until per-file-hash reputation
        // accrues — signed or not. The argv is unit-tested, the skip and the
        // refusals are e2e-tested, and the invocation itself has no proof.
        args: (identity, file) => ['sign', '/n', identity, '/fd', 'sha256', file],
        configKey: 'gjsify.ship.sign.win32.identity',
        gap:
            'no timestamp countersignature is requested, so the signature expires with the certificate ' +
            '(UNVERIFIED: no run in this repository has ever invoked signtool)',
    },
};

/** `gjsify.ship.sign` as declared — one entry per {@link HostOs}. */
export type SignConfig = Partial<Record<HostOs, { identity?: string }>>;

/**
 * What this run will do about signatures.
 *
 * A union rather than an optional string, because the three states need three
 * different words and collapsing them is exactly what § A13 warns about: "no
 * signer for this layout" is silence, "a slot exists and is empty" is a printed
 * skip, and "here is an identity" is work.
 */
export type SignPlan =
    | { kind: 'unsupported' }
    | { kind: 'skip'; message: string }
    | { kind: 'sign'; identity: string; signer: SignerDescriptor; source: 'flag' | 'config' };

/**
 * Resolve the identity for this run, or say why there is none.
 *
 * `flag` beats `config` and neither is a yargs `default:` — the uniform
 * precedence `resolveShipSettings` documents. `config` is `undefined` on the
 * `--from-stage` path and that is not an omission: § A14 amends § A1 to *a
 * format declares where it can be packed; the RUN declares what it can sign
 * with*, and the finishing host has no project to read a default out of.
 */
export function resolveSignPlan(input: {
    /** `--sign` as typed. `''` is a value: it is `[ -z "$SIGN" ]` (§ A13). */
    flag?: string;
    /** `gjsify.ship.sign`, when a project is in reach. */
    config?: SignConfig;
    layoutOs: HostOs;
}): SignPlan {
    const signer = SIGNERS[input.layoutOs];
    if (signer === undefined) {
        if (input.flag !== undefined) {
            throw new Error(
                `gjsify ship: --sign has nothing to sign in the ${input.layoutOs} layout. A .deb and an .rpm ` +
                    'carry no per-file signature — the artifact is signed as a whole by the repository that ' +
                    "serves it (`debsigs`, `rpmsign`), with that repository's key and not with a build-time " +
                    'identity. Drop --sign, or assemble the darwin or windows layout.',
            );
        }
        return { kind: 'unsupported' };
    }
    const configured = input.config?.[input.layoutOs]?.identity;
    const [identity, source] =
        input.flag !== undefined ? ([input.flag, 'flag'] as const) : ([configured, 'config'] as const);
    // The reference's `[ -z "$SIGN" ]` — an EMPTY identity is a skip and not an
    // error, and the skip is printed rather than silent so a pipeline that
    // captures the artifact list still shows it (§ A13). Ours names the step it
    // skipped, which the reference's own copy-pasted message does not.
    if (identity === undefined || identity === '') {
        const said =
            identity === ''
                ? `an empty identity was ${source === 'flag' ? 'passed to --sign' : `set in \`${signer.configKey}\``}`
                : 'no identity was given';
        return {
            kind: 'skip',
            message:
                `${said} — skipping ${signer.tool}. An unsigned artifact is the default path and a ` +
                `legitimate deliverable (ADR 0024 § A13). Pass \`--sign <identity>\` or set ` +
                `\`${signer.configKey}\` to sign; \`--sign -\` signs ad-hoc and needs no developer identity.`,
        };
    }
    return { kind: 'sign', identity, signer, source };
}

/**
 * Refuse a signing run this host cannot make, and say which half is missing.
 *
 * Two checks and not one, for the same reason `assertCanPack` splits them: the
 * wrong OS needs another machine, an absent tool needs a package. Both are
 * knowable before anything is packed.
 */
export function assertHostCanSign(signer: SignerDescriptor): void {
    const host = process.platform as HostOs;
    if (!signer.signOn.includes(host)) {
        throw new Error(
            `gjsify ship: signing the ${signer.layoutOs} layout needs ${signer.tool}, which runs on ` +
                `${signer.signOn.join(', ')} and this host is ${host}. Assembly is not host-bound — ` +
                '`gjsify ship <os> --stage` here, then `gjsify ship --from-stage <dir> --sign <identity>` ' +
                'on a host that has both the tool and the identity (ADR 0024 § A1, § A14).',
        );
    }
    if (!isOnPath(signer.tool)) {
        throw new Error(
            `gjsify ship: --sign was given and \`${signer.tool}\` is not on PATH, so nothing can make the ` +
                `signature — ${signer.installHint}. Dropping --sign produces an unsigned artifact, which is ` +
                'a legitimate output (ADR 0024 § A13); silently producing one while --sign was asked for is not.',
        );
    }
}

export interface SignPayloadInput {
    /** What `readStage` returned — the PRE-sign tree, already held against the manifest. */
    payload: readonly PayloadEntry[];
    identity: string;
    signer: SignerDescriptor;
    /** A scratch directory this function owns and WIPES. Never the arriving stage. */
    workDir: string;
    /** Print every invocation. */
    verbose: boolean;
    log: (line: string) => void;
}

/**
 * Re-sign every signable image in the payload, and hand back the new bytes.
 *
 * The signature is made on FILES because that is the only interface `codesign`
 * and `signtool` have, so the payload is materialised into `workDir`, signed
 * there, and read back. `workDir` is a scratch directory rather than the stage:
 * writing into an arriving stage would make the next `--from-stage` run of the
 * same tree fail `readStage`'s size comparison (measured — see the header), and
 * `writeStage`'s wipe would delete the payload it was about to pack.
 *
 * THE FILE SET MAY NOT CHANGE, and that is asserted rather than assumed. Both
 * tools rewrite an image in place, so a payload that gained or lost a path here
 * means something else ran — a bundle seal writing `_CodeSignature/`, say, whose
 * files would then be dropped on the way back into the payload without anyone
 * noticing.
 */
export async function signPayload(input: SignPayloadInput): Promise<PayloadEntry[]> {
    const { payload, signer, workDir } = input;
    writePayload(workDir, payload, '');

    const signable = payload.filter((entry) => classifyBinary(entry.data) === signer.signs);
    if (signable.length === 0) {
        // NOT silent, and not an error either. A `--app gjs` payload really is
        // JavaScript and a launcher, so there is nothing for the loader to
        // validate — but a run that asked for a signature and made none has to
        // say so, or "signed" and "signed nothing" look identical in the log.
        input.log(
            `nothing in this payload is a ${signer.signs === 'macho' ? 'Mach-O' : 'PE'} image, so ` +
                `${signer.tool} signed 0 file(s). The artifact carries no signature.`,
        );
        return [...payload];
    }

    for (const entry of signable) {
        const file = join(workDir, entry.path.split('/').join(sep));
        const args = signer.args(input.identity, file);
        if (input.verbose) input.log(`${signer.tool} ${args.join(' ')}`);
        const result = await spawnToCompletion(signer.tool, args, {
            completion: 'return',
            cwd: workDir,
            stdio: 'inherit',
            notFound: () => new Error(`gjsify ship: \`${signer.tool}\` is not on PATH — ${signer.installHint}.`),
        });
        if (result.code !== 0) {
            throw new Error(
                `gjsify ship: ${signer.tool} failed on ${entry.path} with ${describeExit(result)}. ` +
                    'Nothing is packed from a payload whose signature failed: an artifact that is half ' +
                    'signed installs and is refused at first launch, which is worse than not shipping.',
            );
        }
    }

    const arrived = new Set(listFilesRecursive(workDir));
    const planned = new Set(payload.map((entry) => entry.path));
    const added = [...arrived].filter((path) => !planned.has(path));
    const removed = [...planned].filter((path) => !arrived.has(path));
    if (added.length > 0 || removed.length > 0) {
        throw new Error(
            `gjsify ship: ${signer.tool} changed the payload's file set — ` +
                `${added.length} added (${added.slice(0, 3).join(', ') || '—'}), ` +
                `${removed.length} removed (${removed.slice(0, 3).join(', ') || '—'}). ` +
                'Signing is a mutation of the files that are already in the payload (ADR 0024 § A4); a ' +
                'file that appeared here would be packed with no mode from the plan, and one that ' +
                'vanished would be packed as absent.',
        );
    }

    input.log(
        `${signer.tool} signed ${signable.length} of ${payload.length} payload file(s) as ` +
            `${input.identity === '-' ? 'ad-hoc (`-`)' : `\`${input.identity}\``} — ${signer.gap}.`,
    );
    // Modes come from the PLAN, exactly as `readStage` insists: the signer
    // rewrites bytes and this re-read must not turn a 0755 launcher into
    // whatever the scratch directory's umask produced.
    return payload.map((entry) => ({
        path: entry.path,
        mode: entry.mode,
        data: new Uint8Array(readFileSync(join(workDir, entry.path.split('/').join(sep)))),
    }));
}

/**
 * What this run will do about notarisation.
 *
 * A SECOND credential and an unrelated one (§ A15): `--sign` names an identity
 * the signing machine holds, `--notarize` names an account credential. They are
 * two flags because they are two inputs, and the reference keeps them in two
 * scripts.
 */
export interface NotaryDescriptor {
    layoutOs: HostOs;
    tool: string;
    notarizeOn: readonly HostOs[];
    installHint: string;
    /**
     * argv after {@link tool}.
     *
     * `credential` is threaded straight into the flag the command consumes, and
     * that is the whole design of {@link resolveNotaryPlan}'s guard. § A15
     * measured the trap: `refs/node/tools/osx-notarize.sh` guards on three
     * environment variables it never uses and then submits with a
     * `--keychain-profile` nothing checked, so the skip is reachable from an
     * input the next line does not read. Here the guarded value IS the argument.
     *
     * ⚠️ `--keychain-profile` is the ONLY shape § A15 found evidenced, and the
     * App Store Connect API-key form (`--key`/`--key-id`/`--issuer`) is NOT
     * implemented because nothing measured it. UNVERIFIED, and marked as such:
     * no run in this repository has ever invoked `notarytool` — notarisation
     * needs an Apple account, which ad-hoc signing deliberately does not.
     */
    args: (credential: string, artifact: string) => readonly string[];
}

export const NOTARIES: Partial<Record<HostOs, NotaryDescriptor>> = {
    darwin: {
        layoutOs: 'darwin',
        tool: 'xcrun',
        notarizeOn: ['darwin'],
        installHint: 'install the Xcode Command Line Tools (`xcode-select --install`) on a macOS host',
        args: (credential, artifact) => ['notarytool', 'submit', '--keychain-profile', credential, '--wait', artifact],
    },
};

export type NotaryPlan =
    | { kind: 'unsupported' }
    | { kind: 'skip'; message: string }
    | { kind: 'notarize'; credential: string; notary: NotaryDescriptor };

/**
 * Resolve the notarisation credential, or say why there is none.
 *
 * Deliberately NOT defaultable from the project. An identity is a name a machine
 * may hold for years and is worth writing into a repository; a notarisation
 * credential is a per-run account credential, and a config key for it is an
 * invitation to commit one.
 */
export function resolveNotaryPlan(input: { flag?: string; layoutOs: HostOs; sign: SignPlan }): NotaryPlan {
    const notary = NOTARIES[input.layoutOs];
    if (notary === undefined) {
        if (input.flag !== undefined) {
            throw new Error(
                `gjsify ship: --notarize has no meaning in the ${input.layoutOs} layout. Notarisation is ` +
                    "Apple's pre-clearance of a signed artifact and nothing else asks for it — Windows " +
                    'SmartScreen accrues reputation per file hash instead (ADR 0024 § A5).',
            );
        }
        return { kind: 'unsupported' };
    }
    if (input.flag === undefined || input.flag === '') {
        return {
            kind: 'skip',
            message:
                `no notarisation credential was given — skipping ${notary.tool} notarytool. Pass ` +
                '`--notarize <keychain-profile>`, naming a profile a prior `notarytool store-credentials` ' +
                "put in this host's keychain.",
        };
    }
    if (input.sign.kind !== 'sign') {
        throw new Error(
            'gjsify ship: --notarize was given without an identity to sign with. Notarisation is a check ' +
                'ON a signature, so submitting an unsigned artifact has nothing to clear. Pass ' +
                '`--sign <identity>` as well, or drop --notarize.',
        );
    }
    return { kind: 'notarize', credential: input.flag, notary };
}

/**
 * Submit one written artifact for notarisation.
 *
 * ⚠️ UNVERIFIED END TO END. Everything up to the `spawnToCompletion` is covered
 * — the argv by `signing.spec.ts`, the guard and both refusals by
 * `tests/e2e/ship-signing` — and the invocation itself has never run: it needs
 * an Apple Developer account, and § A17's whole point is that M6's proof does
 * not. Whoever first runs this on a real credential should record what it did
 * beside § A15, which is where the question was left open.
 */
export async function notarizeArtifact(input: {
    plan: Extract<NotaryPlan, { kind: 'notarize' }>;
    /** The artifact to submit. Must be a FILE — notarytool takes an archive or an installer. */
    artifact: string;
    verbose: boolean;
    log: (line: string) => void;
}): Promise<void> {
    const { notary, credential } = input.plan;
    const host = process.platform as HostOs;
    if (!notary.notarizeOn.includes(host)) {
        throw new Error(
            `gjsify ship: notarising the ${notary.layoutOs} layout needs ${notary.tool}, which runs on ` +
                `${notary.notarizeOn.join(', ')} and this host is ${host}.`,
        );
    }
    const args = notary.args(credential, input.artifact);
    if (input.verbose) input.log(`${notary.tool} ${args.join(' ')}`);
    const result = await spawnToCompletion(notary.tool, args, {
        completion: 'return',
        stdio: 'inherit',
        notFound: () => new Error(`gjsify ship: \`${notary.tool}\` is not on PATH — ${notary.installHint}.`),
    });
    if (result.code !== 0) {
        throw new Error(`gjsify ship: ${notary.tool} notarytool failed with ${describeExit(result)}.`);
    }
    input.log(`${notary.tool} notarytool accepted ${input.artifact}. The artifact is NOT stapled.`);
}
