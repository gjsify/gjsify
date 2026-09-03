import { describe, expect, it } from '@gjsify/unit';

import { windowsGuiLauncherPath, windowsLaunchLogLeaf } from './layout.js';
import { buildGuiLauncher, PE_SUBSYSTEM_GUI } from './pe-launcher.js';
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
