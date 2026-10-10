// `GObject.Value` (string), `Gdk.ContentProvider.new_for_value` and `Gdk.Clipboard.set_content` as
// observable behaviour — the calls Learn6502's source view makes to replace the default copy.
//
// A vector is a program written against the namespaces and the data it must leave behind. The SAME
// vectors run on real `gi://Gdk` (the ORACLE: a vector that fails there is wrong, never a port bug),
// on the core, and on each port's `Gdk` door. A vector that needs a display is skipped by the driver
// when the subject has none (real GDK has no display on a headless CI runner).
//
// Vectors avoid what makes GLib log a CRITICAL (re-initialising a Value, reading an uninitialised
// one): the oracle must run quietly.

import type { ConstructHarness } from './constructs.js';

interface ValueLike {
    init(type: unknown): ValueLike;
    set_string(value: string | null): void;
    get_string(): string | null;
}

interface FormatsLike {
    to_string(): string;
    contain_gtype(type: unknown): boolean;
    contain_mime_type(mimeType: string): boolean;
}

interface ProviderLike {
    ref_formats(): FormatsLike;
}

interface ClipboardLike {
    set_content(provider: ProviderLike | null): boolean;
    set(text: string): void;
    get_formats(): FormatsLike;
}

/** The parts of `GObject` and `Gdk` the vectors read. */
export interface GdkClipboardNamespaces {
    readonly GObject: {
        readonly TYPE_STRING: unknown;
        readonly TYPE_INT: unknown;
        readonly Value: new () => ValueLike;
    };
    readonly Gdk: {
        readonly Display: { get_default(): { get_clipboard(): ClipboardLike } | null };
        readonly ContentProvider: { new_for_value(value: ValueLike): ProviderLike | null };
    };
}

/** What a driver hands the vectors. */
export interface GdkClipboardSubject extends GdkClipboardNamespaces {
    readonly name: string;
    readonly isOracle: boolean;
    /** Whether `Gdk.Display.get_default()` is a display; false skips the vectors that need one. */
    readonly display: boolean;
    /** The text the clipboard now holds as the platform would see it, or null when it holds none. */
    readBack(): Promise<string | null>;
}

export const GDK_CLIPBOARD_ROWS = ['value', 'provider', 'formats', 'set-content', 'set', 'clear', 'display'] as const;

export type GdkClipboardRow = (typeof GDK_CLIPBOARD_ROWS)[number];

export interface GdkClipboardVector {
    readonly row: GdkClipboardRow;
    readonly rule: string;
    readonly needsDisplay?: boolean;
    readonly observe: (subject: GdkClipboardSubject) => unknown;
    readonly shows: unknown;
}

function stringValue({ GObject }: GdkClipboardNamespaces, text: string): ValueLike {
    const value = new GObject.Value();
    value.init(GObject.TYPE_STRING);
    value.set_string(text);
    return value;
}

function throws(fn: () => void): boolean {
    try {
        fn();
        return false;
    } catch {
        return true;
    }
}

export const GDK_CLIPBOARD_VECTORS: readonly GdkClipboardVector[] = [
    {
        row: 'value',
        rule: 'a string Value gives back what was set, spaces and newlines included',
        observe: (subject) => stringValue(subject, 'a b\nc').get_string(),
        shows: 'a b\nc',
    },
    {
        row: 'value',
        rule: 'an initialised string Value holds null until it is set, and null can be set back',
        observe: ({ GObject }) => {
            const value = new GObject.Value();
            value.init(GObject.TYPE_STRING);
            const first = value.get_string();
            value.set_string('x');
            value.set_string(null);
            return [first, value.get_string()];
        },
        shows: [null, null],
    },
    {
        row: 'value',
        rule: 'set_string refuses a non-string argument',
        observe: ({ GObject }) => {
            const value = new GObject.Value();
            value.init(GObject.TYPE_STRING);
            return throws(() => value.set_string(3 as unknown as string));
        },
        shows: true,
    },
    {
        row: 'provider',
        rule: 'new_for_value copies the Value: changing it afterwards leaves the provider alone',
        needsDisplay: true,
        async observe(subject) {
            const value = stringValue(subject, 'before');
            const provider = subject.Gdk.ContentProvider.new_for_value(value);
            value.set_string('after');
            subject.Gdk.Display.get_default()?.get_clipboard().set_content(provider);
            return subject.readBack();
        },
        shows: 'before',
    },
    {
        row: 'formats',
        rule: 'a string provider offers gchararray and no mime type of its own',
        observe: (subject) => {
            const formats = subject.Gdk.ContentProvider.new_for_value(stringValue(subject, 'x'))?.ref_formats();
            return [
                formats?.to_string(),
                formats?.contain_gtype(subject.GObject.TYPE_STRING),
                formats?.contain_gtype(subject.GObject.TYPE_INT),
                formats?.contain_mime_type('text/plain'),
            ];
        },
        shows: ['gchararray', true, false, false],
    },
    {
        row: 'set-content',
        rule: 'set_content returns true and the clipboard then holds the text and offers it as plain text',
        needsDisplay: true,
        async observe(subject) {
            const clipboard = subject.Gdk.Display.get_default()!.get_clipboard();
            const ok = clipboard.set_content(
                subject.Gdk.ContentProvider.new_for_value(stringValue(subject, 'héllo 世界')),
            );
            const formats = clipboard.get_formats();
            return [
                ok,
                await subject.readBack(),
                formats.to_string(),
                formats.contain_gtype(subject.GObject.TYPE_STRING),
                formats.contain_mime_type('text/plain'),
            ];
        },
        shows: [true, 'héllo 世界', 'gchararray text/plain;charset=utf-8 text/plain', true, true],
    },
    {
        row: 'set',
        rule: 'clipboard.set(text) replaces the content with the text',
        needsDisplay: true,
        async observe(subject) {
            const clipboard = subject.Gdk.Display.get_default()!.get_clipboard();
            clipboard.set_content(subject.Gdk.ContentProvider.new_for_value(stringValue(subject, 'old')));
            clipboard.set('new');
            return subject.readBack();
        },
        shows: 'new',
    },
    {
        row: 'clear',
        rule: 'set_content(null) returns true and leaves no formats',
        needsDisplay: true,
        observe(subject) {
            const clipboard = subject.Gdk.Display.get_default()!.get_clipboard();
            clipboard.set_content(subject.Gdk.ContentProvider.new_for_value(stringValue(subject, 'x')));
            return [clipboard.set_content(null), clipboard.get_formats().to_string()];
        },
        shows: [true, ''],
    },
    {
        row: 'display',
        rule: 'get_clipboard returns the same clipboard each time',
        needsDisplay: true,
        observe({ Gdk }) {
            const display = Gdk.Display.get_default()!;
            return display.get_clipboard() === display.get_clipboard();
        },
        shows: true,
    },
];

export async function driveGdkClipboardVectors(
    subject: GdkClipboardSubject,
    harness: ConstructHarness,
    vectors: readonly GdkClipboardVector[] = GDK_CLIPBOARD_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: Gdk clipboard`, async () => {
        for (const vector of vectors) {
            if (vector.needsDisplay && !subject.display) continue;
            await it(`${vector.row}: ${vector.rule}`, async () => {
                const observed = await vector.observe(subject);
                expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
