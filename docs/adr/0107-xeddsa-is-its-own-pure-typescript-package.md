# 107. XEdDSA is its own pure-TypeScript package on @noble/curves

- Status: **Accepted** (2026-10-12)
- Date: 2026-10-12
- Deciders: Pascal Garber
- Related: `packages/gjs/xeddsa`; `packages/node/crypto/src/curve25519.ts`; the first consumer is
  Curlew's ADR 0006 (OMEMO end-to-end encryption)

## Context

OMEMO (XEP-0384) signs signed pre-keys with XEdDSA: an Ed25519-style signature made with an X25519
key pair, per the [Signal specification](https://signal.org/docs/specifications/xeddsa/). Neither
Node's `crypto` nor WebCrypto has it, so `@gjsify/crypto` cannot offer it under a Node or W3C name.
An app on GJS would otherwise write the curve arithmetic itself, the one place a hand-rolled
implementation is most likely to be wrong in a way no round-trip test notices.

libsignal (Rust, Java) deviates from the specification: it keeps the private scalar and stores the
Edwards sign bit in the top bit of the signature's last byte, where the specification negates the
scalar so the sign bit is always 0.

## Decision

1. **A new package, `@gjsify/xeddsa`, in `packages/gjs/`**, tier 3, all runtimes `polyfill`,
   `headless: true`. It is not a Node or Web API, so it does not belong in either pillar, and putting
   it into `@gjsify/crypto` would add a non-Node export to a package whose contract is Node's.
2. **Arithmetic and hashing come from `@noble/curves` and `@noble/hashes`** — audited, MIT, and
   already the dependencies `@gjsify/crypto` builds X25519/Ed25519 on. No new third-party name enters
   the tree.
3. **API:** `xeddsaSign(curvePrivate, message, random64)`, `xeddsaVerify(curvePublic, message,
   signature)`, `curveToEdPublic(curvePublic, signBit = 0)`, `edToCurvePublic(edPublic)`,
   `curveToEdPrivate(curvePrivate)` (§2.3 `calculate_key_pair`).
4. **Signing follows the specification** (sign bit 0); **verification follows libsignal** and reads
   the sign bit from byte 63. That accepts both kinds of signature, and libsignal accepts ours.
5. **Verification is stricter than §2.6 in one place:** a small-order public key never verifies.

## Consequences

- Curlew (and any OMEMO client on gjsify) signs and verifies pre-keys interoperably with
  Conversations/libsignal without its own curve code.
- The package is tested against published vectors (libsignal-protocol-c, libsignal Rust, RFC 7748,
  RFC 8032), not only against itself.
- A new npm name needs a manual first publish; it is queued in `status/pending-npm-bootstrap.json`.
- Constant-time behaviour is what `@noble/curves` provides, no more.

## Alternatives rejected

- **Add it to `@gjsify/crypto`.** Mixes a non-Node export into the Node-contract package.
- **A libsignal binding (native).** A native child per platform for two functions that pure TS
  covers on every runtime.
- **Sign like libsignal (sign bit in byte 63).** Both forms verify everywhere that matters; the
  specification's form is the one a third-party implementation is checked against.

## Implementation

`packages/gjs/xeddsa/src/xeddsa.ts`, tests in `xeddsa.spec.ts` (GJS + Node), README, and
`status/status.json` in the implementing commit.
