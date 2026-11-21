import GObject from 'gi://GObject?version=2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

import type { BoardColumnData } from '../src/board-column.js';
import { KanbanBoard } from '../src/kanban-board.js';
import { onSignal } from '../src/signals.js';
import type { SizeClass } from '../src/size-class.js';
import Gtk from 'gi://Gtk?version=4.0';

/** Invented story data: a small garden-club project, nothing real. */
export function sampleColumns(now: Date = new Date(), emptyDone = false): BoardColumnData[] {
    const day = (n: number): Date => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
    const green = '#2ec27e';
    const blue = '#3584e4';
    const orange = '#e66100';
    return [
        {
            id: 'backlog',
            title: 'Backlog',
            cards: [
                {
                    id: 'c1',
                    title: 'Order seed potatoes for the spring market',
                    sourceLabel: 'Garden club',
                    sourceColour: green,
                    assignees: ['MK'],
                    labels: ['shopping'],
                    due: day(12),
                    readOnly: false,
                },
                {
                    id: 'c2',
                    title: 'Sketch the new raised-bed layout',
                    sourceLabel: 'Workshop',
                    sourceColour: blue,
                    assignees: [],
                    labels: [],
                    due: null,
                    readOnly: false,
                },
            ],
        },
        {
            id: 'todo',
            title: 'Todo',
            cards: [
                {
                    id: 'c3',
                    title: 'Repair the greenhouse door hinge before the first frost warning arrives next week',
                    sourceLabel: 'Garden club',
                    sourceColour: green,
                    assignees: ['AB', 'CD'],
                    labels: ['repair', 'urgent'],
                    due: day(-1),
                    readOnly: false,
                },
                {
                    id: 'c4',
                    title: 'Print the newsletter',
                    sourceLabel: 'Board feed',
                    sourceColour: orange,
                    assignees: ['EF'],
                    labels: [],
                    due: day(0),
                    readOnly: true,
                },
                {
                    id: 'c5',
                    title: 'Book the community hall',
                    sourceLabel: 'Board feed',
                    sourceColour: orange,
                    assignees: [],
                    labels: ['venue'],
                    due: day(2),
                    readOnly: true,
                },
            ],
        },
        {
            id: 'doing',
            title: 'In progress',
            cards: [
                {
                    id: 'c6',
                    title: 'Write the compost guide',
                    sourceLabel: 'Workshop',
                    sourceColour: blue,
                    assignees: ['MK', 'AB', 'CD', 'EF'],
                    labels: ['docs'],
                    due: day(6),
                    readOnly: false,
                },
            ],
        },
        {
            id: 'done',
            title: 'Done',
            cards: emptyDone
                ? []
                : [
                      {
                          id: 'c7',
                          title: 'Collect the membership fees',
                          sourceLabel: 'Garden club',
                          sourceColour: green,
                          assignees: ['AB'],
                          labels: [],
                          due: null,
                          readOnly: false,
                      },
                  ],
        },
    ];
}

const META: StoryMeta = {
    title: 'Adwaita Extended/KanbanBoard',
    description:
        'Columns of cards: one at a time under a switcher (compact), a snapping strip (medium), all side by side (wide). Writable: drag a card to another column, or focus one and press Shift+Left/Right. The board only ASKS — this story plays the host and moves the card in its own data.',
    controls: [
        {
            name: 'sizeClass',
            label: 'Size class',
            type: ControlType.SELECT,
            options: [
                { label: 'Compact', value: 'compact' },
                { label: 'Medium', value: 'medium' },
                { label: 'Wide', value: 'wide' },
            ],
            defaultValue: 'wide',
        },
        { name: 'emptyDone', label: 'Empty last column', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'writable', label: 'Writable', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};

/**
 * What the host does with `card-move-requested`: takes the card out of the column it is in and
 * puts it back at `position` in `columnId`. Pure, so the story's "server" is one function.
 */
export function movedColumns(
    columns: readonly BoardColumnData[],
    cardId: string,
    columnId: string,
    position: number,
): BoardColumnData[] {
    const card = columns.flatMap((column) => column.cards).find((c) => c.id === cardId);
    if (!card) return columns.map((column) => ({ ...column, cards: [...column.cards] }));
    return columns.map((column) => {
        const cards = column.cards.filter((c) => c.id !== cardId);
        if (column.id !== columnId) return { ...column, cards };
        const at = Math.min(Math.max(position, 0), cards.length);
        return { ...column, cards: [...cards.slice(0, at), card, ...cards.slice(at)] };
    });
}

export class KanbanBoardStory extends StoryWidget {
    private board: KanbanBoard | null = null;
    private columns: BoardColumnData[] = [];
    private readonly log = new Gtk.Label({ label: 'No card activated yet', xalign: 0 });

    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwStoryKanbanBoard' }, KanbanBoardStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(KanbanBoardStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...META, component: KanbanBoard.$gtype };
    }

    initialize(): void {
        this.board = new KanbanBoard();
        this.board.set_size_request(360, 420);
        onSignal(this.board, 'card-activated', (id: string) => this.log.set_label(`card-activated(${id})`));
        onSignal(this.board, 'card-move-requested', (id: string, columnId: string, position: number) => {
            this.log.set_label(`card-move-requested(${id}, ${columnId}, ${position})`);
            this.columns = movedColumns(this.columns, id, columnId, position);
            this.board?.setColumns(this.columns);
        });
        this.log.add_css_class('dim-label');
        const box = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, spacing: 8 });
        this.board.set_vexpand(true);
        box.append(this.board);
        box.append(this.log);
        this.addContent(box);
        this.refresh();
    }

    updateArgs(_args: StoryArgs): void {
        this.refresh();
    }

    private refresh(): void {
        if (!this.board) return;
        this.board.setSizeClass(String(this.args.sizeClass) as SizeClass);
        this.board.writable = Boolean(this.args.writable);
        this.columns = sampleColumns(new Date(), Boolean(this.args.emptyDone));
        this.board.setColumns(this.columns);
    }
}

GObject.type_ensure(KanbanBoardStory.$gtype);

export const KanbanBoardStories: StoryModule = { stories: [KanbanBoardStory] };
