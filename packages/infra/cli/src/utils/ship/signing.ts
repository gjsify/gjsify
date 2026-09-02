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
//     re-sign-proof than a digest. BOTH halves are measured and they agree:
//     append one byte to a staged file and `readStage` refuses with "… is 6
//     bytes in the stage and 5 in its manifest"; and an ad-hoc `codesign
//     --force --sign -` over one staged image took it from 34 816 to 34 848
//     bytes (+32) on macos-latest/arm64. {@link signPayload} therefore TAKES what `readStage`
//     returned and RETURNS what the packer consumes: the signed bytes cannot
//     exist before the validation, because they are computed from its output,
//     and the arriving stage is never written to at all.
//
// THREE THINGS THIS FILE USED TO REFUSE TO DO, and the measurement that changed
// each of them (ADR 0040). Every one is marked UNVERIFIED where it is: this
// repository has no macOS host of its own, so what follows is argv and file
// structure decided from Apple's documentation and held by unit tests, with the
// darwin CI leg as the only thing that has ever run `codesign` here.
//
//  * IT NOW SEALS THE `<App>.app` BUNDLE, and the reason it did not was WRONG.
//    The header used to say a bundle seal "would not survive into the `.zip`"
//    because a script main executable's signature lives in an extended attribute
//    and the payload round trip carries none. That is Apple's rule for a LOOSE
//    file, not for a bundle. Apple's TN3126 gives four cases and ours is the
//    second: *"If the item is a bundle without a Mach-O image, the code signature
//    is stored in the bundle's _CodeSignature directory"* — regular files, mode
//    0644, which a plain zip carries like any other. TN2206 states the same from
//    the other side: *"a properly-signed app that has all of its files in the
//    correct places will not contain any signatures stored as extended
//    attributes."* So the seal is reachable, and what was actually blocking it was
//    this file's own refusal of a changed file set. {@link signPayload} now allows
//    exactly the additions the seal makes and still refuses every other one.
//  * IT NOW PASSES `--options runtime`, `--entitlements` and (for a real identity)
//    `--timestamp`. The hardened runtime is a bit in the CODE DIRECTORY, which an
//    ad-hoc signature has, so the flag is accepted with `--sign -` as it is with a
//    Developer ID. `--timestamp` is not: a timestamp lives in the CMS structure
//    and an ad-hoc signature has no CMS and no certificate to pin, so it is passed
//    only for a named identity — and Apple documents nothing about what
//    `codesign --sign - --timestamp` does, which is a second reason not to send it.
//  * IT NOW STAPLES what `stapler` accepts. `stapler(1)` is explicit —
//    *"stapler works only with UDIF disk images, signed \"flat\" installer
//    packages, and certain code-signed executable bundles such as \".app\""* — and
//    Apple's notarisation guide adds the exception that decides our zip:
//    *"While you can notarize a ZIP archive, you can't staple to it directly.
//    Instead, run stapler against each item that you added to the archive."*
//    `canCarryTicket` in `utils/ship/formats.ts` is that fact per format, so the
//    `.dmg` is stapled and the `.zip` is told what a user has to do instead.
//
// WHAT IS STILL NOT DONE, deliberately: `signtool` is never given a timestamp URL
// (see the win32 row), and the entitlement § A16 is about —
// `com.apple.security.cs.disable-library-validation` — is NOT granted, because
// § A4's re-sign of every image in the closure is the design of record and
// granting the entitlement would quietly make it look unnecessary.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

import { isOnPath } from '../check-system-deps.js';
import { describeExit, spawnToCompletion } from '../spawn.js';
import { listFilesRecursive } from './discover.js';
import { classifyBinary, type PayloadEntry } from './payload.js';
import { renderEntitlements } from './plist.js';
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
    args: (input: SignArgs) => readonly string[];
    /**
     * The entitlements this signer asks for, or `[]` where the OS has none.
     *
     * `[]` is an ANSWER and not an omission — the same rule `Layout.metadata`
     * states. Windows has no equivalent concept at all, and a signer that granted
     * nothing on macOS would be a different decision from one that has nothing to
     * grant.
     */
    entitlements: readonly string[];
    /**
     * Does this signer seal the ARTIFACT ROOT after signing the images inside it?
     *
     * Only true where the OS has a bundle format, which is darwin alone. The root
     * itself is not on the descriptor because it belongs to the LAYOUT
     * (`Layout.root`), and a second copy here is where the two would come apart.
     */
    sealsBundle: boolean;
    /**
     * Payload paths a seal is allowed to ADD, given the artifact root.
     *
     * A PREFIX rather than a free hand: `codesign` on a bundle writes
     * `Contents/_CodeSignature/{CodeResources,CodeDirectory,CodeRequirements,
     * CodeRequirements-1,CodeSignature}` and nothing else, so anything appearing
     * outside that directory is something else having run — which is exactly the
     * class {@link signPayload}'s file-set check exists to catch.
     */
    sealAddPrefix: (bundleRoot: string) => string;
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
        //
        // `--options runtime` on BOTH identities and `--timestamp` on only one:
        // the hardened runtime is a code-directory bit, which an ad-hoc signature
        // has, while a timestamp is a CMS countersignature over a CERTIFICATE, and
        // an ad-hoc signature has neither ("Ad-hoc signing does not use an identity
        // at all", `codesign(1)`). Apple documents nothing about what
        // `--sign - --timestamp` does, so it is not sent rather than guessed at —
        // and the one thing `codesign(1)` does promise about the flag is that "if
        // the timestamp authority service cannot be contacted … the signing
        // operation will fail", which is not a failure worth inventing for a
        // signature that cannot carry the result.
        args: ({ identity, file, entitlements, adhoc }) => [
            '--force',
            '--sign',
            identity,
            '--options',
            'runtime',
            ...(entitlements === undefined ? [] : ['--entitlements', entitlements]),
            ...(adhoc ? [] : ['--timestamp']),
            file,
        ],
        // FOUR OF THE REFERENCE'S SIX, and both omissions are decisions:
        //
        //  * `com.apple.security.cs.get-task-allow` is granted by
        //    `refs/node/tools/osx-entitlements.plist:15` and is a DEBUGGING
        //    entitlement — it lets another process attach to this one. Apple's
        //    notarisation rules refuse a Developer-ID artifact carrying it, so
        //    shipping it would trade a working debug build for an artifact that
        //    cannot be distributed. The reference signs its own build; we sign what
        //    a stranger downloads.
        //  * `com.apple.security.cs.disable-library-validation` is § A16's open
        //    question and stays open. § A4's design of record is that every Mach-O
        //    in the closure is re-signed with the SAME identity as the launcher, so
        //    library validation has nothing to object to — and granting the
        //    entitlement anyway would make that re-sign look optional the first
        //    time somebody reads this list.
        //
        // The four that remain are what a shipped V8 needs under a hardened
        // runtime, plus the one our own loader story needs:
        // `@gjsify/node-gi`'s `maybeReexecForGtkRuntime` sets `DYLD_*` for its
        // child on darwin, and a hardened process may not do that without
        // `allow-dyld-environment-variables`.
        entitlements: [
            'com.apple.security.cs.allow-jit',
            'com.apple.security.cs.allow-unsigned-executable-memory',
            'com.apple.security.cs.disable-executable-page-protection',
            'com.apple.security.cs.allow-dyld-environment-variables',
        ],
        // The `.app` is a bundle, and a bundle's signature is the seal over its
        // whole tree — the images alone leave `codesign --verify` with nothing to
        // read at the bundle level.
        sealsBundle: true,
        sealAddPrefix: (bundleRoot) => `${bundleRoot}/Contents/_CodeSignature/`,
        configKey: 'gjsify.ship.sign.darwin.identity',
        gap:
            'the images are signed and the bundle is sealed; UNVERIFIED end to end — no macOS host in this ' +
            'repository has run a `--sign` over a real `.app`, and ADR 0024 § A16 still leaves library ' +
            'validation unmeasured',
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
        args: ({ identity, file }) => ['sign', '/n', identity, '/fd', 'sha256', file],
        // Windows has no equivalent concept. An Authenticode signature carries no
        // capability claims — what a hardened runtime and an entitlement do on
        // macOS is done on Windows by the manifest and by AppContainer, neither of
        // which this signer touches.
        entitlements: [],
        // A Windows program directory is a DIRECTORY and nothing more: there is no
        // manifest to seal and no per-directory signature format. `signtool` signs
        // images, one at a time, which is what the loop above already does.
        sealsBundle: false,
        sealAddPrefix: () => '',
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

/**
 * What a signing run did to the payload's FILE SET, split three ways.
 *
 * PURE, and extracted from {@link signPayload} for one reason: it is the whole of
 * the seal decision and the only half of it that can be checked without a macOS
 * host. Everything else about a bundle seal needs `codesign`, which this
 * repository has on exactly one CI leg; this function needs nothing.
 *
 * `sealPrefix` absent means "this signer seals nothing", and then EVERY addition
 * is unexpected — which is what the file did before ADR 0040 and is still the
 * right answer for `signtool`.
 */
export function partitionSignedFileSet(input: {
    /** Paths found under the scratch directory after the tool ran. */
    arrived: readonly string[];
    /** Paths the payload had before it. */
    planned: readonly string[];
    /** Directory prefix the seal is allowed to write into, when there is one. */
    sealPrefix?: string;
}): { sealed: string[]; unexpected: string[]; removed: string[] } {
    const planned = new Set(input.planned);
    const arrived = new Set(input.arrived);
    const added = [...arrived].filter((path) => !planned.has(path)).sort();
    const prefix = input.sealPrefix;
    return {
        sealed: prefix === undefined ? [] : added.filter((path) => path.startsWith(prefix)),
        unexpected: prefix === undefined ? added : added.filter((path) => !path.startsWith(prefix)),
        removed: [...planned].filter((path) => !arrived.has(path)).sort(),
    };
}

/** What one invocation of a signing tool is given. */
export interface SignArgs {
    identity: string;
    /** Absolute path of the file — or, for a bundle seal, of the bundle DIRECTORY. */
    file: string;
    /** Absolute path of the entitlements plist this run wrote, or absent when the signer grants none. */
    entitlements?: string;
    /** Is {@link identity} the reserved ad-hoc `-`? */
    adhoc: boolean;
}

/** `codesign --sign -`: the one identity value that names no identity at all. */
export const ADHOC_IDENTITY = '-';

export interface SignPayloadInput {
    /** What `readStage` returned — the PRE-sign tree, already held against the manifest. */
    payload: readonly PayloadEntry[];
    identity: string;
    signer: SignerDescriptor;
    /** A scratch directory this function owns and WIPES. Never the arriving stage. */
    workDir: string;
    /**
     * `Layout.root` — the payload-relative directory that IS the artifact, or `''`.
     *
     * Read only by a signer that seals: it is what `codesign` is pointed at, and
     * it comes from the layout rather than from this table because the layout is
     * what decided the `<App>.app` name in the first place.
     */
    bundleRoot: string;
    /**
     * Where to write the entitlements plist, OUTSIDE {@link workDir}.
     *
     * Outside is not a preference: the file-set check below lists `workDir` and
     * compares it with the payload, so an entitlements file written inside would
     * read as a file the signer added.
     */
    entitlementsPath: string;
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
 * TWO STEPS ON DARWIN, ONE EVERYWHERE ELSE: every Mach-O in the closure, then the
 * bundle itself. The second is what `codesign --verify <App>.app` reads, and it
 * writes five regular files into `Contents/_CodeSignature/` that the returned
 * payload carries — so the seal reaches the `.zip` and the `.dmg` alike, which is
 * the correction ADR 0040 makes to this file's previous claim that it could not.
 *
 * THE FILE SET MAY ONLY GROW WHERE THE SEAL WRITES, and that is asserted rather
 * than assumed. Both tools rewrite an image in place, so a payload that gained a
 * path outside `sealAddPrefix` — or lost one anywhere — means something else ran,
 * and its files would be packed with no mode from the plan.
 */
export async function signPayload(input: SignPayloadInput): Promise<PayloadEntry[]> {
    const { payload, signer, workDir } = input;
    writePayload(workDir, payload, '');

    const adhoc = input.identity === ADHOC_IDENTITY;
    let entitlements: string | undefined;
    if (signer.entitlements.length > 0) {
        mkdirSync(dirname(input.entitlementsPath), { recursive: true });
        writeFileSync(input.entitlementsPath, renderEntitlements(signer.entitlements));
        entitlements = input.entitlementsPath;
    }
    const run = async (file: string, what: string): Promise<void> => {
        const args = signer.args({ identity: input.identity, file, adhoc, ...(entitlements ? { entitlements } : {}) });
        if (input.verbose) input.log(`${signer.tool} ${args.join(' ')}`);
        const result = await spawnToCompletion(signer.tool, args, {
            completion: 'return',
            cwd: workDir,
            stdio: 'inherit',
            notFound: () => new Error(`gjsify ship: \`${signer.tool}\` is not on PATH — ${signer.installHint}.`),
        });
        if (result.code !== 0) {
            throw new Error(
                `gjsify ship: ${signer.tool} failed on ${what} with ${describeExit(result)}. ` +
                    'Nothing is packed from a payload whose signature failed: an artifact that is half ' +
                    'signed installs and is refused at first launch, which is worse than not shipping.',
            );
        }
    };

    const signable = payload.filter((entry) => classifyBinary(entry.data) === signer.signs);
    if (signable.length === 0 && !signer.sealsBundle) {
        // NOT silent, and not an error either. A `--app gjs` payload really is
        // JavaScript and a launcher, so there is nothing for the loader to
        // validate — but a run that asked for a signature and made none has to
        // say so, or "signed" and "signed nothing" look identical in the log.
        //
        // `&& !sealsBundle` is what keeps the message TRUE rather than what
        // narrows it: a darwin run with no image still seals the bundle, which is
        // a signature, so printing "the artifact carries no signature" there would
        // be the log contradicting the artifact.
        input.log(
            `nothing in this payload is a ${signer.signs === 'macho' ? 'Mach-O' : 'PE'} image, so ` +
                `${signer.tool} signed 0 file(s). The artifact carries no signature.`,
        );
        return [...payload];
    }

    for (const entry of signable) {
        await run(join(workDir, entry.path.split('/').join(sep)), entry.path);
    }

    // THE IMAGES FIRST, THE SEAL LAST, and the order is not stylistic: a bundle
    // seal hashes the files it seals, so sealing before the closure is signed
    // would record the digests of the images this run is about to replace and
    // produce a bundle that verifies against a tree it no longer contains.
    let sealPrefix: string | undefined;
    if (signer.sealsBundle) {
        if (input.bundleRoot === '') {
            throw new Error(
                `gjsify ship: the ${signer.layoutOs} signer seals a bundle and this layout has no root to ` +
                    'seal. `Layout.root` is what names the artifact directory; a signer that sealed the whole ' +
                    'stage would sign the payload of every other format beside it.',
            );
        }
        sealPrefix = signer.sealAddPrefix(input.bundleRoot);
        await run(join(workDir, input.bundleRoot.split('/').join(sep)), `${input.bundleRoot} (bundle seal)`);
    }

    // THE FILE SET MAY ONLY GROW WHERE THE SEAL WRITES. Both tools rewrite an
    // image in place, so any other new path means something else ran — and a file
    // that appeared unnoticed would be packed with no mode from the plan, while
    // one that vanished would be packed as absent.
    const changes = partitionSignedFileSet({
        arrived: listFilesRecursive(workDir),
        planned: payload.map((entry) => entry.path),
        ...(sealPrefix === undefined ? {} : { sealPrefix }),
    });
    if (changes.unexpected.length > 0 || changes.removed.length > 0) {
        throw new Error(
            `gjsify ship: ${signer.tool} changed the payload's file set — ` +
                `${changes.unexpected.length} added (${changes.unexpected.slice(0, 3).join(', ') || '—'}), ` +
                `${changes.removed.length} removed (${changes.removed.slice(0, 3).join(', ') || '—'}). ` +
                'Signing is a mutation of the files that are already in the payload (ADR 0024 § A4), plus ' +
                `exactly the seal's own directory${sealPrefix === undefined ? '' : ` (\`${sealPrefix}\`)`}.`,
        );
    }

    const sealed = changes.sealed;
    input.log(
        `${signer.tool} signed ${signable.length} of ${payload.length} payload file(s) as ` +
            `${adhoc ? 'ad-hoc (`-`)' : `\`${input.identity}\``}` +
            `${sealPrefix === undefined ? '' : ` and sealed ${input.bundleRoot} (${sealed.length} seal file(s))`}` +
            ` — ${signer.gap}.`,
    );
    // Modes come from the PLAN, exactly as `readStage` insists: the signer
    // rewrites bytes and this re-read must not turn a 0755 launcher into
    // whatever the scratch directory's umask produced. The seal's own files have
    // no plan entry — they did not exist when the plan was made — so they take
    // 0644, which is what `codesign` writes them as
    // (`bundlediskrep.cpp`: `O_WRONLY | O_CREAT | O_TRUNC, 0644`).
    const read = (path: string): Uint8Array => new Uint8Array(readFileSync(join(workDir, path.split('/').join(sep))));
    return [
        ...payload.map((entry) => ({ path: entry.path, mode: entry.mode, data: read(entry.path) })),
        ...sealed.map((path) => ({ path, mode: 0o644, data: read(path) })),
    ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
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
    input.log(`${notary.tool} notarytool accepted ${input.artifact}.`);
}

/**
 * Attach the notarisation ticket to an artifact that can hold one.
 *
 * WHY IT IS A SEPARATE CALL AND NOT THE TAIL OF {@link notarizeArtifact}: not
 * every artifact the notary service ACCEPTS can carry a ticket, and the pair that
 * comes apart is exactly the one this command produces. Apple:
 * *"While you can notarize a ZIP archive, you can't staple to it directly.
 * Instead, run stapler against each item that you added to the archive. Then
 * create a new ZIP file containing the stapled items for distribution."*
 * `stapler(1)` gives the accepting side of the same list: *"stapler works only
 * with UDIF disk images, signed \"flat\" installer packages, and certain
 * code-signed executable bundles such as \".app\"."* So the `.dmg` is stapled
 * here and the `.zip` is told, in the artifact log, what a person has to do
 * instead — which is a fact about the CONTAINER and therefore lives on the format
 * (`canCarryTicket`), not in a branch here.
 *
 * ⚠️ UNVERIFIED END TO END, for the same reason `notarizeArtifact` is: stapling
 * needs a real notarisation, which needs an Apple account (ADR 0024 § A15, § A17).
 * The argv is unit-tested and the invocation has never run in this repository.
 *
 * `stapler(1)` also states the constraint that decides the ORDER: *"Stapling does
 * not invalidate the code signature and must be run after an executable or archive
 * has been code-signed and notarized … Code-signing a supported file format
 * invalidates any stapled tickets"* — so nothing may re-sign after this, and
 * nothing in `packOne` does.
 */
export async function stapleArtifact(input: {
    notary: NotaryDescriptor;
    artifact: string;
    verbose: boolean;
    log: (line: string) => void;
}): Promise<void> {
    const args = ['stapler', 'staple', input.artifact];
    if (input.verbose) input.log(`${input.notary.tool} ${args.join(' ')}`);
    const result = await spawnToCompletion(input.notary.tool, args, {
        completion: 'return',
        stdio: 'inherit',
        notFound: () =>
            new Error(`gjsify ship: \`${input.notary.tool}\` is not on PATH — ${input.notary.installHint}.`),
    });
    if (result.code !== 0) {
        throw new Error(
            `gjsify ship: ${input.notary.tool} stapler failed with ${describeExit(result)}. The artifact is ` +
                'notarised and NOT stapled, which means every launch asks Gatekeeper to check online — and ' +
                'fails closed on a machine with no network. Re-run the finish phase; `stapler` requires ' +
                'internet access and the ticket may not have propagated yet.',
        );
    }
    input.log(`${input.notary.tool} stapler attached the ticket to ${input.artifact}.`);
}
