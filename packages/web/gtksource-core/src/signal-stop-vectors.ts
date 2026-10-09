// Stopping an emission on the GtkSource objects Learn6502 connects to. The SAME vectors run on real
// `gi://GtkSource` (the ORACLE: a vector that fails there is wrong, never a port bug) and on every
// port. Each observes through the GJS names only, `GObject.signal_stop_emission_by_name` included.
//
// The flags they pin, from refs/gtk gtktextbuffer.c and gtktextview.c: `mark-set` and `extend-selection`
// are RUN_LAST, `extend-selection` has a `true_handled` accumulator, and a stop skips the remaining
// plain handlers, the class handler and every `connect_after` one.

export interface IterLike {
    copy(): IterLike;
    get_offset(): number;
    set_offset(offset: number): void;
}

interface MarkLike {
    readonly name: string | null;
}

interface StoppableBufferLike {
    text: string;
    get_start_iter(): IterLike;
    get_insert(): MarkLike;
    get_selection_bound(): MarkLike;
    move_mark(mark: MarkLike, where: IterLike): void;
    connect(name: string, callback: (...args: never[]) => unknown): number;
    connect_after(name: string, callback: (...args: never[]) => unknown): number;
    disconnect(id: number): void;
}

export interface StoppableViewLike {
    buffer: StoppableBufferLike;
    connect(name: string, callback: (...args: never[]) => unknown): number;
    connect_after(name: string, callback: (...args: never[]) => unknown): number;
}

/** The part of `GtkSource` and `GObject` the vectors read. */
export interface GtkSourceStopSurface {
    GtkSource: {
        Buffer: new () => StoppableBufferLike;
        View: new () => StoppableViewLike;
    };
    GObject: {
        signal_stop_emission_by_name(instance: object, detailedSignal: string): void;
    };
}

/**
 * What a port does for a user gesture its view cannot be asked to perform by name. On GJS it emits the
 * signal; on the web it dispatches the DOM event the driver turns into it.
 */
export interface GtkSourceStopGestures {
    /**
     * A double click (`Gtk.TextExtendSelection.WORD`) with the caret at `offset`. Answers what it left
     * selected: `'native'` when the platform may apply its own word selection, else the range.
     */
    extendSelection(view: StoppableViewLike, offset: number): 'native' | [number, number];
    copyClipboard(view: StoppableViewLike): void;
}

export interface GtkSourceStopVector {
    readonly rule: string;
    /** Whether a `GtkSource.View` is built, which needs a display on GJS. */
    readonly view: boolean;
    readonly observe: (surface: GtkSourceStopSurface, gestures: GtkSourceStopGestures) => unknown;
    readonly shows: unknown;
}

const TEXT = 'hello world';

const bufferOf = (surface: GtkSourceStopSurface): StoppableBufferLike => {
    const buffer = new surface.GtkSource.Buffer();
    buffer.text = TEXT;
    return buffer;
};

const viewOf = (surface: GtkSourceStopSurface): StoppableViewLike => {
    const view = new surface.GtkSource.View();
    view.buffer = bufferOf(surface);
    return view;
};

const iterAt = (buffer: StoppableBufferLike, offset: number): IterLike => {
    const iter = buffer.get_start_iter();
    iter.set_offset(offset);
    return iter;
};

export const GTKSOURCE_STOP_VECTORS: readonly GtkSourceStopVector[] = [
    {
        rule: 'stopping mark-set skips later handlers, the default (cursor-moved) and connect_after ones',
        view: false,
        observe: (surface) => {
            const buffer = bufferOf(surface);
            const log: string[] = [];
            buffer.connect('mark-set', ((self: object) => {
                log.push('first');
                surface.GObject.signal_stop_emission_by_name(self, 'mark-set');
            }) as never);
            buffer.connect('mark-set', (() => log.push('second')) as never);
            buffer.connect_after('mark-set', (() => log.push('after')) as never);
            buffer.connect('cursor-moved', (() => log.push('cursor-moved')) as never);
            buffer.move_mark(buffer.get_insert(), iterAt(buffer, 3));
            return log;
        },
        shows: ['first'],
    },
    {
        rule: 'a stop ends that emission only: the next mark-set runs the default and every handler',
        view: false,
        observe: (surface) => {
            const buffer = bufferOf(surface);
            const log: string[] = [];
            let stop = true;
            buffer.connect('mark-set', ((self: object) => {
                log.push('first');
                if (stop) surface.GObject.signal_stop_emission_by_name(self, 'mark-set');
            }) as never);
            buffer.connect('mark-set', (() => log.push('second')) as never);
            buffer.connect('cursor-moved', (() => log.push('cursor-moved')) as never);
            buffer.connect_after('mark-set', (() => log.push('after')) as never);
            buffer.move_mark(buffer.get_insert(), iterAt(buffer, 3));
            stop = false;
            buffer.move_mark(buffer.get_insert(), iterAt(buffer, 4));
            return log;
        },
        shows: ['first', 'first', 'second', 'cursor-moved', 'after'],
    },
    {
        rule: 'without a stop the default runs between the plain and the connect_after handlers',
        view: false,
        observe: (surface) => {
            const buffer = bufferOf(surface);
            const log: string[] = [];
            buffer.connect_after('mark-set', (() => log.push('after')) as never);
            buffer.connect('cursor-moved', (() => log.push('cursor-moved')) as never);
            buffer.connect('mark-set', (() => log.push('plain')) as never);
            buffer.move_mark(buffer.get_insert(), iterAt(buffer, 3));
            return log;
        },
        shows: ['plain', 'cursor-moved', 'after'],
    },
    {
        rule: 'a handler that moves the mark itself, then stops, stops the outer emission only (Learn6502)',
        view: false,
        observe: (surface) => {
            const buffer = bufferOf(surface);
            const log: string[] = [];
            buffer.connect('mark-set', ((self: StoppableBufferLike, location: IterLike, mark: MarkLike) => {
                log.push(`first:${location.get_offset()}`);
                if (location.get_offset() !== 0) {
                    location.set_offset(0);
                    self.move_mark(mark, location);
                    surface.GObject.signal_stop_emission_by_name(self, 'mark-set');
                }
            }) as never);
            buffer.connect('mark-set', ((_self: unknown, location: IterLike) =>
                log.push(`second:${location.get_offset()}`)) as never);
            buffer.connect('cursor-moved', (() => log.push('cursor-moved')) as never);
            buffer.move_mark(buffer.get_insert(), iterAt(buffer, 5));
            return log;
        },
        shows: ['first:5', 'first:0', 'second:0', 'cursor-moved'],
    },
    {
        rule: 'stopping mark-set of the selection_bound mark skips its later handlers too',
        view: false,
        observe: (surface) => {
            const buffer = bufferOf(surface);
            const log: string[] = [];
            buffer.connect('mark-set', ((self: object, _location: IterLike, mark: MarkLike) => {
                log.push(`first:${mark.name}`);
                surface.GObject.signal_stop_emission_by_name(self, 'mark-set');
            }) as never);
            buffer.connect_after('mark-set', (() => log.push('after')) as never);
            buffer.move_mark(buffer.get_selection_bound(), iterAt(buffer, 2));
            return log;
        },
        shows: ['first:selection_bound'],
    },
    {
        rule: 'stopping a signal without a default (cursor-moved) skips later and connect_after handlers',
        view: false,
        observe: (surface) => {
            const buffer = bufferOf(surface);
            const log: string[] = [];
            buffer.connect('cursor-moved', ((self: object) => {
                log.push('first');
                surface.GObject.signal_stop_emission_by_name(self, 'cursor-moved');
            }) as never);
            buffer.connect('cursor-moved', (() => log.push('second')) as never);
            buffer.connect_after('cursor-moved', (() => log.push('after')) as never);
            buffer.move_mark(buffer.get_insert(), iterAt(buffer, 3));
            return log;
        },
        shows: ['first'],
    },
    {
        rule: 'a handler an earlier one disconnected during the emission does not run',
        view: false,
        observe: (surface) => {
            const buffer = bufferOf(surface);
            const log: string[] = [];
            let second = 0;
            buffer.connect('mark-set', ((self: StoppableBufferLike) => {
                log.push('first');
                self.disconnect(second);
            }) as never);
            second = buffer.connect('mark-set', (() => log.push('second')) as never);
            buffer.move_mark(buffer.get_insert(), iterAt(buffer, 3));
            return log;
        },
        shows: ['first'],
    },
    {
        rule: 'stopping with no emission in progress does nothing',
        view: false,
        observe: (surface) => {
            const buffer = bufferOf(surface);
            const log: string[] = [];
            const warn = console.warn;
            console.warn = () => {};
            try {
                surface.GObject.signal_stop_emission_by_name(buffer, 'mark-set');
            } finally {
                console.warn = warn;
            }
            buffer.connect('mark-set', (() => log.push('plain')) as never);
            buffer.move_mark(buffer.get_insert(), iterAt(buffer, 3));
            return log;
        },
        shows: ['plain'],
    },
    {
        rule: 'extend-selection: no stop runs the default, which handles it, so connect_after does not run',
        view: true,
        observe: (surface, gestures) => {
            const view = viewOf(surface);
            const log: string[] = [];
            view.connect('extend-selection', (() => log.push('plain') && false) as never);
            view.connect_after('extend-selection', (() => log.push('after') && false) as never);
            return [gestures.extendSelection(view, 2), log];
        },
        shows: ['native', ['plain']],
    },
    {
        rule: 'extend-selection: stopping skips the default, so the click selects nothing (Learn6502)',
        view: true,
        observe: (surface, gestures) => {
            const view = viewOf(surface);
            const log: string[] = [];
            view.connect('extend-selection', ((self: object) => {
                log.push('first');
                surface.GObject.signal_stop_emission_by_name(self, 'extend-selection');
            }) as never);
            view.connect('extend-selection', (() => log.push('second') && false) as never);
            view.connect_after('extend-selection', (() => log.push('after') && false) as never);
            return [gestures.extendSelection(view, 2), log];
        },
        shows: [[2, 2], ['first']],
    },
    {
        rule: 'copy-clipboard: connect_after runs after the default; a stop skips it',
        view: true,
        observe: (surface, gestures) => {
            const run = (stop: boolean): string[] => {
                const view = viewOf(surface);
                const log: string[] = [];
                view.connect('copy-clipboard', ((self: object) => {
                    log.push('plain');
                    if (stop) surface.GObject.signal_stop_emission_by_name(self, 'copy-clipboard');
                }) as never);
                view.connect_after('copy-clipboard', (() => log.push('after')) as never);
                gestures.copyClipboard(view);
                return log;
            };
            return [run(false), run(true)];
        },
        shows: [['plain', 'after'], ['plain']],
    },
];
