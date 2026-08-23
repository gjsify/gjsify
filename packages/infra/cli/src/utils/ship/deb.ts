// The `.deb` packer.
//
// A Debian package is `debian-binary` + `control.tar.gz` + `data.tar.gz` in an
// ar container, and every one of those three parts already had a writer in
// this tree (`utils/ship/ar.ts`, `@gjsify/tar`) or is four bytes long. So no
// `dpkg-deb`, no vendored Go binary, no download at ship time — which is what
// lets the packer run under GJS, offline, on a Fedora CI image where dpkg does
// not exist.
//
// Everything below that looks like a detail is a documented dpkg failure mode:
// the ancestor-directory expansion (dpkg never calls `mkdir -p` and an ENOENT
// aborts the unpack), the `md5sums` path spelling (no `./`, exactly two
// spaces), the final newline in `control` (its absence is a parse error), and
// the gzip header's mtime (not a dpkg failure at all — it silently destroys
// reproducibility instead).

import { createHash } from 'node:crypto';
import { posix } from 'node:path';

import { createTarball, type TarWriteEntry } from '@gjsify/tar';

import { createArArchive } from './ar.js';
import { formatDebDepend } from './depends.js';
import { gzipDeterministic } from './gzip.js';
import { renderDebScripts } from './scripts.js';
import { readPayloadFacts, type PayloadEntry } from './payload.js';
import type { PackSettings } from './types.js';

export interface DebInputs {
    settings: PackSettings;
    /** The staged payload, prefix-relative. */
    payload: readonly PayloadEntry[];
    /** Install prefix, e.g. `/usr`. */
    prefix: string;
    /** Already-derived dependency list, in `name`/`name >= version` form. */
    depends: readonly string[];
    /** Debian architecture (`amd64`, `all`, …). */
    archLabel: string;
    /** Unix seconds stamped into every header. */
    mtime: number;
}

export async function buildDeb(inputs: DebInputs): Promise<Uint8Array> {
    const { payload, mtime } = inputs;
    const prefix = inputs.prefix.replace(/^\/+/, '');

    const named = payload.map((entry) => ({ ...entry, tarPath: `./${posix.join(prefix, entry.path)}` }));
    const directories = ancestorDirectories(named.map((entry) => entry.tarPath));

    const dataEntries: TarWriteEntry[] = [
        ...directories.map((name) => ({ name, mode: 0o755, mtime, directory: true as const })),
        ...named.map((entry) => ({ name: entry.tarPath, body: entry.data, mode: entry.mode, mtime })),
    ];
    const dataTar = await gzipDeterministic(createTarball(dataEntries));

    // Policy 5.6.20: regular files and symlinks round UP to whole KiB, every
    // other filesystem object counts as one. Getting the unit wrong (bytes
    // instead of KiB) is invisible — dpkg never validates this field, apt just
    // shows the user a wrong number.
    const installedSize =
        named.reduce((total, entry) => total + Math.ceil(entry.data.byteLength / 1024), 0) + directories.length;

    const control = renderControl(inputs, installedSize);
    const md5sums = named
        .map((entry) => `${createHash('md5').update(entry.data).digest('hex')}  ${entry.tarPath.slice(2)}\n`)
        .join('');

    const controlEntries: TarWriteEntry[] = [
        { name: './', mode: 0o755, mtime, directory: true },
        { name: './control', body: control, mode: 0o644, mtime },
        { name: './md5sums', body: md5sums, mode: 0o644, mtime },
    ];
    // From the PAYLOAD, not the settings: the maintainer scripts refresh exactly the
    // directories this package wrote into, and since ADR 0024 § A2 this packer also runs on a
    // host that has the staged tree and no project to ask.
    const maintainerScripts = renderDebScripts(readPayloadFacts(payload), inputs.prefix);
    for (const [name, body] of Object.entries(maintainerScripts)) {
        // dpkg refuses a maintainer script outside 0555–0775 with the mode in
        // the error, so this is 0755 rather than "whatever the source had".
        controlEntries.push({ name: `./${name}`, body, mode: 0o755, mtime });
    }
    const controlTar = await gzipDeterministic(createTarball(controlEntries));

    return createArArchive([
        { name: 'debian-binary', data: new TextEncoder().encode('2.0\n'), mtime },
        { name: 'control.tar.gz', data: controlTar, mtime },
        { name: 'data.tar.gz', data: dataTar, mtime },
    ]);
}

/**
 * Collapse a value that has to occupy exactly one control line.
 *
 * A newline here does not corrupt the file — it FORGES a field: a summary
 * pasted with a hard wrap turns its second line into whatever that line happens
 * to start with, and `Pre-Depends: …` is a real thing to end up with by
 * accident. The extended description already collapses whitespace per
 * paragraph; these fields did not.
 */
function singleLine(value: string): string {
    return value.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * `./`, `./usr/`, `./usr/bin/`, … for every path in the archive.
 *
 * dpkg opens each file with `O_CREAT | O_EXCL` and never creates a parent, so
 * a missing directory entry is `cannot create '<path>'` mid-unpack — with the
 * package half-installed.
 */
export function ancestorDirectories(paths: readonly string[]): string[] {
    const directories = new Set<string>(['./']);
    for (const path of paths) {
        const parts = path.replace(/^\.\//, '').split('/');
        parts.pop();
        let current = '.';
        for (const part of parts) {
            current = `${current}/${part}`;
            directories.add(`${current}/`);
        }
    }
    return [...directories].sort();
}

function renderControl(inputs: DebInputs, installedSize: number): string {
    const { settings } = inputs;
    const fields: Array<[string, string]> = [
        ['Package', settings.binaryName],
        ['Version', `${settings.version}-${settings.release}`],
        ['Architecture', inputs.archLabel],
        ['Maintainer', settings.maintainer],
        ['Installed-Size', String(installedSize)],
    ];
    if (inputs.depends.length > 0) fields.push(['Depends', inputs.depends.map(formatDebDepend).join(', ')]);
    fields.push(['Section', settings.section], ['Priority', 'optional']);
    if (settings.homepage) fields.push(['Homepage', settings.homepage]);

    const lines = fields.map(([key, value]) => `${key}: ${singleLine(value)}`);
    // The extended description is continuation lines: one leading space per
    // line, and a lone ` .` for a paragraph break — a truly blank line ends
    // the field and silently truncates everything after it.
    lines.push(`Description: ${singleLine(settings.summary)}`);
    const body = settings.description.filter((paragraph) => paragraph !== settings.summary);
    body.forEach((paragraph, index) => {
        if (index > 0) lines.push(' .');
        lines.push(` ${paragraph}`);
    });
    return `${lines.join('\n')}\n`;
}
