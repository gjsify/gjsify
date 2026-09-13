// Coverage for `editManifest` — the surgical edit `gjsify flatpak sync-flathub`
// makes to a Flathub tracking-repo's manifest after a release.
//
// THE CASE THIS FILE EXISTS FOR: a Flathub build runs with the network
// unshared. An app whose install reads a generated offline tarball list cannot
// build from the git checkout alone, so that list has to live in the Flathub
// repo AND be named in the module's sources. Repointing tag and commit is only
// half the bump, and the missing half is invisible: the manifest parses, the
// linters pass, and the build dies far away in whatever the app's build system
// says when its dependency install fails. Measured on Learn6502 0.8.0, the
// first release after its vendored dependency cache was dropped.
//
// The second thing asserted here is the SHAPE of `sources`. A flatpak source
// list holds objects and bare strings, the string naming a file beside the
// manifest, and the surrounding code used to type it as objects alone.
//
// Worth being exact about what that buys, because a mutation test says so: in
// JS the old code SURVIVED a string, since `"file.json".type` is `undefined`
// and the search skipped it either way. Restoring the unguarded predicate keeps
// every test here green. The type fix is therefore about the next reader, who
// would write `source.url.startsWith(...)` and get a compile error instead of a
// crash. What these tests do hold is the search itself: replacing it with
// "index 0 is the git source" turns one of them red.

import { describe, it, expect } from '@gjsify/unit';
import { editManifest } from './commands/flatpak/sync-flathub.js';

const MANIFEST =
    JSON.stringify(
        {
            id: 'eu.example.App',
            modules: [
                {
                    name: 'App',
                    buildsystem: 'meson',
                    sources: [{ type: 'git', url: 'https://example.invalid/App.git', tag: 'v1.0.0', commit: 'aaa' }],
                },
            ],
        },
        null,
        4,
    ) + '\n';

/** The main module's sources, after an edit. */
function sourcesOf(json: string): unknown[] {
    return (JSON.parse(json) as { modules: { sources: unknown[] }[] }).modules[0]!.sources;
}

export default async () => {
    await describe('editManifest — the git pin', async () => {
        await it('repoints tag and commit', async () => {
            const out = editManifest(MANIFEST, { tag: 'v1.1.0', commit: 'bbb' });
            const git = sourcesOf(out)[0] as { tag: string; commit: string };
            expect(git.tag).toBe('v1.1.0');
            expect(git.commit).toBe('bbb');
        });

        await it('keeps the file a Flathub manifest: indent and trailing newline', async () => {
            const out = editManifest(MANIFEST, { tag: 'v1.1.0', commit: 'bbb' });
            // Asserted because the whole point of the "surgical" edit is that a
            // maintainer reviewing the PR sees two changed lines, not a reflow.
            expect(out.endsWith('\n')).toBe(true);
            expect(out.split('\n')[1]).toBe('    "id": "eu.example.App",');
        });
    });

    await describe('editManifest — the offline source list', async () => {
        await it('names the list in the module sources', async () => {
            const out = editManifest(MANIFEST, { tag: 'v1.1.0', commit: 'bbb', sourcesFile: 'gjsify-sources.json' });
            expect(sourcesOf(out)).toContain('gjsify-sources.json');
        });

        await it('leaves the sources alone when no list is passed', async () => {
            // An app that installs online, or vendors its dependencies, must not
            // grow a reference to a file its repo does not have.
            const out = editManifest(MANIFEST, { tag: 'v1.1.0', commit: 'bbb' });
            expect(sourcesOf(out).length).toBe(1);
        });

        await it('adds the reference once, however often it runs', async () => {
            // THE RUN THAT USED TO BREAK. The first sync adds the string; every
            // later one walks an array that now holds an object AND a string.
            const once = editManifest(MANIFEST, { tag: 'v1.1.0', commit: 'bbb', sourcesFile: 'gjsify-sources.json' });
            const twice = editManifest(once, { tag: 'v1.2.0', commit: 'ccc', sourcesFile: 'gjsify-sources.json' });
            const sources = sourcesOf(twice);
            expect(sources.filter((s) => s === 'gjsify-sources.json').length).toBe(1);
            // And the git source is still found past the string.
            expect((sources[0] as { tag: string }).tag).toBe('v1.2.0');
        });

        await it('finds the git source when a string comes first', async () => {
            // Order is the manifest author's choice, so the walk cannot assume
            // index 0 is an object.
            const reordered =
                JSON.stringify(
                    {
                        modules: [
                            {
                                name: 'App',
                                sources: [
                                    'gjsify-sources.json',
                                    { type: 'git', url: 'u', tag: 'v1.0.0', commit: 'aaa' },
                                ],
                            },
                        ],
                    },
                    null,
                    4,
                ) + '\n';
            const out = editManifest(reordered, { tag: 'v2.0.0', commit: 'ddd', sourcesFile: 'gjsify-sources.json' });
            const sources = sourcesOf(out);
            expect(sources[0]).toBe('gjsify-sources.json');
            expect((sources[1] as { tag: string; commit: string }).tag).toBe('v2.0.0');
        });

        await it('refuses a source index that points at a file reference', async () => {
            const withString = editManifest(MANIFEST, {
                tag: 'v1.1.0',
                commit: 'bbb',
                sourcesFile: 'gjsify-sources.json',
            });
            let message = '';
            try {
                editManifest(withString, { tag: 'v1.2.0', commit: 'ccc', sourceIndex: 1 });
            } catch (error) {
                message = error instanceof Error ? error.message : String(error);
            }
            // Names what it found rather than reporting `type is "undefined"`,
            // which is what reading `.type` off a string produces.
            expect(message).toContain('gjsify-sources.json');
            expect(message).toContain('expected a git source');
        });
    });
};
