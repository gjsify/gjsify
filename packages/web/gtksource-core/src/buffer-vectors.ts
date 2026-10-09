// The Buffer surface slice 3 claims, as observable behaviour. The SAME vectors run on real
// `gi://GtkSource` (the ORACLE: a vector that fails there is wrong, never a port bug) and on every
// port's Buffer. Each observes through the GJS names only.

interface IterLike {
    get_offset(): number;
    set_offset(offset: number): void;
}

interface MarkLike {
    readonly name: string | null;
}

/** The part of a `GtkSource.Buffer` the vectors read. */
export interface BufferLike {
    text: string;
    readonly language: unknown;
    readonly cursor_position: number;
    readonly can_undo: boolean;
    readonly can_redo: boolean;
    get_start_iter(): IterLike;
    get_end_iter(): IterLike;
    get_insert(): MarkLike;
    get_selection_bound(): MarkLike;
    get_selection_bounds(): [boolean, IterLike, IterLike];
    get_text(start: IterLike, end: IterLike, includeHidden: boolean): string;
    move_mark(mark: MarkLike, where: IterLike): void;
    insert_at_cursor(text: string, len: number): void;
    delete(start: IterLike, end: IterLike): void;
    begin_user_action(): void;
    end_user_action(): void;
    undo(): void;
    redo(): void;
    set_language(language: null): void;
    connect(name: string, callback: (...args: never[]) => void): number;
    connect_after(name: string, callback: (...args: never[]) => void): number;
}

/** The part of `GtkSource` the vectors read. */
export interface GtkSourceBufferLike {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    Buffer: new (properties?: any) => BufferLike;
}

export interface GtkSourceBufferVector {
    readonly rule: string;
    readonly observe: (GtkSource: GtkSourceBufferLike) => unknown;
    readonly shows: unknown;
}

// Two characters outside the ASCII range, one of them outside the BMP: iterators count characters.
const TEXT = 'héllo\n😀 wörld';

const iterAt = (buffer: BufferLike, offset: number): IterLike => {
    const iter = buffer.get_start_iter();
    iter.set_offset(offset);
    return iter;
};

const bounds = (buffer: BufferLike): [boolean, number, number] => {
    const [has, start, end] = buffer.get_selection_bounds();
    return [has, start.get_offset(), end.get_offset()];
};

const logging = (buffer: BufferLike, names: string[]): string[] => {
    const log: string[] = [];
    for (const name of names) {
        buffer.connect(name, ((_self: unknown, ...args: unknown[]) => {
            const [iter, mark] = args as [IterLike | undefined, MarkLike | undefined];
            log.push(name === 'mark-set' ? `${name}:${iter!.get_offset()}:${mark!.name}` : name);
        }) as never);
    }
    return log;
};

const typed = (buffer: BufferLike, text: string): void => {
    buffer.begin_user_action();
    buffer.insert_at_cursor(text, -1);
    buffer.end_user_action();
};

export const GTKSOURCE_BUFFER_VECTORS: readonly GtkSourceBufferVector[] = [
    {
        rule: 'setting text puts the cursor after it, counted in characters',
        observe: (G) => {
            const buffer = new G.Buffer();
            buffer.text = TEXT;
            return [buffer.cursor_position, bounds(buffer)];
        },
        shows: [13, [false, 13, 13]],
    },
    {
        rule: 'the two marks are named insert and selection_bound',
        observe: (G) => {
            const buffer = new G.Buffer();
            return [buffer.get_insert().name, buffer.get_selection_bound().name];
        },
        shows: ['insert', 'selection_bound'],
    },
    {
        rule: 'TextIter.set_offset counts characters; a negative or too large offset is the end',
        observe: (G) => {
            const buffer = new G.Buffer();
            buffer.text = TEXT;
            return [iterAt(buffer, 8).get_offset(), iterAt(buffer, 999).get_offset(), iterAt(buffer, -1).get_offset()];
        },
        shows: [8, 13, 13],
    },
    {
        rule: 'get_text between two iterators',
        observe: (G) => {
            const buffer = new G.Buffer();
            buffer.text = TEXT;
            return buffer.get_text(buffer.get_start_iter(), iterAt(buffer, 8), false);
        },
        shows: 'héllo\n😀 ',
    },
    {
        rule: 'move_mark on insert reports mark-set, then cursor-moved, even for the same place',
        observe: (G) => {
            const buffer = new G.Buffer();
            buffer.text = TEXT;
            const log = logging(buffer, ['mark-set', 'cursor-moved']);
            buffer.move_mark(buffer.get_insert(), iterAt(buffer, 3));
            buffer.move_mark(buffer.get_insert(), iterAt(buffer, 3));
            return log;
        },
        shows: ['mark-set:3:insert', 'cursor-moved', 'mark-set:3:insert', 'cursor-moved'],
    },
    {
        rule: 'move_mark on selection_bound reports mark-set only and makes a selection',
        observe: (G) => {
            const buffer = new G.Buffer();
            buffer.text = TEXT;
            buffer.move_mark(buffer.get_insert(), iterAt(buffer, 3));
            const log = logging(buffer, ['mark-set', 'cursor-moved']);
            buffer.move_mark(buffer.get_selection_bound(), iterAt(buffer, 5));
            const [, start, end] = buffer.get_selection_bounds();
            return [log, bounds(buffer), buffer.get_text(start, end, false)];
        },
        shows: [['mark-set:5:selection_bound'], [true, 3, 5], 'lo'],
    },
    {
        rule: 'get_selection_bounds is ordered whichever mark is first',
        observe: (G) => {
            const buffer = new G.Buffer();
            buffer.text = TEXT;
            buffer.move_mark(buffer.get_insert(), iterAt(buffer, 5));
            buffer.move_mark(buffer.get_selection_bound(), iterAt(buffer, 3));
            return [bounds(buffer), buffer.cursor_position];
        },
        shows: [[true, 3, 5], 5],
    },
    {
        rule: 'moving a mark to 0 through a handler-built iterator',
        observe: (G) => {
            const buffer = new G.Buffer();
            buffer.text = TEXT;
            const seen: unknown[] = [];
            buffer.connect('mark-set', ((_self: unknown, iter: IterLike, mark: MarkLike) => {
                seen.push([iter.get_offset(), mark.name]);
            }) as never);
            const where = buffer.get_start_iter();
            where.set_offset(0);
            buffer.move_mark(buffer.get_insert(), where);
            return [seen, buffer.cursor_position];
        },
        shows: [[[0, 'insert']], 0],
    },
    {
        rule: 'a user action brackets its edits with begin and end, the outermost only',
        observe: (G) => {
            const buffer = new G.Buffer();
            const log = logging(buffer, ['begin-user-action', 'end-user-action']);
            buffer.begin_user_action();
            buffer.begin_user_action();
            buffer.insert_at_cursor('a', -1);
            buffer.end_user_action();
            const inner = [...log];
            buffer.end_user_action();
            return [inner, log];
        },
        shows: [['begin-user-action'], ['begin-user-action', 'end-user-action']],
    },
    {
        rule: 'undo and redo of a user action restore the text and report in order',
        observe: (G) => {
            const buffer = new G.Buffer();
            const log = logging(buffer, ['undo', 'redo']);
            typed(buffer, 'abc');
            const typedState = [buffer.can_undo, buffer.can_redo];
            buffer.undo();
            const undone = [buffer.text, buffer.can_undo, buffer.can_redo, buffer.cursor_position];
            buffer.redo();
            return [typedState, undone, buffer.text, buffer.cursor_position, log];
        },
        shows: [[true, false], ['', false, true, 0], 'abc', 3, ['undo', 'redo']],
    },
    {
        rule: 'several edits in one user action are one undo step',
        observe: (G) => {
            const buffer = new G.Buffer();
            buffer.begin_user_action();
            buffer.insert_at_cursor('x', -1);
            buffer.insert_at_cursor('yz', -1);
            buffer.end_user_action();
            buffer.undo();
            const undone = [buffer.text, buffer.can_undo];
            buffer.redo();
            return [undone, buffer.text];
        },
        shows: [['', false], 'xyz'],
    },
    {
        rule: 'an edit outside a user action is undoable too',
        observe: (G) => {
            const buffer = new G.Buffer();
            buffer.insert_at_cursor('abc', -1);
            const could = buffer.can_undo;
            buffer.undo();
            return [could, buffer.text];
        },
        shows: [true, ''],
    },
    {
        rule: 'undoing a delete brings the text and the cursor back, redo deletes again',
        observe: (G) => {
            const buffer = new G.Buffer();
            buffer.text = 'abcd';
            buffer.begin_user_action();
            buffer.delete(iterAt(buffer, 1), iterAt(buffer, 3));
            buffer.end_user_action();
            const deleted = [buffer.text, buffer.cursor_position];
            buffer.undo();
            const undone = [buffer.text, buffer.cursor_position];
            buffer.redo();
            return [deleted, undone, [buffer.text, buffer.cursor_position]];
        },
        shows: [
            ['ad', 2],
            ['abcd', 4],
            ['ad', 1],
        ],
    },
    {
        rule: 'setting text is not undoable and drops the history',
        observe: (G) => {
            const buffer = new G.Buffer();
            typed(buffer, 'x');
            buffer.text = 'unrec';
            const state = [buffer.can_undo, buffer.can_redo];
            buffer.undo();
            return [state, buffer.text];
        },
        shows: [[false, false], 'unrec'],
    },
    {
        rule: 'connect_after runs after the plain handlers, whichever was connected first',
        observe: (G) => {
            const buffer = new G.Buffer();
            const log: string[] = [];
            buffer.connect_after('cursor-moved', (() => log.push('after')) as never);
            buffer.connect('cursor-moved', (() => log.push('plain')) as never);
            buffer.move_mark(buffer.get_insert(), buffer.get_start_iter());
            return log;
        },
        shows: ['plain', 'after'],
    },
    {
        rule: 'connecting a signal the buffer does not have throws',
        observe: (G) => {
            try {
                new G.Buffer().connect('no-such-signal', (() => {}) as never);
                return false;
            } catch {
                return true;
            }
        },
        shows: true,
    },
    {
        rule: 'set_language(null) leaves no language',
        observe: (G) => {
            const buffer = new G.Buffer();
            buffer.set_language(null);
            return buffer.language;
        },
        shows: null,
    },
];
