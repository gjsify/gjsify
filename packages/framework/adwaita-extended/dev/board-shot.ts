// Renders one KanbanBoard in a window of a fixed width, for screenshots (run under headless-run).
// Build: gjsify build dev/board-shot.ts --app gjs --outfile dist/board-shot.gjs.mjs
import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import system from 'system';

import type { BoardCard } from '../src/board-card.js';
import type { BoardColumn } from '../src/board-column.js';
import { KanbanBoard } from '../src/kanban-board.js';
import { sampleColumns } from '../stories/kanban-board.story.js';
import type { SizeClass } from '../src/size-class.js';

const width = Number(GLib.getenv('BOARD_SHOT_WIDTH') ?? '800');
const height = Number(GLib.getenv('BOARD_SHOT_HEIGHT') ?? '640');
const sizeClass: SizeClass = width < 600 ? 'compact' : width < 1024 ? 'medium' : 'wide';
/** `BOARD_SHOT_DROP="<column index> <card index>"` paints the drop indicator a drag would show. */
const drop = (GLib.getenv('BOARD_SHOT_DROP') ?? '').split(' ').filter(Boolean).map(Number);

/**
 * A pointer drag cannot be synthesised in a headless session, so the indicator is painted through
 * the same `markDrop` a drop motion calls, reaching the columns through the `decorateCard` seam.
 */
class ShotBoard extends KanbanBoard {
    static {
        GObject.registerClass({ GTypeName: 'GjsifyAdwBoardShotBoard' }, ShotBoard);
    }

    private readonly seen: BoardColumn[] = [];

    protected override decorateCard(card: BoardCard, column: BoardColumn): void {
        super.decorateCard(card, column);
        if (!this.seen.includes(column)) this.seen.push(column);
    }

    markDropAt(column: number, index: number): void {
        this.seen[column]?.markDrop(index);
    }
}

const app = new Adw.Application({ applicationId: 'org.gjsify.AdwaitaExtended.BoardShot' });
app.connect('activate', () => {
    const board = new ShotBoard();
    board.setSizeClass(sizeClass);
    board.writable = true;
    board.setColumns(sampleColumns());
    if (drop.length === 2) board.markDropAt(drop[0], drop[1]);
    const view = new Adw.ToolbarView();
    view.add_top_bar(new Adw.HeaderBar());
    view.set_content(board);
    const win = new Adw.ApplicationWindow({
        application: app,
        defaultWidth: width,
        defaultHeight: height,
        content: view,
    });
    win.present();
});
app.run([system.programInvocationName]);
