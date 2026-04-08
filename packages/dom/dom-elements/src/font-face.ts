// FontFace stub for GJS — prevents crashes in libraries that load custom fonts.
// On GJS, custom TTF fonts cannot be loaded via the FontFace API; Excalibur and
// similar libraries fall back to their built-in pixel/raster fonts gracefully.
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

    async load(): Promise<FontFace> {
        this.status = 'loaded';
        return this;
    }
}

/**
 * FontFaceSet stub — intentionally does NOT extend EventTarget. The dom-elements
 * /register module runs before dom-events/register in the inject order, so
 * EventTarget may not yet exist when this class is defined at module load time.
 * All methods are no-ops; consumers that call addEventListener('loadingdone')
 * etc. will silently receive nothing, which is fine for libraries that treat
 * font loading as best-effort.
 */
export class FontFaceSet {
    status: 'loading' | 'loaded' = 'loaded';
    ready: Promise<FontFaceSet> = Promise.resolve(this);

    addEventListener(_type: string, _listener: unknown): void {}
    removeEventListener(_type: string, _listener: unknown): void {}
    dispatchEvent(_event: unknown): boolean { return true; }

    add(_face: FontFace): FontFaceSet { return this; }
    delete(_face: FontFace): boolean { return false; }
    clear(): void {}
    has(_face: FontFace): boolean { return false; }
    check(_font: string, _text?: string): boolean { return false; }
    load(_font: string, _text?: string): Promise<FontFace[]> { return Promise.resolve([]); }
    forEach(_callback: (value: FontFace, key: FontFace, parent: FontFaceSet) => void): void {}
    values(): IterableIterator<FontFace> { return [][Symbol.iterator]() as any; }
    keys(): IterableIterator<FontFace> { return [][Symbol.iterator]() as any; }
    entries(): IterableIterator<[FontFace, FontFace]> { return [][Symbol.iterator]() as any; }
    [Symbol.iterator](): Iterator<FontFace> { return [][Symbol.iterator](); }
    get size(): number { return 0; }
}
