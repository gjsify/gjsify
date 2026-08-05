#!/usr/bin/env node
// Every reference link in CHANGELOG.md must name the thing its href points at.
//
// THE FAILURE (measured on the 0.27.1 cut, and public in its release notes):
// the generated changelog carried links to issues that do not exist and to
// repositories that do not exist —
//
//   closes [#version](https://github.com/gjsify/gjsify/issues/version)
//          [pre-#955](https://github.com/gjsify/pre-/issues/955)
//          [Post-#955](https://github.com/gjsify/Post-/issues/955)
//          [442/#121](https://github.com/442/gjsify/issues/121)
//          [@import](https://github.com/import)
//
// TWO INDEPENDENT PRODUCERS, both inside `@release-it/conventional-changelog`'s
// preset, both structurally unable to tell a reference from a token:
//
//  1. `conventional-commits-parser`'s reference regex is
//     `(?:.*?)??\s*([\w-\.\/]*?)??(#)([\w-]+)(?=\s|$|[,;)\]])`. The issue group
//     is `[\w-]+`, NOT digits — so `#version`, `#ifdef`, `#ffffff` and
//     `package.json#exports` all parse as issues. The group before it is a free
//     `owner/repo` prefix, so `pre-#955` yields repository `pre-` and `#442/#121`
//     yields owner `442`. The writer then fills the missing half from the repo
//     context and emits a URL for a repository nobody ever named.
//  2. the preset's writer `transform` re-links the SUBJECT with
//     `(#)([a-z0-9]+)` and mentions with `\B@([a-z0-9](?:-?[a-z0-9/]){0,38})`.
//     That is the same path that renders the load-bearing `(#970)` squash-merge
//     suffix into a link, and the one that turned the CSS at-rule `@import` and
//     the npm scope `@girs` into user pages.
//
// WHY A POST-GENERATION GATE AND NOT PRESET CONFIG. Producer 1 CAN be narrowed:
// `parserOpts.issuePrefixes` accepts a RegExp (`joinOr` inlines `.source` for a
// non-string), and `[/(?<=(?:^|[\s(\[])(?:[A-Za-z\d][\w.-]*\/[A-Za-z\d][\w.-]*)?)#(?=\d+(?:[\s,;:)\].]|$))/]`
// was measured to reject every artefact shape above while still accepting `#971`
// and `GNOME/gjs#704`. It is not enough, for two reasons: a RegExp cannot be
// written in `.release-it.json` (the config would have to become JS), and
// producer 2 reads the PRESET's own `issuePrefixes: ['#']` to build a regex that
// is baked into the preset's `transform` closure — narrowing it there either
// breaks the `(#970)` subject links this changelog depends on or means replacing
// the preset's `transform` wholesale. A gate over the emitted file covers both
// producers with one rule and cannot be outflanked by a third.
//
// IT ASSERTS POSITIVE FACTS, it does not merely exit 0. Before looking at the
// file it runs its own detector over a fixture matrix of the seventeen artefact
// shapes measured below plus eight shapes that must stay linked, and FAILS if any
// verdict is wrong — a detector that has quietly stopped detecting cannot pass
// here. It then requires the file to actually contain valid issue and commit
// links, because "no findings" over an empty or unparsed file is the same green
// as a clean one. The same matrix covers the section slicer, because the release
// body is a slice and a mis-slice publishes the wrong release's notes.
//
// `--write` REPAIRS, then re-asserts. Same shape as `after:bump`'s
// `generate-platform-packages --write` → `audit-runtimes --check --strict`: fix
// what is derivable, then refuse to commit what is not. Repair is deliberately
// LOSSY-BUT-HONEST — an invalid entry in a `, closes …` list is DROPPED and an
// invalid link anywhere else is UNLINKED to its literal text. It never re-points
// a fabricated link, because the token's real target is not derivable: `PKCS#7`,
// `gjs#44` and `node-gtk #442/#121` name a standard, a GitLab project and
// another repository's issues, so mechanically re-pointing them at this repo
// would replace a broken link with a confidently wrong one. The token itself
// survives verbatim in the commit body, which every entry links to by hash.
//
// THE FILE IS NOT THE PUBLISHED ARTEFACT — `--release-notes` is why this script
// also emits. Repairing CHANGELOG.md does NOT repair the GitHub release body:
// that body is release-it's IN-MEMORY `changelog` context, computed once at
// `release-it/lib/index.js:63` (`plugin.getChangelog()`), frozen into the
// context at `:92`, read verbatim by `lib/plugin/GitRelease.js:34`
// (`const { changelog } = this.config.getContext()`) and posted by
// `lib/plugin/github/GitHub.js:235-242`. `@release-it/conventional-changelog`'s
// `beforeRelease` only ever writes the FILE (`index.js:283-291`), so a shell
// hook — which runs in its own process — cannot reach that context. v0.27.1
// proves it: its published notes and its CHANGELOG.md section were the same
// text, both carrying `github.com/gjsify/pre-/issues/955`.
//
// So the notes are DERIVED FROM THE FILE instead of repaired beside it.
// `.release-it.json` sets `github.releaseNotes` to
// `… --release-notes ${version}`; `GitRelease.processReleaseNotes()` execs a
// string `releaseNotes` and takes stdout as the body. That runs at
// `github:beforeRelease`, i.e. AFTER the changelog plugin regenerated the
// infile, AFTER this script's `before:git:beforeRelease` repair, and after
// `Git.beforeRelease()` staged the result — and BEFORE `Git.release()` commits
// or `GitHub.release()` posts. The body is then a verbatim slice of the very
// bytes that get committed: one file, one parse, one oracle, in one process.
// The mode re-asserts the whole file AND the slice, so a divergence cannot be
// introduced by a later write either.
//
// A GENERATED SECTION IS NOT AN EXPLANATION, which is why the body can carry a
// hand-written PREAMBLE above it (`--prose`, default `docs/release-notes/next.md`).
// A list of conventional-commit subjects tells a reader what changed and never why
// it mattered; v0.28.0's own notes are the case in point — "make the GTK runtime
// bundles self-contained" names the fix and not the three silent defects it
// repaired. The preamble is prose committed during the cycle, so it is in the tree
// the cut reads and lands in the release commit like the infile.
//
// It is an INPUT TO THE SAME ORACLE, not a second one: the preamble is swept by
// the very detector this file exists for, because a hand-written paragraph is
// exactly where a plausible-looking fabricated link gets typed, and a second
// unchecked producer of the published body would reopen the hole 0.27.1 shipped.
// A missing preamble is ADVISORY — deliberately, so prose is never the reason a
// release cannot be cut — but a STALE one is fatal-by-omission instead: it counts
// only if git says it changed since the last tag, so the previous release's text
// cannot silently reappear under a new version. That inverts the risk the advisory
// creates: nothing to say costs a warning, saying the wrong thing is impossible.
//
// Usage: node scripts/check-changelog-references.mjs [--write] [--self-test]
//                                                    [--infile <path>] [--json]
//                                                    [--prose <path>]
//                                                    [--release-notes <version>]
//   (default)     assert; exit 1 listing every finding
//   --write       repair in place, then assert
//   --self-test   run only the fixture matrix
//   --infile      changelog to read (default CHANGELOG.md)
//   --prose       preamble to publish above the section
//                 (default docs/release-notes/next.md; only read with
//                 --release-notes, so the assert path stays about the infile)
//   --release-notes <version>
//                 assert, then print the preamble (if any) and the top section to
//                 STDOUT as the GitHub release body. Every diagnostic goes to
//                 stderr so stdout is exactly the body. Any failure exits 1, which
//                 rejects `GitRelease.beforeRelease()` and aborts the cut before
//                 the commit, the tag and the release exist.

import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
    const i = argv.indexOf(name);
    return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(name);

const INFILE = flag('--infile', 'CHANGELOG.md');
/**
 * Cwd-relative like `--infile`, so a fixture directory can exercise the whole
 * composition — staleness oracle included — without cutting a release.
 */
const PROSE = flag('--prose', 'docs/release-notes/next.md');
const WRITE = has('--write');
const SELF_TEST_ONLY = has('--self-test');
const JSON_OUT = has('--json');
const RELEASE_NOTES = has('--release-notes') ? flag('--release-notes', null) : null;
const LABEL = 'changelog-refs';

/**
 * In `--release-notes` and `--json` mode stdout carries the payload, so every
 * diagnostic — including the "detector verified" banner — goes to stderr.
 * release-it takes stdout verbatim as the release body; a stray progress line
 * would be published.
 */
const note = RELEASE_NOTES !== null || JSON_OUT ? console.error : console.log;

/** GitHub truncates a release body at 124000 chars (`GitHub.js` `truncateBody`). */
const MAX_BODY = 124000;

/**
 * Repair is lossy, so it must leave a record the cut log cannot swallow.
 *
 * It cannot rely on stdout: release-it CAPTURES a hook's output
 * (`lib/shell.js` `execStringCommand` uses `child_process.exec` and routes both
 * streams into `log.verbose`, which `log.js` `shouldLog()` suppresses unless
 * `--verbose`), and `release-cut.yml` does not pass `--verbose`. Measured on the
 * rehearsal cut: ZERO lines of this script reached the log — only the ERROR text
 * of a rejection does. A dropped reference with no record is the same
 * missing-signal failure this gate exists to remove, so the lines also go to
 * `$GITHUB_STEP_SUMMARY`, which no verbosity setting touches. Absent locally, in
 * which case stdout is the record and is not swallowed.
 */
const summaryLines = [];
function flushSummary() {
    const file = process.env.GITHUB_STEP_SUMMARY;
    if (!file || !summaryLines.length) return;
    // A FENCED block, not a bullet list: the entries are markdown link syntax, and
    // a summary that renders them turns a report about broken links into a page of
    // clickable broken links (and eats `*`/`_` in link text). Verbatim is the point.
    appendFileSync(file, `### ${LABEL}\n\n\`\`\`\n${summaryLines.join('\n')}\n\`\`\`\n\n`);
}

/**
 * GitHub's own login grammar: alphanumeric, single interior hyphens, ≤39 chars.
 * Repository names are laxer (dots and underscores are legal, hyphens anywhere).
 */
const LOGIN = /^[A-Za-z\d](?:[A-Za-z\d]|-(?=[A-Za-z\d])){0,38}$/;
const REPO_NAME = /^[A-Za-z\d._-]{1,100}$/;

/**
 * Accounts a bare `https://github.com/<name>` link may name.
 *
 * Deliberately empty: all sixteen mentions this changelog's history accumulated
 * were false positives from the writer's `@` linker — `@import`, `@font-face`
 * (CSS at-rules), `@girs`, `@imports`, `@gi` (npm scopes / a `@gi.ts/parser`
 * package path). None is a GitHub account, yet every one of them satisfies the
 * login grammar, so shape alone cannot tell them apart. An allowlist can: add
 * the account here when a real contributor is credited, and until then a
 * mention is text. Every unlinked mention is recorded (see `flushSummary`), so a
 * genuine one leaves a trace rather than being silently dropped.
 */
const KNOWN_GITHUB_USERS = new Set();

/**
 * Repositories a CROSS-REPO issue link may name.
 *
 * Text↔href agreement alone cannot judge these, and that is a measured hole,
 * not a hypothetical one. When the parser fabricates BOTH halves of the slug it
 * also spells both halves into the link text, so text and href agree — commit
 * `2f0459f` says *"RSA PKCS#1 / PKCS#8"*, from which the parser reads owner `1`
 * and repository `PKCS` and the writer emits
 * `[1/PKCS#8](https://github.com/1/PKCS/issues/8)`. Every shape check passes:
 * `1` is a legal login, `PKCS` a legal repository name, `8` a number, and the
 * text names exactly what the href points at. Only knowing which repositories
 * this project actually references separates that from `GNOME/glib#3981`.
 *
 * Populated from the cross-repo links the changelog actually contains (five,
 * swept over the whole file). A new one is reported with the slug to add, and
 * `--write` unlinks it to its literal text — recorded (see `flushSummary`),
 * never a silent link to a repository nobody named. It does not wedge the cut:
 * `--write` runs first and repairs, so `--release-notes` then finds the file
 * clean.
 */
const KNOWN_REPOS = new Set(['GNOME/gjs', 'GNOME/glib', 'gjsify/ts-for-gir', 'nodejs/node', 'oven-sh/bun']);

/** `git@github.com:owner/repo.git` and `https://github.com/owner/repo(.git)` → `owner/repo`. */
function parseSlug(remoteUrl) {
    const m = /(?:github\.com[:/])([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
    return m ? `${m[1]}/${m[2]}` : null;
}

/**
 * The generator derives owner/repo from `remote.origin.url` (`readRepository()`),
 * so the check reads the SAME source — then it is asserting agreement rather
 * than agreement with a second, driftable copy of the slug. An unreadable remote
 * FAILS: continuing without a slug would make every text↔href comparison
 * vacuous, which is the "missing signal read as a pass" shape.
 */
function detectSlug() {
    let url;
    try {
        url = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
    } catch {
        console.error(`${LABEL}: cannot read remote.origin.url — no slug to compare link text against.`);
        return process.exit(1);
    }
    const slug = parseSlug(url);
    if (!slug) {
        console.error(`${LABEL}: cannot derive owner/repo from remote.origin.url ${JSON.stringify(url.trim())}.`);
        return process.exit(1);
    }
    return slug;
}

/**
 * The one oracle. Returns null when the link is fine, else why it is not.
 *
 * The discriminator is TEXT↔HREF AGREEMENT, not URL shape — an href like
 * `github.com/442/gjsify/issues/121` is perfectly well-formed and `442` is even
 * a legal login. What gives it away is that the link says `442/#121` while its
 * href says `442/gjsify#121`: nobody writes a reference whose text names a
 * different thing than its target.
 */
function linkFinding(text, url, { slug, users = KNOWN_GITHUB_USERS, repos = KNOWN_REPOS }) {
    const path = /^https:\/\/github\.com\/(.+?)\/?$/.exec(url)?.[1];
    if (!path) return null; // not a github.com link — not ours to judge

    const issue = /^([^/]+)\/([^/]+)\/issues\/([^/]+)$/.exec(path);
    if (issue || path.includes('/issues/')) {
        if (!issue) return `href is not <owner>/<repo>/issues/<number>`;
        const [, owner, repo, id] = issue;
        if (!/^\d+$/.test(id)) return `issue id ${JSON.stringify(id)} is not a number`;
        if (!LOGIN.test(owner)) return `owner ${JSON.stringify(owner)} is not a GitHub login`;
        if (!REPO_NAME.test(repo)) return `repository ${JSON.stringify(repo)} is not a repository name`;
        const target = `${owner}/${repo}`;
        const expected = target === slug ? `#${id}` : `${target}#${id}`;
        if (text !== expected) return `text ${JSON.stringify(text)} does not name ${expected}`;
        // Both halves fabricated ⇒ text and href agree; only the allowlist knows.
        if (target !== slug && !repos.has(target)) return `${target} is not a known repository`;
        return null;
    }

    const commit = /^([^/]+)\/([^/]+)\/commit\/(.+)$/.exec(path);
    if (commit) {
        const [, owner, repo, sha] = commit;
        if (`${owner}/${repo}` !== slug) return `commit link points at ${owner}/${repo}, not ${slug}`;
        if (!/^[\da-f]{7,40}$/.test(sha)) return `commit ${JSON.stringify(sha)} is not a sha`;
        if (!sha.startsWith(text)) return `text ${JSON.stringify(text)} is not a prefix of ${sha}`;
        return null;
    }

    const compare = /^([^/]+)\/([^/]+)\/compare\/(.+)$/.exec(path);
    if (compare) {
        const [, owner, repo] = compare;
        if (`${owner}/${repo}` !== slug) return `compare link points at ${owner}/${repo}, not ${slug}`;
        return null;
    }

    const pull = /^([^/]+)\/([^/]+)\/pull\/([^/]+)$/.exec(path);
    if (pull && !/^\d+$/.test(pull[3])) return `pull id ${JSON.stringify(pull[3])} is not a number`;

    if (!path.includes('/')) {
        // A bare `github.com/<name>`: only the writer's `@` linker emits these.
        if (text !== `@${path}`) return `text ${JSON.stringify(text)} does not name @${path}`;
        if (!users.has(path)) return `@${path} is not a known GitHub account`;
        return null;
    }

    return null; // repo root, /tree/, /releases/, … hand-written prose links
}

const LINK_RE = /\[([^\]]*)\]\((https:\/\/github\.com\/[^)\s]*)\)/g;
/** The template emits `, closes` then one ` [text](href)` per reference, to end of line. */
const CLOSES_RE = /^(.*?), closes((?: \[[^\]]*\]\([^)\s]*\))+)\s*$/;

/** Bare hrefs too: a broken URL is broken whether or not it wears link text. */
const BARE_ISSUE_RE = /https:\/\/github\.com\/[^\s)"'`]*?\/issues\/([^\s)"'`]+)/g;

function findLineFindings(line, opts) {
    const findings = [];
    for (const [, text, url] of line.matchAll(LINK_RE)) {
        const why = linkFinding(text, url, opts);
        if (why) findings.push({ link: `[${text}](${url})`, why });
    }
    for (const [full, id] of line.matchAll(BARE_ISSUE_RE)) {
        if (/^\d+$/.test(id)) continue;
        if (findings.some((f) => f.link.includes(full))) continue;
        findings.push({ link: full, why: `issue id ${JSON.stringify(id)} is not a number` });
    }
    return findings;
}

/**
 * Drop invalid entries from the trailing `, closes …` list (and the clause with
 * them when nothing valid is left); unlink invalid links anywhere else.
 */
function repairLine(line, opts) {
    let head = line;
    let tail = '';
    const closes = CLOSES_RE.exec(line);
    if (closes) {
        const kept = [...closes[2].matchAll(LINK_RE)].filter(([, text, url]) => !linkFinding(text, url, opts));
        head = closes[1];
        tail = kept.length ? `, closes${kept.map(([, text, url]) => ` [${text}](${url})`).join('')}` : '';
    }
    head = head.replace(LINK_RE, (full, text, url) => (linkFinding(text, url, opts) ? text : full));
    return head + tail;
}

/**
 * The version heading the changelog writer emits.
 *
 * `conventional-changelog-conventionalcommits`' `headerPartial` is a literal
 * `## ` followed by `[{{version}}]({{compareUrlFormat}})` — never `#` and never
 * `###`, for any bump type. `#{1,3}` is tolerated so a hand-edited depth is
 * extracted rather than silently skipped, and the depth is reported.
 */
const VERSION_HEADING = /^(#{1,3}) +\[?v?(\d+\.\d+\.\d+[^\]\s]*)\]?/;

/**
 * The GitHub release body = the top section of the infile, verbatim.
 *
 * The section starts at the first version heading (the writer PREPENDS, so the
 * newest release is first) and ends at the next one. `expected` is release-it's
 * `${version}`: asserting the heading names it is what catches "the plugin did
 * not regenerate the infile" and "the wrong section was sliced" — both of which
 * would otherwise publish a *previous* release's notes, quietly and plausibly.
 */
function extractTopSection(text, expected) {
    const lines = text.split('\n');
    const start = lines.findIndex((l) => VERSION_HEADING.test(l));
    if (start === -1) return { errors: ['no version heading (`## [x.y.z](…)`) found — nothing to publish'] };
    const [, depth, version] = VERSION_HEADING.exec(lines[start]);
    const after = lines.slice(start + 1).findIndex((l) => VERSION_HEADING.test(l));
    const end = after === -1 ? lines.length : start + 1 + after;
    const body = lines.slice(start, end).join('\n').trim();

    const errors = [];
    if (expected && version !== expected) {
        errors.push(`top section is ${version} but the release is ${expected} — the infile was not regenerated`);
    }
    if (depth !== '##') errors.push(`version heading depth is ${JSON.stringify(depth)}, expected "##"`);
    if (body.length > MAX_BODY) {
        errors.push(
            `section is ${body.length} chars — GitHub truncates at ${MAX_BODY}, so the body would not match the file`,
        );
    }
    return { errors, version, line: start + 1, body };
}

/** Between preamble and section, so the generated part is visibly generated. */
const PREAMBLE_SEPARATOR = '\n\n---\n\n';

/**
 * The tag of the PREVIOUS release, or null in a repo that has none.
 *
 * Sound only because of WHEN this runs: `--release-notes` is `github:beforeRelease`,
 * which precedes `Git.release()` and therefore the new tag (see the header). So the
 * most recent tag is the last release, and "the file changed since it" means "this
 * prose was written during the cycle being cut". No version bookkeeping in the
 * file, nothing to reset by hand, and no way to name a version that is not shipping.
 *
 * A tagless repo yields null and the staleness question does not arise — every
 * commit is "since the last release". That is the first-release case, not a defect.
 */
function lastReleaseTag() {
    try {
        const tag = execFileSync('git', ['describe', '--tags', '--abbrev=0'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        return tag || null;
    } catch {
        return null;
    }
}

/**
 * The prose preamble, or `null` with the reason it does not count.
 *
 * Three ways it does not count, and each is a WARNING rather than a failure so a
 * cut is never blocked on prose:
 *   · absent       — the path does not exist
 *   · empty        — nothing but whitespace and HTML comments, i.e. the reset
 *                    template. "Present but says nothing" must not publish a bare
 *                    separator above the section.
 *   · unchanged    — no commit touched it since `tag`. This is the one that matters:
 *                    with a missing preamble merely advisory, the residual risk is
 *                    the PREVIOUS release's text reappearing under a new version,
 *                    which is a confidently wrong body rather than an absent one.
 *                    Git is the oracle because it cannot be forgotten, unlike a
 *                    version marker in the file.
 *
 * Errors (returned separately, they DO fail the cut) are about a preamble that
 * exists and is wrong, never about one that is missing.
 */
function readPreamble(path, tag) {
    let raw;
    try {
        raw = readFileSync(path, 'utf8');
    } catch {
        return { text: null, reason: `no preamble at ${path}` };
    }

    // HTML comments carry the template's instructions; they are not prose, and a
    // file holding only them is the post-release reset state.
    const text = raw.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!text) {
        return { text: null, reason: `${path} has no prose (only whitespace/comments)` };
    }

    if (tag) {
        let touched;
        try {
            touched = execFileSync('git', ['log', '-1', '--format=%H', `${tag}..HEAD`, '--', path], {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
        } catch {
            // An unreadable history cannot license publishing text that may belong to
            // the last release. Refusing to include it degrades to "no preamble",
            // which is the safe direction and is reported.
            return { text: null, reason: `cannot ask git whether ${path} changed since ${tag} — not publishing it` };
        }
        if (!touched) {
            return {
                text: null,
                reason: `${path} is unchanged since ${tag} — it belongs to that release, not this one`,
            };
        }
    }

    const errors = [];
    // A version heading would render as a second release section and make "the top
    // section" ambiguous to a reader comparing the body against the file. Reported by
    // the offending LINE, not a line number: comments are stripped before this, so any
    // index here counts lines in the stripped text and would point at the wrong line
    // of the file the author has open.
    const heading = text.split('\n').find((l) => VERSION_HEADING.test(l));
    if (heading !== undefined) {
        errors.push(
            `${path} has a version heading (${JSON.stringify(heading.trim())}) — ` +
                `the preamble goes ABOVE the section, not beside it`,
        );
    }
    return { text, errors, reason: null };
}

// ---------------------------------------------------------------------------
// Fixture matrix — one entry per artefact shape MEASURED in this changelog.
// Runs before every check so the detector cannot pass by having stopped
// detecting. Fixed slug, so the verdicts do not depend on the git remote.
// ---------------------------------------------------------------------------

const FIXTURE_SLUG = 'gjsify/gjsify';

/**
 * Every shape below was re-derived from the REAL inputs, not copied from a list:
 * `conventional-commits-parser`'s reference regex was run over all 2246 commit
 * bodies (1467 parsed references) and the detector over the pre-repair
 * CHANGELOG.md (4661 GitHub URLs, 136 findings, 54 distinct link texts). The
 * commit-body sweep is what turned up the last two entries here, which the file
 * does not (yet) contain: a URL fragment read as a reference, and the
 * both-halves-fabricated slug that text↔href agreement cannot judge.
 */
const MUST_REJECT = [
    // 75 findings — the issue group is `[\w-]+`, not digits.
    ['non-numeric id', '#version', 'https://github.com/gjsify/gjsify/issues/version'],
    ['C preprocessor token', '#ifdef', 'https://github.com/gjsify/gjsify/issues/ifdef'],
    ['hex colour', '#ffffff', 'https://github.com/gjsify/gjsify/issues/ffffff'],
    ['hex colour starting with digits', '#3584e4', 'https://github.com/gjsify/gjsify/issues/3584e4'],
    ['digits plus a suffix', '#668-review', 'https://github.com/gjsify/gjsify/issues/668-review'],
    ['manifest field', 'package.json#exports', 'https://github.com/gjsify/package.json/issues/exports'],
    // 12 findings — a prose prefix becomes the repository half of the slug.
    ['prefix-#n → fabricated repository', 'pre-#955', 'https://github.com/gjsify/pre-/issues/955'],
    ['capitalised prefix', 'Post-#955', 'https://github.com/gjsify/Post-/issues/955'],
    ['numeric-prefix repository', '220-#222', 'https://github.com/gjsify/220-/issues/222'],
    // 28 findings — `#a/#b` leaves the repository empty, so the owner is fabricated.
    ['#a/#b → fabricated owner', '442/#121', 'https://github.com/442/gjsify/issues/121'],
    ['#a/#b, four digits', '859/#861', 'https://github.com/859/gjsify/issues/861'],
    // 5 findings — the text drops the owner its href carries.
    ['text omits the owner the href carries', 'gjs#44', 'https://github.com/gjsify/gjs/issues/44'],
    ['three path segments', 'algorithm/buffer/PKCS#7', 'https://github.com/algorithm/buffer/PKCS/issues/7'],
    // 16 findings — the writer's `@` linker on CSS at-rules and npm scopes.
    ['CSS at-rule read as a login', '@import', 'https://github.com/import'],
    ['npm scope read as a login', '@girs', 'https://github.com/girs'],
    // From the commit-body sweep, not yet in the file:
    // `2f0459f` "RSA PKCS#1 / PKCS#8" → owner `1`, repository `PKCS`. Text and
    // href agree, so ONLY the allowlist rejects this one.
    ['both slug halves fabricated', '1/PKCS#8', 'https://github.com/1/PKCS/issues/8'],
    // `e51b126` "nodejs.org/api/packages.html#package-entry-points" — a URL
    // fragment read as a reference behind a `//host/path` slug prefix.
    [
        'URL fragment read as a reference',
        '//nodejs.org/api/packages.html#package-entry-points',
        'https://github.com//nodejs.org/api/packages.html/issues/package-entry-points',
    ],
];

const MUST_ACCEPT = [
    ['own-repo issue', '#970', 'https://github.com/gjsify/gjsify/issues/970'],
    ['cross-repo issue', 'oven-sh/bun#18546', 'https://github.com/oven-sh/bun/issues/18546'],
    ['cross-org issue', 'GNOME/glib#3981', 'https://github.com/GNOME/glib/issues/3981'],
    ['sibling-repo issue', 'gjsify/ts-for-gir#392', 'https://github.com/gjsify/ts-for-gir/issues/392'],
    ['short commit', '137c9fa', 'https://github.com/gjsify/gjsify/commit/137c9fa2f2f4fce87052298c16e0693910feaa61'],
    ['version compare', '0.27.1', 'https://github.com/gjsify/gjsify/compare/v0.27.0...v0.27.1'],
    ['prose repo link', 'fast-glob', 'https://github.com/mrmlnc/fast-glob'],
    ['prose tree link', 'commonjs', 'https://github.com/rollup/plugins/tree/master/packages/commonjs'],
];

/** A release section exactly as the writer emits it, used to test the slicer. */
const FIXTURE_SECTION =
    '## [0.27.2](https://github.com/gjsify/gjsify/compare/v0.27.1...v0.27.2) (2026-08-04)\n' +
    '\n### Bug Fixes\n' +
    '\n* gate changelog links ([#975](https://github.com/gjsify/gjsify/issues/975))' +
    ' ([2a50c6d](https://github.com/gjsify/gjsify/commit/2a50c6d15cdc4261cab6369d116c720418a6ccc8))';
const FIXTURE_OLDER =
    '## [0.27.1](https://github.com/gjsify/gjsify/compare/v0.27.0...v0.27.1) (2026-08-04)\n' +
    '\n### Features\n\n* something older';
const FIXTURE_INFILE = `# Changelog\n\n${FIXTURE_SECTION}\n\n${FIXTURE_OLDER}\n`;

function selfTest() {
    const opts = { slug: FIXTURE_SLUG, users: KNOWN_GITHUB_USERS, repos: KNOWN_REPOS };
    const failures = [];
    for (const [name, text, url] of MUST_REJECT) {
        if (!linkFinding(text, url, opts)) failures.push(`accepted an artefact: ${name} — [${text}](${url})`);
    }
    for (const [name, text, url] of MUST_ACCEPT) {
        const why = linkFinding(text, url, opts);
        if (why) failures.push(`rejected a valid link: ${name} — [${text}](${url}): ${why}`);
    }
    // Repair must be idempotent and must not touch a clean line.
    const clean =
        '* **node-gi:** accept GTypes ([#971](https://github.com/gjsify/gjsify/issues/971)) ' +
        '([ec36fc3](https://github.com/gjsify/gjsify/commit/ec36fc3f6b8f83dc8f30da7076120937f1c5a5df)), ' +
        'closes [#47](https://github.com/gjsify/gjsify/issues/47)';
    if (repairLine(clean, opts) !== clean) failures.push('repair rewrote a clean line');
    const dirty = `${clean} [pre-#955](https://github.com/gjsify/pre-/issues/955)`;
    if (repairLine(dirty, opts) !== clean) failures.push('repair did not drop an invalid reference entry');
    const onlyBad =
        '* subject ([#1](https://github.com/gjsify/gjsify/issues/1)), closes [#PR](https://github.com/gjsify/gjsify/issues/PR)';
    if (repairLine(onlyBad, opts) !== '* subject ([#1](https://github.com/gjsify/gjsify/issues/1))') {
        failures.push('repair did not drop an emptied `closes` clause');
    }

    // The release BODY is a slice of this file, so the slicer is part of the
    // oracle and is verified with it — including that it refuses the shapes
    // that would publish the wrong release's notes.
    const top = extractTopSection(FIXTURE_INFILE, '0.27.2');
    if (top.errors.length) failures.push(`slicer rejected a valid infile: ${top.errors.join('; ')}`);
    if (top.body !== FIXTURE_SECTION) failures.push('slicer did not return the top section verbatim');
    if (!extractTopSection(FIXTURE_INFILE, '0.27.1').errors.length) {
        failures.push('slicer accepted a section that is not the version being released');
    }
    if (!extractTopSection('# Changelog\n', '0.27.2').errors.length) {
        failures.push('slicer accepted an infile with no version heading');
    }
    if (!extractTopSection(FIXTURE_INFILE.replace('## [0.27.2]', '# [0.27.2]'), '0.27.2').errors.length) {
        failures.push('slicer accepted a version heading the writer does not emit');
    }
    return failures;
}

// ---------------------------------------------------------------------------

const selfTestFailures = selfTest();
if (selfTestFailures.length) {
    console.error(`${LABEL}: DETECTOR BROKEN — ${selfTestFailures.length} fixture verdict(s) wrong:`);
    for (const f of selfTestFailures) console.error(`  · ${f}`);
    process.exit(1);
}
note(
    `${LABEL}: detector verified — ${MUST_REJECT.length} artefact shape(s) rejected, ` +
        `${MUST_ACCEPT.length} valid shape(s) accepted.`,
);
if (SELF_TEST_ONLY) process.exit(0);

if (RELEASE_NOTES !== null && !/^\d+\.\d+\.\d+/.test(RELEASE_NOTES ?? '')) {
    console.error(`${LABEL}: --release-notes needs the version being released, got ${JSON.stringify(RELEASE_NOTES)}.`);
    process.exit(1);
}
if (RELEASE_NOTES !== null && WRITE) {
    // The notes must be a slice of what was already asserted and staged, never
    // its own repair pass — a second writer is a second truth.
    console.error(`${LABEL}: --release-notes does not repair; run --write at before:git:beforeRelease.`);
    process.exit(1);
}

const slug = detectSlug();
const opts = { slug, users: KNOWN_GITHUB_USERS, repos: KNOWN_REPOS };
const raw = readFileSync(INFILE, 'utf8');
const lines = raw.split('\n');

let repairs = 0;
if (WRITE) {
    const repaired = lines.map((line, i) => {
        const next = repairLine(line, opts);
        if (next !== line) {
            repairs++;
            for (const f of findLineFindings(line, opts)) {
                note(`${LABEL}: repaired ${INFILE}:${i + 1} — ${f.link} (${f.why})`);
                summaryLines.push(`repaired ${INFILE}:${i + 1} — ${f.link} (${f.why})`);
            }
        }
        return next;
    });
    if (repairs) writeFileSync(INFILE, repaired.join('\n'));
    lines.splice(0, lines.length, ...repaired);
}

// Positive facts about the file itself. "No findings" over a file the extractor
// could not read is the same green as a clean one, so require the links to be
// there before believing they are all good.
const structural = [];
if (!raw.trim()) structural.push(`${INFILE} is empty`);
if (!lines.some((l) => new RegExp(`\\[#\\d+\\]\\(https://github\\.com/${slug}/issues/\\d+\\)`).test(l))) {
    structural.push(`no valid ${slug} issue link found — the extractor or the file is wrong`);
}
if (!lines.some((l) => new RegExp(`\\(https://github\\.com/${slug}/commit/[\\da-f]{7,40}\\)`).test(l))) {
    structural.push(`no valid ${slug} commit link found — the extractor or the file is wrong`);
}

const findings = [];
lines.forEach((line, i) => {
    for (const f of findLineFindings(line, opts)) findings.push({ line: i + 1, ...f });
});

// The release body. Sliced from the SAME `lines` the assertions above ran over,
// in the same process — not re-read, not re-generated, not repaired again. That
// is the whole point: the notes cannot carry a link the file does not.
let section = null;
let body = null;
let preamble = null;
if (RELEASE_NOTES !== null) {
    section = extractTopSection(lines.join('\n'), RELEASE_NOTES);
    structural.push(...section.errors);
    if (section.body !== undefined) {
        if (!new RegExp(`\\(https://github\\.com/${slug}/commit/[\\da-f]{7,40}\\)`).test(section.body)) {
            structural.push(`the ${section.version} section has no valid commit link — it is not a release section`);
        }
        // Belt and braces: the slice is a substring of the asserted file, so this
        // cannot fire independently. It fires if the slicer ever stops slicing.
        for (const f of findLineFindings(section.body, opts)) {
            structural.push(`the ${section.version} section would publish ${f.link} — ${f.why}`);
        }
    }

    // The preamble is held to the SAME standard as the file, by the same detector in
    // the same process. Skipping it would leave the published body with one checked
    // producer and one unchecked one — and the unchecked one is the hand-written half.
    preamble = readPreamble(PROSE, lastReleaseTag());
    structural.push(...(preamble.errors ?? []));
    if (preamble.text) {
        for (const f of findLineFindings(preamble.text, opts)) {
            structural.push(`${PROSE} would publish ${f.link} — ${f.why}`);
        }
    }

    if (section.body !== undefined) {
        body = preamble.text ? `${preamble.text}${PREAMBLE_SEPARATOR}${section.body}` : section.body;
        // The invariant the preamble must not cost: the generated section still
        // appears in the published body VERBATIM. It held by construction before
        // there was anything to concatenate; now it is asserted.
        if (!body.includes(section.body)) {
            structural.push(`the composed body does not contain the ${section.version} section verbatim`);
        }
        // `extractTopSection` capped the section alone; the cap applies to what is
        // actually posted, and a preamble is the only way to exceed it without the
        // section itself growing.
        if (body.length > MAX_BODY) {
            structural.push(
                `composed body is ${body.length} chars (preamble ${preamble.text?.length ?? 0} + section ` +
                    `${section.body.length}) — GitHub truncates at ${MAX_BODY}`,
            );
        }
    }
}

if (JSON_OUT) {
    // One payload per stdout, always: with --release-notes the body rides INSIDE
    // the JSON rather than being appended after it.
    console.log(
        JSON.stringify({ infile: INFILE, slug, repairs, structural, findings, section, preamble, body }, null, 2),
    );
} else if (structural.length) {
    console.error(`${LABEL}: ${INFILE} did not satisfy the structural assertions:`);
    for (const s of structural) console.error(`  · ${s}`);
} else if (findings.length) {
    console.error(`${LABEL}: ${findings.length} broken reference link(s) in ${INFILE}:`);
    for (const f of findings) console.error(`  · ${INFILE}:${f.line} ${f.link} — ${f.why}`);
    console.error(
        `  Re-run with --write to drop the invalid \`closes\` entries and unlink the rest,\n` +
            `  or add the account to KNOWN_GITHUB_USERS / the slug to KNOWN_REPOS if it is real.`,
    );
} else {
    note(
        `${LABEL}: ${INFILE} clean — every reference link names its target` +
            (WRITE && repairs ? ` (${repairs} line(s) repaired).` : '.'),
    );
}

if (structural.length || findings.length) {
    // A FAILURE does reach the cut log — release-it rejects with `new Error(stderr)`
    // and logs it, so this whole list rides out in the ERROR (measured on the
    // rehearsal cut). Recorded anyway so the job summary is a complete account of
    // what the cut did to CHANGELOG.md, not just of the runs that succeeded.
    for (const s of structural) summaryLines.push(`FAILED — ${s}`);
    for (const f of findings) summaryLines.push(`FAILED — ${INFILE}:${f.line} ${f.link} (${f.why})`);
    flushSummary();
    process.exit(1);
}

if (section && !JSON_OUT) {
    // THE STEP SUMMARY IS THE ONLY CHANNEL A NON-FATAL WORD CAN USE HERE. stdout is
    // the release body, so a `::warning::` annotation would be PUBLISHED rather than
    // rendered — the one place in this repo where that pattern is unavailable. And
    // stderr is swallowed into release-it's `log.verbose` on a successful run (see
    // `flushSummary`). So an advisory that only printed would reach nobody, which is
    // the missing-signal shape this file exists to remove.
    if (preamble.text) {
        note(`${LABEL}: preamble = ${PROSE} (${preamble.text.length} chars), published above the section.`);
        summaryLines.push(`preamble = ${PROSE} (${preamble.text.length} chars)`);
    } else {
        note(`${LABEL}: NO PREAMBLE — ${preamble.reason}. Body is the changelog section only.`);
        summaryLines.push(`NO PREAMBLE — ${preamble.reason}; body is the changelog section only`);
    }
    note(`${LABEL}: release notes = ${INFILE}:${section.line} § ${section.version} (${body.length} chars).`);
    summaryLines.push(`release notes = ${INFILE}:${section.line} § ${section.version} (${body.length} chars)`);
    process.stdout.write(`${body}\n`);
}
flushSummary();
