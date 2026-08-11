// Registers custom TTF fonts with PangoCairo so Canvas2D fillText picks up the right family. The
// font file is already on disk by the time load() runs (the blob URL path writes it), so load()
// only has to hand PangoCairo the path. On Node the dynamic gi:// import fails and status still
// becomes 'loaded'.
// Reference: https://developer.mozilla.org/en-US/docs/Web/API/FontFace

export class FontFace {
    readonly family: string;
    readonly source: string;
    status: 'unloaded' | 'loading' | 'loaded' | 'error' = 'unloaded';
    loaded: Promise<FontFace>;
    display = 'auto';
    style = 'normal';
    weight = 'normal';
    stretch = 'normal';
    unicodeRange = 'U+0-10FFFF';
    variant = 'normal';
    featureSettings = 'normal';

    constructor(family: string, source: string | ArrayBuffer | ArrayBufferView, _descriptors?: Record<string, string>) {
        this.family = family;
        this.source = typeof source === 'string' ? source : '[binary]';
        this.loaded = Promise.resolve(this);
    }

    // Parses: url(file:///path), url("file:///path"), url('file:///path')
    private _extractFilePath(): string | null {
        const m = this.source.match(/url\s*\(\s*["']?(file:\/\/\/[^"')]+)["']?\s*\)/i);
        if (!m) return null;
        return m[1].replace(/^file:\/\//, '');
    }

    async load(): Promise<FontFace> {
        this.status = 'loading';
        const filePath = this._extractFilePath();
        if (filePath) {
            try {
                // @ts-ignore — `gi://` specifiers exist only under GJS, so TS cannot resolve this.
                const { default: PangoCairo } = await import('gi://PangoCairo?version=1.0');
                PangoCairo.font_map_get_default().add_font_file(filePath);
            } catch {
                // Not GJS, or the file is gone: fall through to 'loaded' and let fillText use the
                // system font fallback.
            }
        }
        this.status = 'loaded';
        return this;
    }
}

/**
 * Tracks loaded FontFace objects and exposes them to consumers.
 *
 * Does not extend EventTarget: the event methods are no-ops, so a consumer listening for
 * 'loadingdone' silently receives nothing.
 */
export class FontFaceSet {
    status: 'loading' | 'loaded' = 'loaded';
    ready: Promise<FontFaceSet> = Promise.resolve(this);

    private _faces = new Set<FontFace>();

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
    check(_font: string, _text?: string): boolean {
        return false;
    }
    load(_font: string, _text?: string): Promise<FontFace[]> {
        return Promise.resolve([]);
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
