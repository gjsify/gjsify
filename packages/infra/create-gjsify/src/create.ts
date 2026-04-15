import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { discoverTemplates, findTemplate, type TemplateInfo } from './discover-templates.js';

export { discoverTemplates, findTemplate } from './discover-templates.js';
export type { TemplateInfo } from './discover-templates.js';

export interface CreateProjectOptions {
    projectName: string;
    /** Template short name, e.g. "gtk-minimal". If omitted, the caller is responsible for providing one via prompt. */
    template: string;
}

export async function createProject(options: CreateProjectOptions): Promise<void> {
    const { projectName, template } = options;

    const info = findTemplate(template);
    if (!info) {
        const available = discoverTemplates().map((t) => t.name).join(', ');
        throw new Error(
            `Unknown template "${template}". Available templates: ${available || '(none — run "yarn build" first)'}`,
        );
    }

    const targetDir = resolve(process.cwd(), projectName);
    if (existsSync(targetDir)) {
        console.error(`Error: Directory "${projectName}" already exists.`);
        process.exit(1);
    }

    console.log(`Creating new Gjsify project in ${targetDir} (template: ${info.name})...`);

    mkdirSync(targetDir, { recursive: true });

    // Recursive copy of the whole template tree
    cpSync(info.path, targetDir, { recursive: true });

    // Replace sentinel name in package.json
    rewriteProjectName(join(targetDir, 'package.json'), projectName);

    printNextSteps(projectName, info);
}

function rewriteProjectName(pkgJsonPath: string, projectName: string): void {
    if (!existsSync(pkgJsonPath)) return;
    const original = readFileSync(pkgJsonPath, 'utf-8');
    const replaced = original.replace(/new-gjsify-app/g, projectName);
    writeFileSync(pkgJsonPath, replaced);
}

function printNextSteps(projectName: string, template: TemplateInfo): void {
    console.log('');
    console.log(`Project created from template "${template.name}".`);
    console.log('');
    console.log('Next steps:');
    console.log(`  cd ${projectName}`);
    console.log('  npm install');
    console.log('  npm run dev');
    console.log('');
}
