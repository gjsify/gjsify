// The sd.cpp engine's pure parts and its availability, against a made-up
// machine and a temporary store. The addon is never loaded here.

import { describe, expect, it } from '@gjsify/unit';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { MachineProbe } from '@gjsify/machine-fit';
import { ModelStore } from '@gjsify/model-store';

import { createSdCppEngine, type ImageModelEntry, type NativeImage, type SdAddon } from './sdcpp-engine.js';
import { backendCandidates, currentTarget, hasPrebuiltBins, runningOnGjs } from './sdcpp-bin.js';

const GIB = 1024 ** 3;

/** A machine with no GPU in sysfs; `files` makes paths exist. */
function machine(init: { platform?: string; arch?: string; freemem?: number; files?: string[] } = {}): MachineProbe {
    const files = init.files ?? [];
    return {
        env: {},
        platform: init.platform ?? 'linux',
        arch: init.arch ?? 'x64',
        exists: (path: string) => files.some((file) => file === path || file.startsWith(`${path}/`)),
        list: (dir: string) =>
            files.filter((file) => file.startsWith(`${dir}/`)).map((file) => file.slice(dir.length + 1).split('/')[0]),
        read: () => undefined,
        run: () => undefined,
        totalmem: () => 16 * GIB,
        freemem: () => init.freemem ?? 8 * GIB,
    };
}

const vulkanMachine = machine({
    files: ['/usr/lib64/libvulkan.so.1', '/usr/share/vulkan/icd.d/radeon_icd.x86_64.json'],
});

const tinyEntry: ImageModelEntry = {
    id: 'tiny-sd',
    files: [
        {
            file: 'model.ckpt',
            url: 'https://example.org/model.ckpt',
            bytes: 1024,
            sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
    ],
    license: 'MIT',
    redistributable: true,
    modelId: 'tiny-sd',
    diffusionModel: 'model.ckpt',
    defaultWidth: 64,
    defaultHeight: 64,
    // A measured working set, not the file size: deliberately larger than the
    // 100 MB "tight" memory probe used by the availability test.
    footprintBytes: 200 * 1024 * 1024,
};

const tinyWithVae: ImageModelEntry = {
    ...tinyEntry,
    id: 'tiny-sd-vae',
    modelId: 'tiny-sd-vae',
    files: [
        ...tinyEntry.files,
        {
            file: 'vae.ckpt',
            url: 'https://example.org/vae.ckpt',
            bytes: 512,
            sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        },
    ],
    vae: 'vae.ckpt',
};

function makeStore(root: string, models = [tinyEntry, tinyWithVae]) {
    return new ModelStore<ImageModelEntry>({
        capability: 'image',
        models,
        defaultModel: models[0].id,
        root,
        fetch: async () => {
            throw new Error('no network in tests');
        },
    });
}

function fakeAddon(): SdAddon {
    return {
        StableDiffusionContext: {
            create: async () => ({
                generateImage: async (options: { width: number; height: number }): Promise<NativeImage[]> => [
                    {
                        width: options.width,
                        height: options.height,
                        channel: 3,
                        data: new Uint8Array(options.width * options.height * 3).fill(0xff),
                    },
                ],
                abort: () => {},
                close: () => {},
            }),
        },
        setProgressCallback: () => {},
    };
}

/** availability() never reaches the addon; any call into it is a bug. */
const noAddon = new Proxy(
    {},
    {
        get: () => {
            throw new Error('addon touched');
        },
    },
) as SdAddon;

export default async () => {
    await describe('prebuilt binaries', async () => {
        await it('names the target as sd.cpp does', async () => {
            expect(currentTarget(machine({ platform: 'linux', arch: 'arm64' }))).toBe('linux-arm64');
        });

        await it('answers per runtime', async () => {
            expect(hasPrebuiltBins('linux-x64', true)).toBe(true);
            expect(hasPrebuiltBins('darwin-arm64', true)).toBe(false);
            expect(hasPrebuiltBins('darwin-arm64', false)).toBe(true);
            expect(hasPrebuiltBins('freebsd-x64', false)).toBe(false);
        });

        await it('tries Vulkan first only where it is usable', async () => {
            expect(backendCandidates('linux-x64', 'auto', vulkanMachine)).toStrictEqual([
                'linux-x64-vulkan',
                'linux-x64',
            ]);
            expect(backendCandidates('linux-x64', 'auto', machine())).toStrictEqual(['linux-x64']);
            expect(backendCandidates('linux-x64', 'on', machine())).toStrictEqual(['linux-x64-vulkan', 'linux-x64']);
            expect(backendCandidates('linux-x64', 'off', vulkanMachine)).toStrictEqual(['linux-x64']);
            expect(backendCandidates('linux-arm64', 'on', vulkanMachine)).toStrictEqual(['linux-arm64']);
        });
    });

    await describe('runningOnGjs', async () => {
        await it('needs both imports and a GJS version', async () => {
            expect(runningOnGjs({ imports: {}, process: { versions: { gjs: '1.86' } } })).toBe(true);
            expect(runningOnGjs({ imports: {}, process: { versions: {} } })).toBe(false);
            expect(runningOnGjs({ process: { versions: { gjs: '1.86' } } })).toBe(false);
        });
    });

    await describe('availability', async () => {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-imagegen-avail-'));
        const store = makeStore(root);

        await it('is downloadable on a machine that fits and lacks the file', async () => {
            const engine = createSdCppEngine(async () => noAddon, { store, model: tinyEntry.id });
            expect(engine.info).toStrictEqual({ name: 'sd.cpp', locality: 'local' });
            expect(await engine.availability()).toBe('downloadable');
        });

        await it('is unavailable without binaries or without the memory', async () => {
            const freebsd = machine({ platform: 'freebsd' });
            const tight = machine({ freemem: 100 * 1024 * 1024 });
            expect(
                await createSdCppEngine(async () => noAddon, {
                    store,
                    model: tinyEntry.id,
                    probe: freebsd,
                }).availability(),
            ).toBe('unavailable');
            expect(
                await createSdCppEngine(async () => noAddon, {
                    store,
                    model: tinyEntry.id,
                    probe: tight,
                }).availability(),
            ).toBe('unavailable');
        });

        rmSync(root, { recursive: true, force: true });
    });

    await describe('model file roles', async () => {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-imagegen-roles-'));

        await it('requires the diffusionModel to exist in files', async () => {
            const badStore = makeStore(root, [{ ...tinyEntry, diffusionModel: 'missing.ckpt' }]);
            expect(() => createSdCppEngine(async () => noAddon, { store: badStore, model: tinyEntry.id })).toThrow(
                /diffusionModel/,
            );
        });

        rmSync(root, { recursive: true, force: true });
    });

    await describe('local files', async () => {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-imagegen-local-'));
        const model = join(root, 'model.safetensors');
        const vae = join(root, 'vae.safetensors');
        writeFileSync(model, Buffer.alloc(16));
        writeFileSync(vae, Buffer.alloc(16));

        /** A fake addon that remembers what the context was opened with. */
        function recordingAddon(): { addon: SdAddon; contexts: Array<Record<string, unknown>> } {
            const contexts: Array<Record<string, unknown>> = [];
            const addon = fakeAddon();
            const create = addon.StableDiffusionContext.create;
            addon.StableDiffusionContext.create = async (options) => {
                contexts.push(options);
                return create(options);
            };
            return { addon, contexts };
        }

        await it('is available when the files exist, unavailable when one is missing', async () => {
            const present = createSdCppEngine(async () => noAddon, {
                local: { modelId: 'mine', diffusionModel: model, vae },
            });
            expect(await present.availability()).toBe('available');
            const absent = createSdCppEngine(async () => noAddon, {
                local: { modelId: 'mine', diffusionModel: model, vae: join(root, 'gone.safetensors') },
            });
            expect(await absent.availability()).toBe('unavailable');
        });

        await it('checks the memory only when a footprint is given', async () => {
            const tight = machine({ freemem: 100 * 1024 * 1024 });
            const unknown = createSdCppEngine(async () => noAddon, {
                local: { modelId: 'mine', diffusionModel: model },
                probe: tight,
            });
            expect(await unknown.availability()).toBe('available');
            const measured = createSdCppEngine(async () => noAddon, {
                local: { modelId: 'mine', diffusionModel: model, footprintBytes: 200 * 1024 * 1024 },
                probe: tight,
            });
            expect(await measured.availability()).toBe('unavailable');
        });

        await it('opens the context with the given paths and generates at the default size', async () => {
            const { addon, contexts } = recordingAddon();
            const engine = await createSdCppEngine(async () => addon, {
                local: {
                    modelId: 'mine',
                    diffusionModel: model,
                    vae,
                    backend: 'cpu',
                    defaultWidth: 32,
                    defaultHeight: 16,
                },
            }).create();
            const result = await engine.generate({ prompt: 'cat' });
            expect(contexts).toStrictEqual([{ diffusionModelPath: model, vaePath: vae, backend: 'cpu' }]);
            expect(result.modelId).toBe('mine');
            expect(result.width).toBe(32);
            expect(result.height).toBe(16);
            await engine.destroy();
        });

        await it('defaults to 512x512 and does not need a vae or llm', async () => {
            const { addon, contexts } = recordingAddon();
            const engine = await createSdCppEngine(async () => addon, {
                local: { modelId: 'mine', diffusionModel: model },
                gpu: 'off',
            }).create();
            const result = await engine.generate({ prompt: 'cat', width: 8, height: 8 });
            expect(result.width).toBe(8);
            expect(contexts[0].vaePath).toBe(undefined);
            expect(contexts[0].llmPath).toBe(undefined);
            await engine.destroy();
        });

        await it('names the missing files when create() runs without them', async () => {
            const gone = join(root, 'gone.safetensors');
            const factory = createSdCppEngine(async () => noAddon, {
                local: { modelId: 'mine', diffusionModel: gone },
            });
            let message = '';
            try {
                await factory.create();
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain(gone);
        });

        await it('refuses a model without id or checkpoint', async () => {
            expect(() =>
                createSdCppEngine(async () => noAddon, { local: { modelId: '', diffusionModel: model } }),
            ).toThrow(/modelId/);
            expect(() =>
                createSdCppEngine(async () => noAddon, { local: { modelId: 'mine', diffusionModel: '' } }),
            ).toThrow(/diffusionModel/);
        });

        rmSync(root, { recursive: true, force: true });
    });

    await describe('generate with fake addon', async () => {
        const root = mkdtempSync(join(tmpdir(), 'gjsify-imagegen-gen-'));
        const store = makeStore(root);
        const modelDir = join(root, 'image', tinyEntry.id);
        mkdirSync(modelDir, { recursive: true });
        writeFileSync(join(modelDir, 'model.ckpt'), Buffer.alloc(1024));

        await it('produces a PNG from the fake addon', async () => {
            const generator = await createSdCppEngine(async () => fakeAddon(), {
                store,
                model: tinyEntry.id,
            }).create();
            const result = await generator.generate({ prompt: 'cat' });
            expect(result.blob.size).toBeGreaterThan(0);
            expect(result.width).toBe(tinyEntry.defaultWidth);
            expect(result.height).toBe(tinyEntry.defaultHeight);
            expect(result.modelId).toBe(tinyEntry.modelId);
            await generator.destroy();
        });

        await it('reports progress', async () => {
            const progress: Array<{ step: number; steps: number; seconds: number }> = [];
            const generator = await createSdCppEngine(async () => fakeAddon(), {
                store,
                model: tinyEntry.id,
            }).create();
            await generator.generate(
                { prompt: 'cat' },
                {
                    onProgress: (p) => progress.push(p),
                },
            );
            // The fake addon never calls back, so no progress is fine.
            expect(progress).toStrictEqual([]);
            await generator.destroy();
        });

        rmSync(root, { recursive: true, force: true });
    });
};
