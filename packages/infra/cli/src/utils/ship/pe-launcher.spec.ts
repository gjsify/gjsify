import { describe, expect, it } from '@gjsify/unit';

import { pngSize, rasters, tinyPng } from './icon-fixture.spec.js';
import { ICO_SIZES, iconResources, RT_GROUP_ICON, RT_ICON } from './ico.js';
import { windowsGuiLauncherPath, windowsLaunchLogLeaf } from './layout.js';
import { buildGuiLauncher, PE_DIRECTORY_RESOURCE, PE_SUBSYSTEM_GUI, RESOURCE_LANGUAGE } from './pe-launcher.js';
import { classifyBinary, readBinaryArch } from './payload.js';

/**
 * Read the fields a PE loader reads, with arithmetic and not with our writer.
 *
 * The same two seeks `.github/ship-oracle/verify-program-dir.py` and
 * `manifest-conformance`'s `readPe` make — `e_lfanew` at 0x3c, then the COFF
 * header it points at — spelled out here rather than imported, because a test
 * that read the image back through the module that wrote it would agree with
 * itself about a wrong offset.
 */
function readPeHeader(image: Uint8Array): {
    machine: number;
    subsystem: number;
    sections: number;
    sizeOfImage: number;
    entryPoint: number;
} {
    const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
    const peOffset = view.getUint32(0x3c, true);
    const optional = peOffset + 24;
    return {
        machine: view.getUint16(peOffset + 4, true),
        sections: view.getUint16(peOffset + 6, true),
        subsystem: view.getUint16(optional + 68, true),
        sizeOfImage: view.getUint32(optional + 56, true),
        entryPoint: view.getUint32(optional + 16, true),
    };
}

/** The `IMAGE_DATA_DIRECTORY` slot `index`, as the loader reads it: after the 112-byte PE32+ optional header. */
function dataDirectory(image: Uint8Array, index: number): { rva: number; size: number } {
    const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
    const optional = view.getUint32(0x3c, true) + 24;
    return { rva: view.getUint32(optional + 112 + index * 8, true), size: view.getUint32(optional + 116 + index * 8, true) };
}

/** Section headers, read from the table — name, RVA, raw offset, sizes, characteristics. */
function sections(image: Uint8Array): { name: string; rva: number; virtualSize: number; raw: number; rawSize: number; characteristics: number }[] {
    const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
    const peOffset = view.getUint32(0x3c, true);
    const count = view.getUint16(peOffset + 6, true);
    const optionalSize = view.getUint16(peOffset + 20, true);
    const table = peOffset + 24 + optionalSize;
    const out = [];
    for (let index = 0; index < count; index++) {
        const at = table + index * 40;
        out.push({
            name: Buffer.from(image.subarray(at, at + 8)).toString('latin1').replace(/\0+$/, ''),
            virtualSize: view.getUint32(at + 8, true),
            rva: view.getUint32(at + 12, true),
            rawSize: view.getUint32(at + 16, true),
            raw: view.getUint32(at + 20, true),
            characteristics: view.getUint32(at + 36, true),
        });
    }
    return out;
}

/** RVA → file offset through the section table, which is the only way a loader or a reader can do it. */
function fileOffset(image: Uint8Array, rva: number): number {
    const section = sections(image).find((s) => rva >= s.rva && rva < s.rva + Math.max(s.virtualSize, s.rawSize));
    if (section === undefined) throw new Error(`RVA 0x${rva.toString(16)} is in no section`);
    return section.raw + (rva - section.rva);
}

interface ResourceLeaf {
    type: number;
    id: number;
    language: number;
    data: Uint8Array;
}

/**
 * Walk the resource tree the way `FindResource` does: type → id → language,
 * each level an `IMAGE_RESOURCE_DIRECTORY` whose entries point down (high bit
 * set) or at a data entry whose `OffsetToData` is an RVA. Written from the
 * format, not from `buildResourceSection`, so a wrong convention in the writer
 * — a file offset where an RVA belongs — is a read that lands in the wrong bytes
 * here rather than a pair of functions agreeing.
 */
function readResources(image: Uint8Array): { leaves: ResourceLeaf[]; typeIds: number[]; iconIds: number[] } {
    const directory = dataDirectory(image, PE_DIRECTORY_RESOURCE);
    const base = fileOffset(image, directory.rva);
    const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
    const entries = (at: number): { id: number; offset: number; subdirectory: boolean }[] => {
        const named = view.getUint16(base + at + 12, true);
        const ids = view.getUint16(base + at + 14, true);
        const out = [];
        for (let index = 0; index < named + ids; index++) {
            const entry = base + at + 16 + index * 8;
            const target = view.getUint32(entry + 4, true);
            out.push({ id: view.getUint32(entry, true), offset: target & 0x7fffffff, subdirectory: (target & 0x80000000) !== 0 });
        }
        return out;
    };
    const leaves: ResourceLeaf[] = [];
    const types = entries(0);
    let iconIds: number[] = [];
    for (const type of types) {
        expect(type.subdirectory).toBe(true);
        const names = entries(type.offset);
        if (type.id === RT_ICON) iconIds = names.map((name) => name.id);
        for (const name of names) {
            expect(name.subdirectory).toBe(true);
            for (const language of entries(name.offset)) {
                expect(language.subdirectory).toBe(false);
                const dataEntry = base + language.offset;
                const rva = view.getUint32(dataEntry, true);
                const size = view.getUint32(dataEntry + 4, true);
                const at = fileOffset(image, rva);
                leaves.push({ type: type.id, id: name.id, language: language.id, data: image.subarray(at, at + size) });
            }
        }
    }
    return { leaves, typeIds: types.map((type) => type.id), iconIds };
}

/** Every ASCII string in the image, which is where the import names live. */
function asciiStrings(image: Uint8Array): string[] {
    return [
        ...Buffer.from(image)
            .toString('latin1')
            .matchAll(/[\x20-\x7e]{4,}/g),
    ].map((match) => match[0]);
}

export default async () => {
    await describe('ship: the GUI launcher stub', async () => {
        await it('is a GUI-subsystem x64 PE, which is the one field the defect is', async () => {
            const image = buildGuiLauncher({ logLeaf: 'ship-demo.launch.log' });
            const header = readPeHeader(image);
            // 2 is `IMAGE_SUBSYSTEM_WINDOWS_GUI`. 3 is `_CUI`, what `node.exe` and
            // `cmd.exe` are — and the value that makes Windows allocate a console
            // when there is none to inherit, which is the console window a user
            // sees behind every launch of the `.cmd` (ADR 0024 § M3).
            expect(header.subsystem).toBe(PE_SUBSYSTEM_GUI);
            expect(header.subsystem).not.toBe(3);
            expect(header.machine).toBe(0x8664);
            expect(header.sections).toBe(2);
            expect(header.entryPoint).toBeGreaterThan(0);
        });

        await it('is read as a PE by the readers that hold the payload', async () => {
            // NOT this module's own readers: `classifyBinary` decides what the
            // signer signs and `readBinaryArch` decides whether the payload matches
            // its arch label, and both now meet a file this repository writes.
            const image = buildGuiLauncher({ logLeaf: 'x.log' });
            expect(classifyBinary(image)).toBe('pe');
            expect(readBinaryArch(image)).toBe('x64');
        });

        await it('imports only kernel32, so it carries no runtime and nobody’s licence', async () => {
            const strings = asciiStrings(buildGuiLauncher({ logLeaf: 'x.log' }));
            expect(strings).toContain('KERNEL32.dll');
            // The three calls that decide the whole behaviour: which `.cmd` to run,
            // whether a console exists, and where the output goes when none does.
            expect(strings).toContain('GetModuleFileNameW');
            expect(strings).toContain('GetConsoleCP');
            expect(strings).toContain('CreateProcessW');
            // One DLL. A second would be a second thing to be present on the target
            // — and a CRT would be somebody else's code inside our artifact.
            expect(strings.filter((value) => value.toLowerCase().endsWith('.dll'))).toStrictEqual(['KERNEL32.dll']);
        });

        await it('carries the log name it was given, as UTF-16', async () => {
            const image = buildGuiLauncher({ logLeaf: 'ship-demo.launch.log' });
            const wide = Buffer.from('ship-demo.launch.log\0', 'utf16le');
            expect(Buffer.from(image).includes(wide)).toBe(true);
        });

        await it('is deterministic, so two runs of one stage are byte-identical', async () => {
            // No timestamp, no checksum, no build-host string: the `TimeDateStamp`
            // a linker writes is what makes an ordinary PE differ between builds,
            // and an artifact that differs for no reason cannot be compared.
            const first = buildGuiLauncher({ logLeaf: 'a.log' });
            const second = buildGuiLauncher({ logLeaf: 'a.log' });
            expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
            expect(Buffer.from(first).equals(Buffer.from(buildGuiLauncher({ logLeaf: 'b.log' })))).toBe(false);
        });

        await it('refuses a log name that is not a leaf', async () => {
            // The stub concatenates the value onto `%TEMP%\\` with `lstrcatW` and
            // makes no directories, so a value with a separator in it names a file
            // in a directory that may not exist — `CreateFileW` then fails and the
            // app starts with its output going nowhere, at exit 0.
            for (const bad of ['', 'a/b.log', 'a\\b.log', 'C:log']) {
                let message = '';
                try {
                    buildGuiLauncher({ logLeaf: bad });
                } catch (error) {
                    message = (error as Error).message;
                }
                expect(message).toContain('log file name');
            }
        });
    });

    await describe('ship: the GUI launcher carries the app icon', async () => {
        const icon = rasters(ICO_SIZES);
        const image = buildGuiLauncher({ logLeaf: 'ship-demo.launch.log', icon: iconResources(icon) });

        await it('gains a .rsrc section the resource data directory names, and nothing else moves', async () => {
            const bare = buildGuiLauncher({ logLeaf: 'ship-demo.launch.log' });
            expect(readPeHeader(image).sections).toBe(3);
            expect(readPeHeader(bare).sections).toBe(2);
            const [text, data, rsrc] = sections(image);
            const [bareText, bareData] = sections(bare);
            // Appended, not inserted: the two existing sections keep their RVAs and
            // file offsets, so every RIP-relative fixup in the code is untouched.
            expect(text).toStrictEqual(bareText);
            expect(data).toStrictEqual(bareData);
            expect(rsrc?.name).toBe('.rsrc');
            expect(rsrc?.characteristics).toBe(0x40000040); // INITIALIZED_DATA | MEM_READ
            const directory = dataDirectory(image, PE_DIRECTORY_RESOURCE);
            expect(directory.rva).toBe(rsrc?.rva);
            expect(directory.size).toBe(rsrc?.virtualSize);
            // Without an icon the slot is empty — the loader must not look for a tree.
            expect(dataDirectory(bare, PE_DIRECTORY_RESOURCE)).toStrictEqual({ rva: 0, size: 0 });
            // SizeOfImage reaches past the new section, or the loader maps a
            // truncated image and the shell reads the icon out of unmapped pages.
            expect(readPeHeader(image).sizeOfImage).toBeGreaterThan((rsrc?.rva ?? 0) + (rsrc?.virtualSize ?? 0) - 1);
            expect(readPeHeader(bare).sizeOfImage).toBeLessThan(readPeHeader(image).sizeOfImage);
        });

        await it('files one group and one RT_ICON per size, each data entry an RVA at the PNG', async () => {
            const { leaves, typeIds, iconIds } = readResources(image);
            // Ascending ids at every level — the loader binary-searches, so an
            // unsorted table is a tree in which some entries are never found.
            expect(typeIds).toStrictEqual([RT_ICON, RT_GROUP_ICON]);
            expect(iconIds).toStrictEqual(ICO_SIZES.map((_, index) => index + 1));
            const icons = leaves.filter((leaf) => leaf.type === RT_ICON);
            expect(icons.length).toBe(ICO_SIZES.length);
            icons.forEach((leaf, index) => {
                const size = ICO_SIZES[index] ?? 0;
                expect(leaf.language).toBe(RESOURCE_LANGUAGE);
                // Followed through the RVA → file offset map, the data entry lands
                // on the input PNG for that size, byte for byte.
                expect(pngSize(leaf.data).width).toBe(size);
                expect(Buffer.from(leaf.data).equals(Buffer.from(tinyPng(size)))).toBe(true);
            });
            const groups = leaves.filter((leaf) => leaf.type === RT_GROUP_ICON);
            expect(groups.length).toBe(1);
            expect(groups[0]?.id).toBe(1);
            expect(Buffer.from(groups[0]?.data ?? []).equals(Buffer.from(iconResources(icon).group))).toBe(true);
        });

        await it('is deterministic with an icon too, and differs from the bare image', async () => {
            const again = buildGuiLauncher({ logLeaf: 'ship-demo.launch.log', icon: iconResources(icon) });
            expect(Buffer.from(image).equals(Buffer.from(again))).toBe(true);
            expect(Buffer.from(image).equals(Buffer.from(buildGuiLauncher({ logLeaf: 'ship-demo.launch.log' })))).toBe(false);
        });

        await it('is still read as an x64 PE by the readers that hold the payload', async () => {
            expect(classifyBinary(image)).toBe('pe');
            expect(readBinaryArch(image)).toBe('x64');
            expect(readPeHeader(image).subsystem).toBe(PE_SUBSYSTEM_GUI);
        });
    });

    await describe('ship: where the GUI launcher lands', async () => {
        const identity = { binaryName: 'ship-demo', name: 'Ship Demo' };

        await it('sits beside the .cmd under the same stem', async () => {
            // THE STUB DEPENDS ON EXACTLY THIS. It finds its `.cmd` by overwriting
            // the last three characters of its own module filename — a store
            // instead of a path search — so the two names must differ only there.
            expect(windowsGuiLauncherPath(identity)).toBe('ship-demo.exe');
            expect(windowsLaunchLogLeaf(identity)).toBe('ship-demo.launch.log');
        });
    });
};
