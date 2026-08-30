---
title: Sign your artifacts
description: "--sign takes an identity, never a certificate. What codesign and signtool are handed, what happens with no identity, what --notarize submits, and why an unsigned artifact is a legitimate result."
---

macOS and Windows both treat a downloaded application differently once it
carries a signature. `gjsify ship` can make one, on the host that holds the key.

```bash
gjsify ship --from-stage ./stage --sign "Developer ID Application: You (TEAMID)"
```

Linux is not part of this. A `.deb` and an `.rpm` carry no per-file signature.
The artifact is signed as a whole by the repository that serves it, with
`debsigs` or `rpmsign` and that repository's key. `--sign` on the Linux layout
is refused rather than doing nothing.

## `--sign` takes an identity, not a certificate

The flag takes a NAME. `codesign` and `signtool` are both handed a string and
look the private key up themselves, so `gjsify ship` is never given a secret and
there is nothing to redact from a build log. There is no `--certificate`, no
`--p12` and no `--password`.

| | macOS | Windows |
|---|---|---|
| Tool | `codesign` | `signtool` |
| What `--sign` names | a Developer ID name or a SHA-1 fingerprint | a certificate subject name in a store |
| What gets signed | every Mach-O image in the payload | every PE image in the payload |
| Runs on | macOS | Windows |
| Project default | `gjsify.ship.sign.darwin.identity` | `gjsify.ship.sign.win32.identity` |

Getting a key into a keychain or a certificate store is the signing host's job.
That is a machine setup or a CI step, not something this command does.

Set a project default so nobody has to remember the string:

```jsonc
"gjsify": {
  "ship": {
    "sign": {
      "darwin": { "identity": "Developer ID Application: You (TEAMID)" },
      "win32": { "identity": "Your Company Ltd" }
    }
  }
}
```

`linux` is not a valid key there and is refused.

## Unsigned is a legitimate result

With no identity the run skips signing, prints why on stderr, and exits 0:

```text
[gjsify ship] no identity was given — skipping codesign. An unsigned artifact is
the default path and a legitimate deliverable (ADR 0024 § A13). Pass
`--sign <identity>` or set `gjsify.ship.sign.darwin.identity` to sign; `--sign -`
signs ad-hoc and needs no developer identity.
```

What is refused is the other direction. Nothing here claims a signature that was
not made, and a signing step that fails stops the run before anything is packed,
because a half-signed artifact installs and is refused at first launch.

What unsigned costs you differs by operating system. Gatekeeper blocks an
unsigned `.app` on a stranger's Mac. SmartScreen only warns about an unsigned
Windows download until it builds reputation, so a Windows program directory is
usable unsigned in a way the macOS bundle is not.

## Sign ad-hoc with no developer account

`--sign -` signs ad-hoc on macOS. It needs no Apple Developer Program
membership, and it is how the gjsify project proves this pipeline in CI with no
key anywhere.

```bash
gjsify ship --from-stage ./stage --sign -
```

An ad-hoc signature does not satisfy Gatekeeper on someone else's machine. It
proves the pipeline, not the provenance.

Windows has no ad-hoc mode. `signtool` needs a real certificate.

## Signing runs on the finish phase

`--sign` on a `--stage` run is refused. That phase produces no artifact, and a
signature over the tree it writes would be invalidated by the packer reading it
back:

```text
gjsify ship: --sign belongs to the finish phase, and --stage produces no
artifact to sign …
```

Signing also needs the host that has the tool, which is the same host that has
the key:

```text
gjsify ship: signing the darwin layout needs codesign, which runs on darwin and
this host is linux.
```

So the split is the same one the `.dmg` and the `.msi` use:

```bash
gjsify ship darwin --stage --arch arm64      # anywhere, offline
# move ship/stage/ to a Mac, then:
gjsify ship --from-stage ./stage \
            --sign "Developer ID Application: You (TEAMID)"
```

The staged tree is never written to, so a `--from-stage --sign` run can be
repeated.

## What the signature covers, and what it does not

The signature goes on every image inside the payload rather than on a wrapper
around it. Under a hardened runtime a Developer-ID-signed executable will not
load ad-hoc-signed libraries, and the GTK closure a macOS bundle carries arrives
ad-hoc-signed. So `gjsify ship` re-signs the images and builds the container
from the signed bytes.

Each run prints how many of the payload's files it signed, under which
identity, and what that signature still leaves open. On macOS what it leaves
open is the `.app` bundle itself, which is not sealed, so there is no
`Contents/_CodeSignature` and no entitlements are granted. On Windows it is the
timestamp, which is not countersigned, so the signature expires when the
certificate does.

A payload with nothing to sign says so rather than reporting success. A
`--app gjs` payload really is JavaScript and a launcher, and a run that asked
for a signature and made none has to be distinguishable from one that made one.

## Notarisation

`--notarize <keychain-profile>` submits the signed artifact to Apple:

```bash
gjsify ship --from-stage ./stage \
            --sign "Developer ID Application: You (TEAMID)" \
            --notarize my-profile
```

It runs `xcrun notarytool submit --keychain-profile <profile> --wait`, where the
profile is one a prior `notarytool store-credentials` put in that host's
keychain. It is macOS only, and it needs `--sign`:

```text
gjsify ship: --notarize was given without an identity to sign with.
```

Three things to know before you rely on it.

- **It has never been run against a real Apple account.** Notarisation needs
  one, and ad-hoc signing deliberately does not, so no run in the gjsify
  repository has exercised this call. Treat it as untested.
- **It does not staple the ticket.** A stapled artifact validates offline; an
  unstapled one asks Apple's servers at first launch.
- **The `.app` itself is skipped.** `notarytool` submits an archive or an
  installer, so a directory has no submittable form. The zip or the `.dmg`
  beside it is what goes.

## Where to next

- [macOS app bundles](/gjsify/ship/macos/) for the artifacts `codesign` signs.
- [Windows artifacts](/gjsify/ship/windows/) for the ones `signtool` signs.
- [Ship your app](/gjsify/ship/#assemble-here-pack-there) for the two-phase
  split every signed build uses.
- [CLI Reference → `gjsify ship`](/gjsify/cli-reference/#gjsify-ship) for the
  flag table.
