/**
 * `@gjsify/adwaita-extended` — GTK4/libadwaita widgets libadwaita does not ship.
 *
 * The widgets know nothing about the app that embeds them.
 * The pure helpers (`/due-state`, `/source-names`, `/priority-marks`, `/swipe-rules`,
 * `/adaptive-container`, `/size-class`, `/chat-entry-rules`) run on Node as well; this barrel needs GJS.
 */

export { AdaptivePane } from './adaptive-pane.js';
export { containerFor, type PaneContainer } from './adaptive-container.js';
export { AgendaList, firstAgendaDate } from './agenda-list.js';
export { groupByDay, type AgendaDay, type AgendaEntry, type AgendaOptions } from './agenda-rules.js';
export { BoardCard, MAX_AVATARS, type BoardCardData } from './board-card.js';
export { BoardColumn, type BoardColumnData } from './board-column.js';
export {
    boardPresentation,
    canDrag,
    dropIndex,
    dropPlacement,
    moveColumn,
    visibleColumns,
    type BoardPresentation,
    type CardExtent,
} from './board-rules.js';
export type { CalendarEvent, CalendarEventData } from './calendar-event.js';
export {
    dayHeading,
    hourLabel,
    isoDate,
    monthTitle,
    parseIsoDate,
    shortDayHeading,
    timeLabel,
    timeRangeLabel,
    usesHour12,
    weekdayNames,
} from './calendar-format.js';
export { KanbanBoard } from './kanban-board.js';
export { MonthGrid, eventCountText, moreText, weekText } from './month-grid.js';
export { barRows, dotsForDay, monthDensity, moveGridFocus, type GridMove, type MonthDensity } from './month-rules.js';
export { ChatActionButton, type ChatAction } from './chat-action-button.js';
export { ChatEntry } from './chat-entry.js';
export {
    clampLines,
    entryHeightRange,
    entryKeyAction,
    linesToHeight,
    submittableText,
    type EntryKeyAction,
    type EntryModifiers,
} from './chat-entry-rules.js';
export { ComposerBar } from './composer-bar.js';
export { ColorCheck } from './color-check.js';
export { DueChip } from './due-chip.js';
export { dueState, SOON_DAYS, type DueState } from './due-state.js';
export { FilterChip } from './filter-chip.js';
export { priorityLevel, priorityMarks, type PriorityLevel } from './priority-marks.js';
export type { SizeClass } from './size-class.js';
export { duplicateNameIds, type NamedSource } from './source-names.js';
export { SourceBadge, SourceDot } from './source-badge.js';
export { SourceList, type SourceItem, type SourceSection } from './source-list.js';
export { commitDistance, rowMinHeight, swipeOutcome, type SwipeOutcome } from './swipe-rules.js';
export { SwipeRow } from './swipe-row.js';
export { TaskRow, type TaskRowData } from './task-row.js';
export { TimeGrid } from './time-grid.js';
export {
    GUTTER_WIDTH,
    HOUR_HEIGHT,
    MAX_UNITS,
    SLOT_MINUTES,
    clampDays,
    columnUnits,
    gridHeight,
    gridSlot,
    minuteAtOffset,
    nowOffset,
    offsetForMinute,
    scrollTarget,
    visibleRange,
} from './time-grid-rules.js';
export { initI18n, TEXT_DOMAIN } from './i18n.js';
