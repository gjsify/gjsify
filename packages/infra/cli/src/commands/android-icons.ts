// `gjsify android-icons [--resources <dir>] [--icon <svg>] [--background <colour>] [--check]`
//
// Writes the Android launcher icon and splash logo of a NativeScript app from the
// ONE app icon the GNOME way already declares, so no app hand-maintains rasters.

import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

import { Config } from '../config.js';
import type { Command } from '../types/index.js';
import {
    ANDROID_ICONS_STAMP,
    buildStamp,
    checkStamp,
    hashInputs,
    parseMetainfoBranding,
    pickIconSources,
    planAndroidIcons,
    resolveBackground,
    resolveResourcesName,
    symbolicSibling,
    wrapperSvg,
} from '../utils/ship/android-icons.js';
import { rasterizeSvg } from '../utils/ship/icons.js';

interface AndroidIconsOptions {
    resources?: string;
    icon?: string;
    background?: string;
    check?: boolean;
}

const RES_PREFIX = 'Android/src/main/res';

function walk(dir: string, out: string[] = []): string[] {
    if (!existsSync(dir)) return out;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else out.push(full);
    }
    return out;
}

function discoverIcon(projectDir: string, flag: string | undefined): { icon: string; symbolic: string | null } {
    if (flag !== undefined) {
        const icon = resolve(projectDir, flag);
        if (!existsSync(icon)) throw new Error(`the icon ${flag} does not exist`);
        const sibling = symbolicSibling(icon);
        return { icon, symbolic: existsSync(sibling) ? sibling : null };
    }
    // The app's own `data/` first, then the sibling GNOME package of a monorepo.
    const roots = [join(projectDir, 'data', 'icons'), ...siblingIconRoots(projectDir)];
    for (const root of roots) {
        const found = pickIconSources(
            walk(root)
                .filter((f) => f.toLowerCase().endsWith('.svg'))
                .sort(),
        );
        if (found.icon !== null) return { icon: found.icon, symbolic: found.symbolic };
    }
    throw new Error('no app icon found; pass --icon <svg> or set `gjsify.androidIcons.icon`');
}

function siblingIconRoots(projectDir: string): string[] {
    const parent = dirname(projectDir);
    if (!existsSync(parent)) return [];
    return readdirSync(parent)
        .sort()
        .map((name) => join(parent, name, 'data', 'icons'))
        .filter((dir) => dir !== join(projectDir, 'data', 'icons') && existsSync(dir) && statSync(dir).isDirectory());
}

function findMetainfoColor(iconPath: string, projectDir: string): string | null {
    const roots = new Set<string>([join(projectDir, 'data')]);
    // `<pkg>/data/icons/hicolor/scalable/apps/<id>.svg` → `<pkg>/data`
    roots.add(resolve(dirname(iconPath), '..', '..', '..', '..'));
    for (const root of roots) {
        const files = walk(join(root, 'metainfo'))
            .filter((f) => /\.metainfo\.xml(\.in)?$/.test(f))
            .sort();
        for (const file of files) {
            const color = parseMetainfoBranding(readFileSync(file, 'utf8'));
            if (color !== null) return color;
        }
    }
    return null;
}

export const androidIconsCommand: Command<unknown, AndroidIconsOptions> = {
    command: 'android-icons',
    description: 'Generate the Android launcher icon and splash logo of a NativeScript app from its one app icon.',
    builder: (yargs) =>
        yargs
            .option('resources', {
                description:
                    'The App_Resources directory. Default: `gjsify.androidIcons.resources`, else `appResourcesPath` of nativescript.config.ts, else App_Resources.',
                type: 'string',
            })
            .option('icon', {
                description:
                    'The scalable app icon SVG. Default: `gjsify.androidIcons.icon`, else the hicolor icon under data/icons (here or in a sibling package).',
                type: 'string',
            })
            .option('background', {
                description:
                    'Adaptive-icon background colour. Default: `gjsify.androidIcons.background`, else the metainfo light `<branding>` colour, else white.',
                type: 'string',
            })
            .option('check', {
                description: 'Write nothing; exit 1 when the generated files are missing or the inputs changed.',
                type: 'boolean',
                default: false,
            }),
    handler: async (args) => {
        const projectDir = process.cwd();
        try {
            const config = (await new Config().forCommand(projectDir)).androidIcons ?? {};
            const nsConfigPath = ['nativescript.config.ts', 'nativescript.config.js']
                .map((name) => join(projectDir, name))
                .find((file) => existsSync(file));
            const resourcesName = resolveResourcesName({
                flag: args.resources,
                configured: config.resources,
                nativescriptConfig: nsConfigPath === undefined ? null : readFileSync(nsConfigPath, 'utf8'),
            });
            const resources = resolve(projectDir, resourcesName);
            const { icon, symbolic } = discoverIcon(projectDir, args.icon ?? config.icon);
            const background = resolveBackground({
                flag: args.background,
                configured: config.background,
                fromMetainfo: findMetainfoColor(icon, projectDir),
            });
            const iconBytes = new Uint8Array(readFileSync(icon));
            const symbolicBytes = symbolic === null ? null : new Uint8Array(readFileSync(symbolic));
            const inputs = hashInputs({ icon: iconBytes, symbolic: symbolicBytes, background });
            const plan = planAndroidIcons({ background, monochrome: symbolicBytes !== null });
            const stampPath = join(resources, ANDROID_ICONS_STAMP);

            if (args.check === true) {
                const verdict = checkStamp(
                    existsSync(stampPath) ? readFileSync(stampPath, 'utf8') : null,
                    inputs,
                    (rel) => existsSync(join(resources, ...rel.split('/'))),
                );
                if (!verdict.current) {
                    process.stderr.write(
                        `gjsify android-icons: ${resourcesName} ${verdict.reason}; run \`gjsify android-icons\` and commit it\n`,
                    );
                    return process.exit(1);
                }
                return;
            }

            const res = join(resources, ...RES_PREFIX.split('/'));
            const tmp = mkdtempSync(join(tmpdir(), 'gjsify-android-icons-'));
            try {
                const sources = new Map<string, string>([['plain', icon]]);
                for (const kind of ['round', 'foreground'] as const) {
                    const file = join(tmp, `${kind}.svg`);
                    writeFileSync(file, wrapperSvg(kind, iconBytes, background));
                    sources.set(kind, file);
                }
                if (symbolicBytes !== null) {
                    const file = join(tmp, 'monochrome.svg');
                    writeFileSync(file, wrapperSvg('monochrome', symbolicBytes, background));
                    sources.set('monochrome', file);
                }
                for (const [kind, svg] of sources) {
                    const wanted = plan.png.filter((p) =>
                        kind === 'plain' ? p.kind === 'legacy' || p.kind === 'splash' : p.kind === kind,
                    );
                    const sizes = [...new Set(wanted.map((p) => p.size))];
                    const rendered = await rasterizeSvg({ svg, sizes, command: 'gjsify android-icons' });
                    for (const spec of wanted) {
                        const target = join(res, spec.path);
                        mkdirSync(dirname(target), { recursive: true });
                        writeFileSync(target, rendered.get(spec.size) as Uint8Array);
                    }
                }
            } finally {
                rmSync(tmp, { recursive: true, force: true });
            }
            for (const spec of plan.text) {
                const target = join(res, spec.path);
                mkdirSync(dirname(target), { recursive: true });
                writeFileSync(target, spec.content);
            }
            // The template's vector would be dead weight showing the NativeScript "N".
            rmSync(join(res, 'drawable', 'ic_launcher_foreground.xml'), { force: true });
            writeFileSync(stampPath, `${JSON.stringify(buildStamp(inputs, plan, RES_PREFIX), null, 2)}\n`);
            process.stdout.write(
                `gjsify android-icons: wrote ${plan.png.length + plan.text.length} files under ${relative(projectDir, res).split(sep).join('/')} from ${relative(projectDir, icon)}\n`,
            );
        } catch (err) {
            process.stderr.write(`gjsify android-icons: ${err instanceof Error ? err.message : String(err)}\n`);
            return process.exit(1);
        }
    },
};
