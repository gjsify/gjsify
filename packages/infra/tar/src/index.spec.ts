import { describe, it, expect, on } from "@gjsify/unit";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import { parseTar, extractTarball, gunzip, BLOCK_SIZE, type TarEntry } from "./index.ts";

interface BuildTarEntry {
    name: string;
    body?: Uint8Array | string;
    type?: "file" | "directory" | "symlink";
    linkname?: string;
    mode?: number;
    mtime?: number;
    paxHeader?: Record<string, string>;
}

function writeAscii(buf: Uint8Array, offset: number, len: number, s: string): void {
    for (let i = 0; i < s.length && i < len; i++) buf[offset + i] = s.charCodeAt(i);
}

function writeOctal(buf: Uint8Array, offset: number, len: number, value: number): void {
    const s = value.toString(8).padStart(len - 1, "0");
    writeAscii(buf, offset, len - 1, s);
    // last byte stays 0 (NUL terminator).
}

function buildHeader(entry: {
    name: string;
    size: number;
    type: "file" | "directory" | "symlink" | "x" | "L";
    linkname?: string;
    mode?: number;
    mtime?: number;
}): Uint8Array {
    const header = new Uint8Array(BLOCK_SIZE);
    writeAscii(header, 0, 100, entry.name);
    writeOctal(header, 100, 8, entry.mode ?? 0o644);
    writeOctal(header, 108, 8, 0); // uid
    writeOctal(header, 116, 8, 0); // gid
    writeOctal(header, 124, 12, entry.size);
    writeOctal(header, 136, 12, entry.mtime ?? 0);
    // chksum left as spaces during checksum calc
    for (let i = 148; i < 156; i++) header[i] = 0x20;
    let typeflag = "0";
    if (entry.type === "directory") typeflag = "5";
    else if (entry.type === "symlink") typeflag = "2";
    else if (entry.type === "x") typeflag = "x";
    else if (entry.type === "L") typeflag = "L";
    header[156] = typeflag.charCodeAt(0);
    if (entry.linkname) writeAscii(header, 157, 100, entry.linkname);
    writeAscii(header, 257, 6, "ustar\0");
    writeAscii(header, 263, 2, "00");
    // Compute checksum.
    let sum = 0;
    for (let i = 0; i < BLOCK_SIZE; i++) sum += header[i];
    writeOctal(header, 148, 8, sum);
    return header;
}

function alignBlock(n: number): number {
    return Math.ceil(n / BLOCK_SIZE) * BLOCK_SIZE;
}

function bodyToBytes(body?: Uint8Array | string): Uint8Array {
    if (body === undefined) return new Uint8Array(0);
    if (typeof body === "string") return new TextEncoder().encode(body);
    return body;
}

/** Construct a tiny ustar archive in memory for tests. */
function buildTar(entries: BuildTarEntry[]): Uint8Array {
    const blocks: Uint8Array[] = [];
    for (const entry of entries) {
        if (entry.paxHeader) {
            // Build PAX header block: each record `<len> <key>=<value>\n`.
            let payload = "";
            for (const [k, v] of Object.entries(entry.paxHeader)) {
                const inner = `${k}=${v}\n`;
                let len = inner.length + 1;
                while (`${len} ${inner}`.length !== len) len = `${len} ${inner}`.length;
                payload += `${len} ${inner}`;
            }
            const paxBytes = new TextEncoder().encode(payload);
            blocks.push(buildHeader({ name: "./PaxHeaders/x", size: paxBytes.length, type: "x" }));
            const pad = new Uint8Array(alignBlock(paxBytes.length));
            pad.set(paxBytes);
            blocks.push(pad);
        }
        const body = bodyToBytes(entry.body);
        const type = entry.type ?? "file";
        blocks.push(
            buildHeader({
                name: entry.name,
                size: type === "file" ? body.length : 0,
                type,
                linkname: entry.linkname,
                mode: entry.mode,
                mtime: entry.mtime,
            }),
        );
        if (type === "file") {
            const pad = new Uint8Array(alignBlock(body.length));
            pad.set(body);
            blocks.push(pad);
        }
    }
    // Two trailing zero blocks mark EOF.
    blocks.push(new Uint8Array(BLOCK_SIZE));
    blocks.push(new Uint8Array(BLOCK_SIZE));

    let total = 0;
    for (const b of blocks) total += b.length;
    const out = new Uint8Array(total);
    let pos = 0;
    for (const b of blocks) {
        out.set(b, pos);
        pos += b.length;
    }
    return out;
}

function findEntry(entries: TarEntry[], name: string): TarEntry | undefined {
    return entries.find((e) => e.name === name);
}

export default async () => {
    await describe("@gjsify/tar — parseTar", async () => {
        await it("parses a single file entry", async () => {
            const buf = buildTar([{ name: "package/README.md", body: "hello" }]);
            const entries = parseTar(buf);
            expect(entries.length).toBe(1);
            expect(entries[0].name).toBe("package/README.md");
            expect(entries[0].type).toBe("file");
            expect(new TextDecoder().decode(entries[0].body)).toBe("hello");
        });

        await it("parses files and directories with correct types/modes", async () => {
            const buf = buildTar([
                { name: "package/", type: "directory", mode: 0o755 },
                { name: "package/index.js", body: "module.exports = 1", mode: 0o644 },
                { name: "package/bin/cli", body: "#!/bin/sh\necho hi\n", mode: 0o755 },
            ]);
            const entries = parseTar(buf);
            expect(entries.length).toBe(3);
            const dir = findEntry(entries, "package/");
            expect(dir).toBeTruthy();
            expect(dir?.type).toBe("directory");
            const cli = findEntry(entries, "package/bin/cli");
            expect(cli?.mode).toBe(0o755);
        });

        await it("handles a symlink entry", async () => {
            const buf = buildTar([
                { name: "package/lib/link", type: "symlink", linkname: "../target" },
            ]);
            const entries = parseTar(buf);
            expect(entries.length).toBe(1);
            expect(entries[0].type).toBe("symlink");
            expect(entries[0].linkname).toBe("../target");
        });

        await it("respects PAX path override for long names", async () => {
            const longName =
                "package/" + "very-long-segment/".repeat(8) + "deeply/nested/file.js";
            const buf = buildTar([
                {
                    name: "package/placeholder",
                    body: "long-name body",
                    paxHeader: { path: longName },
                },
            ]);
            const entries = parseTar(buf);
            expect(entries.length).toBe(1);
            expect(entries[0].name).toBe(longName);
            expect(new TextDecoder().decode(entries[0].body)).toBe("long-name body");
        });

        await it("rejects garbage with a clear error", async () => {
            const buf = new Uint8Array(BLOCK_SIZE);
            for (let i = 0; i < buf.length; i++) buf[i] = 0x42; // not a valid tar
            let caught: Error | null = null;
            try {
                parseTar(buf);
            } catch (e) {
                caught = e as Error;
            }
            expect(caught).toBeTruthy();
            expect(String(caught?.message)).toMatch(/Bad header checksum/);
        });
    });

    await describe("@gjsify/tar — extractTarball (filesystem)", async () => {
        await it("extracts files + dirs into a tmpdir, stripping leading 'package/'", async () => {
            const buf = buildTar([
                { name: "package/", type: "directory", mode: 0o755 },
                { name: "package/package.json", body: '{"name":"x"}\n' },
                { name: "package/lib/index.js", body: "module.exports = 1\n" },
            ]);
            const dest = fs.mkdtempSync(path.join(os.tmpdir(), "gjsify-tar-"));
            try {
                const result = await extractTarball(buf, dest);
                expect(result.files.length).toBe(2);
                expect(fs.existsSync(path.join(dest, "package.json"))).toBe(true);
                expect(fs.existsSync(path.join(dest, "lib", "index.js"))).toBe(true);
                expect(fs.readFileSync(path.join(dest, "package.json"), "utf-8")).toBe(
                    '{"name":"x"}\n',
                );
            } finally {
                fs.rmSync(dest, { recursive: true, force: true });
            }
        });

        await it("rejects entries that escape destDir", async () => {
            const buf = buildTar([
                { name: "package/../../etc/evil", body: "danger" },
            ]);
            const dest = fs.mkdtempSync(path.join(os.tmpdir(), "gjsify-tar-"));
            let caught: Error | null = null;
            try {
                try {
                    await extractTarball(buf, dest);
                } catch (e) {
                    caught = e as Error;
                }
                expect(caught).toBeTruthy();
                expect(String(caught?.message)).toMatch(/refusing to extract/);
            } finally {
                fs.rmSync(dest, { recursive: true, force: true });
            }
        });

        await it("filter() can skip entries", async () => {
            const buf = buildTar([
                { name: "package/keep.js", body: "keep" },
                { name: "package/skip.test.js", body: "skip" },
            ]);
            const dest = fs.mkdtempSync(path.join(os.tmpdir(), "gjsify-tar-"));
            try {
                const result = await extractTarball(buf, dest, {
                    filter: (entry) => !entry.name.endsWith(".test.js"),
                });
                expect(result.files.length).toBe(1);
                expect(fs.existsSync(path.join(dest, "keep.js"))).toBe(true);
                expect(fs.existsSync(path.join(dest, "skip.test.js"))).toBe(false);
            } finally {
                fs.rmSync(dest, { recursive: true, force: true });
            }
        });
    });

    await on("Node.js", async () => {
        await describe("@gjsify/tar — gzip round-trip (Node only)", async () => {
            await it("gunzip undoes gzipSync", async () => {
                // Use Node's zlib so we don't depend on @gjsify/zlib being
                // bundled into the tar test.
                const { gzipSync } = await import("node:zlib");
                const original = new TextEncoder().encode("the quick brown fox\n");
                const gz = gzipSync(original);
                const round = await gunzip(new Uint8Array(gz));
                expect(new TextDecoder().decode(round)).toBe("the quick brown fox\n");
            });

            await it("extractTarball auto-detects gzipped input", async () => {
                const { gzipSync } = await import("node:zlib");
                const tar = buildTar([
                    { name: "package/hello.txt", body: "world" },
                ]);
                const gz = new Uint8Array(gzipSync(tar));
                const dest = fs.mkdtempSync(path.join(os.tmpdir(), "gjsify-tar-"));
                try {
                    await extractTarball(gz, dest);
                    expect(fs.readFileSync(path.join(dest, "hello.txt"), "utf-8")).toBe("world");
                } finally {
                    fs.rmSync(dest, { recursive: true, force: true });
                }
            });
        });
    });
};
