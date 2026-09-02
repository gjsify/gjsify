#!/usr/bin/env node
// Every code sample in the Adwaita docs has to be a sample that RUNS.
//
// THE INCIDENT
//
// `check-website-adwaita-gallery.mjs` holds that every storybook widget has a
// gallery block and every block has a widget behind it — coverage, in both
// directions. Its own header says what it does not do: "it therefore says
// NOTHING about whether a page RENDERS". Nothing else read a fence at all, and
// an audit on 2026-08-23 found eight defects sitting in that blind spot across
// four shapes, every one of them copy-and-paste-fatal:
//
//   1. `view-switching.mdx:314` uses `mailUnreadSymbolic`, `starredSymbolic` and
//      `folderSymbolic`; the fence's single import line brings in four
//      NativeScript classes and no glyph. `presentation.mdx:352` is the same
//      shape with `folderSymbolic`.
//   2. `boxed-lists.mdx:576` imports `AdwSwitchRow` and never uses it — the
//      inverse tell, and it marked a tab that builds one fewer row than the
//      three beside it.
//   3. `buttons.mdx:441` and `:465` name `view-columns-symbolic`, which exists
//      in NO icon theme, so the GJS and Blueprint panes draw GTK's broken-image
//      paintable under prose promising an icon. `build-scss.mjs:62` names this
//      very page as the victim and ships a hand-drawn substitute for the WEB
//      pane only.
//   4. `layout.mdx:232` and `:343` write `class="adw-action-bar"`, which is in
//      no stylesheet, no partial and no generated file — a phantom. In the
//      preview the inline styles carry the look; in the web tab the inline
//      `border-top` was dropped too, so a reader who copies it gets neither.
//
// None of the four needs a browser, a build or an install to see. Three need
// nothing but the repo's own tracked files; the fourth needs one binary.
//
// WHAT EACH ARM CHECKS, AND WHAT IT DELIBERATELY DOES NOT
//
//   BLUEPRINT   every ```blueprint fence is handed to `blueprint-compiler
//               compile`. A diagnostic on stderr fails too, not just a non-zero
//               exit: the whole class here is "compiles, means something else",
//               and `Unused import: Adw` is how a GTK-only block advertises that
//               it copied a header it does not need.
//
//   IMPORTS     inside a ```ts fence: every identifier of the icon-export shape
//               (`somethingSymbolic`) must be imported IN THAT FENCE, and every
//               imported binding must appear somewhere in it. Scoped to that one
//               shape on purpose — a general unbound-identifier analysis over a
//               fence with no surrounding module is where false alarms come
//               from, and a check with false alarms is worse than none (the
//               workflow validator that produced 17 of them was reverted).
//
//   ICONS       every imported glyph must exist in `@gjsify/adwaita-icons` AND
//               in the subpath it is imported from; every icon NAME written as a
//               string — `icon=`, `icon-name=`, `iconName:` — must exist either
//               there or in the web pillar's own `ICONS` map. Both spellings
//               resolve: `go-next` and `go-next-symbolic` are the same glyph.
//
//   TOKENS      a `tsx` fence that writes `className` must be preceded — in the
//               same fence, or earlier on the same page — by `configureStyle({
//               tokens })`. The class VALUES are the reader's project's:
//               `@gjsify/gtk-host/style` ships `0` and `px` and nothing between
//               them, deliberately, so that an undeclared token is a named error
//               rather than a wrong margin. That error THROWS OUT OF THE RENDER:
//               React unmounts the tree, the window is empty, the process exits 0
//               and GTK reports nothing, because there is no tree to report about.
//
//               MEASURED 2026-08-27, which is why this arm exists: FOUR of four
//               className-bearing tsx fences in the docs were blank windows —
//               `gap-s`, `gap-m`, `p-m`, `p-xl`, `text-title`, `text-caption`, none
//               of them in any default scale. Every tree assertion behind them was
//               true; `slot="title"` really did reach `set_title_widget`. Nothing
//               in this repository could see it, because the only witness is the
//               window.
//
//               WHAT IT DELIBERATELY DOES NOT CHECK: whether the scales shown
//               COVER the tokens used. That needs `resolveUtility` out of a BUILT
//               `@gjsify/gtk-host`, and this gate reads tracked files with no build
//               — the property every other arm here has. Sufficiency is answered by
//               a photograph instead: `shotEvidence`/`blankReason` in that package's
//               `probe.ts`, which exist because a non-empty PNG is not proof.
//
//   CLASSES     every `adw-`-prefixed class in a `class=`/`className` value must
//               appear somewhere in the tracked SCSS. The SCSS side is read as a
//               loose token scan rather than a selector parse, because the
//               partials nest with `&` and interpolate with `#{}`: an
//               over-approximation can only ever MISS a phantom, never invent
//               one, and that is the right direction for the first gate to hold
//               this edge.
//
// It reads only tracked files, so `dist/adwaita-web.css` and
// `src/styles.generated.ts` — both gitignored — are not the source for anything
// here; the 60 `scss/` partials and `scripts/build-scss.mjs` are.
//
// Usage: node scripts/check-doc-fences.mjs [--root <dir>]

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { membersOf, NS_CORE_TYPES, readCoreProperties, readWidgets, WIDGET_CLASS } from './nativescript-xml-doors.mjs';

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : process.argv[rootFlag + 1];

/**
 * The gallery's section directories, one per widget library.
 *
 * Two since ADR 0034 § 1 put `Gtk` beside `Adwaita`. A fence under `gtk/` compiles
 * and resolves exactly like one under `adwaita/`, so a single-directory scan would
 * simply stop reading four blocks on the day they moved. It would stay green over a
 * set smaller than the one it names.
 */
const DOCS_SECTIONS = ['adwaita', 'gtk'];
const docsDir = (section) => join(ROOT, 'website/src/content/docs', section);

/**
 * Scanned by the TOKENS arm ONLY, and the narrowness is deliberate: three of the
 * four blank snippets were here rather than in the gallery, and widening the whole
 * gate to these pages in the same commit would mix a fix with a coverage change
 * whose failures would be about icons.
 */
const FRAMEWORKS_DIR = join(ROOT, 'website/src/content/docs/frameworks');
const ICONS_PKG = join(ROOT, 'packages/web/adwaita-icons');
const WEB_SCSS = join(ROOT, 'packages/web/adwaita-web/scss');
const WEB_ICON_MAP = join(ROOT, 'packages/web/adwaita-web/scripts/build-scss.mjs');
const LEDGER = join(ROOT, 'status/doc-fence-exemptions.json');

/** The website styles some of its own page furniture; those classes are legitimate. */
const WEBSITE_STYLE_SOURCES = ['website/src/styles/custom.css'];
const WEBSITE_COMPONENT_DIRS = ['website/src/components'];

/**
 * READMEs are in scope for the same reason the pages are: they are the one file
 * a consumer copies from, and `adwaita-icons/README.md` shipped two import lines
 * that resolve to nothing (`folder_symbolic`; the generator emits camelCase, and
 * there are ZERO snake_case names among the 644 exports).
 */
const EXTRA_SOURCES = ['packages/web/adwaita-icons/README.md', 'packages/web/adwaita-web/README.md'];

const failures = [];
const notes = [];
const fail = (where, message) => failures.push(`${where}: ${message}`);

// ---------------------------------------------------------------------------
// Ground truth, all from tracked files
// ---------------------------------------------------------------------------

/** camelCase glyph name -> the subpath that exports it. `folderSymbolic` -> `places`. */
function readIconExports() {
    const bySubpath = new Map();
    const all = new Map();
    for (const file of readdirSync(ICONS_PKG)) {
        if (!file.endsWith('.ts') || file === 'index.ts' || file === 'utils.ts') continue;
        const subpath = file.slice(0, -3);
        const names = new Set();
        for (const m of readFileSync(join(ICONS_PKG, file), 'utf8').matchAll(/^export const ([A-Za-z0-9_]+)/gm)) {
            names.add(m[1]);
            all.set(m[1], subpath);
        }
        bySubpath.set(subpath, names);
    }
    return { bySubpath, all };
}

/**
 * `folderDownloadSymbolic` -> `folder-download`. The spelling a doc writes in markup.
 *
 * The exact inverse of the generator's `toCamelCase`
 * (`adwaita-icons/scripts/generate.ts:19`), which uppercases the letter after every
 * hyphen — so the way back inserts one before every capital. The obvious
 * `([a-z0-9])([A-Z])` form is NOT the inverse and fails on consecutive capitals:
 * it turns `applicationXExecutableSymbolic` into `application-xexecutable`, which
 * would have reported a real glyph as missing the first time a page named it.
 * `assertKebabRoundTrips` below holds this against all 644 exports rather than
 * trusting the reasoning.
 */
const toKebabIcon = (camel) => camel.replace(/([A-Z])/g, '-$1').toLowerCase();

/**
 * Both spellings a doc may legitimately write for one glyph.
 *
 * `folder-symbolic` is the file name; markup on the web side writes `folder`, and a
 * GJS sample writes `folder-symbolic`. The strip is a SUFFIX rule and nothing more —
 * 58 of the 644 end in `-symbolic-rtl`, where `-symbolic` is not the tail and
 * chopping it produced a name no theme has.
 */
function iconSpellings(camel) {
    const full = toKebabIcon(camel);
    return full.endsWith('-symbolic') ? [full, full.slice(0, -'-symbolic'.length)] : [full];
}

/** The generator's forward rule, verbatim, so the inverse can be checked and not argued. */
const toCamelIcon = (kebab) => kebab.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

/**
 * Every glyph export must survive camel -> kebab -> camel unchanged.
 *
 * Without this the icon arm rests on a regex nobody re-derives, and its failure
 * mode is a FALSE ALARM on a glyph that exists — the one failure this repository
 * treats as worse than no check at all.
 */
function assertKebabRoundTrips(icons) {
    const broken = [];
    for (const camel of icons.all.keys()) {
        if (toCamelIcon(toKebabIcon(camel)) !== camel) broken.push(camel);
    }
    if (broken.length > 0) {
        console.error(
            `check-doc-fences: ${broken.length} glyph name(s) do not survive the kebab round-trip ` +
                `(e.g. ${broken.slice(0, 3).join(', ')}). The icon arm would report them as missing.`,
        );
        process.exit(1);
    }
    return icons.all.size;
}

/** Icon names the web pillar can actually draw — the keys of `build-scss.mjs`'s ICONS map. */
function readWebIconNames() {
    const source = readFileSync(WEB_ICON_MAP, 'utf8');
    const block = source.match(/const ICONS = \{([\s\S]*?)\n\};/);
    if (!block) throw new Error(`check-doc-fences: could not find the ICONS map in ${WEB_ICON_MAP}`);
    return new Set([...block[1].matchAll(/^\s*'?([a-z0-9-]+)'?\s*:/gm)].map((m) => m[1]));
}

/**
 * Every `adw-`-prefixed token in a stylesheet a doc page's markup can actually
 * reach. Over-approximates on purpose (see the header).
 *
 * TWO sources, and the second is not an afterthought: a gallery page styles some
 * of its own furniture in the Astro component that renders it — `adw-gallery-grid`
 * is declared at `AdwGalleryCard.astro:163` and nowhere in the pillar. Reading
 * only the pillar reported it as a phantom, which is a false alarm, and a check
 * with false alarms is worse than no check.
 */
function readStyledClasses() {
    const styled = new Set();
    const harvest = (text) => {
        for (const m of text.matchAll(/\badw-[a-z0-9-]+/g)) styled.add(m[0]);
    };
    for (const file of readdirSync(WEB_SCSS)) {
        if (!file.endsWith('.scss')) continue;
        // The generated icon partial is gitignored, so it is not ground truth
        // here — its classes are derived from the ICONS map instead, below.
        if (file === '_icons.generated.scss') continue;
        harvest(readFileSync(join(WEB_SCSS, file), 'utf8'));
    }
    for (const rel of WEBSITE_STYLE_SOURCES) {
        const abs = join(ROOT, rel);
        if (existsSync(abs)) harvest(readFileSync(abs, 'utf8'));
    }
    for (const dir of WEBSITE_COMPONENT_DIRS) {
        const abs = join(ROOT, dir);
        if (!existsSync(abs)) continue;
        for (const file of readdirSync(abs)) {
            if (file.endsWith('.astro')) harvest(readFileSync(join(abs, file), 'utf8'));
        }
    }
    return styled;
}

// ---------------------------------------------------------------------------
// Fence extraction
// ---------------------------------------------------------------------------

/**
 * Every fenced block in an `.mdx`/`.md` file, with the line its opener sits on.
 *
 * The fences on these pages are INDENTED, inside `<Fragment slot="…">`, so an
 * anchored `^```` finds 10 of the 340 that are there.
 */
function fences(text) {
    const lines = text.split('\n');
    const out = [];
    let open = null;
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(\s*)```(\w*)\s*$/);
        if (!m) {
            if (open) open.body.push(lines[i]);
            continue;
        }
        if (open && m[1].length === open.indent && m[2] === '') {
            out.push({ lang: open.lang, line: open.line, body: open.body.join('\n') });
            open = null;
        } else if (!open) {
            open = { indent: m[1].length, lang: m[2], line: i + 1, body: [] };
        } else if (open) {
            open.body.push(lines[i]);
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Arm: blueprint
// ---------------------------------------------------------------------------

/** blueprint-compiler colours unconditionally, and the escapes reach a CI log as mojibake. */
// oxlint-disable-next-line no-control-regex -- the escape sequence IS what this strips
const ANSI_SGR = /\u001b\[[0-9;]*m/g;

/**
 * Can the compile arm actually run here?
 *
 * `--version` answers a DIFFERENT question. Measured on a bare `ubuntu-latest`
 * with the package installed: every one of the 40 fences came back with
 * `Could not find GTK 4 introspection files. Is gobject-introspection
 * installed?` — 40 failures that say nothing about the samples. So the probe
 * compiles the smallest document that needs a typelib, and a host without one
 * gets a SKIPPED line naming the reason instead of a wall of false red.
 */
function blueprintAvailable(dir) {
    if (spawnSync('blueprint-compiler', ['--version'], { stdio: 'ignore' }).status !== 0) {
        return { ok: false, why: 'blueprint-compiler is not on PATH' };
    }
    const probe = join(dir, 'probe.blp');
    writeFileSync(probe, 'using Gtk 4.0;\n\nGtk.Label {\n  label: "probe";\n}\n');
    const proc = spawnSync('blueprint-compiler', ['compile', probe], { encoding: 'utf8' });
    if (proc.status === 0) return { ok: true, why: null };
    const first = (proc.stderr ?? '').replace(ANSI_SGR, '').trim().split('\n')[0];
    return { ok: false, why: first || `blueprint-compiler exited ${proc.status} on a one-label document` };
}

/**
 * Compile every blueprint fence, once each, and report BOTH halves.
 *
 * A clean exit is not a clean compile: blueprint-compiler prints
 * `Unused import: Adw` as a warning on stderr and still exits 0 — and that
 * warning is precisely how a GTK-only block says it copied a `using Adw 1;`
 * header it does not need. So the status and the stderr are read together,
 * which is also why this is `spawnSync` and not `execFileSync`.
 */
function checkBlueprint(fenceList, where, dir) {
    let compiled = 0;
    for (const fence of fenceList) {
        if (fence.lang !== 'blueprint') continue;
        const file = join(dir, `${where.replace(/[^\w]/g, '_')}-${fence.line}.blp`);
        writeFileSync(file, `${fence.body}\n`);
        compiled++;

        const proc = spawnSync('blueprint-compiler', ['compile', file], { encoding: 'utf8' });
        // blueprint-compiler colours its diagnostics unconditionally, and the escape
        // sequences survive into a CI log as mojibake around the one line that matters.
        const stderr = (proc.stderr ?? '').replace(ANSI_SGR, '').trim();
        if (proc.status !== 0) {
            const first = stderr.split('\n').slice(0, 4).join(' / ') || `exit ${proc.status}`;
            fail(`${where}:${fence.line}`, `blueprint-compiler refused this block — ${first}`);
            continue;
        }
        const warning = stderr.match(/warning: ([^\n]+)/);
        if (warning) fail(`${where}:${fence.line}`, `blueprint-compiler warns — ${warning[1].trim()}`);
    }
    return compiled;
}

// ---------------------------------------------------------------------------
// Arm: imports and identifiers inside a ts fence
// ---------------------------------------------------------------------------

const GLYPH_SHAPE = /\b([a-z][A-Za-z0-9]*Symbolic)\b/g;

/** Imported binding names, plus the subpath each glyph came from. */
function readImports(body) {
    const bound = new Set();
    const glyphSubpath = new Map();
    for (const m of body.matchAll(/import\s+(?:type\s+)?(?:\{([^}]*)\}|(\w+))\s+from\s+'([^']+)'/g)) {
        const from = m[3];
        if (m[2]) bound.add(m[2]);
        for (const raw of (m[1] ?? '').split(',')) {
            const name = raw
                .trim()
                .replace(/^type\s+/, '')
                .split(/\s+as\s+/)
                .pop()
                ?.trim();
            if (!name) continue;
            bound.add(name);
            const sub = from.match(/^@gjsify\/adwaita-icons\/(\w+)$/);
            if (sub) glyphSubpath.set(name, sub[1]);
        }
    }
    return { bound, glyphSubpath };
}

function checkTsFence(fence, where, icons) {
    const { bound, glyphSubpath } = readImports(fence.body);
    const usedGlyphs = new Set();
    // Only the body BELOW the import lines counts as use, or an import is its own
    // justification and the dead-import arm can never fire.
    const withoutImports = fence.body.replace(/import\s+[^;]*;/g, '');
    for (const m of withoutImports.matchAll(GLYPH_SHAPE)) usedGlyphs.add(m[1]);

    for (const glyph of usedGlyphs) {
        if (!bound.has(glyph)) {
            const home = icons.all.get(glyph);
            const hint = home
                ? `import it from '@gjsify/adwaita-icons/${home}'`
                : `and it is not among the ${icons.all.size} glyphs @gjsify/adwaita-icons exports`;
            fail(`${where}:${fence.line}`, `\`${glyph}\` is used but never imported in this fence — ${hint}`);
        }
    }

    for (const [glyph, subpath] of glyphSubpath) {
        const home = icons.all.get(glyph);
        if (!home) {
            fail(`${where}:${fence.line}`, `\`${glyph}\` is imported but @gjsify/adwaita-icons exports no such glyph`);
        } else if (home !== subpath) {
            fail(`${where}:${fence.line}`, `\`${glyph}\` is imported from './${subpath}' but lives in './${home}'`);
        }
    }

    for (const name of bound) {
        if (!new RegExp(`\\b${name}\\b`).test(withoutImports)) {
            fail(`${where}:${fence.line}`, `\`${name}\` is imported and never used in this fence`);
        }
    }
}

// ---------------------------------------------------------------------------
// Arm: icon names written as strings, anywhere on the page
// ---------------------------------------------------------------------------

const ICON_STRING =
    /\b(?:icon|icon-name|iconName|startIcon|endIcon|start-icon|end-icon)\s*[:=]\s*['"]([a-z0-9-]+)['"]/g;

/**
 * Which icon names a given surface can actually draw.
 *
 * THE SLOT DECIDES, and that is the whole point of this arm. `@gjsify/adwaita-web`
 * ships a small hand-drawn substitute set, so a name in `build-scss.mjs`'s ICONS
 * map renders in a browser whether or not any icon theme has it. GTK has no such
 * fallback: it draws the broken-image paintable. So `view-columns-symbolic` — in
 * the web map, in NO icon theme — renders on the `web` tab and fails on the `gjs`
 * and `blueprint` tabs of the same block, under prose promising an icon. Judging
 * every slot against the union is exactly how that shipped.
 */
const THEME_ONLY_SLOTS = new Set(['gjs', 'blueprint', 'nativescript']);

/** `<Fragment slot="gjs">` … the slot each line of the page sits in, or null. */
function slotAtLine(lines) {
    const owner = Array.from({ length: lines.length }, () => null);
    let current = null;
    let depth = 0;
    for (let i = 0; i < lines.length; i++) {
        const open = lines[i].match(/<Fragment\s+slot="(\w+)"/);
        if (open) {
            current = open[1];
            depth = 1;
        } else if (current && /<\/Fragment>/.test(lines[i])) {
            depth--;
            if (depth <= 0) current = null;
        }
        owner[i] = current;
    }
    return owner;
}

function checkIconStrings(text, where, icons, webIcons, exempt) {
    const themeIcons = new Set([...icons.all.keys()].flatMap(iconSpellings));
    const lines = text.split('\n');
    const slots = slotAtLine(lines);
    for (let i = 0; i < lines.length; i++) {
        for (const m of lines[i].matchAll(ICON_STRING)) {
            const written = m[1];
            const bare = written.replace(/-symbolic$/, '');
            const themeOnly = THEME_ONLY_SLOTS.has(slots[i] ?? '');
            if (themeIcons.has(written) || themeIcons.has(bare)) continue;
            if (!themeOnly && (webIcons.has(written) || webIcons.has(bare))) continue;
            if (exempt.has(`${where}:${bare}`)) continue;
            fail(
                `${where}:${i + 1}`,
                themeOnly && webIcons.has(bare)
                    ? `icon "${m[1]}" is in adwaita-web's own ICONS map but in NO icon theme, so this ` +
                          `${slots[i]} sample draws GTK's broken-image paintable`
                    : `icon "${m[1]}" exists in no icon theme and in no ICONS map`,
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Arm: adw- classes
// ---------------------------------------------------------------------------

const CLASS_ATTR = /(?:class|className)\s*(?:=\s*|=\s*\{?\s*)['"]([^'"]*)['"]/g;

function checkClasses(text, where, styled, webIcons, exempt) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
        for (const m of lines[i].matchAll(CLASS_ATTR)) {
            for (const token of m[1].split(/\s+/)) {
                if (!token.startsWith('adw-')) continue;
                if (styled.has(token)) continue;
                // `.adw-icon--<name>` is GENERATED, one per key of the ICONS map,
                // into the gitignored `_icons.generated.scss`. So the map is its
                // ground truth — which makes this arm sharper, not laxer: a mask
                // class for a name the map does not carry draws nothing, and now
                // fails by name instead of hiding behind the generated file.
                const mask = token.match(/^adw-icon--([a-z0-9-]+)$/);
                if (mask) {
                    if (webIcons.has(mask[1])) continue;
                    if (exempt.has(`${where}:${token}`)) continue;
                    fail(
                        `${where}:${i + 1}`,
                        `class "${token}" names no icon in build-scss.mjs's ICONS map, so it draws nothing`,
                    );
                    continue;
                }
                if (exempt.has(`${where}:${token}`)) continue;
                fail(`${where}:${i + 1}`, `class "${token}" appears in no stylesheet this page can reach`);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Arm: style tokens
// ---------------------------------------------------------------------------

/** Only `className`: `class=` is the web port's, and adwaita-web ships its own sheet. */
const UTILITY_CLASS_ATTR = /\bclassName="([^"]*)"/g;

/** The one call that puts a project's token scales in scope (ADR 0032 § 3). */
const CONFIGURE_STYLE = /\bconfigureStyle\s*\(/;

/**
 * Is this fence inside a `<Fragment slot="…">` — i.e. one tab of a gallery block?
 *
 * THE SCOPE QUESTION, and the first version of this arm got it wrong in the
 * expensive direction. It allowed "anywhere at or above on the page", which is
 * right for a prose page — a Quick-start installs the tokens once and every later
 * snippet inherits it, the way a reader actually works through one — and WRONG for
 * a gallery, where each tab is copied on its own and there is no "earlier".
 * MEASURED: under that rule, deleting the token step from `layout.mdx`'s
 * toolbar-view fragment left this gate GREEN, because the clamp fragment above it
 * still had one. A gate that passes the exact deletion it was written to catch is
 * the shape this whole file exists against, so the two cases are two rules and this
 * is what tells them apart.
 */
function insideGalleryFragment(lines, line) {
    for (let i = line - 2; i >= 0; i--) {
        if (/<\/Fragment>/.test(lines[i])) return false;
        if (/<Fragment\s+slot="/.test(lines[i])) return true;
    }
    return false;
}

/**
 * Fences that style with `className` and have nowhere to have got the values from.
 *
 * Returns how many className-bearing fences it saw, because an arm that scanned
 * nothing must not report success.
 */
function checkStyleTokens(text, where, fenceList) {
    const lines = text.split('\n');
    let seen = 0;
    for (const fence of fenceList) {
        if (fence.lang !== 'tsx') continue;
        const classes = [...fence.body.matchAll(UTILITY_CLASS_ATTR)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean);
        if (classes.length === 0) continue;
        seen++;
        const standalone = insideGalleryFragment(lines, fence.line);
        // A gallery tab has to carry the step itself; a prose page may have set it
        // up above. `fence.line` is the ``` line, so the body starts after it.
        const scope = standalone ? fence.body : lines.slice(0, fence.line + fence.body.split('\n').length).join('\n');
        if (CONFIGURE_STYLE.test(scope)) continue;
        fail(
            `${where}:${fence.line}`,
            `this fence styles with \`${classes.join(' ')}\` and ` +
                (standalone
                    ? 'the fence itself never calls `configureStyle({ tokens })` — a gallery tab is copied on ' +
                      'its own, so a token step in another tab does not cover it. '
                    : 'nothing at or above it on the page calls `configureStyle({ tokens })`. ') +
                "The values behind those names come from the reader's project — the default scales are " +
                'deliberately small, spacing being `0` and `px` alone — so the first undeclared ' +
                'token throws out of the render: React unmounts, the window is ' +
                'EMPTY, and the process exits 0 with no GTK diagnostic.',
        );
    }
    return seen;
}

// ---------------------------------------------------------------------------
// Arm: a NativeScript fence writing a property the widget does not have
// ---------------------------------------------------------------------------

/**
 * `const x = new AdwToggleGroup(); x.selected = 0;` — where `AdwToggleGroup` has no
 * `selected` any more.
 *
 * THE INCIDENT is the one this file already exists for, in the dialect the other arms
 * do not read. ADR 0034 clause 1 renamed `AdwToggleGroup.selected` to `active`, and
 * `buttons.mdx` kept teaching the old name. Nothing could see it: a NativeScript view
 * takes an unknown assignment as a dead own-property, the showcase that would type-check
 * the same code is `private` with `@nativescript/core` as an optional peer, and the arms
 * above read imports and icon glyphs. The sample compiles for a reader and does nothing —
 * the shape in this header's item 4, one dialect over.
 *
 * The widget's members come from the port's own source and the exemption from its ambient
 * `@nativescript/core` slice, so the pair of them is what a real NativeScript program
 * would resolve against.
 */
const NS_CONSTRUCTION = new RegExp(
    `\\b(?:const|let|var)\\s+([A-Za-z0-9_$]+)\\s*=\\s*new\\s+(${WIDGET_CLASS})\\s*\\(`,
    'g',
);

function checkNativescriptFence(fence, where, nsWidgets, coreProperties) {
    const held = new Map();
    for (const [, variable, klass] of fence.body.matchAll(NS_CONSTRUCTION)) {
        if (nsWidgets.has(klass)) held.set(variable, klass);
    }
    let writes = 0;
    for (const [, variable, property] of fence.body.matchAll(/\b([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)\s*=[^=]/g)) {
        const klass = held.get(variable);
        if (klass === undefined) continue;
        writes += 1;
        if (coreProperties.has(property) || membersOf(nsWidgets, klass).has(property)) continue;
        fail(
            `${where}:${fence.line}`,
            `\`${variable}.${property} = …\` — ${klass} has no such member, and NativeScript takes an ` +
                'unknown assignment as a dead own-property. The sample runs and that line does nothing. ' +
                'A renamed property is the usual cause; the ambient core slice ' +
                `(${NS_CORE_TYPES}) is the other place the name could legitimately live.`,
        );
    }
    return writes;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { exemptions: {} };
const exempt = new Set(Object.keys(ledger.exemptions ?? {}));

// A missing root is "could not look", not "found nothing" — and it crashed with a
// Node stack trace, which reads like a broken gate rather than a bad argument.
for (const [label, dir] of [
    ...DOCS_SECTIONS.map((section) => [`the ${section} gallery pages`, docsDir(section)]),
    ['@gjsify/adwaita-icons', ICONS_PKG],
    ["adwaita-web's scss", WEB_SCSS],
]) {
    if (!existsSync(dir)) {
        console.error(`check-doc-fences: cannot look — ${label} is not at ${dir}. Wrong --root?`);
        process.exit(1);
    }
}

const icons = readIconExports();
const roundTripped = assertKebabRoundTrips(icons);
const webIcons = readWebIconNames();
const styled = readStyledClasses();
const { sources: nsWidgets } = readWidgets(ROOT);
const nsCoreProperties = readCoreProperties(ROOT);

const sources = [
    ...DOCS_SECTIONS.flatMap((section) =>
        readdirSync(docsDir(section))
            .filter((f) => f.endsWith('.mdx'))
            .map((f) => `website/src/content/docs/${section}/${f}`),
    ),
    ...EXTRA_SOURCES,
];

const frameworkSources = existsSync(FRAMEWORKS_DIR)
    ? readdirSync(FRAMEWORKS_DIR)
          .filter((f) => f.endsWith('.mdx') || f.endsWith('.md'))
          .map((f) => `website/src/content/docs/frameworks/${f}`)
    : [];

if (sources.length === 0) {
    console.error('check-doc-fences: found no sources to scan. A scan with nothing to scan proves nothing.');
    process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'gjsify-doc-fences-'));
const blueprint = blueprintAvailable(dir);
let tsFences = 0;
let blueprintFences = 0;
let styledFences = 0;
let nsWrites = 0;

try {
    for (const rel of sources) {
        const abs = join(ROOT, rel);
        if (!existsSync(abs)) {
            fail(rel, 'listed as a source and not present');
            continue;
        }
        const text = readFileSync(abs, 'utf8');
        const list = fences(text);
        const slots = slotAtLine(text.split('\n'));
        for (const fence of list) {
            if (fence.lang !== 'ts') continue;
            tsFences++;
            checkTsFence(fence, rel, icons);
            // The fence opener sits INSIDE the Fragment, so its own line names the slot.
            if (slots[fence.line] === 'nativescript') {
                nsWrites += checkNativescriptFence(fence, rel, nsWidgets, nsCoreProperties);
            }
        }
        checkIconStrings(text, rel, icons, webIcons, exempt);
        checkClasses(text, rel, styled, webIcons, exempt);
        styledFences += checkStyleTokens(text, rel, list);
        if (blueprint.ok) {
            blueprintFences += checkBlueprint(list, rel, dir);
        } else {
            blueprintFences += list.filter((f) => f.lang === 'blueprint').length;
        }
    }
} finally {
    rmSync(dir, { recursive: true, force: true });
}

for (const rel of frameworkSources) {
    const abs = join(ROOT, rel);
    if (!existsSync(abs)) {
        fail(rel, 'listed as a token-arm source and not present');
        continue;
    }
    const text = readFileSync(abs, 'utf8');
    styledFences += checkStyleTokens(text, rel, fences(text));
}

// A scan whose corpus is empty reports green while proving nothing — the failure
// class this repository pays most for. Every arm states what it saw.
if (tsFences === 0) fail('scan', 'no `ts` fence was found across every source — the extractor is broken');
if (styledFences === 0) {
    fail('scan', 'no className-bearing tsx fence was found — the TOKENS extractor is broken, not the docs');
}
if (blueprintFences === 0) fail('scan', 'no `blueprint` fence was found — the extractor is broken');
if (nsWrites === 0) {
    fail(
        'scan',
        'no property write on a constructed NativeScript widget was found in any `nativescript` fence — ' +
            'the extractor is broken, not the docs',
    );
}

if (blueprint.ok) {
    notes.push(`${blueprintFences} blueprint fence(s) compiled with blueprint-compiler`);
} else {
    notes.push(
        `SKIPPED: ${blueprintFences} blueprint fence(s) NOT compiled — ${blueprint.why}. ` +
            "The other three arms ran. main.yml's `tree-checks` job is where this arm is real: " +
            'the ci-fedora image bakes blueprint-compiler, gtk4-devel and gobject-introspection.',
    );
}
notes.push(
    `${tsFences} ts fence(s) resolved against ${roundTripped} glyph exports in ${icons.bySubpath.size} subpaths ` +
        '(all round-tripping camel <-> kebab)',
);
notes.push(
    `${webIcons.size} web ICONS names, ${styled.size} adw- tokens in ${readdirSync(WEB_SCSS).length} scss files`,
);
notes.push(
    `${styledFences} className-bearing tsx fence(s) across the gallery and ${frameworkSources.length} ` +
        'frameworks page(s), each with the token step at or above it',
);
notes.push(
    `${nsWrites} property write(s) in nativescript fences held against ${nsWidgets.size} widget class(es) ` +
        `and ${nsCoreProperties.size} ambient core name(s)`,
);
if (exempt.size > 0) notes.push(`${exempt.size} exemption(s) from ${LEDGER.replace(`${ROOT}/`, '')}`);

for (const note of notes) console.log(`check-doc-fences: ${note}`);

if (failures.length > 0) {
    console.error(`\ncheck-doc-fences: ${failures.length} problem(s) across ${sources.length} source(s):\n`);
    for (const line of failures) console.error(`  ${line}`);
    console.error(
        '\nEvery one of these is a sample a reader copies. Fix the sample, or — when the\n' +
            `divergence is deliberate — record it in ${LEDGER.replace(`${ROOT}/`, '')} with a reason.`,
    );
    process.exit(1);
}

console.log(`check-doc-fences: OK across ${sources.length} source(s).`);
