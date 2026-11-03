// Contributor credits from git history, for `gjsify credits`.
//
// Names only: an e-mail address is read to recognise a bot or an AI co-author and
// is dropped before anything is built, so no output can carry one.

import { spawnSync } from 'node:child_process';
import { posix } from 'node:path';

export interface CreditsPerson {
    name: string;
    email: string;
}

export interface CreditsCommit {
    author: CreditsPerson;
    /** `Co-authored-by:` trailers, already run through `.mailmap`. */
    coAuthors: CreditsPerson[];
    files: string[];
}

/** The `credits.json` schema. `supporters` has no source but the overrides file. */
export interface Credits {
    developers: string[];
    translators: Record<string, string[]>;
    supporters: string[];
}

/** Hand-maintained additions and removals; every key is optional. */
export interface CreditsOverrides {
    developers?: string[];
    translators?: Record<string, string[]>;
    supporters?: string[];
    /** Patterns (see {@link isIgnored}) matched against names; removes a person from every list. */
    exclude?: string[];
}

/**
 * Patterns for people who are not contributors. `*` is the only wildcard and a
 * pattern must match the WHOLE name or the WHOLE e-mail, case-insensitively.
 * Weblate commits as "Weblate (bot)" with the real translator in a trailer, so
 * the bot is dropped and the trailer is what counts.
 */
export const DEFAULT_CREDITS_IGNORE: readonly string[] = [
    '*[bot]',
    'github-actions',
    'Weblate',
    'Weblate (bot)',
    'Hosted Weblate',
    'Weblate Translation Memory',
    'LibreTranslate',
    'Claude',
    '*@anthropic.com',
    'noreply-mt-*@weblate.org',
    'hosted@weblate.org',
    '*[bot]@users.noreply.github.com',
];

const FIELD = '\x1f';
const RECORD = '\x1e';
const TRAILER_SEPARATOR = '\x1d';

function globToRegExp(pattern: string): RegExp {
    const source = pattern
        .split('*')
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
        .join('.*');
    return new RegExp(`^${source}$`, 'i');
}

export function isIgnored(person: CreditsPerson, patterns: readonly string[]): boolean {
    return patterns.some((pattern) => {
        const re = globToRegExp(pattern);
        return re.test(person.name) || (person.email !== '' && re.test(person.email));
    });
}

/** `Name <mail>` → parts. A trailer without an address keeps the whole value as the name. */
export function parsePerson(value: string): CreditsPerson {
    const match = /^(.*?)\s*<([^>]*)>\s*$/.exec(value.trim());
    return match ? { name: match[1]!.trim(), email: match[2]!.trim() } : { name: value.trim(), email: '' };
}

const isTranslationFile = (file: string) => /\.pot?$/i.test(file);

/** `po/pt_BR.po` → `pt_BR`; a `.pot` template names no language. Git prints `/` on every host. */
function poLanguage(file: string): string | undefined {
    const base = posix.basename(file);
    return /\.po$/i.test(base) ? base.slice(0, -3) : undefined;
}

function bump(map: Map<string, number>, name: string): void {
    map.set(name, (map.get(name) ?? 0) + 1);
}

/** Most commits first, then by name; code-point order so every host sorts alike. */
function rank(counts: Map<string, number>): string[] {
    return [...counts.entries()].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : a > b ? 1 : 0)).map(([name]) => name);
}

function appendUnseen(list: string[], names: readonly string[] | undefined, excluded: (name: string) => boolean): void {
    const seen = new Set(list);
    for (const raw of names ?? []) {
        const name = raw.trim();
        if (name && !seen.has(name) && !excluded(name)) {
            seen.add(name);
            list.push(name);
        }
    }
}

export function buildCredits(
    commits: readonly CreditsCommit[],
    options: { ignore?: readonly string[]; overrides?: CreditsOverrides } = {},
): Credits {
    const ignore = options.ignore ?? DEFAULT_CREDITS_IGNORE;
    const overrides = options.overrides ?? {};
    const excludePatterns = overrides.exclude ?? [];
    const excluded = (name: string) => isIgnored({ name, email: '' }, excludePatterns);

    const developers = new Map<string, number>();
    const translators = new Map<string, Map<string, number>>();

    for (const commit of commits) {
        const names = new Set<string>();
        for (const person of [commit.author, ...commit.coAuthors]) {
            if (person.name && !isIgnored(person, ignore) && !excluded(person.name)) names.add(person.name);
        }
        const languages = new Set<string>();
        let touchesCode = false;
        for (const file of commit.files) {
            if (!isTranslationFile(file)) touchesCode = true;
            const language = poLanguage(file);
            if (language) languages.add(language);
        }
        for (const name of names) {
            if (touchesCode) bump(developers, name);
            for (const language of languages) {
                let perLanguage = translators.get(language);
                if (!perLanguage) translators.set(language, (perLanguage = new Map()));
                bump(perLanguage, name);
            }
        }
    }

    const credits: Credits = { developers: rank(developers), translators: {}, supporters: [] };
    for (const language of [...translators.keys()].sort()) {
        credits.translators[language] = rank(translators.get(language)!);
    }

    appendUnseen(credits.developers, overrides.developers, excluded);
    for (const language of Object.keys(overrides.translators ?? {}).sort()) {
        const list = credits.translators[language] ?? [];
        appendUnseen(list, overrides.translators![language], excluded);
        if (list.length) credits.translators[language] = list;
    }
    credits.translators = Object.fromEntries(Object.entries(credits.translators).sort(([a], [b]) => (a < b ? -1 : 1)));
    appendUnseen(credits.supporters, overrides.supporters, excluded);
    return credits;
}

/** The `git log` format `parseGitLog` reads: author, address, co-author trailers, then the file names. */
export const GIT_LOG_ARGS = [
    '-c',
    'core.quotepath=off',
    'log',
    '--no-merges',
    '--use-mailmap',
    '--name-only',
    `--format=${RECORD}%aN${FIELD}%aE${FIELD}%(trailers:key=Co-authored-by,valueonly,unfold,separator=%x1d)${FIELD}`,
];

/** Splits `git log` output into commits; co-author trailers are NOT mapped yet. */
export function parseGitLog(output: string): CreditsCommit[] {
    const commits: CreditsCommit[] = [];
    for (const record of output.split(RECORD)) {
        if (!record.trim()) continue;
        const [name = '', email = '', trailers = '', files = ''] = record.split(FIELD);
        commits.push({
            author: { name: name.trim(), email: email.trim() },
            coAuthors: trailers
                .split(TRAILER_SEPARATOR)
                .map((value) => value.trim())
                .filter(Boolean)
                .map(parsePerson),
            files: files
                .split('\n')
                .map((file) => file.trim())
                .filter(Boolean),
        });
    }
    return commits;
}

function git(cwd: string, args: readonly string[], input?: string): string {
    const result = spawnSync('git', [...args], { cwd, encoding: 'utf8', input, maxBuffer: 1 << 30 });
    if (result.error) throw new Error(`cannot run git: ${result.error.message}`);
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr).trim()}`);
    return String(result.stdout);
}

/** Runs each trailer through `.mailmap`, so a co-author and the same person as an author merge. */
function mapTrailers(cwd: string, commits: CreditsCommit[]): void {
    const contacts = new Set<string>();
    for (const commit of commits) {
        for (const person of commit.coAuthors) if (person.email) contacts.add(`${person.name} <${person.email}>`);
    }
    if (contacts.size === 0) return;
    const asked = [...contacts];
    const answered = git(cwd, ['check-mailmap', '--stdin'], asked.join('\n') + '\n')
        .split('\n')
        .filter(Boolean);
    if (answered.length !== asked.length) throw new Error('git check-mailmap answered a different number of lines');
    const mapped = new Map(asked.map((contact, i) => [contact, parsePerson(answered[i]!)]));
    for (const commit of commits) {
        commit.coAuthors = commit.coAuthors.map((p) => (p.email ? mapped.get(`${p.name} <${p.email}>`)! : p));
    }
}

/** The repo's non-merge commits with `.mailmap` applied to authors and co-authors. */
export function readCommits(cwd: string): CreditsCommit[] {
    // A shallow clone drops history, so the result would silently differ from a full one
    // and `--check` would flag a perfectly current file as stale.
    if (git(cwd, ['rev-parse', '--is-shallow-repository']).trim() === 'true') {
        throw new Error('the repository is a shallow clone; fetch the full history first (git fetch --unshallow)');
    }
    const commits = parseGitLog(git(cwd, GIT_LOG_ARGS));
    mapTrailers(cwd, commits);
    return commits;
}

const STRING_LIST_KEYS = ['developers', 'supporters', 'exclude'] as const;

function asStringList(value: unknown, where: string): string[] {
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
        throw new Error(`${where} must be an array of strings`);
    }
    return value;
}

export function parseOverrides(text: string, where = 'overrides'): CreditsOverrides {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch (err) {
        throw new Error(`${where} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new Error(`${where} must be a JSON object`);
    }
    const record = data as Record<string, unknown>;
    const known = new Set<string>([...STRING_LIST_KEYS, 'translators']);
    for (const key of Object.keys(record)) {
        if (!known.has(key)) throw new Error(`${where} has an unknown key "${key}" (known: ${[...known].join(', ')})`);
    }
    const overrides: CreditsOverrides = {};
    for (const key of STRING_LIST_KEYS) {
        if (record[key] !== undefined) overrides[key] = asStringList(record[key], `${where}.${key}`);
    }
    if (record.translators !== undefined) {
        const raw = record.translators;
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
            throw new Error(`${where}.translators must map a language to an array of names`);
        }
        overrides.translators = {};
        for (const [language, names] of Object.entries(raw)) {
            overrides.translators[language] = asStringList(names, `${where}.translators.${language}`);
        }
    }
    return overrides;
}

export function serializeCredits(credits: Credits): string {
    return JSON.stringify(credits, null, 2) + '\n';
}

/** True when `existing` (the file on disk, or `null` when absent) is not what `credits` serializes to. */
export function isStale(existing: string | null, credits: Credits): boolean {
    if (existing === null) return true;
    try {
        return JSON.stringify(JSON.parse(existing)) !== JSON.stringify(credits);
    } catch {
        return true;
    }
}
