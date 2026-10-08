// The two decisions of `report-target-gap.mjs` that a test has to reach without running the report:
// which members a namespace barrel exports, and which bind forms a target refuses.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import ts from 'typescript';

const isExported = (statement) =>
    statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

/** The member names a barrel's syntax tree exports as values: `export const x`, `export { x }`. */
export const exportedValueNames = (sourceFile) => {
    const names = new Set();
    for (const statement of sourceFile.statements) {
        if (ts.isVariableStatement(statement) && isExported(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
            }
        } else if (
            ts.isExportDeclaration(statement) &&
            !statement.isTypeOnly &&
            statement.exportClause !== undefined &&
            ts.isNamedExports(statement.exportClause)
        ) {
            for (const specifier of statement.exportClause.elements) {
                if (!specifier.isTypeOnly) names.add(specifier.name.text);
            }
        }
    }
    return names;
};

/**
 * Whether a target builds `bind template.x` and the bind flags: its `GObject` barrel carries
 * `registerClass`, whose template scope the builder binds through (ADR 0096 § 3).
 */
export const hasTemplateScope = (barrels) => barrels.get('GObject')?.has('registerClass') === true;

/** The issues one bind carries on a target, `templateScoped` being {@link hasTemplateScope}. */
export const bindFormIssues = (binding, tag, templateScoped) => {
    const issues = [];
    if ((binding.flags ?? []).length > 0 && !templateScoped) {
        issues.push({ issue: 'refused-bind-flag', tag, name: binding.flags.join(','), line: binding.line });
    }
    if (binding.source === 'template' && !templateScoped) {
        issues.push({ issue: 'refused-bind-source', tag, name: 'template', line: binding.line });
    }
    return issues;
};

/**
 * The barrel files that packages other than `ownDir` add to a renderer with
 * `registerBarrel(prefix, 'Library', …)` in `src/builder.ts` (ADR 0094): the file is
 * `src/namespace/<library>.ts`. A builder that names no such file contributes nothing.
 */
export const registeredBarrelFiles = (packageDirs, ownDir) => {
    const files = [];
    for (const packageDir of packageDirs) {
        const builder = join(packageDir, 'src/builder.ts');
        if (packageDir === ownDir || !existsSync(builder)) continue;
        const registered = /registerBarrel\(\s*'[^']+'\s*,\s*'(\w+)'/.exec(readFileSync(builder, 'utf8'));
        const file = registered && join(packageDir, 'src/namespace', `${registered[1].toLowerCase()}.ts`);
        if (file && existsSync(file)) files.push(file);
    }
    return files;
};
