// `GLib.Error`, `Gtk.DialogError` and `Gio.IOErrorEnum`, renderer-free — ADR 0100 § 5. Every
// rejection of the file-chooser subset is one of these, so `e instanceof GLib.Error` and
// `e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED)` hold as they do on GJS.
//
// A TRUE SUBSET of what GJS gives: `domain` is a number (a quark), `code` and `message` are read
// back, `matches(domain, code)` takes the enum object or its quark, and `toString()` names the
// domain as GJS does. As on GJS, a `GLib.Error` is not `instanceof Error`. The quark helpers,
// `new_literal` and `copy` throw by name. The enums carry the members the subset raises, no more.
//
// Reference: gjs gi/gerror.cpp, glib glib/gerror.c, gio gio/gioenums.h, gtk gtk/gtkdialogerror.h
// Copyright (c) GNOME contributors (GJS, GLib, GTK). MIT OR LGPLv2+ (GJS), LGPLv2.1+.

import { UnsupportedGObjectError } from './gobject.js';

function refuse(feature: string): UnsupportedGObjectError {
    return new UnsupportedGObjectError(feature, `${feature} is outside the GLib.Error subset (ADR 0100 § 5).`);
}

interface Domain {
    readonly quark: number;
    readonly name: string;
}

const DOMAINS = new WeakMap<object, Domain>();
const BY_QUARK = new Map<number, Domain>();

function errorDomain<T extends Record<string, number>>(name: string, quark: number, members: T): Readonly<T> {
    const domain = Object.freeze({ ...members });
    const info = { quark, name };
    DOMAINS.set(domain, info);
    BY_QUARK.set(quark, info);
    return domain;
}

/** `Gtk.DialogError`: what `Gtk.FileDialog` rejects with. A user closing the dialog is `DISMISSED`. */
export const DialogError = errorDomain('Gtk.DialogError', 1001, { FAILED: 0, CANCELLED: 1, DISMISSED: 2 });

/** `Gio.IOErrorEnum`, the codes the `Gio.File` subset raises. */
export const IOErrorEnum = errorDomain('Gio.IOErrorEnum', 1002, {
    FAILED: 0,
    NOT_FOUND: 1,
    NOT_SUPPORTED: 15,
    CLOSED: 18,
    CANCELLED: 19,
    PENDING: 20,
});

function domainOf(domain: unknown): Domain {
    const info =
        typeof domain === 'number'
            ? BY_QUARK.get(domain)
            : domain !== null && typeof domain === 'object'
              ? DOMAINS.get(domain)
              : undefined;
    if (!info) throw refuse(`GLib.Error domain ${String(domain)}`);
    return info;
}

export class GLibError {
    readonly domain: number;
    readonly code: number;
    readonly message: string;
    readonly stack: string;

    constructor(domain: unknown, code: number, message: string) {
        this.domain = domainOf(domain).quark;
        this.code = code;
        this.message = String(message);
        this.stack = new Error(this.message).stack ?? '';
    }

    matches(domain: unknown, code: number): boolean {
        return domainOf(domain).quark === this.domain && code === this.code;
    }

    toString(): string {
        return `${domainOf(this.domain).name}: ${this.message}`;
    }

    static new_literal(): never {
        throw refuse('GLib.Error.new_literal()');
    }

    copy(): never {
        throw refuse('GLib.Error.copy()');
    }
}

/** `error` as it reaches a caller: a `GLib.Error` passes through, anything else becomes `code` in `domain`. */
export function asGLibError(error: unknown, domain: object, code: number): GLibError {
    if (error instanceof GLibError) return error;
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return new GLibError(domain, code, message);
}
