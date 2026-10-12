# @gjsify/xeddsa

[XEdDSA](https://signal.org/docs/specifications/xeddsa/) signatures with a Curve25519 (X25519) key
pair, plus the Curve25519 ⇄ Ed25519 key mapping. Pure TypeScript on `@noble/curves` and
`@noble/hashes`, so it runs on GJS, Node.js, browsers and NativeScript alike.

Part of the [gjsify](https://github.com/gjsify/gjsify) project. **Tier 3 (experimental, ADR 0003)**:
tested against the libsignal-protocol-c and libsignal (Rust) vectors, not yet in a deployed client.

## Installation

```bash
gjsify install @gjsify/xeddsa
```

## Usage

```typescript
import { xeddsaSign, xeddsaVerify } from '@gjsify/xeddsa';

// curvePrivate / curvePublic: a 32-byte X25519 key pair
const signature = xeddsaSign(curvePrivate, message, crypto.getRandomValues(new Uint8Array(64)));
xeddsaVerify(curvePublic, message, signature); // true
```

| Export | What it does |
|---|---|
| `xeddsaSign(curvePrivate, message, random64)` | §2.5 `xeddsa_sign`; 64-byte signature, sign bit 0 |
| `xeddsaVerify(curvePublic, message, signature)` | §2.6 `xeddsa_verify`; `false` for malformed input, never throws |
| `curveToEdPublic(curvePublic, signBit = 0)` | Montgomery u → Edwards y (RFC 7748 §4.1) |
| `edToCurvePublic(edPublic)` | Edwards y → Montgomery u |
| `curveToEdPrivate(curvePrivate)` | §2.3 `calculate_key_pair`: Ed25519 scalar + public key with sign bit 0 |

## Compatibility with libsignal

The specification fixes the Edwards sign bit to 0 by negating the private scalar. libsignal (Rust,
Java) keeps the scalar and stores the sign bit in the top bit of the signature's last byte.
`xeddsaVerify` reads that bit, so it accepts both kinds; `xeddsaSign` writes spec signatures, which
libsignal verifies because their top bit is the sign bit 0.

## License

MIT
