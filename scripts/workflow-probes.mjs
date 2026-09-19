// What a `continue-on-error` PROBE is, in one place.
//
// Two checks ask questions about the same set of steps — `check-probe-outcomes-read.mjs`
// (is its outcome addressable and read?) and `check-probe-retirement.mjs` (has its stated
// condition come true?). Written twice they would come to know two different sets, and the
// step that fell out of one of them would be invisible in exactly the way both exist to end.
//
// LEXICAL, NOT YAML-PARSED, and that constraint is inherited rather than chosen: the audit
// job that runs these does no install and no build, so no `yaml` package is available to it
// — importing one cost one red PR before the constraint was believed. Every reader in
// `scripts/` that touches a workflow is hand-rolled for that reason.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** `  - name: x` / `    id: y` → the key, whether or not the line opens the list item. */
const KEY = /^\s*(?:-\s+)?([A-Za-z-]+):/;

/**
 * Blank out every BLOCK SCALAR body, so a `run:` script is never read as YAML.
 *
 * Measured against the sibling checker: a `run: |` body containing an indented
 * `- name: fake step` / `continue-on-error: true` was parsed as a step and refused, and an
 * `id:` inside a heredoc won over the step's real one. Lines are replaced by empty ones
 * rather than removed, so every index still names the line it did before.
 */
export function withoutBlockScalars(lines) {
    const out = [...lines];
    for (let i = 0; i < out.length; i += 1) {
        if (!/^\s*(?:-\s+)?[A-Za-z-]+:\s*[|>][-+0-9]*\s*(?:#.*)?$/.test(out[i])) continue;
        const keyIndent = (out[i].match(/^\s*/) ?? [''])[0].length;
        for (let j = i + 1; j < out.length; j += 1) {
            if (out[j].trim() === '') continue;
            const indent = (out[j].match(/^\s*/) ?? [''])[0].length;
            if (indent <= keyIndent) break;
            out[j] = '';
        }
    }
    return out;
}

/**
 * The index of the `- ` line opening the step block `index` belongs to, or `null`.
 *
 * A step's keys all sit at ONE indent and exactly one of them carries the list dash. Not in
 * a list at all → not a step: `jobs.<id>.continue-on-error` is the other spelling and a
 * different question, with no `steps.<id>` to read and no step comment to carry a condition.
 */
export function stepStart(lines, index) {
    const indent = (lines[index].match(/^\s*/) ?? [''])[0].length;
    let start = index;
    while (start > 0) {
        if (lines[start].startsWith(`${' '.repeat(indent - 2)}- `)) return start;
        start -= 1;
    }
    return null;
}

/** The step block that opens at `start`, up to the next sibling or the end of the job. */
export function stepBlockFrom(lines, start) {
    const indent = (lines[start].match(/^\s*/) ?? [''])[0].length + 2;
    let end = start + 1;
    while (end < lines.length) {
        const line = lines[end];
        if (line.trim() === '' || line.trim().startsWith('#')) {
            end += 1;
            continue;
        }
        const lineIndent = (line.match(/^\s*/) ?? [''])[0].length;
        if (lineIndent < indent) break;
        if (lineIndent === indent - 2 && line.trim().startsWith('- ')) break;
        end += 1;
    }
    return lines.slice(start, end);
}

/** The value of `key` in a step block, unquoted, or `undefined`. */
export function valueOf(block, key) {
    for (const line of block) {
        const match = line.match(KEY);
        if (!match || match[1] !== key) continue;
        return line
            .slice(line.indexOf(':') + 1)
            .trim()
            .replace(/^['"]|['"]$/g, '');
    }
    return undefined;
}

/**
 * The value of an `env:` key in a step block, unquoted, or `undefined`.
 *
 * Separate from `valueOf` because env names carry underscores and the YAML key grammar
 * above does not admit them — so `PROBE_LABEL` was invisible to every reader in this file,
 * which is how a label went unchecked against the step it names for as long as it did.
 */
export function envValueOf(block, name) {
    const re = new RegExp(`^\\s*${name}:\\s*(.*)$`);
    for (const line of block) {
        const match = re.exec(line);
        if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
    }
    return undefined;
}

/**
 * The step block containing `needle`, or `null`.
 *
 * Walks back to the nearest list dash at ANY shallower indent rather than reusing
 * `stepStart`: the needle is usually a NESTED line (`env:` two levels in), and a walk that
 * assumes the hit sits at the step's own indent looks for a dash that is not there and
 * finds no step at all — measured, it reported every reader in the tree as absent.
 */
export function stepBlockContaining(lines, needle) {
    const index = lines.findIndex((line) => line.includes(needle));
    if (index === -1) return null;
    const indent = (lines[index].match(/^\s*/) ?? [''])[0].length;
    for (let i = index; i >= 0; i -= 1) {
        const dash = /^(\s*)- /.exec(lines[i]);
        if (dash && dash[1].length < indent) return stepBlockFrom(lines, i);
    }
    return null;
}

/**
 * The job a line belongs to: `{ key, name }`, where `name` is the declared `name:` or the
 * job key when it declares none.
 *
 * A job key sits at two spaces and its keys at four, which is the whole grammar needed.
 * Without this, a step lookup by NAME spans every job in a run — and `gtk-os-suites.yml`
 * has one step name appearing in two jobs, one of them a gate, which made a gating step's
 * green legs count as a probe's.
 */
export function jobAround(lines, index) {
    for (let i = index; i >= 0; i -= 1) {
        const match = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);
        if (!match) continue;
        const key = match[1];
        for (let j = i + 1; j < lines.length; j += 1) {
            if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[j])) break;
            const named = /^ {4}name:\s*(.+?)\s*$/.exec(lines[j]);
            if (named) return { key, name: named[1].replace(/^['"]|['"]$/g, '') };
        }
        return { key, name: key };
    }
    return null;
}

/**
 * The run of comment lines immediately above the step, which is where this repository has
 * always written a probe's reasoning — and therefore where its condition has to live if it
 * is to sit NEXT TO the probe rather than in a registry that drifts away from it.
 *
 * A BLANK line ends the run and a bare `#` does not, which is how these workflows already
 * spell a paragraph break inside one block. The distinction matters: treating a blank line
 * as part of the run would walk past the gap between two steps and credit one step's
 * condition to the next one.
 */
export function commentAbove(rawLines, start) {
    const out = [];
    for (let i = start - 1; i >= 0; i -= 1) {
        const trimmed = rawLines[i].trim();
        if (!trimmed.startsWith('#')) break;
        out.unshift({ text: trimmed.replace(/^#\s?/, ''), line: i + 1 });
    }
    return out;
}

/**
 * Every `continue-on-error` step under `<root>/.github/workflows`.
 *
 * ANY value but a literal `false` counts, because an EXPRESSION is the shape that hides
 * best: `continue-on-error: ${{ github.event_name == 'push' }}` is sometimes true, and a
 * reader keyed on the literal counted it as gating and walked past it.
 *
 * @returns {Array<{file: string, rel: string, text: string, lines: string[], rawLines: string[],
 *   block: string[], label: string, id: string|undefined, line: number, comment: {text: string, line: number}[]}>}
 */
export function listProbes(root) {
    const dir = join(root, '.github', 'workflows');
    const probes = [];
    let files;
    try {
        files = readdirSync(dir);
    } catch {
        // A tree with no workflows has no probes — the answer, not an error.
        return probes;
    }
    for (const name of files.filter((n) => n.endsWith('.yml') || n.endsWith('.yaml')).sort()) {
        const path = join(dir, name);
        const text = readFileSync(path, 'utf8');
        const rawLines = text.split('\n');
        const lines = withoutBlockScalars(rawLines);
        for (let i = 0; i < lines.length; i += 1) {
            const flag = /^\s*continue-on-error:\s*(.+?)\s*(?:#.*)?$/.exec(lines[i]);
            if (!flag || flag[1] === 'false') continue;
            const start = stepStart(lines, i);
            if (start === null) continue;
            const block = stepBlockFrom(lines, start);
            probes.push({
                file: path,
                rel: relative(root, path),
                text,
                lines,
                rawLines,
                block,
                label: valueOf(block, 'name') ?? `line ${i + 1}`,
                id: valueOf(block, 'id'),
                line: i + 1,
                comment: commentAbove(rawLines, start),
                job: jobAround(lines, start),
            });
        }
    }
    return probes;
}
