// Fixture helpers for the TLS-session integration suite.
//
// Exposes:
//   - FIXTURES_DIR + cert/key path constants
//   - readCert / readKey — PEM string loaders
//   - getEphemeralPort — pick an unused TCP port at runtime
//   - isGjs — runtime predicate
//
// All paths are resolved relative to the BUNDLE location
// (`new URL('../fixtures/…', import.meta.url)`) so they follow the build
// output (`dist/test.{node,gjs}.mjs`) rather than the source layout.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

export const CERT_PATH = join(FIXTURES_DIR, 'cert.pem');
export const KEY_PATH = join(FIXTURES_DIR, 'key.pem');

/** Read the fixture certificate as a PEM string. */
export function readCert(): string {
    return readFileSync(CERT_PATH, 'utf8');
}

/** Read the fixture private key as a PEM string. */
export function readKey(): string {
    return readFileSync(KEY_PATH, 'utf8');
}

/** True when running under GJS — checked once at module load. */
export const isGjs: boolean =
    typeof (globalThis as { imports?: unknown }).imports === 'object' &&
    typeof (globalThis as { imports?: { gi?: unknown } }).imports?.gi === 'object';
