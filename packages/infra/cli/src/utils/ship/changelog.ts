// `/usr/share/doc/<package>/changelog.Debian.gz` — Debian Policy § 4.4.
//
// WHY IT EXISTS AT ALL. Every `.deb` this writer produced shipped without one,
// which the first real lintian this project ever ran named as the only
// error-severity tag left once the copyright landed:
//
//   E: gjsify: no-changelog usr/share/doc/gjsify/changelog.Debian.gz (non-native package)
//
// "non-native" is not a coincidence: `deb.ts` writes `Version: <version>-<release>`,
// and a version carrying a Debian revision is by definition a non-native package,
// whose changelog is `changelog.Debian.gz` rather than `changelog.gz`.
//
// WHAT THE ENTRY SAYS — the open question the ledger left, decided here.
//
// ONE ENTRY, for the version being packaged, and that is not a truncation. Policy
// § 4.4's file is the DEBIAN changelog: it records the packaging, not upstream's
// development. `gjsify ship` performs exactly one packaging event per version, so
// one entry is the whole history there is to tell. The upstream history has its own
// (optional) file, `changelog.gz`, and this writer does not claim to produce it.
//
// The BODY comes from the project's own changelog when one is found — `CHANGELOG.md`
// beside the project or up at its repository root, the same search the licence uses,
// overridable with `gjsify.ship.changelogFile`. That was the choice worth making:
// the GitHub release body says the same thing and is not reachable from a packing
// host that may be offline (ADR 0024 § A2), while `CHANGELOG.md` is in the tree the
// stage is assembled from. When nothing there names this version, the entry says so
// in one line rather than inventing content.
//
// AND ONLY THE PACKAGED VERSION GETS A DATE. A Debian entry needs a distribution, an
// urgency and an RFC822 timestamp; this writer has a real timestamp for exactly one
// of them — `mtime`, the build stamp every other header in the artifact already
// shares. Rendering the older versions would mean stamping each with a fabricated
// time, since `CHANGELOG.md` dates them to the DAY, and a Debian changelog is read
// by tools that compare those stamps.
//
// Deterministic by construction: the date is the build stamp, and the month and day
// names are spelled out here rather than taken from `toLocaleString`, which answers
// in the host's locale.

import type { PackSettings } from './types.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * `Thu, 04 Sep 2026 12:34:56 +0000` — the trailer format Policy § 4.4 requires.
 *
 * Always UTC, and the offset is written out rather than derived: the build stamp is
 * Unix seconds, so there is no zone to preserve, and a package built in two places
 * must not differ by a timezone.
 *
 * @param unixSeconds the build stamp every header in the artifact shares
 */
export function rfc822(unixSeconds: number): string {
    const at = new Date(unixSeconds * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        `${DAYS[at.getUTCDay()]}, ${pad(at.getUTCDate())} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()} ` +
        `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())} +0000`
    );
}

/**
 * The bullet lines a project's own changelog carries for ONE version.
 *
 * Reads the Markdown release-note shape `release-it`'s conventional-changelog
 * preset writes — `## [0.47.0](compare-url) (2026-09-03)`, or a bare `## 0.47.0`
 * for a first release — and takes the `*`/`-` bullets under it up to the next
 * version heading. Category subheadings (`### Bug Fixes`) are dropped: a Debian
 * change block is a flat list, and a heading rendered as a bullet reads as a change
 * that was made.
 *
 * Markdown links collapse to their text (`[#1510](https://…)` → `#1510`) and bold
 * scopes lose their asterisks, because the destination is plain text that `apt
 * changelog` prints to a terminal.
 *
 * @returns one string per bullet, empty when the file does not name this version
 */
export function changelogEntriesFor(version: string, source: string): string[] {
    const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const heading = new RegExp(`^##+[ \\t]+\\[?${escaped}\\]?[^\\n]*$`, 'm');
    const start = heading.exec(source);
    if (start === null) return [];
    const rest = source.slice(start.index + start[0].length);
    // The next VERSION heading, not the next heading of any depth: `### Features`
    // is inside this release, `## [0.46.0]` is the next one.
    const end = /^##[ \t]+\[?\d/m.exec(rest);
    const body = end === null ? rest : rest.slice(0, end.index);

    const entries: string[] = [];
    for (const line of body.split('\n')) {
        const bullet = /^[*-][ \t]+(.*\S)\s*$/.exec(line);
        if (bullet === null) continue;
        entries.push(
            bullet[1]!
                .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
                .replace(/\*\*([^*]+)\*\*/g, '$1')
                .replace(/\s+/g, ' ')
                .trim(),
        );
    }
    return entries;
}

/**
 * One bullet, wrapped so no line exceeds {@link WIDTH}.
 *
 * MEASURED, not stylistic: lintian raises `debian-changelog-line-too-long` past 80
 * columns, and a conventional-commit subject plus its scope, its PR link and its
 * `closes` list goes well past it. Continuation lines are indented to sit under the
 * bullet text — Debian's change block only requires at least two leading spaces, and
 * anything less than four would read as a new item.
 *
 * A single word longer than the width is left on its own line rather than broken: a
 * URL is the usual case, and a hyphenated URL is worse than a long one.
 */
function wrapEntry(entry: string): string[] {
    const lines: string[] = [];
    let line = '  *';
    for (const word of entry.split(/\s+/)) {
        if (word === '') continue;
        if (line.length + 1 + word.length > WIDTH && line !== '  *' && line !== '   ') {
            lines.push(line);
            line = '   ';
        }
        line += ` ${word}`;
    }
    lines.push(line);
    return lines;
}

/** lintian's `debian-changelog-line-too-long` threshold. */
const WIDTH = 80;

/**
 * The whole `changelog.Debian` file: one entry, for the version being packaged.
 *
 * `unstable` is the distribution and `medium` the urgency — the values `dh_make`
 * seeds a package with, and the only honest ones for an artifact built outside any
 * Debian suite: this package targets no release, and claiming one would put a
 * specific false statement in a field `apt` reads.
 *
 * The trailer's spacing is load-bearing and is the usual way this file is got
 * wrong: exactly one leading space, then `--`, one space, the maintainer, and TWO
 * spaces before the date.
 *
 * TWO lintian tags this file still raises, both measured on lintian 2.117 against
 * gjsify's own `.deb` and both left alone deliberately:
 *
 *  - `initial-upload-closes-no-bugs`, because the Debian revision is `-1` and the
 *    entry closes no bug. It is a statement about the Debian ARCHIVE's ITP
 *    workflow — the first upload of a new source package should close its ITP bug
 *    — and a package built by `gjsify ship` is never uploaded there. There is no
 *    bug number that would be true to write, so the tag is inapplicable rather
 *    than unmet.
 *  - `changelog-not-compressed-with-max-compression`. Policy asks for `gzip -9`
 *    and neither `CompressionStream` nor `@gjsify/zlib` takes a level, so
 *    `gzipDeterministic` cannot ask for one. Ledgered in `status/open-todos.md`:
 *    the fix is a capability in the core, and stamping the header's XFL byte to
 *    claim max compression we did not use is not one.
 */
export function renderDebianChangelog(settings: PackSettings, source: string | undefined, mtime: number): string {
    const entries = source === undefined ? [] : changelogEntriesFor(settings.version, source);
    const fallback = settings.homepage
        ? `Release ${settings.version}. See ${settings.homepage} for the upstream changes.`
        : `Release ${settings.version}.`;
    const body = (entries.length > 0 ? entries : [fallback]).flatMap(wrapEntry);
    return [
        `${settings.binaryName} (${settings.version}-${settings.release}) unstable; urgency=medium`,
        '',
        ...body,
        '',
        ` -- ${settings.maintainer}  ${rfc822(mtime)}`,
        '',
    ].join('\n');
}
