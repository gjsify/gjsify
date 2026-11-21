# @gjsify/adwaita-extended

GTK4/libadwaita widgets libadwaita itself does not ship, each with a story and an own gettext
domain (`gjsify-adwaita-extended`).

## Widgets

| Widget | What | Signals |
|---|---|---|
| `TaskRow` | a task as a row: check, title, due chip, priority marks, source dot | `toggled(id, done)`, `activated(id)` |
| `SwipeRow` | a row you can swipe left/right for two actions, with a keyboard path | `action(name)` |
| `DueChip` | a due date as a coloured chip (`dueState` decides overdue / soon / later) | — |
| `ColorCheck` | a check button in a source's own colour | `toggled(active)` |
| `SourceDot` · `SourceBadge` | a source's colour as a dot, or dot + name | — |
| `SourceList` | sources in titled sections, each a row that toggles its visibility | `source-toggled(id, visible)` |
| `FilterChip` | an active filter with a remove button | `removed(name)` |
| `BoardCard` · `BoardColumn` · `KanbanBoard` | a board as columns of cards | `card-activated(id)`, `card-moved(id, column, index)` |
| `AdaptivePane` | one child or two, by size class | — |
| `MonthGrid` | a month of days with the items on them | `day-activated(date)`, `item-activated(id)` |
| `TimeGrid` | 1–7 day columns over an hour gutter | `item-activated(id)`, `slot-activated(date, minute)` |
| `AgendaList` | what happens next, grouped by day | `item-activated(id)` |

## Calendar views

The three calendar widgets take **already-expanded occurrences** as
`CalendarEvent = CalendarItem<{ title, colour?, location? }>` and compute no geometry of their
own: which day sits in which cell, which row a multi-day bar takes, and which overlap column a
timed item gets all come from [`@gjsify/calendar-layout`](../../gjs/calendar-layout/README.md). That is
the only dependency, and it keeps a layout bug in one testable place.

```ts
const grid = new MonthGrid();
grid.setMonth(2024, 1);
grid.setFirstWeekday(1); // 0 = Sunday; the host looks this up from the locale
grid.setShowWeekNumbers(true);
grid.setItems(events);
onSignal(grid, 'day-activated', (date: string) => open(date)); // "2024-01-17"
```

- **`MonthGrid`** draws titled bars from `medium` up. In `compact` a cell is about 45 px across,
  where a bar holds two or three characters and reads as noise, so compact draws **one dot per
  item** (up to three, then `+n`) and leaves the titles to a day list beside the grid —
  `AdaptivePane` with an `AgendaList` for the selected day is the pairing this was built for.
  `monthDensity(sizeClass)` is that decision, as a pure function. Arrow keys, Home and End move
  between days (`moveGridFocus`), Enter activates.
- **`TimeGrid`** stacks each day in a `Gtk.Overlay`: a timed grid has no row structure a box could
  express, since 09:00 and 09:15 overlap by a quarter of their heights. Vertical position is a
  `margin-top` in pixels; sideways position is a homogeneous `Gtk.Grid` per item band, so an item
  in an overlap cluster keeps its share of the column at any width — a `Gtk.Fixed` child cannot
  follow its parent's width. Header, all-day strip and columns are three homogeneous rows sharing
  one horizontal adjustment, so a long all-day title can never push a day out of line. All-day and
  multi-day items never reach the columns (`layoutTimeGrid` drops them) and go to the strip above.
  `setNow(null)` removes the now line; the widget never reads the clock itself, so a story and a
  screenshot stay reproducible.
- **`AgendaList`** repeats a multi-day item under every day it touches, with an arrow saying where
  in the item that day sits. Headings scroll with the list: GTK has no sticky header for a plain
  `Gtk.ListBox`, and a `Gtk.ListView` section header would cost the widget a model it does not
  otherwise need.

## Pure helpers (Node-safe)

Each has its own `exports` entry and is unit-tested without a display:
`/due-state`, `/size-class`, `/source-names`, `/priority-marks`, `/swipe-rules`,
`/adaptive-container`, `/board-rules`, `/calendar-format`, `/month-rules`, `/time-grid-rules`,
`/agenda-rules`. The barrel (`.`) needs GJS.

Weekday and month names come from `Intl` (CLDR), not from the catalogue — only UI words
("All day", "+%d more", "Week %d") are translated here.

## Stories and translations

```sh
gjsify workspace @gjsify/adwaita-extended stories        # run the storybook
gjsify workspace @gjsify/adwaita-extended stories:build  # build it only
./dev-i18n.sh                                            # refresh the .pot and merge into po/*.po
```

Story files (`*.story.ts`) are excluded from the extraction, so a translatable string must live in
the widget, never in its story.
