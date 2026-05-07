// `gjsify flatpak ci` — scaffold .github/workflows/flatpak.yml in the
// shape used by Flathub-hosted apps:
//
//   * upstream `flatpak/flatpak-github-actions/flatpak-builder@v6` action
//   * `ghcr.io/flathub-infra/flatpak-github-actions:<runtime>-<version>` container
//   * cache key keyed by commit SHA
//
// Idempotent: refuses to overwrite an existing workflow without `--force`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { Command, ConfigData, ConfigDataFlatpak } from '../../types/index.js';
import { Config } from '../../config.js';
import { defaultCiContainer, looksLikeAppId, readPackageJson, resolveRuntime } from './utils.js';

interface FlatpakCiOptions {
    manifest?: string;
    bundle?: string;
    runtimeImage?: string;
    branches?: string[];
    out?: string;
    force?: boolean;
    cacheKey?: string;
    verbose?: boolean;
}

export const flatpakCiCommand: Command<unknown, FlatpakCiOptions> = {
    command: 'ci',
    description:
        'Scaffold .github/workflows/flatpak.yml using the flathub-infra container + flatpak-builder@v6 action.',
    builder: (yargs) => {
        return yargs
            .option('manifest', {
                description: 'Manifest path the workflow points at (default: <app-id>.json)',
                type: 'string',
                normalize: true,
            })
            .option('bundle', {
                description: 'Bundle filename produced by the action (default: <app-id>.flatpak)',
                type: 'string',
                normalize: true,
            })
            .option('runtime-image', {
                description:
                    'Container image override. Default derived from gjsify.flatpak.runtime + runtimeVersion (e.g. `ghcr.io/flathub-infra/flatpak-github-actions:gnome-50`).',
                type: 'string',
            })
            .option('branches', {
                description: 'Branches the workflow runs on push for (default: main)',
                type: 'string',
                array: true,
            })
            .option('out', {
                description: 'Output path',
                type: 'string',
                default: '.github/workflows/flatpak.yml',
                normalize: true,
            })
            .option('cache-key', {
                description: 'Override the action `cache-key` (default: `flatpak-builder-${{ github.sha }}`)',
                type: 'string',
            })
            .option('force', {
                description: 'Overwrite an existing workflow file',
                type: 'boolean',
                default: false,
            })
            .option('verbose', {
                description: 'Print resolved fields',
                type: 'boolean',
                default: false,
            });
    },
    handler: async (args) => {
        const cwd = process.cwd();
        const cfg = new Config();
        const configData = await cfg.forBuild({} as never).catch(() => ({} as ConfigData));
        const flatpak: ConfigDataFlatpak = configData.flatpak ?? {};
        const pkg = readPackageJson(cwd);

        const appId =
            flatpak.appId ??
            (looksLikeAppId(pkg.name) ? (pkg.name as string) : undefined);
        if (!appId) {
            throw new Error(
                'gjsify flatpak ci: no app id available. Set gjsify.flatpak.appId in package.json ' +
                    'or rename the package to a reverse-DNS id.',
            );
        }

        const manifest = (args.manifest as string | undefined) ?? `${appId}.json`;
        const bundle = (args.bundle as string | undefined) ?? `${appId}.flatpak`;

        const { runtime, runtimeVersion } = resolveRuntime(flatpak, {});
        const runtimeImage =
            (args.runtimeImage as string | undefined) ??
            flatpak.ciContainer ??
            defaultCiContainer(runtime, runtimeVersion);

        const branches = (args.branches as string[] | undefined) ?? flatpak.ciBranches ?? ['main'];
        const cacheKey = args.cacheKey ?? 'flatpak-builder-${{ github.sha }}';

        const out = resolve(cwd, args.out ?? '.github/workflows/flatpak.yml');
        if (existsSync(out) && !args.force) {
            // Same content → silently skip; different content → fail with a hint.
            const existing = readFileSync(out, 'utf-8');
            const next = renderWorkflow({ manifest, bundle, runtimeImage, branches, cacheKey });
            if (existing === next) {
                console.log(`[gjsify flatpak ci] ${out} already up to date`);
                return;
            }
            throw new Error(
                `gjsify flatpak ci: ${out} exists with different content. Pass --force to overwrite.`,
            );
        }

        const content = renderWorkflow({ manifest, bundle, runtimeImage, branches, cacheKey });
        mkdirSync(dirname(out), { recursive: true });
        writeFileSync(out, content, 'utf-8');

        if (args.verbose) {
            console.log(
                `[gjsify flatpak ci] runtime-image=${runtimeImage} manifest=${manifest} bundle=${bundle}`,
            );
        }
        console.log(`[gjsify flatpak ci] wrote ${out}`);
    },
};

interface RenderInput {
    manifest: string;
    bundle: string;
    runtimeImage: string;
    branches: string[];
    cacheKey: string;
}

/**
 * Render the workflow YAML. Format string built explicitly (no template
 * library) so the output is byte-stable for diff-based code review.
 */
function renderWorkflow(input: RenderInput): string {
    const branchesYaml = `[${input.branches.map((b) => JSON.stringify(b)).join(', ')}]`;
    return `name: Flatpak

on:
  push:
    branches: ${branchesYaml}
  pull_request:
    branches: ${branchesYaml}

jobs:
  flatpak:
    name: Flatpak Build
    runs-on: ubuntu-latest
    container:
      image: ${input.runtimeImage}
      options: --privileged

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
        with:
          submodules: false

      - name: Build Flatpak
        uses: flatpak/flatpak-github-actions/flatpak-builder@v6
        with:
          manifest-path: ${input.manifest}
          bundle: ${input.bundle}
          cache-key: ${input.cacheKey}
`;
}
