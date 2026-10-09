// The clipboard slice of `Gdk`, renderer-free: `Display.get_default()` / `get_clipboard()`,
// `Clipboard.set_content` / `set`, `ContentProvider.new_for_value` and `ContentFormats` — ADR 0096
// Amendment 2. A TRUE SUBSET of `gi://Gdk?version=4.0`: the names and semantics are GDK's and a
// later stage only adds members. What GDK has and this does not (`Clipboard.read_text_async`,
// `get_content`, the primary selection, non-string values) is not defined here.
//
// WHAT THE HOST DOES: GDK keeps the provider locally and publishes it to the platform clipboard.
// The local half is here; the publish is the {@link ClipboardHost} a port hands in (a browser's
// async Clipboard API or the `copy` event's `clipboardData`, Android's `ClipboardManager`). A host
// that throws or rejects is logged as a warning; the local content stays, as it does when GDK
// cannot reach a selection owner.
//
// Reference: gtk gdk/gdkclipboard.c, gdk/gdkcontentprovider.c, gdk/gdkcontentformats.c
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import { readValue, TYPE_STRING, Value, type GType } from './gobject.js';

/** How a port publishes text to the platform clipboard. */
export interface ClipboardHost {
    writeText(text: string): void | Promise<void>;
}

const STRING_MIME_TYPES = ['text/plain;charset=utf-8', 'text/plain'] as const;

export class ContentFormats {
    readonly #types: readonly GType[];
    readonly #mimeTypes: readonly string[];

    constructor(types: readonly GType[], mimeTypes: readonly string[]) {
        this.#types = types;
        this.#mimeTypes = mimeTypes;
    }

    to_string(): string {
        return [...this.#types.map((type) => type.name), ...this.#mimeTypes].join(' ');
    }

    contain_gtype(type: GType): boolean {
        return this.#types.includes(type);
    }

    contain_mime_type(mimeType: string): boolean {
        return this.#mimeTypes.includes(mimeType);
    }
}

export class ContentProvider {
    readonly #type: GType;
    readonly #string: string | null;

    private constructor(type: GType, string: string | null) {
        this.#type = type;
        this.#string = string;
    }

    /** Copies `value` now; later changes to it do not reach the provider. `null` for an uninitialised value. */
    static new_for_value(value: unknown): ContentProvider | null {
        const state = readValue(value);
        return state ? new ContentProvider(state.type, state.string) : null;
    }

    ref_formats(): ContentFormats {
        return new ContentFormats([this.#type], []);
    }

    /** @internal */
    static text(provider: ContentProvider): string | null {
        return provider.#string;
    }
}

const EMPTY_FORMATS = new ContentFormats([], []);

export class Clipboard {
    readonly #host: ClipboardHost;
    #provider: ContentProvider | null = null;

    /** @internal */
    constructor(host: ClipboardHost) {
        this.#host = host;
    }

    set_content(provider: ContentProvider | null): boolean {
        this.#provider = provider;
        const text = provider ? ContentProvider.text(provider) : null;
        if (text !== null) this.#publish(text);
        return true;
    }

    set(text: string): void {
        this.set_content(ContentProvider.new_for_value(stringValue(text)));
    }

    get_formats(): ContentFormats {
        if (!this.#provider) return EMPTY_FORMATS;
        const own = this.#provider.ref_formats();
        return own.contain_gtype(TYPE_STRING) ? new ContentFormats([TYPE_STRING], STRING_MIME_TYPES) : own;
    }

    #publish(text: string): void {
        try {
            const pending = this.#host.writeText(text);
            if (pending && typeof pending.then === 'function') {
                pending.then(undefined, (error: unknown) => console.warn('Gdk.Clipboard: publishing failed:', error));
            }
        } catch (error) {
            console.warn('Gdk.Clipboard: publishing failed:', error);
        }
    }
}

export class Display {
    readonly #clipboard: Clipboard;

    /** @internal */
    constructor(host: ClipboardHost) {
        this.#clipboard = new Clipboard(host);
    }

    get_clipboard(): Clipboard {
        return this.#clipboard;
    }
}

/** `Gdk` as far as this subset goes. */
export interface GdkClipboard {
    readonly Display: { get_default(): Display };
    readonly Clipboard: typeof Clipboard;
    readonly ContentProvider: Pick<typeof ContentProvider, 'new_for_value'>;
    readonly ContentFormats: typeof ContentFormats;
}

/** A port is always on a display, so `get_default()` is never null (real GDK: null before `Gtk.init`). */
export function createGdk(host: ClipboardHost): GdkClipboard {
    const display = new Display(host);
    return {
        Display: { get_default: () => display },
        Clipboard,
        ContentProvider,
        ContentFormats,
    };
}

function stringValue(text: string): Value {
    const value = new Value().init(TYPE_STRING);
    value.set_string(text);
    return value;
}

/**
 * `Gtk.Widget.get_display()` and `get_clipboard()`, for a port to put on the widgets of a registered
 * class. A widget on a port is always on the one display; both are GTK's names and return what
 * GTK returns for a realized widget.
 */
export function widgetDisplayMembers(gdk: GdkClipboard): { get_display(): Display; get_clipboard(): Clipboard } {
    return {
        get_display: () => gdk.Display.get_default(),
        get_clipboard: () => gdk.Display.get_default().get_clipboard(),
    };
}
