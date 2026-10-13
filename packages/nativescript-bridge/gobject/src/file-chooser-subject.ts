// `Gio.File`, `GLib.Bytes`, `GLib.Error` and the output stream on a real Gio as a conformance
// SUBJECT — ADR 0105 stage 3, the `Gio.File` half. `FILE_CHOOSER_VECTORS` (ADR 0100 § 6) were
// written against real GJS and run there as the ORACLE; this builds the subject that runs them
// against the same classes reached through node-gi, on Node and on a device.
//
// WHAT IS REAL AND WHAT IS NOT. The vectors are programs against `GLib`, `Gio` and `Gtk`. GLib and
// Gio are the real namespaces, always. The picker is the subject's by the vectors' own contract
// (GJS is the oracle for the SHAPE of results and errors, "not for the picker UI"): `open` and
// `save` resolve a real `Gio.File` under a temporary directory, or reject with a real
// `Gtk.DialogError.DISMISSED`, exactly as `adwaita-core/src/file-chooser.gjs.spec.ts` does.
//
// `Gtk` is real where the host has it. Android does not: the payload carries GLib, GObject and Gio
// only (`gi-runtime.json`), so there `requireGi('Gtk')` throws and the subject runs on a STAND-IN —
// `Gtk.FileFilter` as a GObject registered through the real `GObject.registerClass`, `FileDialog`
// as a plain class holding the properties ADR 0100 lists, and `Gtk.DialogError` as a GError domain
// built over a real quark. A stand-in cannot witness anything about GTK, so `rowsFor` drops the
// vectors whose subject IS GTK (`FileDialog`/`FileFilter` shape, the `Gtk.DialogError` values) and
// keeps all that is about Gio, GLib and the promise form — which is what the device owes a measurement.
//
// WHY `requireGi` IS A PARAMETER: `engine.ts`'s header.

import type { RequireGi } from './engine.js';

type Callback = (source: unknown, result: unknown) => void;
type Outcome = { file: unknown } | { error: unknown };

/** What the next `open`/`save` picks: a file named `basename` (holding `contents`, if given), or a dismissal. */
export type RealScriptedPick = { readonly basename: string; readonly contents?: Uint8Array } | null;

/** The `FileChooserSubject` of `@gjsify/adwaita-core/conformance`, restated structurally. */
export interface RealGioFileChooserSubject {
    readonly name: string;
    readonly isOracle: boolean;
    readonly GLib: any;
    readonly Gio: any;
    readonly Gtk: any;
    script(pick: RealScriptedPick): void;
    pickerFilters(): string[][];
    cancelled(): unknown;
    /** `true` when `Gtk` is the real namespace, `false` on the stand-in. */
    readonly realGtk: boolean;
    /** Removes the temporary directory the picks were made in. */
    dispose(): void;
}

export interface RealGioFileChooserOptions {
    /** A directory the picks land in; the subject creates files in it and `dispose` empties it. */
    readonly dir: string;
    /** Use the Gtk stand-in even where Gtk loads: how the Android path is exercised on a host. */
    readonly standIn?: boolean;
}

interface DialogLike {
    filters: { get_n_items(): number; get_item(i: number): unknown } | null;
}

/**
 * The patterns of each filter the dialog was given. Real `Gtk.FileFilter` serialises through
 * `to_gvariant`; the stand-in keeps its patterns itself.
 */
function patternsOf(filter: unknown): string[] {
    // Not `patterns` first: GTK's own `patterns` property is empty for a filter built with add_pattern.
    if (typeof (filter as { to_gvariant?: unknown }).to_gvariant !== 'function') {
        return (filter as { patterns: string[] }).patterns;
    }
    const [, rules] = (filter as { to_gvariant(): { recursiveUnpack(): unknown } }).to_gvariant().recursiveUnpack() as [
        string,
        [number, string][],
    ];
    return rules.map(([, rule]) => rule);
}

/**
 * The vector rows whose subject is GTK itself; a stand-in has nothing to say about them.
 *
 * The printed-name row is one of them: an error prints the NAME OF ITS DOMAIN CLASS
 * (`Gtk.DialogError: x`), which node-gi reads back out of the typelib that registered the
 * domain — so without GTK there is no class to name and the base form prints instead.
 */
const GTK_ONLY_RULES: readonly RegExp[] = [
    /^the enum members the subset raises/,
    /^a GLib\.Error names its domain when printed/,
    /FileFilter/,
    /FileDialog/,
];

/** The vectors a subject can answer: all of them on real GTK, those not about GTK otherwise. */
export function rowsFor<V extends { readonly rule: string; readonly row: string }>(
    subject: Pick<RealGioFileChooserSubject, 'realGtk'>,
    vectors: readonly V[],
): V[] {
    if (subject.realGtk) return [...vectors];
    return vectors.filter(
        (vector) =>
            !(vector.row === 'dialog' || vector.row === 'filter' || GTK_ONLY_RULES.some((re) => re.test(vector.rule))),
    );
}

function loadGtk(requireGi: RequireGi): any | null {
    try {
        return requireGi('Gtk', '4.0');
    } catch {
        return null;
    }
}

/** A `Gtk` namespace with the members the vectors read, built over real GLib and GObject. */
function createGtkStandIn(requireGi: RequireGi): any {
    const GObject = requireGi('GObject', '2.0') as any;
    const FileFilter = GObject.registerClass(
        {
            GTypeName: 'GjsifyStandInFileFilter',
            Properties: {
                name: GObject.ParamSpec.string('name', 'name', 'name', GObject.ParamFlags.READWRITE, null),
            },
        },
        class GjsifyStandInFileFilter extends GObject.Object {
            patterns: string[] = [];
            static new(): GjsifyStandInFileFilter {
                return new GjsifyStandInFileFilter();
            }
            get_name(): string | null {
                return (this as unknown as { name: string | null }).name;
            }
            set_name(name: string | null): void {
                (this as unknown as { name: string | null }).name = name;
            }
            add_pattern(pattern: string): void {
                this.patterns.push(pattern);
            }
        },
    );

    class FileDialog {
        title: string | null = null;
        modal = true;
        initial_name: string | null = null;
        filters: unknown = null;
        default_filter: unknown = null;
        constructor(props: Record<string, unknown> = {}) {
            Object.assign(this, props);
        }
    }

    // A real error domain: the quark is what `g_error_matches` compares on the C side too.
    const DialogError = {
        FAILED: 0,
        CANCELLED: 1,
        DISMISSED: 2,
        // A real `Gtk.DialogError` IS its quark when coerced (a static `valueOf`, so
        // `new GLib.Error(Gtk.DialogError, …)` and `matches(Gtk.DialogError, …)` take the
        // enum itself) — the one piece of the domain class a stand-in can honour without
        // GTK's typelib to register the domain in.
        valueOf: () => (requireGi('GLib', '2.0') as any).quark_from_string('gtk-dialog-error-quark') as number,
    };

    return { FileFilter, FileDialog, DialogError };
}

/**
 * The subject for `FILE_CHOOSER_VECTORS` over real Gio. `isOracle` is `true`: GLib and Gio ARE the
 * real classes, so the subset-only refusals (a picked file has no path, a cancelled `open`,
 * the ADR 0100 § 2 refusals) are skipped exactly as on the GJS leg.
 */
export function createRealGioFileChooserSubject(
    requireGi: RequireGi,
    { dir, standIn = false }: RealGioFileChooserOptions,
): RealGioFileChooserSubject {
    const GLib = requireGi('GLib', '2.0') as any;
    const Gio = requireGi('Gio', '2.0') as any;
    const real = standIn ? null : loadGtk(requireGi);
    // The GJS leg does the same: constructing a GTK object before `init_check` crashes the process.
    real?.init_check?.();
    const Gtk = real ?? createGtkStandIn(requireGi);

    let next: RealScriptedPick = null;
    let filters: string[][] = [];

    const answer = function (this: DialogLike, _parent: unknown, _cancellable: unknown, callback: Callback): void {
        filters = [];
        for (let i = 0; this.filters && i < this.filters.get_n_items(); i++) {
            filters.push(patternsOf(this.filters.get_item(i)));
        }
        let outcome: Outcome;
        if (next === null) {
            outcome = { error: new GLib.Error(Gtk.DialogError, Gtk.DialogError.DISMISSED, 'Dismissed by user') };
        } else {
            const file = Gio.File.new_for_path(GLib.build_filenamev([dir, next.basename]));
            // An empty Uint8Array reaches GIO as NULL and trips an assertion; create the file instead.
            if (next.contents?.length) {
                file.replace_contents(next.contents, null, false, Gio.FileCreateFlags.NONE, null);
            } else if (next.contents) {
                file.replace(null, false, Gio.FileCreateFlags.NONE, null).close(null);
            }
            outcome = { file };
        }
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            callback(this, outcome);
            return GLib.SOURCE_REMOVE;
        });
    };
    const finish = (result: Outcome): unknown => {
        if ('error' in result) throw result.error;
        return result.file;
    };
    Object.assign(Gtk.FileDialog.prototype, { open: answer, save: answer, open_finish: finish, save_finish: finish });

    return {
        name: real ? 'node-gi (real Gio and Gtk)' : 'node-gi (real Gio, Gtk stand-in)',
        isOracle: true,
        realGtk: real !== null,
        GLib,
        Gio,
        Gtk,
        script: (pick) => void (next = pick),
        pickerFilters: () => filters,
        cancelled: () => {
            const cancellable = new Gio.Cancellable();
            cancellable.cancel();
            return cancellable;
        },
        dispose: () => {
            const folder = Gio.File.new_for_path(dir);
            const enumerator = folder.enumerate_children('standard::name', 0, null);
            for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null)) {
                enumerator.get_child(info).delete(null);
            }
            folder.delete(null);
        },
    };
}
