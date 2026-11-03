// `gjsify credits` — bot filter, mailmap merge, Co-authored-by parsing, translators per
// language, overrides and --check staleness, against a throwaway git repository.

import { describe, expect, it } from '@gjsify/unit';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
    DEFAULT_CREDITS_IGNORE,
    buildCredits,
    isIgnored,
    isStale,
    parseGitLog,
    parseOverrides,
    parsePerson,
    readCommits,
    serializeCredits,
} from './utils/credits.js';

interface FixtureCommit {
    author: string;
    email: string;
    files: Record<string, string>;
    trailers?: string[];
}

const ISOLATED_GIT = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };

function git(cwd: string, args: string[], env: Record<string, string | undefined> = {}): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...ISOLATED_GIT, ...env } });
}

function commit(cwd: string, { author, email, files, trailers = [] }: FixtureCommit): void {
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(cwd, path)), { recursive: true });
        writeFileSync(join(cwd, path), content);
    }
    git(cwd, ['add', '-A']);
    const message = ['-m', 'change'];
    if (trailers.length) message.push('-m', trailers.join('\n'));
    git(cwd, ['commit', '--quiet', ...message], {
        GIT_AUTHOR_NAME: author,
        GIT_AUTHOR_EMAIL: email,
        GIT_COMMITTER_NAME: author,
        GIT_COMMITTER_EMAIL: email,
    });
}

let serial = 0;
function withRepo<T>(fn: (dir: string) => T): T {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-credits-'));
    try {
        git(dir, ['init', '--quiet', '-b', 'main']);
        return fn(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const code = () => ({ [`src/f${serial++}.ts`]: String(serial) });
const po = (lang: string) => ({ [`po/${lang}.po`]: `# ${lang} ${serial++}` });

const person = (name: string, email = '') => ({ name, email });

export default async () => {
    await describe('credits', async () => {
        await it('drops bots, AI co-authors and translation services by name or e-mail', async () => {
            const ignored: [string, string][] = [
                ['dependabot[bot]', 'x@users.noreply.github.com'],
                ['github-actions', 'actions@github.com'],
                ['Some App', '41898282+github-actions[bot]@users.noreply.github.com'],
                ['Weblate', 'w@example.org'],
                ['Weblate (bot)', 'hosted@weblate.org'],
                ['Hosted Weblate', 'hosted@weblate.org'],
                ['Weblate Translation Memory', 'x@example.org'],
                ['LibreTranslate', 'x@example.org'],
                ['claude', 'x@example.org'],
                ['Claude Opus 4.5', 'noreply@anthropic.com'],
                ['A. Machine', 'noreply-mt-libretranslate@weblate.org'],
            ];
            for (const [name, email] of ignored) {
                expect(isIgnored(person(name, email), DEFAULT_CREDITS_IGNORE)).toBe(true);
            }
            expect(isIgnored(person('Ada Lovelace', 'ada@example.org'), DEFAULT_CREDITS_IGNORE)).toBe(false);
            expect(isIgnored(person('Claudia Reuter', 'claudia@example.org'), DEFAULT_CREDITS_IGNORE)).toBe(false);
        });

        await it('lets the caller replace the default list', async () => {
            const commits = [{ author: person('Weblate', 'w@x.org'), coAuthors: [], files: ['src/a.ts'] }];
            expect(buildCredits(commits).developers.length).toBe(0);
            expect(buildCredits(commits, { ignore: [] }).developers.join()).toBe('Weblate');
            expect(buildCredits(commits, { ignore: ['*@x.org'] }).developers.length).toBe(0);
        });

        await it('parses Co-authored-by trailers with and without an address', async () => {
            expect(parsePerson('Ada Lovelace <ada@example.org>')).toStrictEqual(
                person('Ada Lovelace', 'ada@example.org'),
            );
            expect(parsePerson('Just A Name')).toStrictEqual(person('Just A Name'));
            const [first] = parseGitLog(
                '\x1eMe\x1fme@x.org\x1fAda <a@x.org>\x1dGrace <g@x.org>\x1f\n\nsrc/a.ts\npo/de.po\n',
            );
            expect(first!.author).toStrictEqual(person('Me', 'me@x.org'));
            expect(first!.coAuthors.map((c) => c.name).join()).toBe('Ada,Grace');
            expect(first!.files.join()).toBe('src/a.ts,po/de.po');
        });

        await it('reads co-authors from a real commit, matching the trailer key case-insensitively', async () => {
            withRepo((dir) => {
                commit(dir, {
                    author: 'Me',
                    email: 'me@x.org',
                    files: code(),
                    trailers: ['Co-authored-by: Ada <ada@x.org>', 'co-authored-by: Grace <grace@x.org>'],
                });
                const [only] = readCommits(dir);
                expect(only!.coAuthors.map((c) => c.name).join()).toBe('Ada,Grace');
            });
        });

        await it('merges identities through .mailmap, for authors and for trailers', async () => {
            withRepo((dir) => {
                writeFileSync(
                    join(dir, '.mailmap'),
                    'Ada Lovelace <ada@example.org> <ada@old.example>\nAda Lovelace <ada@example.org> ada <ada@laptop>\n',
                );
                commit(dir, { author: 'ada', email: 'ada@laptop', files: code() });
                commit(dir, { author: 'Ada L.', email: 'ada@old.example', files: code() });
                commit(dir, {
                    author: 'Grace',
                    email: 'grace@x.org',
                    files: code(),
                    trailers: ['Co-authored-by: Ada <ada@old.example>'],
                });
                const credits = buildCredits(readCommits(dir));
                expect(credits.developers.join()).toBe('Ada Lovelace,Grace');
                expect(credits.developers.length).toBe(2);
            });
        });

        await it('counts a commit once when someone is both author and co-author', async () => {
            withRepo((dir) => {
                commit(dir, {
                    author: 'Ada',
                    email: 'a@x.org',
                    files: code(),
                    trailers: ['Co-authored-by: Ada <a@x.org>'],
                });
                commit(dir, { author: 'Grace', email: 'g@x.org', files: code() });
                commit(dir, { author: 'Grace', email: 'g@x.org', files: code() });
                expect(buildCredits(readCommits(dir)).developers.join()).toBe('Grace,Ada');
            });
        });

        await it('assigns translators to the languages a commit touched, from the Weblate trailers', async () => {
            withRepo((dir) => {
                commit(dir, { author: 'Dev', email: 'dev@x.org', files: { ...code(), ...po('de') } });
                commit(dir, {
                    author: 'Weblate (bot)',
                    email: 'hosted@weblate.org',
                    files: { ...po('de'), ...po('pt_BR') },
                    trailers: ['Co-authored-by: Hans <hans@x.org>', 'Co-authored-by: Maria <maria@x.org>'],
                });
                commit(dir, {
                    author: 'Weblate (bot)',
                    email: 'hosted@weblate.org',
                    files: po('pt_BR'),
                    trailers: ['Co-authored-by: Maria <maria@x.org>'],
                });
                commit(dir, {
                    author: 'Weblate (bot)',
                    email: 'hosted@weblate.org',
                    files: { 'po/app.pot': 'template' },
                    trailers: ['Co-authored-by: Nobody <nobody@x.org>'],
                });
                const credits = buildCredits(readCommits(dir));
                expect(credits.developers.join()).toBe('Dev');
                expect(Object.keys(credits.translators).join()).toBe('de,pt_BR');
                expect(credits.translators.de!.join()).toBe('Dev,Hans,Maria');
                expect(credits.translators.pt_BR!.join()).toBe('Maria,Hans');
            });
        });

        await it('sorts by contribution count, then by name', async () => {
            const commit = (name: string) => ({ author: person(name), coAuthors: [], files: ['src/a.ts'] });
            const credits = buildCredits(
                ['Zed', 'Bob', 'Ann', 'Bob', 'Zed', 'Cy'].map(commit).concat(commit('Cy'), commit('Cy')),
            );
            expect(credits.developers.join()).toBe('Cy,Bob,Zed,Ann');
        });

        await it('never lets an e-mail address into the output', async () => {
            withRepo((dir) => {
                commit(dir, {
                    author: 'Ada',
                    email: 'ada@secret.example',
                    files: { ...code(), ...po('de') },
                    trailers: ['Co-authored-by: Grace <grace@secret.example>'],
                });
                const text = serializeCredits(buildCredits(readCommits(dir)));
                expect(text.includes('@')).toBe(false);
                expect(text.includes('secret.example')).toBe(false);
            });
        });

        await it('adds people without commits, excludes others, and fills supporters from the overrides only', async () => {
            withRepo((dir) => {
                commit(dir, { author: 'Ada', email: 'a@x.org', files: code() });
                commit(dir, { author: 'Mallory', email: 'm@x.org', files: { ...code(), ...po('fr') } });
                const overrides = parseOverrides(
                    JSON.stringify({
                        developers: ['Original Author', 'Ada'],
                        translators: { fr: ['Frida'], es: ['Elena'] },
                        supporters: ['Patron', 'Patron', ' Sponsor '],
                        exclude: ['Mallory'],
                    }),
                );
                const credits = buildCredits(readCommits(dir), { overrides });
                expect(credits.developers.join()).toBe('Ada,Original Author');
                expect(JSON.stringify(credits.translators)).toBe('{"es":["Elena"],"fr":["Frida"]}');
                expect(credits.supporters.join()).toBe('Patron,Sponsor');
                expect(buildCredits(readCommits(dir)).supporters.length).toBe(0);
            });
        });

        await it('refuses a malformed overrides file, naming the key', async () => {
            const message = (text: string) => {
                try {
                    parseOverrides(text, 'o.json');
                } catch (err) {
                    return (err as Error).message;
                }
                return '';
            };
            expect(message('{')).toContain('o.json is not valid JSON');
            expect(message('[]')).toContain('must be a JSON object');
            expect(message('{"develpers":[]}')).toContain('unknown key "develpers"');
            expect(message('{"developers":"Ada"}')).toContain('o.json.developers must be an array of strings');
            expect(message('{"translators":{"de":[1]}}')).toContain('o.json.translators.de');
        });

        await it('--check: a missing, outdated or unparsable file is stale, a current one is not', async () => {
            withRepo((dir) => {
                commit(dir, { author: 'Ada', email: 'a@x.org', files: code() });
                const current = buildCredits(readCommits(dir));
                expect(isStale(null, current)).toBe(true);
                expect(isStale('not json', current)).toBe(true);
                expect(isStale(serializeCredits(current), current)).toBe(false);
                // Formatting is not content.
                expect(isStale(JSON.stringify(current), current)).toBe(false);

                commit(dir, { author: 'Grace', email: 'g@x.org', files: code() });
                const later = buildCredits(readCommits(dir));
                expect(isStale(serializeCredits(current), later)).toBe(true);
            });
        });

        await it('refuses a shallow clone instead of reporting a truncated history', async () => {
            withRepo((dir) => {
                commit(dir, { author: 'Ada', email: 'a@x.org', files: code() });
                commit(dir, { author: 'Grace', email: 'g@x.org', files: code() });
                const clone = join(dir, 'shallow');
                git(dir, ['clone', '--quiet', '--depth', '1', `file://${dir}`, clone]);
                let message = '';
                try {
                    readCommits(clone);
                } catch (err) {
                    message = (err as Error).message;
                }
                expect(message).toContain('shallow clone');
            });
        });
    });
};
