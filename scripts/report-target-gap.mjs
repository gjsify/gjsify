#!/usr/bin/env node
// How far a project is from running on every `--gi-renderer` target (browser, nativescript).
//
// A REPORT, NOT A GATE: it exits 0 whatever it finds, because the distance is the answer and
// a project is allowed to be far. It exits 2 only when it could not do its job — a usage error,
// or an input it cannot read. Nothing in it is about one project: the directory is a required
// argument, and the numbers belong in this output, never in prose that would go stale.
//
//   node scripts/report-target-gap.mjs <project-dir> [--json]
//
// PER `.blp`, through the seam the bundler plugin uses (`projectToSharedNode`):
//   · `lost`      — what the projection cannot carry at all;
//   · `refused`   — the carried constructs (`uses`, ADR 0093) a renderer's `./capabilities`
//                   table refuses, with the line;
//   · `no member` — the tags the renderer has nothing for;
//   · signals     — a `signal` handler or a `bind` source whose class does not declare the
//                   signal / `notify::<property>` (ADR 0093 Progress 3-4), and the forms both
//                   builders refuse by name (a `template` source, flags, `swapped`/`after`).
// PER `.ts`/`.js`, every `gi://Ns` import and every `Ns.member` it uses, against the namespaces
// `GI_RENDERERS` routes to a renderer and the members that renderer exports.
//
// VALUE USE VERSUS TYPE USE. The source is read with the TypeScript parser (syntax only, no
// program). A member in a type position (`x: GObject.ParamSpec`, `implements`, `import type`) needs
// nothing from a renderer at run time, so it is counted apart and never in the unmet list that
// bounds what a renderer must supply. A member named in an `import { A, B }` list counts once, as
// a value use, at the import; later references to the local name are not followed.
//
// A runtime `import X from '@girs/<ns>-<ver>'` is the same dependency: under `--gi-renderer`
// that package's body does the `gi://` import, so its namespace is read from the package, found
// from the importing file upward (the project's own tree) and then in this repository's.
//
// WHERE EACH ANSWER IS READ, so nothing is restated here:
//   · which package answers `gi://Ns` per target — `GI_RENDERERS`, by import;
//   · which constructs it builds — its own `src/capabilities.{mjs,ts}` (read by import; Node
//     strips the types, and the file imports none at run time, which the package requires so a
//     build plugin can read it the same way);
//   · which members `Adw`/`Gtk` carry — the `export { Class as Member }` lines of its
//     `src/namespace/<ns>.ts`, the list the barrel is `export * as Ns` of;
//   · which tags the web builder can build — the builder does `createElement(hostTagOf(tag))`
//     and never checks the answer, so the registry is the authority: every
//     `customElements.define('…')` in the package, plus the barrel's classes. NativeScript's
//     `elementFor` resolves against the barrel directly;
//   · which signals a class declares — its `static signals` (web) or `static emittedSignals`
//     (NativeScript), read from the class's source: string literals, constants of the same or an
//     imported module, `...Parent.signals` spreads and `extends` inside the package are followed,
//     and so is a mixin call (`extends withSignals(GridLayout)`) whose own body declares no such
//     static. A base class outside the package (`HTMLElement`, `@nativescript/core`) is taken to
//     declare none. Anything else — a computed key, a call, a class behind a re-export — makes the answer
//     "unresolved", which is counted and never reported as undeclared: the report does not guess.
//
// NOT CHECKED: that a bind TARGET has a writable property of that name (it needs the member list
// of the class, not its signals), and the object a value-typed tag (`GtkStringList`) stands for.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { gtypeName, parseBlueprint, projectToSharedNode } from '../packages/infra/blueprint/src/index.mjs';
import { GI_RENDERERS } from '../packages/infra/resolve-npm/lib/gi-renderers.mjs';
import {
    bindFormIssues,
    exportedValueNames,
    hasTemplateScope,
    registeredBarrelFiles,
} from './lib/target-gap-barrel.mjs';
import { hostTagOf } from '../packages/web/adwaita-core/src/tags.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: node scripts/report-target-gap.mjs <project-dir> [--json]';

const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'lib', 'build', 'generated']);
const SOURCE_FILE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
const NOT_SOURCE = /\.d\.[cm]?ts$|\.(?:spec|test)\.[^.]+$|\.generated\./;
// The shape `hostTagOf` accepts; it throws on anything else, so the question is asked first.
const GIR_CLASS = /^(?:Adw|Gtk)[A-Z]\w*$/;
const SIGNAL_MEMBERS = ['signals', 'emittedSignals'];

const usageError = (message) => {
    console.error(`report-target-gap: ${message}\n${USAGE}`);
    process.exit(2);
};

const args = process.argv.slice(2);
const flags = args.filter((arg) => arg.startsWith('--'));
const positional = args.filter((arg) => !arg.startsWith('--'));
const unknownFlag = flags.find((flag) => flag !== '--json');
if (unknownFlag) usageError(`unknown flag ${unknownFlag}`);
if (positional.length !== 1) usageError('expected exactly one project directory');
const asJson = flags.includes('--json');
const projectDir = resolve(positional[0]);
if (!existsSync(projectDir) || !statSync(projectDir).isDirectory()) {
    usageError(`${projectDir} is not a directory`);
}

// ---- reading ---------------------------------------------------------------------------

const walk = (from) =>
    readdirSync(from, { withFileTypes: true }).flatMap((entry) => {
        const path = join(from, entry.name);
        if (entry.isDirectory()) {
            return entry.name.startsWith('.') || SKIPPED_DIRS.has(entry.name) ? [] : walk(path);
        }
        return [path];
    });

const isGenerated = (text) => /@generated|DO NOT EDIT/i.test(text.slice(0, 400));

const parsedFiles = new Map();
/** The syntax tree of `file`, parsed once. `setParentNodes` because the type-position test walks up. */
const parse = (file, text = undefined) => {
    if (!parsedFiles.has(file)) {
        parsedFiles.set(
            file,
            ts.createSourceFile(file, text ?? readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true),
        );
    }
    return parsedFiles.get(file);
};

const nameOf = (name) =>
    name !== undefined && (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name))
        ? name.text
        : undefined;

/** A relative module specifier as the source file it names, or undefined for a package. */
const sourceOf = (from, specifier) => {
    if (!specifier.startsWith('.')) return undefined;
    const base = resolve(dirname(from), specifier);
    const stem = base.replace(/\.[cm]?[jt]sx?$/, '');
    return ['.ts', '.mts', '.tsx', '.js', '.mjs'].map((ext) => stem + ext).find(existsSync);
};

// ---- the renderers ---------------------------------------------------------------------

const packageDirs = new Map();
for (const group of readdirSync(join(ROOT, 'packages'))) {
    const groupDir = join(ROOT, 'packages', group);
    if (!statSync(groupDir).isDirectory()) continue;
    for (const name of readdirSync(groupDir)) {
        const manifest = join(groupDir, name, 'package.json');
        if (existsSync(manifest))
            packageDirs.set(JSON.parse(readFileSync(manifest, 'utf8')).name, join(groupDir, name));
    }
}

/** `export { Class as Member } from './file.js'` of a barrel: member → class and where it lives. */
const barrelOf = (file) => {
    const entries = new Map();
    for (const statement of parse(file).statements) {
        // `export const registerClass = …` is a member as much as `export { registerClass }` is.
        if (ts.isVariableStatement(statement)) {
            for (const name of exportedValueNames({ statements: [statement] })) {
                entries.set(name, { className: name, file });
            }
            continue;
        }
        if (!ts.isExportDeclaration(statement) || statement.isTypeOnly) continue;
        if (statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause)) continue;
        const from = statement.moduleSpecifier ? sourceOf(file, statement.moduleSpecifier.text) : file;
        for (const specifier of statement.exportClause.elements) {
            if (specifier.isTypeOnly) continue;
            entries.set(specifier.name.text, {
                className: (specifier.propertyName ?? specifier.name).text,
                file: from,
            });
        }
    }
    return entries;
};

const definedElements = (dir) => {
    const tags = new Set();
    const visit = (from) => {
        for (const entry of readdirSync(from, { withFileTypes: true })) {
            const path = join(from, entry.name);
            if (entry.isDirectory()) {
                visit(path);
                continue;
            }
            if (!entry.name.endsWith('.ts') || NOT_SOURCE.test(entry.name)) continue;
            const find = (node) => {
                if (
                    ts.isCallExpression(node) &&
                    node.expression.getText() === 'customElements.define' &&
                    node.arguments[0] !== undefined &&
                    ts.isStringLiteralLike(node.arguments[0])
                ) {
                    tags.add(node.arguments[0].text);
                }
                ts.forEachChild(node, find);
            };
            find(parse(path));
        }
    };
    visit(dir);
    return tags;
};

// ---- declared signals ------------------------------------------------------------------

const UNRESOLVED = Symbol('unresolved');
const topLevelClass = (sf, name) =>
    sf.statements.find((statement) => ts.isClassDeclaration(statement) && statement.name?.text === name);

/** A local name, as the module-level declaration it is: a class or const here, or an import. */
const importOf = (sf, file, local) => {
    for (const statement of sf.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        const named = statement.importClause?.namedBindings;
        if (named === undefined || !ts.isNamedImports(named)) continue;
        for (const specifier of named.elements) {
            if (specifier.name.text !== local) continue;
            return {
                original: (specifier.propertyName ?? specifier.name).text,
                file: sourceOf(file, statement.moduleSpecifier.text),
                external: !statement.moduleSpecifier.text.startsWith('.'),
            };
        }
    }
    return undefined;
};

const unwrap = (expression) => {
    let current = expression;
    while (ts.isAsExpression(current) || ts.isParenthesizedExpression(current) || ts.isSatisfiesExpression(current)) {
        current = current.expression;
    }
    return current;
};

/** The string a module-level `const` holds, or UNRESOLVED. */
const constantOf = (file, name, depth = 0) => {
    const sf = parse(file);
    for (const statement of sf.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (declaration.name.getText() !== name || declaration.initializer === undefined) continue;
            const value = unwrap(declaration.initializer);
            if (ts.isStringLiteralLike(value)) return value.text;
        }
    }
    const imported = importOf(sf, file, name);
    if (imported?.file !== undefined && depth < 8) return constantOf(imported.file, imported.original, depth + 1);
    return UNRESOLVED;
};

/** The class `name` as seen from `file`: its source, or `external` when a package supplies it. */
const classOf = (file, name) => {
    const here = topLevelClass(parse(file), name);
    if (here !== undefined) return { file, node: here };
    const imported = importOf(parse(file), file, name);
    if (imported === undefined || imported.external) return { external: true };
    if (imported.file === undefined) return undefined;
    const there = topLevelClass(parse(imported.file), imported.original);
    return there === undefined ? undefined : { file: imported.file, node: there };
};

/**
 * Whether `callee`, a function of this package, is a mixin that gives its base no `static`
 * signal declaration of its own. Only its own body is read, so the answer is a statement about
 * that function and not about whatever it calls.
 */
const mixinAddsNoSignals = (file, callee) => {
    if (!ts.isIdentifier(callee)) return false;
    const sf = parse(file);
    const imported = importOf(sf, file, callee.text);
    const [from, name] = imported === undefined ? [file, callee.text] : [imported.file, imported.original];
    if (from === undefined) return false;
    const declaration = parse(from).statements.find(
        (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
    );
    return declaration !== undefined && !/\bstatic\b[^;{=]*\b(?:signals|emittedSignals)\b/.test(declaration.getText());
};

/** The signal names a class declares, following `extends`; `complete: false` when something could not be read. */
const declaredSignals = (file, className, depth = 0) => {
    const found = classOf(file, className);
    if (found === undefined || depth > 16) return { names: new Set(), complete: false };
    if (found.external) return { names: new Set(), complete: true };
    const names = new Set();
    let complete = true;
    const collect = (expression) => {
        const value = unwrap(expression);
        const add = (key) => {
            if (key === UNRESOLVED) complete = false;
            else names.add(key);
        };
        if (ts.isObjectLiteralExpression(value)) {
            for (const property of value.properties) {
                if (ts.isSpreadAssignment(property)) spread(property.expression);
                else if (ts.isShorthandPropertyAssignment(property)) add(property.name.text);
                else if (ts.isPropertyAssignment(property) && ts.isComputedPropertyName(property.name)) {
                    const key = unwrap(property.name.expression);
                    add(
                        ts.isStringLiteralLike(key)
                            ? key.text
                            : ts.isIdentifier(key)
                              ? constantOf(found.file, key.text)
                              : UNRESOLVED,
                    );
                } else add(nameOf(property.name) ?? UNRESOLVED);
            }
        } else if (ts.isArrayLiteralExpression(value)) {
            for (const element of value.elements) {
                const item = unwrap(element);
                if (ts.isSpreadElement(element)) spread(element.expression);
                else if (ts.isStringLiteralLike(item)) add(item.text);
                else add(ts.isIdentifier(item) ? constantOf(found.file, item.text) : UNRESOLVED);
            }
        } else complete = false;
    };
    const spread = (expression) => {
        const target = unwrap(expression);
        if (
            ts.isPropertyAccessExpression(target) &&
            SIGNAL_MEMBERS.includes(target.name.text) &&
            ts.isIdentifier(target.expression)
        ) {
            const inner = declaredSignals(found.file, target.expression.text, depth + 1);
            inner.names.forEach((name) => names.add(name));
            if (!inner.complete) complete = false;
        } else complete = false;
    };
    const own = found.node.members.find(
        (member) =>
            ts.isPropertyDeclaration(member) &&
            member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) &&
            SIGNAL_MEMBERS.includes(nameOf(member.name)),
    );
    if (own?.initializer !== undefined) {
        collect(own.initializer);
        return { names, complete };
    }
    let base = found.node.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)?.types[0]
        ?.expression;
    if (base === undefined) return { names, complete };
    // `extends withSignals(GridLayout)`: a mixin that declares nothing is followed to its argument.
    if (ts.isCallExpression(base) && base.arguments.length === 1 && mixinAddsNoSignals(found.file, base.expression)) {
        base = unwrap(base.arguments[0]);
    }
    if (!ts.isIdentifier(base)) return { names, complete: false };
    const inherited = declaredSignals(found.file, base.text, depth + 1);
    return { names: inherited.names, complete: inherited.complete };
};

const loadRenderer = async (target, { renderer, namespaces }) => {
    const dir = packageDirs.get(renderer);
    if (!dir)
        throw new Error(`GI_RENDERERS names ${renderer} for ${target}, and no package under packages/ has that name`);
    const capabilitiesFile = ['mjs', 'ts'].map((ext) => join(dir, `src/capabilities.${ext}`)).find(existsSync);
    if (!capabilitiesFile) throw new Error(`${renderer} has no src/capabilities.{mjs,ts}`);
    const { capabilities } = await import(capabilitiesFile);
    const barrels = new Map();
    const classIndex = new Map();
    for (const ns of Object.keys(namespaces)) {
        const file = join(dir, 'src/namespace', `${ns.toLowerCase()}.ts`);
        if (!existsSync(file))
            throw new Error(`${renderer} is routed ${ns} by GI_RENDERERS and has no ${relative(ROOT, file)}`);
        const barrel = barrelOf(file);
        barrels.set(ns, new Set(barrel.keys()));
        for (const { className, file: classFile } of barrel.values()) classIndex.set(className, classFile);
    }
    // A package that depends on the renderer adds a barrel with `registerBarrel(prefix, 'Library', …)`
    // in its `src/builder.ts` (ADR 0094). Its classes make a tag buildable, but the namespace is not
    // answered by `gi://` on this target, so they join the class index and nothing else.
    // NativeScript only: the web renderer has no `registerBarrel`, its tags are `customElements.define`s.
    if (renderer === '@gjsify/adwaita-nativescript') {
        for (const barrelFile of registeredBarrelFiles(packageDirs.values(), dir)) {
            for (const { className, file: classFile } of barrelOf(barrelFile).values()) {
                classIndex.set(className, classFile);
            }
        }
    }
    // Only the web builder asks a registry; the native one asks the barrel, so only it needs the scan.
    const elements = existsSync(join(dir, 'src/elements')) ? definedElements(join(dir, 'src')) : undefined;
    const hasTag = (tag) =>
        classIndex.has(tag) || (elements !== undefined && GIR_CLASS.test(tag) && elements.has(hostTagOf(tag)));
    /** The signals the class behind `tag` declares, or undefined when that cannot be read. */
    const signalsOfTag = (tag) => {
        const file = classIndex.get(tag);
        if (file === undefined) return undefined;
        const declared = declaredSignals(file, tag);
        return declared.complete ? declared.names : { partial: declared.names };
    };
    return { target, renderer, capabilities, namespaces, barrels, hasTag, signalsOfTag };
};

// ---- blueprints ------------------------------------------------------------------------

const tagsOf = (node, into = new Set()) => {
    // A `$Name` extern is a class the application registers, not a member of any barrel (ADR 0093).
    if (node.extern !== true) into.add(node.tag);
    for (const child of node.children ?? []) tagsOf(child, into);
    for (const sibling of node.siblings ?? []) tagsOf(sibling, into);
    return into;
};

const isBreakpointObject = (object) => object.type.namespace === 'Adw' && object.type.name === 'Breakpoint';

/** The objects a body places as children, in the order the projection keeps them. */
const placedChildren = (body) =>
    [
        ...body.properties
            .filter((property) => property.value.kind === 'object')
            .map((property) => ({ ...property, object: property.value.object })),
        ...body.children,
    ]
        .sort((a, b) => a.line - b.line || a.order - b.order)
        .filter((entry) => !isBreakpointObject(entry.object));

/**
 * Every tree node with its signals and binds and the line each is on. The tree carries no
 * lines, so the parse tree is walked beside it, child for child by the projection's own
 * ordering; where the counts disagree the lines are left out rather than guessed.
 */
const sitesOf = (file, node) => {
    const roots = file.roots.filter((candidate) => candidate.kind !== 'menu');
    const kept = roots[0];
    const siblingBodies = roots
        .filter((candidate) => candidate !== kept && candidate.kind !== 'template')
        .map((root) => root.body);
    const sites = [];
    const pair = (current, body) => {
        sites.push({
            tag: current.tag,
            id: current.id,
            extern: current.extern === true,
            signals: (current.signals ?? []).map((signal, index) => ({
                name: signal.detail === undefined ? signal.name : `${signal.name}::${signal.detail}`,
                forms: [...(signal.object === undefined ? [] : ['object']), ...(signal.flags ?? [])],
                line: body?.signals[index]?.line,
            })),
            bindings: Object.entries(current.bindings ?? {}).map(([target, binding]) => ({
                target,
                ...binding,
                line: body?.properties.find((property) => property.name === target && property.value.kind === 'binding')
                    ?.line,
            })),
        });
        const placed = body === undefined ? undefined : placedChildren(body);
        const aligned = placed !== undefined && placed.length === (current.children ?? []).length;
        (current.children ?? []).forEach((child, index) =>
            pair(child, aligned ? placed[index].object.body : undefined),
        );
    };
    pair(node, kept?.body);
    (node.siblings ?? []).forEach((sibling, index) => pair(sibling, siblingBodies[index]));
    return sites;
};

/** What a renderer's classes declare against the signals and binds of one file's sites. */
const signalIssues = (renderer, sites) => {
    const ids = new Map(sites.filter((site) => site.id !== undefined).map((site) => [site.id, site]));
    const issues = [];
    // `bind template.x` and the bind flags go through the template scope a `registerClass` class
    // supplies (ADR 0096 § 3); a target whose `GObject` namespace has no `registerClass` has none.
    const templateScoped = hasTemplateScope(renderer.barrels);
    let unresolved = 0;
    const declares = (tag, name) => {
        const declared = renderer.signalsOfTag(tag);
        if (declared === undefined) {
            unresolved++;
            return true;
        }
        if (declared instanceof Set) return declared.has(name);
        if (declared.partial.has(name)) return true;
        unresolved++;
        return true;
    };
    for (const site of sites) {
        if (site.extern) continue;
        for (const signal of site.signals) {
            if (!declares(site.tag, signal.name)) {
                issues.push({ issue: 'undeclared-signal', tag: site.tag, name: signal.name, line: signal.line });
            }
            if (signal.forms.length > 0) {
                issues.push({
                    issue: 'refused-signal-form',
                    tag: site.tag,
                    name: signal.forms.join(','),
                    line: signal.line,
                });
            }
        }
        for (const binding of site.bindings) {
            issues.push(...bindFormIssues(binding, site.tag, templateScoped));
            if (binding.source === 'template') continue;
            const source = ids.get(binding.source);
            if (source === undefined) {
                issues.push({ issue: 'unknown-bind-source', tag: site.tag, name: binding.source, line: binding.line });
            } else if (!source.extern && !declares(source.tag, `notify::${binding.property}`)) {
                issues.push({
                    issue: 'undeclared-notify',
                    tag: source.tag,
                    name: binding.property,
                    line: binding.line,
                });
            }
        }
    }
    return { issues, unresolved };
};

const blueprintRow = (file, renderers) => {
    const row = { file: relative(projectDir, file), lost: [], targets: {} };
    try {
        const parsed = parseBlueprint(readFileSync(file, 'utf8'), file);
        const { node, lost, uses } = projectToSharedNode(parsed, { gtypeName });
        row.lost = [...new Set(lost.map((loss) => loss.kind))].sort();
        const tags = [...tagsOf(node)];
        const sites = sitesOf(parsed, node);
        for (const renderer of renderers) {
            const refused = uses
                .filter((use) => renderer.capabilities[use.kind] !== 'implemented')
                .map((use) => ({ kind: use.kind, line: use.line }));
            const { issues, unresolved } = signalIssues(renderer, sites);
            row.targets[renderer.target] = {
                refused,
                missing: tags.filter((tag) => !renderer.hasTag(tag)).sort(),
                signals: issues,
                unresolvedSignals: unresolved,
            };
        }
    } catch (error) {
        row.error = String(error.message).split('\n')[0];
    }
    row.projects = row.error === undefined && row.lost.length === 0;
    row.builds = Object.fromEntries(
        renderers.map((renderer) => {
            const found = row.targets[renderer.target];
            const clear =
                found !== undefined && found.refused.length + found.missing.length + found.signals.length === 0;
            return [renderer.target, row.projects && clear];
        }),
    );
    return row;
};

// ---- sources ---------------------------------------------------------------------------

const GI_SPECIFIER = /^gi:\/\/(\w+)(?:\?(.*))?$/;
const GIRS_SPECIFIER = /^@girs\/([\w.-]+)$/;

/** `gtk-4.0` -> `{ namespace: 'Gtk', version: '4.0' }`, read from the package: the project's tree first, then ours. */
const girsNamespaces = new Map();
const girsNamespace = (fromDir, name) => {
    const key = `${fromDir}|${name}`;
    if (!girsNamespaces.has(key)) {
        const roots = [];
        for (let dir = fromDir; ; dir = dirname(dir)) {
            roots.push(dir);
            if (dirname(dir) === dir) break;
        }
        const packages = [...roots, ROOT].map((dir) => join(dir, 'node_modules/@girs', name));
        const installed = packages.find(existsSync);
        const entry = packages.map((dir) => join(dir, `${name}.js`)).find(existsSync);
        const found = entry && readFileSync(entry, 'utf8').match(/from\s*'gi:\/\/(\w+)(?:\?version=([^']*))?'/);
        // A package that is installed and names no namespace (`@girs/gjs`) is types for the
        // runtime itself: nothing to count, and not a failure to find it.
        girsNamespaces.set(key, found ? { namespace: found[1], version: found[2] } : installed ? { skip: true } : null);
    }
    return girsNamespaces.get(key);
};

/**
 * Whether a property access sits in a type position. A type is a `QualifiedName` (`x: Gtk.Widget`)
 * and never reaches here; the one type that is spelled as a property access is a heritage clause
 * entry: `extends` of a class is a value, `implements` and an interface's `extends` are types.
 */
const inTypePosition = (node) => {
    for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts.isExpressionWithTypeArguments(parent) && ts.isHeritageClause(parent.parent)) {
            return (
                parent.parent.token === ts.SyntaxKind.ImplementsKeyword ||
                ts.isInterfaceDeclaration(parent.parent.parent)
            );
        }
        if (ts.isStatement(parent)) return false;
    }
    return false;
};

const sourceRow = (file, text, renderers) => {
    const sf = parse(file, text);
    const imports = [];
    const bindings = new Map();
    const values = new Map();
    const types = new Map();
    let unresolvedGirs = 0;
    const count = (map, namespace, member) => {
        const key = `${namespace}.${member}`;
        map.set(key, (map.get(key) ?? 0) + 1);
    };
    const namespaceOf = (specifier) => {
        const gi = specifier.match(GI_SPECIFIER);
        if (gi) return { namespace: gi[1], version: gi[2]?.match(/(?:^|&)version=([^&]*)/)?.[1] };
        const girs = specifier.match(GIRS_SPECIFIER);
        if (!girs) return undefined;
        const found = girsNamespace(dirname(file), girs[1]);
        if (found?.skip) return undefined;
        return found ? { ...found, via: specifier } : { unresolved: true };
    };
    const record = (specifier, typeOnly, locals = []) => {
        const found = namespaceOf(specifier);
        if (found === undefined) return undefined;
        if (found.unresolved) {
            if (!typeOnly) unresolvedGirs++;
            return undefined;
        }
        const { namespace, version, via } = found;
        if (!typeOnly) {
            imports.push({
                namespace,
                ...(version ? { version } : {}),
                ...(via ? { via } : {}),
                bindings: locals.map((local) => local.name),
            });
        }
        for (const local of locals) bindings.set(local.name, { namespace, typeOnly });
        return namespace;
    };
    const visit = (node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const clause = node.importClause;
            const typeOnly = clause?.isTypeOnly === true;
            const locals = [];
            const named = [];
            if (clause?.name) locals.push({ name: clause.name.text });
            if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
                locals.push({ name: clause.namedBindings.name.text });
            } else if (clause?.namedBindings) {
                for (const element of clause.namedBindings.elements) {
                    named.push({
                        member: (element.propertyName ?? element.name).text,
                        typeOnly: typeOnly || element.isTypeOnly,
                    });
                }
            }
            const namespace = record(node.moduleSpecifier.text, typeOnly, locals);
            if (namespace !== undefined) {
                for (const item of named) count(item.typeOnly ? types : values, namespace, item.member);
                // A file whose only import is `{ type X }` leaves no runtime dependency to record.
                if (named.length > 0 && named.every((item) => item.typeOnly) && locals.length === 0) imports.pop();
            }
            return;
        }
        if (
            ts.isImportEqualsDeclaration(node) &&
            ts.isExternalModuleReference(node.moduleReference) &&
            ts.isStringLiteral(node.moduleReference.expression)
        ) {
            record(node.moduleReference.expression.text, node.isTypeOnly, [{ name: node.name.text }]);
            return;
        }
        if (
            ts.isCallExpression(node) &&
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            node.arguments[0] !== undefined &&
            ts.isStringLiteral(node.arguments[0])
        ) {
            record(node.arguments[0].text, false);
        }
        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
            const bound = bindings.get(node.expression.text);
            if (bound) count(bound.typeOnly || inTypePosition(node) ? types : values, bound.namespace, node.name.text);
        } else if (ts.isQualifiedName(node) && ts.isIdentifier(node.left)) {
            const bound = bindings.get(node.left.text);
            if (bound) count(types, bound.namespace, node.right.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sf);
    const unmetOf = (renderer, members) => {
        const lacksMember = [];
        for (const key of members.keys()) {
            const [namespace, member] = key.split('.');
            if (namespace in renderer.namespaces && !renderer.barrels.get(namespace).has(member)) lacksMember.push(key);
        }
        return lacksMember.sort();
    };
    const unmet = {};
    for (const renderer of renderers) {
        const noRenderer = new Set(
            imports.map((entry) => entry.namespace).filter((namespace) => !(namespace in renderer.namespaces)),
        );
        unmet[renderer.target] = {
            noRenderer: [...noRenderer].sort(),
            lacksMember: unmetOf(renderer, values),
            typeOnly: [...types.keys()].filter((key) => {
                const [namespace, member] = key.split('.');
                return !(namespace in renderer.namespaces) || !renderer.barrels.get(namespace).has(member);
            }),
        };
    }
    const sorted = (map) => Object.fromEntries([...map].sort(([a], [b]) => a.localeCompare(b)));
    return {
        file: relative(projectDir, file),
        imports,
        members: sorted(values),
        typeMembers: sorted(types),
        unresolvedGirs,
        unmet,
    };
};

// ---- aggregation -----------------------------------------------------------------------

const tally = (entries) => {
    const counts = new Map();
    for (const entry of entries) counts.set(entry, (counts.get(entry) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
};

const byUses = (a, b) =>
    b.uses - a.uses ||
    b.files.length - a.files.length ||
    String(a.member ?? a.key).localeCompare(String(b.member ?? b.key));

const add = (map, key, shape, uses, file) => {
    const row = map.get(key) ?? { ...shape, uses: 0, files: [] };
    row.uses += uses;
    if (!row.files.includes(file)) row.files.push(file);
    map.set(key, row);
};

const issueKey = (issue) =>
    issue.issue === 'undeclared-notify' ? `${issue.tag}::notify::${issue.name}` : `${issue.tag}::${issue.name}`;

const summarise = (blueprints, sources, renderers) => {
    const targets = {};
    for (const { target } of renderers) {
        const lacks = new Map();
        const noRenderer = new Map();
        const typeOnly = new Map();
        const undeclared = new Map();
        for (const source of sources) {
            const { noRenderer: spaces, lacksMember, typeOnly: typeKeys } = source.unmet[target];
            for (const key of lacksMember) {
                const namespace = key.slice(0, key.indexOf('.'));
                if (spaces.includes(namespace)) continue;
                add(lacks, key, { member: key }, source.members[key], source.file);
            }
            for (const namespace of spaces) {
                add(noRenderer, namespace, { namespace, members: new Map() }, 0, source.file);
                for (const [key, uses] of Object.entries(source.members)) {
                    if (key.startsWith(`${namespace}.`)) {
                        const row = noRenderer.get(namespace);
                        row.uses += uses;
                        add(row.members, key, { member: key }, uses, source.file);
                    }
                }
            }
            for (const key of typeKeys) add(typeOnly, key, { member: key }, source.typeMembers[key], source.file);
        }
        for (const row of blueprints) {
            for (const issue of row.targets[target]?.signals ?? []) {
                if (issue.issue.startsWith('undeclared'))
                    add(undeclared, issueKey(issue), { key: issueKey(issue) }, 1, row.file);
            }
        }
        const noRendererRows = [...noRenderer.values()]
            .map((row) => ({ ...row, members: [...row.members.values()].sort(byUses) }))
            .sort(byUses);
        targets[target] = {
            blueprints: {
                total: blueprints.length,
                project: blueprints.filter((row) => row.projects).length,
                build: blueprints.filter((row) => row.builds[target]).length,
                refusedKinds: tally(
                    blueprints.flatMap((row) => [...new Set((row.targets[target]?.refused ?? []).map((r) => r.kind))]),
                ),
                missingTags: tally(blueprints.flatMap((row) => row.targets[target]?.missing ?? [])),
                undeclaredSignals: [...undeclared.values()].sort(byUses),
                refusedForms: tally(
                    blueprints.flatMap((row) =>
                        (row.targets[target]?.signals ?? [])
                            .filter((i) => !i.issue.startsWith('undeclared'))
                            .map((i) => `${i.issue} ${i.name}`),
                    ),
                ),
                unresolvedSignals: blueprints.reduce(
                    (sum, row) => sum + (row.targets[target]?.unresolvedSignals ?? 0),
                    0,
                ),
            },
            sources: {
                withGi: sources.length,
                clean: sources.filter(
                    (source) =>
                        source.unmet[target].noRenderer.length === 0 && source.unmet[target].lacksMember.length === 0,
                ).length,
                noRenderer: noRendererRows,
                lacksMember: [...lacks.values()].sort(byUses),
                typeOnly: [...typeOnly.values()].sort(byUses),
            },
        };
    }
    return {
        blueprints: {
            total: blueprints.length,
            project: blueprints.filter((row) => row.projects).length,
            lostKinds: tally(blueprints.flatMap((row) => row.lost)),
        },
        targets,
    };
};

// ---- output ----------------------------------------------------------------------------

const filesNote = (files) => {
    const shown = files.slice(0, 3).join(', ');
    return `${files.length} file${files.length === 1 ? '' : 's'}: ${shown}${files.length > 3 ? `, +${files.length - 3}` : ''}`;
};

const issueText = (issue) => {
    const at = `@${issue.line ?? '?'}`;
    if (issue.issue === 'undeclared-signal') return `undeclared signal ${issue.tag}::${issue.name}${at}`;
    if (issue.issue === 'undeclared-notify') return `undeclared notify ${issue.tag}:${issue.name}${at}`;
    return `refused ${issue.issue.replace(/^refused-/, '').replace(/^unknown-/, 'unknown ')} ${issue.name}${at}`;
};

const printText = (report) => {
    const { blueprints, sources, summary, renderers } = report;
    const line = (text = '') => console.log(text);
    line(`report-target-gap: ${projectDir}`);
    for (const renderer of renderers) line(`  ${renderer.target.padEnd(13)} ${renderer.renderer}`);
    line();
    line(`== .blp templates (${blueprints.length}) ==`);
    for (const row of blueprints) {
        const found = [];
        if (row.error) found.push(`  error         ${row.error}`);
        if (row.lost.length) found.push(`  lost          ${row.lost.join(', ')}`);
        for (const renderer of renderers) {
            const { refused = [], missing = [], signals = [] } = row.targets[renderer.target] ?? {};
            const parts = [];
            if (refused.length) parts.push(`refuses ${refused.map((use) => `${use.kind}@${use.line}`).join(' ')}`);
            if (missing.length) parts.push(`no member ${missing.join(' ')}`);
            if (signals.length) parts.push(signals.map(issueText).join(' | '));
            if (parts.length) found.push(`  ${renderer.target.padEnd(13)} ${parts.join(' | ')}`);
        }
        line(`${found.length === 0 ? 'ok   ' : 'gap  '} ${row.file}`);
        for (const detail of found) line(detail);
    }
    line();
    line(`== gi:// in source (${sources.length} file${sources.length === 1 ? '' : 's'}) ==`);
    const namespaces = new Map();
    for (const source of sources) {
        for (const { namespace, version, via } of source.imports) {
            const row = namespaces.get(namespace) ?? { versions: new Set(), files: new Set(), girs: new Set() };
            if (version) row.versions.add(version);
            row.files.add(source.file);
            if (via) row.girs.add(source.file);
            namespaces.set(namespace, row);
        }
    }
    for (const [namespace, row] of [...namespaces].sort(([a], [b]) => a.localeCompare(b))) {
        const versions = row.versions.size ? ` (version ${[...row.versions].sort().join(', ')})` : '';
        const girs = row.girs.size ? `, ${row.girs.size} via @girs/*` : '';
        line(`  ${namespace}${versions}  ${row.files.size} file${row.files.size === 1 ? '' : 's'}${girs}`);
    }
    if (report.unresolvedGirs > 0) {
        line(
            `  note: ${report.unresolvedGirs} @girs/* import(s) not scanned — package found neither in the project nor in this repository`,
        );
    }
    for (const renderer of renderers) {
        const { noRenderer, lacksMember } = summary.targets[renderer.target].sources;
        line();
        line(`-- ${renderer.target}: unmet gi:// members (value uses) --`);
        for (const row of noRenderer) {
            line(`  no renderer       ${row.namespace}  ${row.uses} use(s), ${filesNote(row.files)}`);
            for (const member of row.members)
                line(`      ${member.member}  ${member.uses} use(s), ${filesNote(member.files)}`);
        }
        for (const row of lacksMember) {
            line(`  renderer lacks    ${row.member}  ${row.uses} use(s), ${filesNote(row.files)}`);
        }
        if (noRenderer.length === 0 && lacksMember.length === 0) line('  none');
    }
    line();
    line('== summary ==');
    line(`  .blp that project without a loss: ${summary.blueprints.project}/${summary.blueprints.total}`);
    line(`  loss kinds (files): ${summary.blueprints.lostKinds.map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
    for (const renderer of renderers) {
        const { blueprints: bp, sources: src } = summary.targets[renderer.target];
        line(`  ${renderer.target}`);
        line(`    .blp that build without refusals, missing tags or undeclared signals: ${bp.build}/${bp.total}`);
        line(`    refused constructs (files): ${bp.refusedKinds.map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
        line(`    tags with no member (files): ${bp.missingTags.map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
        const undeclared = bp.undeclaredSignals.map((row) => `${row.key} ${row.files.length}`);
        line(`    undeclared signals and notifies (files): ${undeclared.join(', ') || 'none'}`);
        const forms = bp.refusedForms.map(([k, n]) => `${k} ${n}`);
        if (forms.length) line(`    refused signal and bind forms (uses): ${forms.join(', ')}`);
        if (bp.unresolvedSignals > 0)
            line(`    signal declarations not statically readable: ${bp.unresolvedSignals} (not counted above)`);
        line(`    source files whose gi:// is fully answered: ${src.clean}/${src.withGi}`);
        const top = [
            ...src.noRenderer.map((row) => ({ label: `${row.namespace} (no renderer)`, uses: row.uses })),
            ...src.lacksMember.map((row) => ({ label: row.member, uses: row.uses })),
        ].sort((a, b) => b.uses - a.uses);
        line(
            `    top unmet gi:// members (value uses): ${
                top
                    .slice(0, 8)
                    .map((row) => `${row.label} ${row.uses}`)
                    .join(', ') || 'none'
            }`,
        );
        const typeUses = src.typeOnly.reduce((sum, row) => sum + row.uses, 0);
        line(
            `    type-only uses of unmet members (no run-time need): ${typeUses} use(s), ${src.typeOnly.length} member(s)`,
        );
    }
};

// ---- main ------------------------------------------------------------------------------

try {
    const renderers = await Promise.all(Object.entries(GI_RENDERERS).map(([target, row]) => loadRenderer(target, row)));
    const files = walk(projectDir).sort();
    const blueprints = files.filter((file) => file.endsWith('.blp')).map((file) => blueprintRow(file, renderers));
    const sources = [];
    let unresolvedGirs = 0;
    for (const file of files) {
        if (!SOURCE_FILE.test(file) || NOT_SOURCE.test(file)) continue;
        const text = readFileSync(file, 'utf8');
        if (isGenerated(text)) continue;
        const row = sourceRow(file, text, renderers);
        unresolvedGirs += row.unresolvedGirs;
        if (row.imports.length > 0) sources.push(row);
    }
    const report = {
        project: projectDir,
        renderers: renderers.map(({ target, renderer }) => ({ target, renderer })),
        blueprints,
        sources,
        unresolvedGirs,
        summary: summarise(blueprints, sources, renderers),
    };
    if (asJson) console.log(JSON.stringify(report, null, 2));
    else printText(report);
} catch (error) {
    console.error(`report-target-gap: ${error.message}`);
    process.exit(2);
}
