// SPDX-License-Identifier: MIT

/**
 * Verdict for a request that connects to one host but verifies the peer certificate against
 * another name (`servername`, as Node's `tls.connect({ servername })` / curl `--resolve`).
 *
 * `errors` are the flags libsoup reports for the connection (it verifies the chain against the
 * system CA and the URL host as identity); `nameErrors` are the flags from verifying the same
 * certificate against `servername`. Accept ONLY when the URL host was the sole problem
 * (`errors === badIdentity`: chain, expiry and revocation are fine) and the certificate does name
 * `servername`. Any other flag, or a name mismatch, rejects — fail closed.
 */
export function acceptsForServername(errors: number, nameErrors: number, badIdentity: number): boolean {
    return errors === badIdentity && (nameErrors & badIdentity) === 0;
}
