// Renders one calendar widget in a window of a fixed width, for screenshots (run under headless-run).
// Build: gjsify build dev/calendar-shot.ts --app gjs --outfile dist/calendar-shot.gjs.mjs
// Env: CAL_SHOT_WIDGET=month|time|agenda, CAL_SHOT_WIDTH, CAL_SHOT_HEIGHT.
import Adw from '@girs/adw-1';
import GLib from '@girs/glib-2.0';
import type Gtk from '@girs/gtk-4.0';
import system from 'system';

import { AgendaList } from '../src/agenda-list.js';
import { MonthGrid } from '../src/month-grid.js';
import { sampleEvents } from '../stories/month-grid.story.js';
import type { SizeClass } from '../src/size-class.js';
import { TimeGrid } from '../src/time-grid.js';

const which = GLib.getenv('CAL_SHOT_WIDGET') ?? 'month';
const width = Number(GLib.getenv('CAL_SHOT_WIDTH') ?? '800');
const height = Number(GLib.getenv('CAL_SHOT_HEIGHT') ?? '640');
const sizeClass: SizeClass = width < 600 ? 'compact' : width < 1024 ? 'medium' : 'wide';

// A fixed month, a fixed "today" and a fixed "now", so every run produces the same picture.
const TODAY = new Date(2024, 0, 17);
const NOW = new Date(2024, 0, 10, 13, 20);

function build(): Gtk.Widget {
    const events = sampleEvents();
    if (which === 'time') {
        const grid = new TimeGrid();
        grid.setRange('2024-01-08', sizeClass === 'compact' ? 1 : sizeClass === 'medium' ? 3 : 7);
        grid.setVisibleHours(7, 20);
        grid.setNow(NOW);
        grid.setItems(events);
        grid.scrollToHour(8);
        return grid;
    }
    if (which === 'agenda') {
        const list = new AgendaList();
        list.setToday(new Date(2024, 0, 8));
        list.setItems(events);
        return list;
    }
    const grid = new MonthGrid();
    grid.setSizeClass(sizeClass);
    grid.setMonth(2024, 1);
    grid.setFirstWeekday(1);
    grid.setShowWeekNumbers(sizeClass !== 'compact');
    grid.setToday(TODAY);
    grid.setSelected('2024-01-17');
    grid.setItems(events);
    return grid;
}

const app = new Adw.Application({ applicationId: 'org.gjsify.AdwaitaExtended.CalendarShot' });
app.connect('activate', () => {
    const view = new Adw.ToolbarView();
    view.add_top_bar(new Adw.HeaderBar());
    view.set_content(build());
    const win = new Adw.ApplicationWindow({
        application: app,
        defaultWidth: width,
        defaultHeight: height,
        content: view,
    });
    win.present();
});
app.run([system.programInvocationName]);
