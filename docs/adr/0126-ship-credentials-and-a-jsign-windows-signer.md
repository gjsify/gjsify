# 126. `gjsify ship credentials`, and a Windows signer that is not bound to a Windows host

- Status: **Accepted** (2026-10-30)
- Date: 2026-10-30
- Deciders: Pascal Garber
- Related: [ADR 0024](0024-ship-installable-artifacts.md) (§ A1 the host owns the format, § A5
  Apple is the binding constraint, § A12–§ A17 the signing interface), [ADR
  0040](0040-gui-launcher-and-the-macos-seal.md) (the darwin seal and notarisation), [ADR
  0124](0124-ship-writes-a-release-record-per-artifact.md) (the release record names the
  signature); `packages/infra/cli/src/utils/ship/signing.ts` (`SIGNERS`, `NOTARIES`),
  `packages/infra/cli/src/commands/trust.ts` (the model for a command that talks to a service on
  the user's behalf), `docs/ship-formats.md` § Signing

## Context

ADR 0024 § A14 settled that `gjsify ship` never sees a certificate: `--sign` takes an identity
string, and getting the key where `codesign` finds it is "the signing HOST's job, a machine setup
or a CI job, not this command". That decision stands. What it left unowned is the job itself, and
every app repository now writes it by hand, twice:

1. **Uploading.** Base64 a `.p12`, then `gh secret set` five Apple secrets
   (`APPLE_DEVELOPER_ID_P12_BASE64`, `APPLE_DEVELOPER_ID_P12_PASSWORD`, `APPLE_NOTARY_KEY_P8`,
   `APPLE_NOTARY_KEY_ID`, `APPLE_NOTARY_ISSUER_ID`). Nothing checks that all five were set, that
   they are the right five, or that none went through a shell history.
2. **Installing.** Each release workflow imports the `.p12` into a throwaway keychain, makes it
   the *default* keychain (`notarytool` reads only that one), and runs
   `notarytool store-credentials gjsify-notary`. § A14 marked this incantation UNVERIFIED and
   § A15 marked the notary credential form as unmeasured; the hand-rolled copies are where that
   knowledge now lives, once per repository, and drifts.

Both halves are a fixed procedure over a fixed list of names, which is data plus a loop, the shape
`SIGNERS` and `NOTARIES` already have.

The Windows half is in worse state. `SIGNERS.win32` runs `signtool sign /n <subject> /fd sha256`.
It has never run in this repository (ADR 0040 still lists it UNVERIFIED), it only works on a
Windows host (`signOn: ['win32']`), so a Linux job that assembles and packs the `.msi` with
`wixl` cannot sign it, and it requests no timestamp (the row's own `gap` string says so). The
route that fits a CI pipeline without a long-lived secret is cloud signing, and § A5 already
noted it: Windows has one, Developer ID has none. Azure Artifact Signing (formerly Azure Trusted
Signing) issues certificates that live **three days**; jsign's documentation states this and
that "timestamping is necessary to ensure the long term validity of the signature". An
untimestamped signature from such a certificate stops validating on the fourth day, so the
timestamp is not an option of this signer, it is the signature.

## Decision

### D1. `gjsify ship credentials` owns the credential procedure, one table row per OS

A new subcommand group beside `ship`, shaped like `trust` (`Command<unknown, Options>`, `--dry-run`,
a declared remote it talks to), with three verbs and one table:

```
gjsify ship credentials upload  <os> --repo <owner/name> [per-secret source flags] [--dry-run]
gjsify ship credentials install <os> [--remove] [--dry-run]
gjsify ship credentials check   <os> [--repo <owner/name>] [--json]
```

`CREDENTIALS: Partial<Record<HostOs, CredentialSet>>` lives in `utils/ship/credentials.ts` beside
`signing.ts`, keyed by the layout's OS exactly as `SIGNERS` is. A second OS is a row, not a
branch. A row lists, per entry: the secret NAME, how its value is sourced on upload (`file`
base64-encoded, `file` verbatim, `prompt`, or `env`), and whether it is a secret at all. The
three verbs read that one table, so they cannot disagree about which names exist.

| | darwin | win32 |
|---|---|---|
| secrets | the five names above | none |
| variables (identifiers, not secrets) | none | the Entra application and tenant identifiers the OIDC login needs |
| `install` | temp keychain, notary profile | validates only (D4) |

`SIGNERS` and `NOTARIES` stay as they are; the new table is separate for the reason § A14 gave for
`FORMATS` and `SIGNERS`: a credential is per RUN and per HOST, not per format.

**`upload`** reads the credential FILES from paths the user gives and pushes each value with
`gh secret set <NAME> --repo <owner/name>`, the value written to the child's **stdin**, never
placed in argv (a process list is readable; `gh secret set` reads stdin when `--body` is absent,
per `gh`'s manual, not exercised in this repository). The `.p12` is base64-encoded in memory.
The command never prints a value, a path's content or a digest of one; it prints the names it
set. Identifiers that are not secrets (key id, issuer id keep the existing secret names for
compatibility; the Entra identifiers are set with `gh variable set`) follow the same rule: a
value comes from a file, a prompt or a named environment variable, never from a flag.

**`install`** runs in CI and materialises what `upload` stored. Darwin, in this order:

1. refuse outside CI unless `--force`: step 3 changes the user's default keychain, which on a
   developer machine is not a thing to do by accident;
2. create a `0700` temp directory; write the `.p12` and `.p8` from the environment into it, mode
   `0600`;
3. `security create-keychain`, `set-keychain-settings`, `unlock-keychain` on a keychain whose
   password is generated in memory for the run;
4. `security import` the `.p12`, then `security set-key-partition-list` so `codesign` is allowed
   the key without a prompt;
5. put the keychain first on the user search list **and make it the default**, remembering the
   previous values in a state file in the temp directory (no secret in it);
6. `xcrun notarytool store-credentials gjsify-notary` from the `.p8`, key id and issuer id, which
   lands in the default keychain and so dies with it;
7. delete the key files at once, not at the end; print the signing identity's common name (public
   in every signed file) so the workflow can pass it to `--sign`.

`install darwin --remove` deletes the keychain, restores the default and the search list from the
state file and removes the temp directory. A failure at any step removes what was created so far
and exits non-zero.

**`check`** says which names are present and which are missing, never a value. With `--repo` it
reads `gh secret list` / `gh variable list` (names only); without it, it reads the process
environment, which is what a workflow step sees. **A set is all-or-nothing:** signing needs every
entry, so a partial set exits non-zero and says which half is missing. That is § A15's rule
applied one level up: the guard must test what the command consumes, and a `.p12` without a
notary key is not "mostly signed". A missing set is still not an error for `ship` itself: `ship`
keeps § A13 (skip, loudly, exit 0) and its skip message now names `credentials check`. What a
**tag release** does about a missing set is the workflow's decision: it runs `check` and lets the
non-zero exit stand, while a pull request or a fork runs `check || true` and ships unsigned. The
CLI has no notion of "tag", and gains none.

**All three verbs** share three rules: a secret is written to disk only inside a temp directory
the same run removes (also on failure and on a signal); a secret is never logged, including in
`--verbose` and in a thrown error's message; `--dry-run` prints the `gh` and `security` argv with
every value replaced by its name, and touches nothing.

### D2. Rejected for D1

- **Keep the shell in each app repository.** It works until the third repository; the keychain
  sequence has four ordering traps (`unlock` before `import`, partition list, default keychain,
  profile in the default keychain) and each copy re-learns them. There is also nothing to unit
  test, and no `check` to put in front of a tag release.
- **A reusable GitHub Action in this repository as THE mechanism.** It would be GitHub-only, it
  cannot run `upload` (which is local, with the user's `gh` login), and it forks the table of
  names into `action.yml`. Not rejected as a *wrapper*: a three-line composite action that calls
  `gjsify ship credentials install` is compatible with this ADR and can come later.
- **`fastlane match`.** It adds a Ruby toolchain and a second long-lived store (an encrypted
  repository or bucket of certificates), and it creates and rotates certificates through an
  Apple ID, which is a different and larger trust grant than "use this `.p12` I made". It is also
  Apple-only; gjsify needs the same verb for Windows.
- **Putting the `.p12` path or password on `ship --sign`.** § A12 and § A14 stand: the CLI that
  makes the signature is never handed the certificate.

### D3. The Windows signer is jsign, and it signs on any host

`SIGNERS.win32` is replaced:

| | was | becomes |
|---|---|---|
| tool | `signtool` | `jsign` |
| `signOn` | `['win32']` | `['linux', 'darwin', 'win32']` |
| key location | a certificate store, looked up by `/n <subject>` | a cloud signing service, looked up by account and profile |
| timestamp | none | always, RFC 3161 |

jsign is Java, runs on Linux, macOS and Windows, signs PE images and `.msi`, and has a
`TRUSTEDSIGNING` store type for Azure Artifact Signing (all from jsign's documentation at
`ebourg.github.io/jsign`). The consequence is the point of the change: the Windows leg
(`gjsify ship windows`) can assemble, pack the `.msi` with `wixl` **and** sign on one Linux job.
`--from-stage` on a Windows host is no longer needed for signing; it keeps working.

**The argv, per jsign's documented options** (each flag below appears in that documentation):

```
jsign --storetype TRUSTEDSIGNING
      --keystore  <endpoint host>
      --alias     <account>/<certificate profile>
      --storepass env:<variable holding the access token>
      --alg       SHA-256
      --tsaurl    http://timestamp.acs.microsoft.com
      --tsmode    RFC3161
      <files…>
```

- **`--tsmode RFC3161` is part of the decision.** jsign's documented default mode is
  `Authenticode`, so a bare `--tsaurl` pointing at an RFC 3161 service would talk the wrong
  protocol. Microsoft's own signing-integration guide passes `http://timestamp.acs.microsoft.com`
  to `signtool` as `/tr`, which is signtool's RFC 3161 flag (learn.microsoft.com,
  `azure/artifact-signing/how-to-signing-integrations`, read 2026-10-30).
- **The timestamp is mandatory, not a field.** The descriptor emits it unconditionally; there is
  no flag, config key or environment variable that omits it. jsign enables timestamping itself
  for this store type (its documentation says so), and the explicit flags pin the authority and
  mode instead of leaving them to a default that may change. A timestamp that cannot be obtained
  fails the signing (jsign retries, three times by default, ten seconds apart) and so fails
  `ship`. A signature without a timestamp is never produced.
- **The token never enters argv.** jsign's `--storepass` accepts an `env:` prefix; `gjsify ship`
  puts the token in a variable of the child's environment only. A process listing shows the
  variable's name.
- **One invocation per run, not per file.** jsign's documentation warns that each invocation
  makes an extra call to the signing API to fetch the chain, and recommends one invocation with
  a file list. The win32 row therefore signs the whole payload batch in one call. This changes
  the shape of `SignerDescriptor.args` (today `ONE file`); the darwin row keeps per-file calls.

**Identity syntax.** § A12's one-flag interface is kept; the value on win32 is

```
--sign azure:<endpoint host>#<account>/<certificate profile>
```

for example `azure:weu.codesigning.azure.net#my-account/my-profile`, parsed by one pure function
and settable as `gjsify.ship.sign.win32.identity`. The leading `https://` is accepted and
stripped (jsign's own example passes a bare host). `#` separates the endpoint from the
`<account>/<profile>` alias; neither a host name nor, to the best of our knowledge, an Azure
account or profile name can contain it (UNVERIFIED against the service's naming rules). The
`azure:` prefix is a namespace, not decoration: jsign has a dozen other store types, any of which
could become a row of the grammar later, and an unknown prefix is refused with the list of known
ones. A bare subject name (the old `/n` form) is refused with the same message, because there is
no store to look it up in any more.

There is deliberately no file-keystore form (`pfx:`): it would put a certificate on this
surface, which § A12 refuses, and Azure Artifact Signing is what the target audience of a
"stranger can ship" tool can get without buying a hardware token.

**The token** comes from, in order: the environment variable `AZURE_ACCESS_TOKEN`; else
`az account get-access-token --resource https://codesigning.azure.net`, the command jsign's
documentation names. In CI it is obtained by `azure/login` with a **federated credential**
(GitHub OIDC); no client secret exists. The identity needs the role *Artifact Signing
Certificate Profile Signer* (Microsoft's current name, same guide as above; jsign's documentation
still uses an older one), and no other role.

**What is signed, and in which order.** Every PE image in the payload (`signs: 'pe'`, the
existing magic-number predicate), then, after `wixl` has packed it, the `.msi` itself. This is
the order ADR 0040 gave darwin, "images first, container last": the container's bytes contain
the images' bytes, so the images are final before it is built, and the container's signature
covers the finished file. Two existing rules carry over unchanged: `signPayload` TAKES what
`readStage` validated and RETURNS what the packer consumes (§ A17, § A18: a signature changes a
file's size, so the order is structural), and signing the `.msi` is a step on the artifact the
way `signDmgImage` is for a `.dmg`. Today nothing signs the `.msi` at all (`grep` over
`packages/infra/cli/src` finds no signing of it); that is part of this change.

**`signtool` is not kept as a fallback row.** One signer per layout is the rule `SIGNERS` is
built on, and a fallback is a second path with its own unproven argv. Everything `signtool` can
do on a Windows host with a certificate in a store, jsign can do there too with a PKCS#12
keystore, and a fork that wants that path has a documented route out: `gjsify ship` leaves the
unsigned `.msi` and the user signs it however they like. The `/n` form that nothing here ever
ran is removed rather than carried as a claim.

**SmartScreen is unchanged** (§ A5): Authenticode buys a named publisher and tamper evidence,
and SmartScreen reputation still accrues per file hash. The ADR 0124 record continues to hold
no stronger state than `signed` for win32.

### D4. `credentials` on win32 stores identifiers and validates, it does not import

With federated login there is no secret to store, so `upload win32` sets only the
non-secret Entra identifiers as repository **variables**, and `install win32` has nothing to
import. It is `check` plus probes: `jsign` and `java` are on `PATH`, the `--sign` / config
identity parses, and an access token is obtainable (without printing it). `--remove` is a no-op
that says so. The row exists so a caller writes the same two lines for both OSes.

### D5. Out of scope

- **Microsoft Store (MSIX).** The Store re-signs the package, so it needs a different
  credential (a publisher identity from the Store, not a code-signing certificate) and a
  different format. It is a future format row; jsign lists `.msix` as a supported file type, so
  the signer would not be the obstacle.
- **Linux package signing** (`debsigs`, `rpmsign`): unchanged, § `resolveSignPlan`'s refusal
  stands.
- **A Developer ID route without a `.p12`.** Apple offers none.

## Consequences

- **Every release workflow shrinks to one `check` and one `install`**, and the keychain
  procedure is held by unit tests in one place instead of by copies. The drift § A14 predicted
  ("whoever implements M6 measures that step on a real runner") has one place to land.
- **The first long-lived signing secrets in a gjsify consumer are the five Apple ones** (§ A5);
  this ADR makes uploading them safe and checkable but does not remove them. Windows adds none.
- **The darwin install sequence is inherited from § A14's UNVERIFIED note.** `store-credentials`
  with a `.p8` key and the partition-list call are unmeasured in this repository. The first
  implementation PR must include a real run and record the measured sequence over this one.
- **The keychain password appears in argv on the runner** (`security create-keychain -p`). A CI
  runner is an ephemeral single-job machine, which is why `install` refuses a non-CI host; there
  is no stdin form of the call to use instead.
- **`SignerDescriptor` changes shape in two places** (`args` takes a batch; the identity gets a
  parser and an environment). Darwin must not regress: per-file argv and ordering are held by the
  existing tests.
- **Signing hundreds of DLLs costs signing-API calls.** A GTK runtime bundle for Windows is many
  PE files. Whether Azure Artifact Signing meters or rate-limits per file is UNVERIFIED (open
  question 2); signing every PE is the decision here, and it is the expensive end.
- **The release record's `identity`** (ADR 0124) is the certificate subject for darwin. For win32
  the `--sign` value is an Azure account and profile, not a subject, so the record needs the
  subject read back from the signed file (open question 3). Until then it must not claim a
  subject it did not read.
- **Java becomes a build-host prerequisite for signing on Windows**, and only there. Assembly and
  every non-signing path stay Java-free.
- **The unsigned path is untouched.** No credential still means "skip, loudly, exit 0".

## Test plan

- **Unit, no network and no credential:**
  - the jsign argv for a fixture identity: timestamp URL and mode always present, `--alg
    SHA-256`, the token reference is `env:…` and the token's value appears nowhere in argv;
  - the identity grammar: accepted spellings, stripped scheme, and a refusal for each of a bare
    subject, an unknown prefix, a missing `#`, a missing `/`;
  - `CREDENTIALS` rows against `upload`, `check` and `install` with a fake `gh` and a fake
    `security` on `PATH` that record argv and stdin: names set, values only on stdin, a partial
    set fails `check`, `--dry-run` runs nothing;
  - a canary value planted in every secret never appears in captured stdout, stderr or a thrown
    message, and the temp directory is gone after success, after a failed step and after a
    signal;
  - the Windows signing order, using a fake `jsign` that appends bytes: `readStage` validates the
    pre-sign tree, the packer consumes the signed one, the `.msi` is signed last.
- **E2E, skipped without the tool or credential, loudly:** extend `tests/e2e/ship-signing` with a
  win32 half that needs `jsign`, Java and a token, and a `…REQUIRE_…=1` switch, analogous to
  `GJSIFY_SHIP_SIGNING_REQUIRE_DARWIN_TOOLS`, so a leg that is meant to run cannot pass by
  skipping.
- **Acceptance, once, real:** (a) one darwin consumer release where `install` replaces the
  hand-rolled shell and the artifact is signed, notarised `Accepted` and stapled; (b) one Windows
  release signed on a **Linux** job through GitHub OIDC with no client secret, whose `.msi` and
  PEs verify with an oracle that is not jsign (`signtool verify /pa` on a Windows job, or
  `osslsigncode verify`) and carry a timestamp countersignature. Until (b) has run, the win32 row
  carries the same `UNVERIFIED` marker the `signtool` row had.

## Open questions

1. **Who can use this signer at all.** Microsoft's quickstart (read 2026-10-30) offers Public
   Trust certificates to organisations in the US, Canada, the EU, the UK and a handful of other
   countries, and to individual developers only in the US and Canada. An individual elsewhere has
   no Azure route; whether gjsify documents an alternative (for open-source projects, a
   foundation-run signing service) is open.
2. **Cost of signing every PE.** Quota, rate limit and wall time for a payload with hundreds of
   DLLs. If it bites, the alternative is a scope option (sign the launcher and the application's
   own binaries, leave third-party runtime DLLs as they ship), a decision with a SmartScreen
   trade-off nobody has measured.
3. **The subject for the record.** How to read the certificate subject back (jsign documents a
   `show` command, marked a 8.0 preview there) so `signature.identity` stays a name that is
   public in the file.
4. **How `jsign` is supplied.** Distribution packages exist for Debian, RPM, Homebrew, Chocolatey
   and Scoop and there is an all-in-one jar; whether `tool: 'jsign'` on `PATH` is enough or the
   jar needs a documented `java -jar` form, and the minimum version that supports
   `TRUSTEDSIGNING` with automatic timestamping (the documentation shows 7.6 as current and an
   8.0 preview).
5. **A fallback timestamp authority.** jsign accepts several comma-separated URLs. Whether a
   second, non-Microsoft RFC 3161 authority is wanted for availability, given the certificate
   validity makes a missing timestamp unrecoverable.
6. **Command registration.** `ship` takes a positional OS today; `credentials` must register as
   a subcommand without being parsed as one. Not checked against how `ship.ts` declares its
   command string.
7. **Whether `upload win32` should set variables at all**, or the Entra identifiers stay a
   documented manual step. They are not secrets, but the verb would then do something on one OS
   and nothing on the other.

## Implementation

1. `@gjsify/cli`: `utils/ship/credentials.ts` (the table, the pure planners that turn a row into
   argv, the temp-directory discipline) and `commands/ship-credentials.ts` modelled on
   `commands/trust.ts`; the three verbs, `--dry-run`, unit tests as above.
2. `@gjsify/cli`: replace `SIGNERS.win32` (tool, `signOn`, batch `args`, identity parser, token
   resolution, mandatory timestamp), sign the `.msi` as the last step of the win32 pack, update
   the row's `gap` text and § A12's table in `docs/ship-formats.md`.
3. `@gjsify/cli`: `ship`'s skip message for an absent identity names `ship credentials check`.
4. Record the measured darwin sequence over D1's, and mark the win32 row verified, in the PR that
   lands acceptance run (b).
5. Consumers: replace the hand-rolled upload and keychain steps in the release workflows with
   `check` and `install`.
