// Registers custom TTF fonts with PangoCairo so Canvas2D fillText picks up the right family. The
// font file is already on disk by the time load() runs (the blob URL path writes it), so load()
// only has to hand PangoCairo the path. On a runtime with no Pango (Node, a browser bundle) the
// registration is unavailable and status still becomes 'loaded'.
//
// THE REGISTRATION IS NOT LOCAL. It is `registerFontFaces` out of `@gjsify/utils/font-map` — the same
// call `@gjsify/gtk-host`'s `initFonts` uses, including the fontconfig fallback for a font map that
// DECLINES registration. This file used to call `add_font_file` on the default map and swallow the
// error, and on macOS that map is CoreText, which implements no `add_font_file` vfunc and answers
// `G_IO_ERROR_NOT_SUPPORTED` (ADR 0038 § Amendment 5): a Canvas `FontFace` there rendered in the
// fallback sans with nothing said, unless `initFonts()` happened to have run first. A second copy of
// the fallback is the shape AGENTS.md calls "duplication instead of a helper" — the copy fails in a
// CONSUMER while the owning package stays green.
//
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/FontFace

import GLib from 'gi://GLib?version=2.0';

import { fontMapHasFamily, registerFontFaces, type FontFaceRegistration } from '@gjsify/utils/font-map';

type FontFaceStatus = 'unloaded' | 'loading' | 'loaded' | 'error';

/**
 * Put font bytes where Pango can read them. `add_font_file` takes a PATH and keeps it for the life of
 * the process (fontconfig opens the file lazily), so the bytes cannot live in a temp file that is
 * removed at exit of `load()`. The name is the content hash, so the same bytes registered twice —
 * every start of the same app — reuse one file instead of growing the cache.
 */
function stageFontBytes(bytes: Uint8Array): string {
    const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'gjsify', 'fonts']);
    GLib.mkdir_with_parents(dir, 0o755);
    const otf = bytes.length > 4 && String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === 'OTTO';
    const name = `${GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, new GLib.Bytes(bytes))}${otf ? '.otf' : '.ttf'}`;
    const path = GLib.build_filenamev([dir, name]);
    if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
        // Written beside, then renamed, so a second process never reads a half-written face.
        const partial = `${path}.${GLib.get_monotonic_time()}.part`;
        GLib.file_set_contents(partial, bytes);
        GLib.rename(partial, path);
    }
    return path;
}

export class FontFace {
    readonly family: string;
    readonly source: string;
    status: FontFaceStatus = 'unloaded';
    loaded: Promise<FontFace>;
    display = 'auto';
    style = 'normal';
    weight = 'normal';
    stretch = 'normal';
    unicodeRange = 'U+0-10FFFF';
    variant = 'normal';
    featureSettings = 'normal';

    private readonly _bytes: Uint8Array | null;
    private _started: Promise<FontFace> | null = null;
    private _settle!: { resolve: (face: FontFace) => void; reject: (error: unknown) => void };

    constructor(family: string, source: string | ArrayBuffer | ArrayBufferView, _descriptors?: Record<string, string>) {
        this.family = family;
        this.source = typeof source === 'string' ? source : '[binary]';
        this.loaded = new Promise<FontFace>((resolve, reject) => {
            this._settle = { resolve, reject };
        });
        // `loaded` of a face nobody awaits must not surface as an unhandled rejection.
        this.loaded.catch(() => {});
        if (typeof source === 'string') {
            this._bytes = null;
        } else {
            this._bytes = ArrayBuffer.isView(source)
                ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
                : new Uint8Array(source);
            // The Web contract: a face built from bytes starts loading at once, no load() needed.
            void this.load();
        }
    }

    // Parses: url(file:///path), url("file:///path"), url('file:///path')
    private _extractFilePath(): string | null {
        const m = this.source.match(/url\s*\(\s*["']?(file:\/\/\/[^"')]+)["']?\s*\)/i);
        if (!m) return null;
        return decodeURIComponent(m[1].replace(/^file:\/\//, ''));
    }

    load(): Promise<FontFace> {
        this._started ??= this._load();
        return this._started;
    }

    private async _load(): Promise<FontFace> {
        this.status = 'loading';
        // Registration is synchronous, but the Web contract is that a face is `loading` until a task
        // later, so `document.fonts.ready` has something to wait for.
        await Promise.resolve();
        try {
            const filePath = this._bytes ? stageFontBytes(this._bytes) : this._extractFilePath();
            if (filePath) {
                const registration = registerFontFaces([filePath]);
                // Loud ONLY where a font map exists to have accepted it. A browser bundle has no Pango at
                // all and answers `FontFace` with its own machinery, so reporting there would print a font
                // warning per face in every web app; `available` is what separates the two, and it exists
                // for exactly this decision.
                if (registration.available) reportRegistration(this.family, registration);
            }
        } catch (error) {
            this.status = 'error';
            this._settle.reject(error);
            throw error;
        }
        this.status = 'loaded';
        this._settle.resolve(this);
        return this;
    }
}

/**
 * Say what a `FontFace.load()` actually achieved, because the alternative is the failure ADR 0038
 * exists against: Pango answers a family it does not hold with the default sans, it does not throw,
 * and the Canvas renders in the wrong typeface with every test green.
 *
 * A WARNING and never a rejection. The Web `FontFace` contract rejects on a failed load, and this
 * class has always resolved: `status` is the only signal it offers, the consumers are Canvas games
 * (Excalibur's `FontSource.load`) that treat a rejection as a crash, and taking a page down over a
 * decorative face is worse than the substitution. Loud is the part that was missing.
 *
 * FOUR OUTCOMES, and the third and fourth are the ones that render a working canvas and are still
 * wrong. The third is the Windows optical-size rename, where the face is on the map as
 * `Merriweather 18pt` and the name the page wrote (`Merriweather`) resolves to nothing. The fourth is
 * a face that IS under the name the page wrote and still is not used, because the font map had already
 * resolved that name to the fallback before the face arrived and caches the answer — `unreachable`.
 */
function reportRegistration(family: string, registration: FontFaceRegistration): void {
    for (const failure of registration.failed) {
        console.warn(
            `FontFace.load: ${failure.path} could not be read as a font (${failure.message}), so text ` +
                `asking for "${family}" will render in a substituted one.`,
        );
    }
    for (const path of registration.declined) {
        console.warn(
            `FontFace.load: no font map in this process would take ${path} — Pango answers a family it ` +
                `does not hold with the default sans, and nothing else says so. A shipped .app reaches ` +
                `its faces through ATSApplicationFontsPath; a bare \`gjsify run\` needs initFonts() first.`,
        );
    }
    // A face the map TOOK and still cannot serve: a different failure with a different remedy, so it
    // is reported here rather than through `declined` above. The face IS on the map and `get_family`
    // answers the family, so pointing at `ATSApplicationFontsPath` or at `initFonts()` would name the
    // one thing that has already happened. Where the fontconfig fallback took over this list is EMPTY
    // — that is the fix working — so a line here means the substitution is real and nothing in this
    // process was able to prevent it.
    for (const path of registration.unreachable) {
        console.warn(
            `FontFace.load: ${path} is registered and "${family}" is a family this font map holds, but ` +
                'text asking for it will still render in a substituted one: the map had already ' +
                'resolved that family to the fallback, and that cached answer cannot be asked again. ' +
                'Register the face before anything lays text out.',
        );
    }
    if (registration.registered.length === 0) return;
    // The face is on the map and the NAME is not, so `fillText` will substitute. Checked against the
    // map the registration landed on rather than the one it started from — a fontconfig fallback
    // replaces the default, and `registration.map` is the only value that knows which map answers now.
    if (registration.map === undefined) return;
    if (fontMapHasFamily(registration.map, family)) return;
    console.warn(
        `FontFace.load: ${registration.registered[0]} is registered, but "${family}" is not a family on ` +
            'the font map — it may be registered under a different name, and text asking for it will ' +
            'render in a substituted one.',
    );
}

/** The family names a CSS `font` shorthand (`12px "A B", sans-serif`) asks for, lower-cased. */
function requestedFamilies(font: string): string[] {
    const size = font.match(/\d(?:\.\d+)?(?:px|pt|em|rem|%)(?:\/\S+)?\s+(.+)$/i);
    const list = size ? size[1] : font;
    return list
        .split(',')
        .map((name) =>
            name
                .trim()
                .replace(/^["']|["']$/g, '')
                .toLowerCase(),
        )
        .filter((name) => name.length > 0);
}

/**
 * The faces a page registered, and what `ctx.font` can therefore draw. `add()` does not load a face
 * built from a URL (the Web contract: `load()` or the first use does); a face built from bytes is
 * already loading, and `ready` waits for it.
 *
 * Does not extend EventTarget: the event methods are no-ops, so a consumer listening for
 * 'loadingdone' silently receives nothing.
 */
export class FontFaceSet {
    private _faces = new Set<FontFace>();

    get status(): 'loading' | 'loaded' {
        for (const face of this._faces) if (face.status === 'loading') return 'loading';
        return 'loaded';
    }

    /** Resolves once every face that is loading NOW has settled; a failed face does not reject it. */
    get ready(): Promise<FontFaceSet> {
        const pending = Array.from(this._faces)
            .filter((face) => face.status === 'loading')
            .map((face) => face.loaded.catch(() => face));
        return Promise.all(pending).then(() => this);
    }

    addEventListener(_type: string, _listener: unknown): void {}
    removeEventListener(_type: string, _listener: unknown): void {}
    dispatchEvent(_event: unknown): boolean {
        return true;
    }

    add(face: FontFace): FontFaceSet {
        this._faces.add(face);
        return this;
    }
    delete(face: FontFace): boolean {
        return this._faces.delete(face);
    }
    clear(): void {
        this._faces.clear();
    }
    has(face: FontFace): boolean {
        return this._faces.has(face);
    }

    private _matching(font: string): FontFace[] {
        const wanted = requestedFamilies(font);
        return Array.from(this._faces).filter((face) => wanted.includes(face.family.toLowerCase()));
    }

    /** True when every face of this set that `font` names is loaded (a name not in the set is a system font). */
    check(font: string, _text?: string): boolean {
        return this._matching(font).every((face) => face.status === 'loaded');
    }
    /** Loads the faces of this set that `font` names and resolves with them. */
    load(font: string, _text?: string): Promise<FontFace[]> {
        const faces = this._matching(font);
        return Promise.all(faces.map((face) => face.load())).then(() => faces);
    }
    forEach(callback: (value: FontFace, key: FontFace, parent: FontFaceSet) => void): void {
        this._faces.forEach((f) => callback(f, f, this));
    }
    values(): IterableIterator<FontFace> {
        return this._faces.values();
    }
    keys(): IterableIterator<FontFace> {
        return this._faces.values();
    }
    entries(): IterableIterator<[FontFace, FontFace]> {
        const faces = Array.from(this._faces);
        return faces.map((f) => [f, f] as [FontFace, FontFace])[Symbol.iterator]() as IterableIterator<
            [FontFace, FontFace]
        >;
    }
    [Symbol.iterator](): Iterator<FontFace> {
        return this._faces[Symbol.iterator]();
    }
    get size(): number {
        return this._faces.size;
    }
}
