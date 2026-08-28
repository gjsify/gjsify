// What each storybook target actually renders, read from the code that registers it.
//
// THE INCIDENT
//
// `check-storybook-story-parity.mjs` held three targets to the same story set off a
// FILENAME on disk — a set-of-basenames reader that is gone with it. A file is not a
// story that renders. Two of the three targets register through a hand-written list
// module, and the gate read neither:
//
//   deleting `import { CarouselWebStories }` and its array entry from
//   `showcases/gtk/adwaita-storybook/src/browser/stories.ts` removes Carousel from
//   the browser storybook AND from the website embed that mounts the same list,
//   and the gate printed "41 stories, each rendered by all three targets".
//
// Measured against `origin/main` at 9d9db9376, together with the NativeScript twin
// and a `*.story.ts` whose story module lost its `export` keyword: three targets,
// three ways to stop rendering a story, exit 0 for all three.
//
// So this module is the ONE reader of the registration, the way
// `adwaita-elements.mjs` is the one reader of the element set — same argument, one
// domain over: a cheap local derivation beside a real one is how the weak answer
// ends up being the one that passes. It reports TWO facts per target and the
// caller says which it means, following `suite-registration.mjs` (#1367):
//
//   `reachable` — the target's registry IMPORTS the rendering module.
//   `live`      — the registry also HANDS it to the controller: the binding is in
//                 the exported `stories` array, or (GTK) the module exports a value
//                 `collectStoryModules` will recognise as a story module.
//
// A registry this cannot parse THROWS. Reporting every story of that target as
// unregistered would present the reader's own limit as the tree's defect, and that
// is the expensive direction to be wrong in.
//
// A FOURTH TARGET is one entry in {@link STORYBOOK_TARGETS}: a suffix, a source
// root and either a list module or the glob.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';

import { resolveLocalSource, toPosixPath } from '../packages/infra/manifest-conformance/lib/index.mjs';
import { ADWAITA_NS_STORY_SRC, ADWAITA_STORY_SRC, storyFilesWith, stripComments } from './adwaita-elements.mjs';

/** The showcase whose `gjsify.storybook.stories` decides what the GTK glob scans. */
const GTK_SHOWCASE = 'showcases/gtk/adwaita-storybook';

/**
 * Every storybook target, with the code that decides which stories it renders.
 *
 * `registry: null` is the glob: `gjsify storybook` walks `gjsify.storybook.stories`
 * for `*.story.{ts,js,mts,mjs}` and generates an entry that imports each one as a
 * namespace, so for GTK the filename IS the import — but only what the module
 * EXPORTS reaches `collectStoryModules`, which is the second fact below.
 */
export const STORYBOOK_TARGETS = [
    { id: 'gtk', label: 'GTK (*.story.ts)', suffix: '.story.ts', src: ADWAITA_STORY_SRC, registry: null },
    {
        id: 'browser',
        label: 'browser (*.web.ts)',
        suffix: '.web.ts',
        src: ADWAITA_STORY_SRC,
        registry: `${GTK_SHOWCASE}/src/browser/stories.ts`,
    },
    {
        id: 'nativescript',
        label: 'NativeScript (*.ns.ts)',
        suffix: '.ns.ts',
        src: ADWAITA_NS_STORY_SRC,
        registry: 'showcases/dom/adwaita-storybook-nativescript/src/stories.ts',
    },
];

/** The barrel every renderer-agnostic meta must leave through — see {@link metaBarrelExports}. */
export const META_BARREL = `${GTK_SHOWCASE}/src/metas.ts`;

// `gjsify storybook` (packages/infra/cli/src/commands/storybook.ts) skips `node_modules`
// and dot-names and matches these four extensions. Repeated here rather than
// approximated, because a target's file set and the CLI's have to be the same set.
const STORY_FILE = /\.story\.(ts|js|mts|mjs)$/;

/** Every `import` statement, so a form the binding reader below cannot see can be counted. */
const IMPORT_STATEMENT = /(?:^|[\n;])\s*import\b/g;

/** `import './styles.css'` — it provably binds nothing, so it is read and contributes nothing. */
const SIDE_EFFECT_IMPORT = /(?:^|[\n;])\s*import\s*['"][^'"]+['"]/g;

/** `import { A, B } from './x/y.web.js'` — the named bindings and the specifier. */
const NAMED_IMPORT = /(?:^|[\n;])\s*import\s+\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

/** A statement TypeScript erases whole; it registers nothing and is not counted as an import. */
const TYPE_IMPORT = /(?:^|[\n;])\s*import\s+type\b/g;

/** `export const stories: WebStoryModule[] = [` — the list the controller is handed. */
const STORY_LIST = /export\s+const\s+stories\s*(?::[^=]*)?=\s*\[/;

/**
 * `export const XStories: StoryModule = { stories: [ … ] }` — what `collectStoryModules`
 * finds when it walks a namespace for values shaped like a story module (`isStoryModule`:
 * an object with a `stories` array).
 *
 * Deliberately narrow. An export shape this cannot read is reported as NOT live, which
 * fails the gate; the opposite default would pass a `*.story.ts` that registers nothing.
 * Every GTK rendering in the tree is written this way.
 */
const STORY_MODULE_EXPORT = /export\s+const\s+[A-Za-z0-9_$]+\s*(?::[^=]*)?=\s*\{[^{}]*\bstories\s*:\s*\[/;

/** `export * from './rows/action-row.meta.js'` — the barrel's one form. */
const BARREL_EXPORT = /export\s+\*\s+from\s*['"]([^'"]+)['"]/g;

/** Every re-export, so a form {@link BARREL_EXPORT} cannot see is counted rather than missed. */
const BARREL_STATEMENT = /(?:^|[\n;])\s*export\b/g;

/** `./view-switching/carousel.web.js` → `carousel`, the name metas and ledgers share. */
function storyNameOf(specifier, suffix) {
    const emitted = `${suffix.slice(0, -'ts'.length)}js`;
    const file = basename(specifier);
    return file.endsWith(emitted) ? file.slice(0, -emitted.length) : null;
}

/**
 * A TS source importing its emitted `.js` sibling; the file on disk is the TypeScript
 * one. `resolveLocalSource` asks the DISK across the whole shared extension set rather
 * than rewriting the suffix to `.ts` and hoping — the rewrite silently produces a path
 * that does not exist for anything written as `.mts` or `.tsx`, and a specifier that
 * resolves to nothing drops the edge without a word.
 */
const onDisk = (from, specifier) =>
    resolveLocalSource(from, specifier) ?? resolve(from, '..', specifier.replace(/\.js$/, '.ts'));

/**
 * {@link STORY_FILE} under `dir` — `name` → absolute path.
 *
 * Its own walk rather than {@link storyFilesWith}, because the GTK target's file set has
 * to be the set the CLI imports and the CLI matches four extensions, not one suffix. A
 * `carousel.story.mts` would be in the storybook and outside a `.story.ts` scan.
 */
function globStoryFiles(dir) {
    /** @type {Map<string, string>} */
    const found = new Map();
    const walk = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            const path = join(current, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (STORY_FILE.test(entry.name)) found.set(entry.name.replace(STORY_FILE, ''), path);
        }
    };
    if (existsSync(dir)) walk(dir);
    return found;
}

/** The directory `gjsify storybook` scans, as the showcase's own package.json declares it. */
function globRoot(root) {
    const manifest = join(root, GTK_SHOWCASE, 'package.json');
    let declared;
    try {
        declared = JSON.parse(readFileSync(manifest, 'utf8')).gjsify?.storybook?.stories ?? 'src';
    } catch (error) {
        throw new Error(
            `${GTK_SHOWCASE}/package.json is unreadable (${error.message}), and it declares which ` +
                'directory `gjsify storybook` scans. Without it nothing here knows what the GTK target renders.',
        );
    }
    const dir = join(root, GTK_SHOWCASE, declared);
    if (resolve(dir) !== resolve(join(root, ADWAITA_STORY_SRC))) {
        throw new Error(
            `${GTK_SHOWCASE}/package.json scans \`${declared}\`, which is not ${ADWAITA_STORY_SRC} — where ` +
                'the metas are read from. The two have to be the same tree, or every GTK rendering reports ' +
                'as missing against metas nothing renders.',
        );
    }
    return dir;
}

/**
 * The GTK arm: the glob imports every file, so `reachable` is the file set, and `live`
 * is the subset whose story module LEAVES the module.
 */
function globRegistration(files) {
    const live = new Set();
    for (const [name, path] of files) {
        if (STORY_MODULE_EXPORT.test(stripComments(readFileSync(path, 'utf8')))) live.add(name);
    }
    return { reachable: new Set(files.keys()), live, dangling: [] };
}

/**
 * A hand-written list module: `reachable` is what it imports, `live` what it puts in
 * the exported `stories` array.
 *
 * THROWS on a registry it cannot parse — a missing file, an import form it cannot read,
 * no `stories` array, an empty one, or an array entry bound to no import. Each of those
 * would otherwise report every story of the target as unregistered, which points the
 * reader at every sound file in the tree instead of at the one that moved.
 *
 * `dangling` is an import whose rendering is not on disk. It is DATA rather than a throw
 * because the missing file is a parity finding the caller already has a line for — the
 * caller decides which of the two to say.
 */
function listRegistration(root, target, files) {
    const path = join(root, target.registry);
    let source;
    try {
        source = stripComments(readFileSync(path, 'utf8'));
    } catch (error) {
        throw new Error(
            `${target.registry} is the ${target.label} story registry and could not be read (${error.message}). ` +
                'Nothing else says which stories that target renders.',
        );
    }

    /** binding identifier → story name, for the imports that resolve to a rendering. */
    const bindings = new Map();
    const dangling = [];
    const reachable = new Set();
    let parsed = 0;
    for (const [, clause, specifier] of source.matchAll(NAMED_IMPORT)) {
        parsed += 1;
        const name = storyNameOf(specifier, target.suffix);
        if (name === null) continue; // a type-only or helper import; it registers no story.
        const identifiers = clause
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry !== '' && !entry.startsWith('type '));
        // Bound BEFORE the file check, so an import pointing at a deleted rendering leaves
        // the array entry resolvable. Dropping the binding here would raise the
        // no-such-binding throw below over what is really one missing file.
        for (const identifier of identifiers) bindings.set(identifier, name);
        if (files.get(name) !== onDisk(path, specifier)) {
            dangling.push({ name, specifier });
            continue;
        }
        if (identifiers.length > 0) reachable.add(name);
    }

    const statements =
        (source.match(IMPORT_STATEMENT) ?? []).length -
        (source.match(TYPE_IMPORT) ?? []).length -
        (source.match(SIDE_EFFECT_IMPORT) ?? []).length;
    if (parsed < statements) {
        throw new Error(
            `${target.registry} has ${statements - parsed} import statement(s) this reader cannot parse. ` +
                'Every story it registers through one of them would report as unregistered, so the limit ' +
                'is reported here rather than as a finding against each file that is fine.',
        );
    }

    const opens = STORY_LIST.exec(source);
    if (opens === null) {
        throw new Error(
            `${target.registry} exports no \`stories\` array this reader can find. That array is what the ` +
                `${target.label} controller is handed; without reading it nothing here knows what renders.`,
        );
    }
    const close = source.indexOf(']', opens.index + opens[0].length);
    if (close === -1) {
        throw new Error(`${target.registry}: the \`stories\` array is never closed — this reader cannot end it.`);
    }
    const listed = [...source.slice(opens.index + opens[0].length, close).matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)].map(
        ([identifier]) => identifier,
    );
    if (listed.length === 0) {
        throw new Error(
            `${target.registry}: the \`stories\` array is empty. An empty registry makes every story of ` +
                'this target report as unregistered at once, which is a broken read, not one finding per story.',
        );
    }

    const live = new Set();
    for (const identifier of listed) {
        const name = bindings.get(identifier);
        if (name === undefined) {
            throw new Error(
                `${target.registry} lists \`${identifier}\` in its \`stories\` array, and imports no such ` +
                    'binding from a rendering file. Either the import was removed and the entry left behind, ' +
                    'or this reader misread the import — either way the array no longer says what renders.',
            );
        }
        live.add(name);
    }
    return { reachable, live, dangling };
}

/**
 * Every target with its renderings and the two registration facts about each.
 *
 * @param {string} root repository root
 * @returns {Map<string, {label: string, suffix: string, src: string, registry: string|null,
 *                        files: Map<string, string>, reachable: Set<string>, live: Set<string>,
 *                        dangling: Array<{name: string, specifier: string}>}>} keyed by target id
 */
export function storybookRegistration(root) {
    const registration = new Map();
    for (const target of STORYBOOK_TARGETS) {
        const files =
            target.registry === null
                ? globStoryFiles(globRoot(root))
                : storyFilesWith(join(root, target.src), target.suffix);
        if (files.size === 0) {
            throw new Error(
                `no ${target.suffix} file under ${target.src}. Either the showcase moved or the naming ` +
                    'convention changed — a scan that finds nothing passes vacuously, so this is a ' +
                    'failure, not a pass.',
            );
        }
        const read = target.registry === null ? globRegistration(files) : listRegistration(root, target, files);
        registration.set(target.id, { ...target, files, ...read });
    }
    return registration;
}

/**
 * The story names {@link META_BARREL} re-exports — the only path a NativeScript rendering
 * has to its meta, since it imports `@gjsify/example-gtk-adwaita-storybook/metas` rather
 * than reaching across packages into the file.
 *
 * A meta missing here breaks the build rather than shipping a hole, but nothing in
 * `audit-runtimes.yml` builds that showcase, so the first reader to find out is a person.
 *
 * @param {string} root repository root
 * @returns {Set<string>} bare story names
 */
export function metaBarrelExports(root) {
    const path = join(root, META_BARREL);
    let source;
    try {
        source = stripComments(readFileSync(path, 'utf8'));
    } catch (error) {
        throw new Error(`${META_BARREL} could not be read (${error.message}) — it is what carries the metas out.`);
    }
    const names = new Set();
    let parsed = 0;
    for (const [, specifier] of source.matchAll(BARREL_EXPORT)) {
        parsed += 1;
        const file = basename(specifier);
        if (file.endsWith('.meta.js')) names.add(file.slice(0, -'.meta.js'.length));
    }
    const statements = (source.match(BARREL_STATEMENT) ?? []).length;
    if (parsed < statements) {
        throw new Error(
            `${META_BARREL} has ${statements - parsed} export statement(s) this reader cannot parse, so the ` +
                'metas they carry would report as unexported. Fix the reader rather than the barrel.',
        );
    }
    if (names.size === 0) {
        throw new Error(
            `${META_BARREL} re-exports no *.meta.js. An empty barrel reports every meta as unreachable from ` +
                'NativeScript at once, which is a broken read, not a tree-wide defect.',
        );
    }
    return names;
}

/** Repo-relative, for a message a reader can open. */
export const showPath = (root, path) => toPosixPath(relative(root, path));
