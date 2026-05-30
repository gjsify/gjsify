// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by memfs
// (streamich + contributors, Apache-2.0).
//
// In-memory only. No persistence (OPFS bridge is a future iteration).
// No file watching (FSWatcher is a stub). No real permission/owner enforcement.
//
// In-memory file system tree. The volume is a single global `__defaultVolume`
// (with the option to instantiate further `Volume`s for tests / sandboxing).
// Paths are POSIX-style only — there is no concept of a drive letter or
// Win32 separator in the browser shape.

import { EACCES, EBADF, EEXIST, EINVAL, EISDIR, ENOENT, ENOTDIR, ENOTEMPTY } from './errors.js';
import { dirname, normalize, resolve, split } from './path-utils.js';
import { modeFor, type NodeKind, type StatFields } from './types.js';

interface BaseNode {
    mode: number;
    uid: number;
    gid: number;
    atimeMs: number;
    mtimeMs: number;
    ctimeMs: number;
    birthtimeMs: number;
    ino: number;
    nlink: number;
}
interface FileNode extends BaseNode { kind: 'file'; data: Uint8Array }
interface DirNode extends BaseNode { kind: 'dir'; children: Map<string, AnyNode> }
interface SymlinkNode extends BaseNode { kind: 'symlink'; target: string }
type AnyNode = FileNode | DirNode | SymlinkNode;

interface FdEntry { node: FileNode; path: string; position: number; flags: string }

const EMPTY = new Uint8Array(0);
const now = (): number => Date.now();

function toStatFields(node: AnyNode): StatFields {
    return {
        kind: node.kind,
        size: node.kind === 'file' ? node.data.byteLength : node.kind === 'symlink' ? node.target.length : 0,
        mode: node.mode,
        atimeMs: node.atimeMs,
        mtimeMs: node.mtimeMs,
        ctimeMs: node.ctimeMs,
        birthtimeMs: node.birthtimeMs,
        uid: node.uid,
        gid: node.gid,
        ino: node.ino,
        nlink: node.nlink,
    };
}

/** Single in-memory volume — exported so test code can build isolated instances. */
export class Volume {
    private root: DirNode;
    private nextIno = 2;
    private fds = new Map<number, FdEntry>();
    private nextFd = 3;

    constructor() {
        this.root = { kind: 'dir', children: new Map(), ...this.mkBase('dir', 0o755), nlink: 2 } as DirNode;
        this.root.ino = 1;
    }

    private mkBase(kind: NodeKind, perm: number): BaseNode {
        const t = now();
        return {
            mode: modeFor(kind, perm),
            uid: 0, gid: 0,
            atimeMs: t, mtimeMs: t, ctimeMs: t, birthtimeMs: t,
            ino: this.nextIno++, nlink: 1,
        };
    }

    private mkNode(kind: NodeKind, perm: number): AnyNode {
        const base = this.mkBase(kind, perm);
        if (kind === 'file') return { kind: 'file', data: EMPTY, ...base };
        if (kind === 'dir') return { kind: 'dir', children: new Map(), ...base, nlink: 2 };
        return { kind: 'symlink', target: '', ...base };
    }

    private lookup(path: string, syscall: string): AnyNode {
        const abs = resolve(path);
        if (abs === '/') return this.root;
        let cur: AnyNode = this.root;
        for (const seg of split(abs)) {
            if (cur.kind !== 'dir') throw ENOTDIR(syscall, abs);
            const child = cur.children.get(seg);
            if (!child) throw ENOENT(syscall, abs);
            cur = child;
        }
        return cur;
    }

    private lookupParent(path: string, syscall: string): { parent: DirNode; name: string; abs: string } {
        const abs = resolve(path);
        if (abs === '/') throw EINVAL(syscall, abs);
        const parent = this.lookup(dirname(abs), syscall);
        if (parent.kind !== 'dir') throw ENOTDIR(syscall, dirname(abs));
        const parts = split(abs);
        return { parent, name: parts[parts.length - 1], abs };
    }

    // ───────────── Existence / probes ────────────────────────────────────────

    existsSync(path: string): boolean {
        try { this.lookup(path, 'stat'); return true; } catch { return false; }
    }

    statSync(path: string): StatFields {
        const node = this.lookup(path, 'stat');
        node.atimeMs = now();
        return toStatFields(node);
    }

    lstatSync(path: string): StatFields { return this.statSync(path); }

    accessSync(path: string, _mode: number): void {
        this.lookup(path, 'access');
    }

    // ───────────── File I/O ──────────────────────────────────────────────────

    readFileSync(path: string): Uint8Array {
        const node = this.lookup(path, 'open');
        if (node.kind === 'dir') throw EISDIR('read', resolve(path));
        if (node.kind === 'symlink') throw EINVAL('read', resolve(path));
        node.atimeMs = now();
        return new Uint8Array(node.data);
    }

    writeFileSync(path: string, data: Uint8Array, mode = 0o666): void {
        const abs = resolve(path);
        try {
            const node = this.lookup(abs, 'open');
            if (node.kind === 'dir') throw EISDIR('open', abs);
            if (node.kind === 'symlink') throw EINVAL('open', abs);
            node.data = new Uint8Array(data);
            node.mtimeMs = node.ctimeMs = now();
        } catch (e) {
            if ((e as { code?: string }).code !== 'ENOENT') throw e;
            const { parent, name } = this.lookupParent(abs, 'open');
            const file = this.mkNode('file', mode) as FileNode;
            file.data = new Uint8Array(data);
            parent.children.set(name, file);
            parent.mtimeMs = parent.ctimeMs = now();
        }
    }

    appendFileSync(path: string, data: Uint8Array, mode = 0o666): void {
        const abs = resolve(path);
        try {
            const node = this.lookup(abs, 'open');
            if (node.kind !== 'file') throw EISDIR('open', abs);
            const merged = new Uint8Array(node.data.byteLength + data.byteLength);
            merged.set(node.data, 0);
            merged.set(data, node.data.byteLength);
            node.data = merged;
            node.mtimeMs = node.ctimeMs = now();
        } catch (e) {
            if ((e as { code?: string }).code !== 'ENOENT') throw e;
            this.writeFileSync(abs, data, mode);
        }
    }

    truncateSync(path: string, len = 0): void {
        const node = this.lookup(path, 'open');
        if (node.kind !== 'file') throw EISDIR('open', resolve(path));
        if (len < node.data.byteLength) node.data = node.data.slice(0, len);
        else if (len > node.data.byteLength) {
            const extended = new Uint8Array(len);
            extended.set(node.data, 0);
            node.data = extended;
        }
        node.mtimeMs = node.ctimeMs = now();
    }

    // ───────────── Directory I/O ─────────────────────────────────────────────

    readdirSync(path: string): string[] {
        const node = this.lookup(path, 'scandir');
        if (node.kind !== 'dir') throw ENOTDIR('scandir', resolve(path));
        return [...node.children.keys()];
    }

    readdirEntriesSync(path: string): Array<{ name: string; kind: NodeKind }> {
        const node = this.lookup(path, 'scandir');
        if (node.kind !== 'dir') throw ENOTDIR('scandir', resolve(path));
        return [...node.children.entries()].map(([name, child]) => ({ name, kind: child.kind }));
    }

    mkdirSync(path: string, opts: { recursive?: boolean; mode?: number } = {}): string | undefined {
        const abs = resolve(path);
        if (abs === '/') {
            if (opts.recursive) return undefined;
            throw EEXIST('mkdir', abs);
        }
        const parts = split(abs);
        const mode = opts.mode ?? 0o777;
        let firstCreated: string | undefined;
        let cur: DirNode = this.root;
        let curPath = '';
        for (let i = 0; i < parts.length; i++) {
            const name = parts[i];
            curPath += '/' + name;
            const child = cur.children.get(name);
            if (!child) {
                if (!opts.recursive && i !== parts.length - 1) throw ENOENT('mkdir', abs);
                const node = this.mkNode('dir', mode) as DirNode;
                cur.children.set(name, node);
                cur.mtimeMs = cur.ctimeMs = now();
                if (firstCreated === undefined) firstCreated = curPath;
                cur = node;
            } else if (child.kind !== 'dir') {
                throw ENOTDIR('mkdir', curPath);
            } else if (i === parts.length - 1 && !opts.recursive) {
                throw EEXIST('mkdir', abs);
            } else {
                cur = child;
            }
        }
        return firstCreated;
    }

    rmdirSync(path: string, opts: { recursive?: boolean } = {}): void {
        const abs = resolve(path);
        if (abs === '/') throw EACCES('rmdir', abs);
        const { parent, name } = this.lookupParent(abs, 'rmdir');
        const node = parent.children.get(name);
        if (!node) throw ENOENT('rmdir', abs);
        if (node.kind !== 'dir') throw ENOTDIR('rmdir', abs);
        if (!opts.recursive && node.children.size > 0) throw ENOTEMPTY('rmdir', abs);
        parent.children.delete(name);
        parent.mtimeMs = parent.ctimeMs = now();
    }

    unlinkSync(path: string): void {
        const abs = resolve(path);
        const { parent, name } = this.lookupParent(abs, 'unlink');
        const node = parent.children.get(name);
        if (!node) throw ENOENT('unlink', abs);
        if (node.kind === 'dir') throw EISDIR('unlink', abs);
        parent.children.delete(name);
        parent.mtimeMs = parent.ctimeMs = now();
    }

    rmSync(path: string, opts: { recursive?: boolean; force?: boolean } = {}): void {
        const abs = resolve(path);
        let node: AnyNode;
        try { node = this.lookup(abs, 'unlink'); }
        catch (e) {
            if (opts.force && (e as { code?: string }).code === 'ENOENT') return;
            throw e;
        }
        if (node.kind === 'dir') {
            if (!opts.recursive) throw EISDIR('unlink', abs);
            this.rmdirSync(abs, { recursive: true });
            return;
        }
        this.unlinkSync(abs);
    }

    // ───────────── Move / copy / link ────────────────────────────────────────

    renameSync(oldPath: string, newPath: string): void {
        const oldAbs = resolve(oldPath);
        const newAbs = resolve(newPath);
        if (oldAbs === newAbs) return;
        const { parent: oldParent, name: oldName } = this.lookupParent(oldAbs, 'rename');
        const node = oldParent.children.get(oldName);
        if (!node) throw ENOENT('rename', oldAbs);
        const { parent: newParent, name: newName } = this.lookupParent(newAbs, 'rename');
        const existing = newParent.children.get(newName);
        if (existing?.kind === 'dir' && existing.children.size > 0) {
            throw ENOTEMPTY('rename', newAbs);
        }
        oldParent.children.delete(oldName);
        newParent.children.set(newName, node);
        const t = now();
        oldParent.mtimeMs = oldParent.ctimeMs = t;
        newParent.mtimeMs = newParent.ctimeMs = t;
        node.ctimeMs = t;
    }

    copyFileSync(src: string, dest: string, flags = 0): void {
        const srcNode = this.lookup(src, 'copyfile');
        if (srcNode.kind !== 'file') throw EISDIR('copyfile', resolve(src));
        if ((flags & 1) && this.existsSync(dest)) throw EEXIST('copyfile', resolve(dest));
        this.writeFileSync(dest, srcNode.data, srcNode.mode & 0o777);
    }

    linkSync(existingPath: string, newPath: string): void {
        // No true hardlinks — emit a copy that shares the byte buffer reference.
        const node = this.lookup(existingPath, 'link');
        if (node.kind !== 'file') throw EISDIR('link', resolve(existingPath));
        const { parent, name } = this.lookupParent(newPath, 'link');
        if (parent.children.has(name)) throw EEXIST('link', resolve(newPath));
        node.nlink += 1;
        parent.children.set(name, { ...node, kind: 'file' } as FileNode);
        parent.mtimeMs = parent.ctimeMs = now();
    }

    // ───────────── Symlinks (limited) ────────────────────────────────────────

    symlinkSync(target: string, linkPath: string): void {
        const abs = resolve(linkPath);
        const { parent, name } = this.lookupParent(abs, 'symlink');
        if (parent.children.has(name)) throw EEXIST('symlink', abs);
        const link = this.mkNode('symlink', 0o777) as SymlinkNode;
        link.target = target;
        parent.children.set(name, link);
        parent.mtimeMs = parent.ctimeMs = now();
    }

    readlinkSync(path: string): string {
        const node = this.lookup(path, 'readlink');
        if (node.kind !== 'symlink') throw EINVAL('readlink', resolve(path));
        return node.target;
    }

    realpathSync(path: string): string {
        const abs = resolve(path);
        this.lookup(abs, 'lstat');
        return abs;
    }

    // ───────────── Metadata mutators (no-ops in-memory) ──────────────────────

    chmodSync(path: string, mode: number): void {
        const node = this.lookup(path, 'chmod');
        node.mode = (node.mode & ~0o7777) | (mode & 0o7777);
        node.ctimeMs = now();
    }

    chownSync(path: string, uid: number, gid: number): void {
        const node = this.lookup(path, 'chown');
        node.uid = uid;
        node.gid = gid;
        node.ctimeMs = now();
    }

    utimesSync(path: string, atime: number, mtime: number): void {
        const node = this.lookup(path, 'utimes');
        node.atimeMs = atime;
        node.mtimeMs = mtime;
        node.ctimeMs = now();
    }

    // ───────────── File descriptors (minimal) ────────────────────────────────

    openSync(path: string, flags: string, mode = 0o666): number {
        const abs = resolve(path);
        const wantCreate = flags.includes('w') || flags.includes('a') || flags.includes('x');
        const wantTruncate = flags === 'w' || flags === 'w+';
        const exclusive = flags.includes('x');
        let node: FileNode;
        try {
            const existing = this.lookup(abs, 'open');
            if (existing.kind !== 'file') throw EISDIR('open', abs);
            if (exclusive) throw EEXIST('open', abs);
            node = existing;
            if (wantTruncate) { node.data = EMPTY; node.mtimeMs = node.ctimeMs = now(); }
        } catch (e) {
            if ((e as { code?: string }).code !== 'ENOENT' || !wantCreate) throw e;
            const { parent, name } = this.lookupParent(abs, 'open');
            node = this.mkNode('file', mode) as FileNode;
            parent.children.set(name, node);
            parent.mtimeMs = parent.ctimeMs = now();
        }
        const fd = this.nextFd++;
        this.fds.set(fd, { node, path: abs, position: flags.includes('a') ? node.data.byteLength : 0, flags });
        return fd;
    }

    closeSync(fd: number): void {
        if (!this.fds.delete(fd)) throw EBADF('close');
    }

    readSync(fd: number, buf: Uint8Array, offset: number, length: number, position: number | null): number {
        const entry = this.fds.get(fd);
        if (!entry) throw EBADF('read');
        const pos = position ?? entry.position;
        const data = entry.node.data;
        const read = Math.max(0, Math.min(pos + length, data.byteLength) - pos);
        if (read > 0) buf.set(data.subarray(pos, pos + read), offset);
        if (position === null) entry.position += read;
        entry.node.atimeMs = now();
        return read;
    }

    writeSync(fd: number, buf: Uint8Array, offset: number, length: number, position: number | null): number {
        const entry = this.fds.get(fd);
        if (!entry) throw EBADF('write');
        const pos = position ?? entry.position;
        const slice = buf.subarray(offset, offset + length);
        const end = pos + slice.byteLength;
        if (end > entry.node.data.byteLength) {
            const grown = new Uint8Array(end);
            grown.set(entry.node.data, 0);
            entry.node.data = grown;
        }
        entry.node.data.set(slice, pos);
        if (position === null) entry.position = end;
        entry.node.mtimeMs = entry.node.ctimeMs = now();
        return slice.byteLength;
    }

    // ───────────── Serialisation helpers (memfs parity) ──────────────────────

    /** Snapshot the volume as a memfs-shaped `DirectoryJSON`. */
    toJSON(): Record<string, string | null> {
        const out: Record<string, string | null> = {};
        const walk = (node: DirNode, prefix: string): void => {
            if (node.children.size === 0 && prefix !== '/') out[prefix] = null;
            for (const [name, child] of node.children) {
                const sub = prefix === '/' ? '/' + name : prefix + '/' + name;
                if (child.kind === 'dir') walk(child, sub);
                else if (child.kind === 'file') out[sub] = new TextDecoder().decode(child.data);
                else out[sub] = `[symlink → ${child.target}]`;
            }
        };
        walk(this.root, '/');
        return out;
    }

    /** Seed the volume from a flat `path -> content` map (memfs parity). */
    fromJSON(json: Record<string, string | Uint8Array | null>, cwd = '/'): void {
        for (const [path, content] of Object.entries(json)) {
            const abs = resolve(cwd, path);
            this.mkdirSync(dirname(abs), { recursive: true });
            if (content === null) {
                try { this.mkdirSync(abs, { recursive: true }); } catch { /* exists */ }
            } else {
                const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
                this.writeFileSync(abs, bytes);
            }
        }
    }

    /** Wipe all state. */
    reset(): void {
        this.root.children.clear();
        this.fds.clear();
        this.nextIno = 2;
        this.nextFd = 3;
    }
}

/** The process-wide default volume. */
export const __defaultVolume = new Volume();

/** Normalise an input path (string | Buffer | URL) plus apply `resolve`. */
export function absolutise(p: unknown): string {
    if (typeof p === 'string') return resolve(normalize(p));
    if (p instanceof URL) {
        if (p.protocol !== 'file:') throw new TypeError(`unsupported URL scheme: ${p.protocol}`);
        return resolve(decodeURIComponent(p.pathname));
    }
    if (p && typeof (p as { toString: () => string }).toString === 'function') {
        return resolve((p as { toString: () => string }).toString());
    }
    throw new TypeError('path must be a string, Buffer, or URL');
}
