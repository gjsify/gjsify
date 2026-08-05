// `gjsify/todo-needs-anchor` — a deferral marker must name where it is tracked.
//
// A bare `// TODO` has no owner, no date and no retirement path. Nothing fails
// when the work is done, nothing fails when it is abandoned, and it is invisible
// until somebody happens to open the file. Measured on this repo at v0.29.0: of
// 42 markers in source, 5 carried a reference and 37 did not — including
// `// TODO: Fix this test`, i.e. a test documented as broken with no way for
// anyone to notice it stayed that way.
//
// This is the ONE place the repo's own pattern was missing. Everywhere else a
// deferral must state where it lives and dies on its own:
//
//   `it.failing(name, fn, reason)`        runs the test, FAILS the day it passes
//   `unchecked-fields.mjs`                key → reason, FAILS when a rule claims it
//   `gjsify.platformsUncommitted`         target → reason, FAILS when the dir appears
//   `// fixed upstream in gjsify: …`      removed on the next version bump
//
// Each one is mandatory-reason plus self-retirement. A bare marker is neither.
//
// SCOPE — this rule does not ban deferral, it bans an UNTRACKED one. Three
// anchors are accepted, matching the three channels in AGENTS.md:
//
//   `#123`                 a GitHub issue or PR — work needing discussion or a
//                          third party
//   `open-todos`           an entry in `status/open-todos.md`, which the
//                          `status-data` conformance rule already validates on
//                          every PR (it fails on resolved-TODO corpses)
//   `fixed upstream in …`  the cross-repo shim note, removed at the next bump
//
// The anchor must sit in the SAME comment as the marker: an anchor a reader has
// to go find is not evidence, and a block comment is one comment, so a `#123`
// anywhere in a JSDoc block covers a marker inside it.
//
// Comments are read through `sourceCode.getAllComments()` rather than by
// scanning the source text, so a marker inside a STRING is not a finding — the
// `--- outcomes:` style probe strings and this repo's own error messages contain
// the words. A text scan cannot tell a comment from a quoted one; that is the
// same distinction `gjs-bundle-guard.ts` documents for `node:` specifiers.
//
// Escape hatch is the ordinary lint one, and it carries a reason by convention:
// `// oxlint-disable-next-line gjsify/todo-needs-anchor -- <why>`. `.oxlintrc.json`
// already fails on a disable directive that suppresses nothing, so a stale
// exemption cannot sit there quietly either.
//
// Reference: AGENTS.md § Deferrals must name where they are tracked.

import type { Context, Node, Rule, Visitor } from './types.ts';

/** A comment as returned by `sourceCode.getAllComments()`. */
interface Comment extends Node {
    type: 'Line' | 'Block' | 'Shebang';
    value: string;
}

interface SourceCodeWithComments {
    getAllComments?: () => Comment[];
}

/**
 * A deferral marker OPENS its line — `// TODO wire this up`, or the same after
 * a block comment's leading `*`. Matched as a whole word so `TODOS` and an
 * identifier like `todoCount` are not findings, and case-sensitively, because
 * the convention is upper-case.
 *
 * Line-start is what separates a marker from PROSE ABOUT one. This file, the
 * `status-data` conformance rule and `generate-status.mjs` all discuss TODOs in
 * sentences ("a bare `// TODO` has no owner"), and flagging those would make the
 * rule unable to document itself — measured: 5 of the first 31 findings were
 * exactly that, three of them in this file. The cost is a mid-sentence deferral
 * ("handle the empty case. TODO") going unseen; that shape is rare, and the
 * false positives it would buy are not worth it.
 */
const MARKER = /^(TODO|FIXME|HACK|XXX)\b/;

/** Strip a block comment's leading `*` and indentation from one line. */
function openingWord(line: string): string {
    return line.replace(/^\s*\*?\s*/, '');
}

/**
 * An anchor that makes the deferral trackable. `#123` covers this repo's issues
 * and PRs; a forge issue URL covers an UPSTREAM defect (GNOME GitLab, another
 * GitHub repo) that no local number can name; `open-todos` covers the ledger
 * under `status/`; `fixed upstream in` covers the temporary shim note.
 *
 * The URL form is not optional politeness — `error-handler.spec.ts` cites
 * https://gitlab.gnome.org/GNOME/gjs/-/issues/523 for an object-identity gap,
 * which is BETTER tracked than a local issue would be. A rule that flagged it
 * would be teaching people to delete the most useful reference in the file.
 */
const ANCHOR = /#\d+|\/(?:issues|pull|merge_requests)\/\d+|open-todos|fixed upstream in/i;

export const todoNeedsAnchorRule: Rule = {
    meta: {
        // No autofix — only a human knows whether the right repair is fixing it
        // now, filing an issue, or adding a ledger entry.
        fixable: false,
    },
    create(context: Context): Visitor {
        // `getAllComments` is not in the local typings (they model only what the
        // other two rules need) and is absent on older oxlint hosts. Degrade to
        // a no-op rather than throwing: a lint rule that crashes the run is
        // worse than one that reports nothing.
        const source = context.sourceCode as unknown as SourceCodeWithComments;
        if (typeof source.getAllComments !== 'function') return {};

        let checked = false;

        const check = () => {
            if (checked) return;
            checked = true;

            for (const comment of source.getAllComments!()) {
                if (comment.type === 'Shebang') continue;

                // The anchor may sit anywhere in the comment — a `#123` in a
                // JSDoc block covers a marker inside it — so it is tested
                // against the whole value, the marker only per line.
                if (ANCHOR.test(comment.value)) continue;

                let marker: RegExpExecArray | null = null;
                for (const line of comment.value.split('\n')) {
                    marker = MARKER.exec(openingWord(line));
                    if (marker) break;
                }
                if (!marker) continue;

                context.report({
                    message:
                        `Untracked \`${marker[1]}\`. A deferral marker must name where it is tracked, or ` +
                        'nothing fails when the work is finished and nothing fails when it is dropped. ' +
                        'Pick the channel: fix it in THIS PR (the root-cause rule — preferred, and the ' +
                        'reason this codebase has few of these); add an entry to `status/open-todos.md` ' +
                        'and cite it here, which the `status-data` conformance rule then validates every ' +
                        'PR; or open an issue and cite `#<number>` when the work needs discussion or ' +
                        'somebody else. A cross-repo shim writes `// fixed upstream in gjsify: <one-line>` ' +
                        'instead. If the marker is prose rather than a deferral, rewrite it — the word is ' +
                        'the signal.',
                    node: comment,
                });
            }
        };

        // Comments are file-scoped, so one pass per file. `Program` fires once
        // and is present in every parse, including an empty file.
        return { Program: check };
    },
};
