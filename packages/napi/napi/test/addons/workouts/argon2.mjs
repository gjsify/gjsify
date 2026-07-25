// SPDX-License-Identifier: MIT
// @node-rs/argon2 consumer workout — ONE source, Node (golden) + GJS-shim.
// argon2 is a napi-rs (Rust) addon — DIFFERENT codegen from the node-addon-api
// C++ addons. This workout exercises only the SYNC surface (hashSync,
// hashRawSync, verifySync) with a FIXED salt so the output is deterministic and
// byte-comparable. String + Uint8Array passwords, multiple algorithms/versions,
// raw-buffer output, and both true/false verify paths cover string<->buffer
// marshalling + enum args across the napi boundary. (The Promise-returning
// hash()/verify() are async_work-backed and probed separately.)

import { Algorithm, hashRawSync, hashSync, verifySync, Version } from '@node-rs/argon2';

const out = [];
const log = (...p) => out.push(p.join(' '));
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

log('=== @node-rs/argon2 workout ===');
log('exports', 'hashSync', typeof hashSync, 'hashRawSync', typeof hashRawSync, 'verifySync', typeof verifySync);
log('Algorithm.Argon2id', Algorithm.Argon2id, 'Version.V0x13', Version.V0x13);

// Fixed salt => deterministic hashes. Cheap params keep it fast + reproducible.
const salt = Buffer.from('gjsify-fixed-salt-16', 'utf8').subarray(0, 16);
const base = { salt, memoryCost: 512, timeCost: 1, parallelism: 1, outputLen: 32 };

// string password, default (Argon2id / V0x13)
const pw = 'correct horse battery staple';
const h1 = hashSync(pw, base);
log('hashSync(str) =', h1);
log('verifySync(h1, pw)', verifySync(h1, pw));
log('verifySync(h1, wrong)', verifySync(h1, 'wrong password'));

// Uint8Array password -> should hash identically to the same bytes as string
const pwBytes = new Uint8Array(Buffer.from(pw, 'utf8'));
const h2 = hashSync(pwBytes, base);
log('hashSync(bytes) == hashSync(str)', h2 === h1);

// raw digest (Buffer return across the boundary)
const raw = hashRawSync(pw, base);
log('hashRawSync isBuffer', Buffer.isBuffer(raw), 'len', raw.length, 'hex', hex(raw));

// explicit algorithm + version variants (enum args)
const hI = hashSync(pw, { ...base, algorithm: Algorithm.Argon2i });
const hD = hashSync(pw, { ...base, algorithm: Algorithm.Argon2d });
const h10 = hashSync(pw, { ...base, version: Version.V0x10 });
log('argon2i', hI);
log('argon2d', hD);
log('v0x10', h10);
log('variants distinct', new Set([h1, hI, hD, h10]).size === 4);

// cross-verify: h1 (id) must not verify as argon2i-only? verify auto-detects
log('verifySync(hI, pw)', verifySync(hI, pw), 'verifySync(hD, pw)', verifySync(hD, pw));

// different outputLen changes raw length
const raw16 = hashRawSync(pw, { ...base, outputLen: 16 });
log('outputLen16 rawLen', raw16.length, 'hex', hex(raw16));

log('=== workout complete ===');
console.log(out.join('\n'));
