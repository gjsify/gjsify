// The platform-facing slice of `Gtk` / `Gdk`, renderer-free: `Gtk.CssProvider`, `Gtk.StyleContext`
// (`add_provider_for_display` / `remove_provider_for_display`), `Gtk.Settings` (`gtk_font_name`),
// `Gtk.IconTheme` (its resource path and `changed`), `Gtk.show_uri`, `Gtk.EventControllerKey` with
// `add_controller`, and the `Gdk.KEY_*` keysyms. A TRUE SUBSET of GTK 4: the names and semantics are
// GTK's, and what is not defined here is absent.
//
// WHAT THE HOST DOES: everything GTK would hand to the display server. The behaviour (provider
// bookkeeping, priority order, key translation, the `key-pressed` return value) is here once; a port
// hands in a {@link PlatformHost} (a `<style>` element and `window.open` in a browser,
// `Application` CSS and `Utils.openUrl` on NativeScript).
//
// Reference: gtk gtk/gtkcssprovider.c, gtk/gtkstylecontext.c, gtk/gtkeventcontrollerkey.c, gtk/gtkshow.c,
// gtk/gtkicontheme.c
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

/** What a key event carries into {@link EventControllerKey}. `key` is a DOM `KeyboardEvent.key`. */
export interface HostKeyEvent {
    readonly key: string;
    readonly keycode: number;
    /** `Gdk.ModifierType` bits. */
    readonly state: number;
    readonly pressed: boolean;
}

/** How a port reaches the platform. Every member may be absent on a platform that has no such thing. */
export interface PlatformHost {
    /** Replaces the style sheet of `owner`; an empty list removes it. The host orders by priority. */
    setStyles(sheets: readonly { owner: object; css: string; priority: number }[]): void;
    openUri(uri: string): void;
    /** The system UI font as `"Name Size"`, or `null` when the platform does not say. */
    fontName(): string | null;
    /** Listens for keys on `widget`; `handler` returns whether it handled the key. */
    listenKeys(widget: object, handler: (event: HostKeyEvent) => boolean): () => void;
}

export const STYLE_PROVIDER_PRIORITY_FALLBACK = 1;
export const STYLE_PROVIDER_PRIORITY_THEME = 200;
export const STYLE_PROVIDER_PRIORITY_SETTINGS = 400;
export const STYLE_PROVIDER_PRIORITY_APPLICATION = 600;
export const STYLE_PROVIDER_PRIORITY_USER = 800;

/** `Gdk.CURRENT_TIME`. */
export const CURRENT_TIME = 0;

/** The X11 keysyms (`Gdk.KEY_*`) an application writes a key map in; the numbers are GDK's. */
export const GDK_KEYS = Object.freeze({
    KEY_space: 0x20,
    KEY_a: 0x61,
    KEY_d: 0x64,
    KEY_e: 0x65,
    KEY_q: 0x71,
    KEY_s: 0x73,
    KEY_w: 0x77,
    KEY_Return: 0xff0d,
    KEY_Escape: 0xff1b,
    KEY_Left: 0xff51,
    KEY_Up: 0xff52,
    KEY_Right: 0xff53,
    KEY_Down: 0xff54,
    /** XF86Back: the hardware / mouse back key, and what Android's back button is delivered as. */
    KEY_Back: 0x1008ff26,
} as const);

const NAMED_KEYS: Readonly<Record<string, number>> = {
    ' ': GDK_KEYS.KEY_space,
    Enter: GDK_KEYS.KEY_Return,
    Escape: GDK_KEYS.KEY_Escape,
    ArrowLeft: GDK_KEYS.KEY_Left,
    ArrowUp: GDK_KEYS.KEY_Up,
    ArrowRight: GDK_KEYS.KEY_Right,
    ArrowDown: GDK_KEYS.KEY_Down,
    BrowserBack: GDK_KEYS.KEY_Back,
};

/** A DOM `key` as the keysym GTK would deliver: a Latin-1 character is its own code point, lowercased. */
export function keyvalOfKey(key: string): number {
    const named = NAMED_KEYS[key];
    if (named !== undefined) return named;
    const [first] = Array.from(key);
    if (first === undefined || key.length > 2) return 0;
    const code = first.toLowerCase().codePointAt(0) ?? 0;
    return code >= 0x20 && code <= 0xff ? code : 0x1000000 + code;
}

/** `Gtk.CssProvider`: `load_from_string` is the one loader the subset carries. */
export class CssProvider {
    #css = '';
    #onChange: (() => void) | null = null;

    load_from_string(css: string): void {
        this.#css = String(css);
        this.#onChange?.();
    }

    to_string(): string {
        return this.#css;
    }

    /** @internal */
    static bind(provider: CssProvider, onChange: (() => void) | null): void {
        provider.#onChange = onChange;
    }
}

interface Attached {
    readonly provider: CssProvider;
    readonly priority: number;
}

class StyleBook {
    readonly #host: PlatformHost;
    readonly #attached: Attached[] = [];

    constructor(host: PlatformHost) {
        this.#host = host;
    }

    add(provider: CssProvider, priority: number): void {
        this.remove(provider, false);
        this.#attached.push({ provider, priority });
        CssProvider.bind(provider, () => this.#publish());
        this.#publish();
    }

    remove(provider: CssProvider, publish = true): void {
        const index = this.#attached.findIndex((entry) => entry.provider === provider);
        if (index < 0) return;
        this.#attached.splice(index, 1);
        CssProvider.bind(provider, null);
        if (publish) this.#publish();
    }

    #publish(): void {
        // Stable: equal priorities keep the order they were added in, as GTK applies them.
        const ordered = this.#attached
            .map((entry, order) => ({ entry, order }))
            .sort((a, b) => a.entry.priority - b.entry.priority || a.order - b.order);
        this.#host.setStyles(
            ordered.map(({ entry }) => ({
                owner: entry.provider,
                css: entry.provider.to_string(),
                priority: entry.priority,
            })),
        );
    }
}

/** `Gtk.Settings`: `gtk_font_name`, held once written. */
export class GtkSettings {
    readonly #host: PlatformHost;
    #fontName: string | null | undefined;

    /** @internal */
    constructor(host: PlatformHost) {
        this.#host = host;
    }

    get gtk_font_name(): string | null {
        return this.#fontName === undefined ? this.#host.fontName() : this.#fontName;
    }

    set gtk_font_name(name: string | null) {
        this.#fontName = name;
    }
}

/**
 * `Gtk.IconTheme`: the resource paths and the `changed` signal; `icon-theme-resources.ts` is the
 * lookup over them. As in gtkicontheme.c a path change drops the scan and queues `changed` only
 * when a lookup has scanned since the last change, and `changed` runs on a later task (GTK: idle).
 */
export class IconTheme {
    #paths: string[] | null = ['/org/gtk/libgtk/icons/'];
    #scanned = false;
    #serial = 0;
    #queued = false;
    readonly #handlers = new Map<number, (theme: IconTheme) => void>();
    #next = 1;

    set_resource_path(path: readonly string[] | null): void {
        this.#paths = path === null ? null : [...path];
        if (this.#scanned) {
            this.#scanned = false;
            this.#serial++;
            this.#queueChanged();
        }
    }

    /** Appends, as GTK does: a path added twice is scanned twice. */
    add_resource_path(path: string): void {
        if (typeof path !== 'string') throw new TypeError('Gtk.IconTheme.add_resource_path: path must not be null');
        this.set_resource_path([...(this.#paths ?? []), path]);
    }

    get_resource_path(): string[] | null {
        return this.#paths === null ? null : [...this.#paths];
    }

    connect(signal: string, handler: (theme: IconTheme) => void): number {
        if (signal !== 'changed') throw new Error(`No signal '${signal}' on object 'GtkIconTheme'`);
        const id = this.#next++;
        this.#handlers.set(id, handler);
        return id;
    }

    disconnect(id: number): void {
        if (!this.#handlers.delete(id)) throw new Error(`No handler with id ${id} is connected to ${String(this)}`);
    }

    #queueChanged(): void {
        if (this.#queued) return;
        this.#queued = true;
        setTimeout(() => {
            this.#queued = false;
            for (const handler of Array.from(this.#handlers.values())) handler(this);
        }, 0);
    }

    /**
     * @internal Marks the theme scanned and answers the scan generation: a cached scan is valid
     * while the serial it was built at is still the current one.
     */
    static scan(theme: IconTheme): number {
        theme.#scanned = true;
        return theme.#serial;
    }
}

type KeyHandler = (controller: EventControllerKey, keyval: number, keycode: number, state: number) => boolean | void;

/** `Gtk.EventControllerKey`: `key-pressed` and `key-released`, the first one's return value counts. */
export class EventControllerKey {
    readonly #handlers = new Map<number, { signal: string; handler: KeyHandler }>();
    #next = 1;
    #detach: (() => void) | null = null;

    connect(signal: string, handler: KeyHandler): number {
        if (signal !== 'key-pressed' && signal !== 'key-released') {
            throw new Error(`No signal '${signal}' on object 'GtkEventControllerKey'`);
        }
        const id = this.#next++;
        this.#handlers.set(id, { signal, handler });
        return id;
    }

    disconnect(id: number): void {
        if (!this.#handlers.delete(id)) throw new Error(`No handler with id ${id} is connected to ${String(this)}`);
    }

    /** @internal */
    static attach(controller: EventControllerKey, detach: (() => void) | null): void {
        controller.#detach?.();
        controller.#detach = detach;
    }

    /** @internal Runs the handlers of one key event; true when one of them took the key. */
    static dispatch(controller: EventControllerKey, event: HostKeyEvent): boolean {
        const signal = event.pressed ? 'key-pressed' : 'key-released';
        const keyval = keyvalOfKey(event.key);
        let handled = false;
        for (const { signal: wanted, handler } of Array.from(controller.#handlers.values())) {
            if (wanted !== signal) continue;
            if (handler(controller, keyval, event.keycode, event.state) === true) {
                handled = true;
                break;
            }
        }
        return handled;
    }
}

/** `Gtk` and `Gdk` as far as this slice goes. */
export interface GtkPlatform {
    readonly CssProvider: typeof CssProvider;
    readonly StyleContext: {
        add_provider_for_display(display: unknown, provider: CssProvider, priority: number): void;
        remove_provider_for_display(display: unknown, provider: CssProvider): void;
    };
    readonly Settings: { get_default(): GtkSettings };
    readonly IconTheme: { get_for_display(display: unknown): IconTheme };
    readonly EventControllerKey: typeof EventControllerKey;
    show_uri(parent: unknown, uri: string, timestamp: number): void;
}

/** A port is always on a display, so `Settings.get_default()` is never null (real GTK: null before `Gtk.init`). */
export function createGtkPlatform(host: PlatformHost): GtkPlatform {
    const book = new StyleBook(host);
    const settings = new GtkSettings(host);
    const theme = new IconTheme();
    return {
        CssProvider,
        StyleContext: {
            add_provider_for_display: (_display, provider, priority) => book.add(provider, priority),
            remove_provider_for_display: (_display, provider) => book.remove(provider),
        },
        Settings: { get_default: () => settings },
        IconTheme: { get_for_display: () => theme },
        EventControllerKey,
        show_uri: (_parent, uri) => host.openUri(uri),
    };
}

const controllersOf = new WeakMap<object, Set<EventControllerKey>>();
const ownerOf = new WeakMap<EventControllerKey, object>();

function forget(controller: EventControllerKey): void {
    const owner = ownerOf.get(controller);
    if (owner) controllersOf.get(owner)?.delete(controller);
    ownerOf.delete(controller);
}

/**
 * Runs `event` through the key controllers attached to `widget`, as GTK does for a key the widget's
 * toplevel receives: the first controller whose `key-pressed` / `key-released` handler returns true
 * takes it. For keys the platform delivers by another road than the widget's own key listener (the
 * Android back button); the result is whether a controller handled it.
 */
export function deliverKeyToControllers(widget: object, event: HostKeyEvent): boolean {
    for (const controller of Array.from(controllersOf.get(widget) ?? [])) {
        if (EventControllerKey.dispatch(controller, event)) return true;
    }
    return false;
}

/** `Gtk.Widget.add_controller` / `remove_controller` for the widgets of a port. */
export function widgetControllerMembers(host: PlatformHost): {
    add_controller(this: object, controller: EventControllerKey): void;
    remove_controller(this: object, controller: EventControllerKey): void;
} {
    return {
        add_controller(this: object, controller) {
            forget(controller);
            EventControllerKey.attach(
                controller,
                host.listenKeys(this, (event) => EventControllerKey.dispatch(controller, event)),
            );
            let set = controllersOf.get(this);
            if (!set) controllersOf.set(this, (set = new Set()));
            set.add(controller);
            ownerOf.set(controller, this);
        },
        remove_controller(controller) {
            forget(controller);
            EventControllerKey.attach(controller, null);
        },
    };
}
