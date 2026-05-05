// Parse a `gjsify dlx` package spec — distinguishes local paths from npm specs.

import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export type ParsedSpec =
    | { kind: 'local'; path: string }
    | { kind: 'registry'; name: string; version?: string; spec: string };

const NPM_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

/**
 * Parse a CLI input into either a local-path or an npm-registry spec.
 *
 * Local: starts with `./`, `../`, `/`, or is an existing directory path.
 * Registry: `<name>` | `<name>@<version>` | `@scope/<name>` | `@scope/<name>@<version>`
 *
 * The full spec string is preserved on the registry case so it can be passed
 * verbatim to `npm install` (which already understands dist-tags, ranges,
 * git URIs, tarball URLs, etc. — we don't re-parse those).
 */
export function parseSpec(input: string): ParsedSpec {
    if (!input) throw new Error('dlx: empty package spec');

    if (input.startsWith('./') || input.startsWith('../') || isAbsolute(input)) {
        return { kind: 'local', path: resolve(input) };
    }

    if (existsSync(input)) {
        return { kind: 'local', path: resolve(input) };
    }

    // Registry spec: split off the version after the LAST `@` that isn't the
    // leading scope separator.
    let name = input;
    let version: string | undefined;
    const lastAt = input.lastIndexOf('@');
    if (lastAt > 0) {
        name = input.slice(0, lastAt);
        version = input.slice(lastAt + 1);
    }

    if (!NPM_NAME_RE.test(name)) {
        throw new Error(`dlx: invalid package name "${name}"`);
    }

    return { kind: 'registry', name, version, spec: input };
}
