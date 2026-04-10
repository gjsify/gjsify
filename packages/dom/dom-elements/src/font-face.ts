// FontFace implementation for GJS — registers custom TTF fonts in PangoCairo
// so that Canvas2D fillText uses the correct font family.
//
// Flow (Excalibur): XHR(blob) → /tmp/gjsify-blob-N.ttf → createObjectURL →
//   new FontFace(family, 'url(file:///tmp/gjsify-blob-N.ttf)') → face.load()
// The file is already on disk when load() is called; we just tell PangoCairo
// about it via font_map_get_default().add_font_file(path).
//
// Node.js: dynamic gi:// import fails gracefully → status='loaded' still set.
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
        // Strip file:// prefix → /path/to/file.ttf
        return m[1].replace(/^file:\/\//, '');
    }

    async load(): Promise<FontFace> {
        this.status = 'loading';
        const filePath = this._extractFilePath();
        if (filePath) {
            try {
                // gi:// only available in GJS — fails gracefully on Node.js
                // @ts-ignore
                const { default: PangoCairo } = await import('gi://PangoCairo?version=1.0');
                PangoCairo.font_map_get_default().add_font_file(filePath);
            } catch {
                // Not in GJS, or font file not found — fall through to loaded
                // Canvas fillText will use system font fallback (acceptable)
            }
        }
        this.status = 'loaded';
        return this;
    }
}

/**
 * FontFaceSet — tracks loaded FontFace objects and exposes them to consumers.
 *
 * Intentionally does NOT extend EventTarget. The dom-elements /register module
 * runs before dom-events/register in the inject order, so EventTarget may not
 * yet exist when this class is defined at module load time. All event methods
 * are provided as no-ops; consumers that call addEventListener('loadingdone')
 * etc. will silently receive nothing.
 */
export class FontFaceSet {
    status: 'loading' | 'loaded' = 'loaded';
    ready: Promise<FontFaceSet> = Promise.resolve(this);

    private _faces = new Set<FontFace>();

    addEventListener(_type: string, _listener: unknown): void {}
    removeEventListener(_type: string, _listener: unknown): void {}
    dispatchEvent(_event: unknown): boolean { return true; }

    add(face: FontFace): FontFaceSet {
        this._faces.add(face);
        return this;
    }
    delete(face: FontFace): boolean { return this._faces.delete(face); }
    clear(): void { this._faces.clear(); }
    has(face: FontFace): boolean { return this._faces.has(face); }
    check(_font: string, _text?: string): boolean { return false; }
    load(_font: string, _text?: string): Promise<FontFace[]> { return Promise.resolve([]); }
    forEach(callback: (value: FontFace, key: FontFace, parent: FontFaceSet) => void): void {
        this._faces.forEach(f => callback(f, f, this));
    }
    values(): IterableIterator<FontFace> { return this._faces.values(); }
    keys(): IterableIterator<FontFace> { return this._faces.values(); }
    entries(): IterableIterator<[FontFace, FontFace]> {
        const faces = Array.from(this._faces);
        return faces.map(f => [f, f] as [FontFace, FontFace])[Symbol.iterator]() as IterableIterator<[FontFace, FontFace]>;
    }
    [Symbol.iterator](): Iterator<FontFace> { return this._faces[Symbol.iterator](); }
    get size(): number { return this._faces.size; }
}
