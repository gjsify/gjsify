// A `gi://` that is TEXT rather than an import — the distinction the arm makes, and the
// one nothing else in this suite measures.
//
// Both literals below are specifiers the arm REFUSES when they arrive as imports, and
// `unanswered-namespace.ts` / `wrong-version.ts` assert exactly that: `gi://Gio` has no
// renderer, `gi://Adw?version=9` names a version no arm answers. As string literals they
// have to reach the bundle untouched, because `resolveId` is handed module specifiers and
// never source text. The real import beside them keeps the row honest — it proves the arm
// was composed and did resolve, so a green result cannot mean the arm was simply absent.
import Adw from 'gi://Adw?version=1';

export const unanswerable = 'gi://Gio?version=2.0';
export const wrongVersion = 'gi://Adw?version=9';

export const actionRow = Adw.ActionRow;
export const kind = typeof Adw.ActionRow;

export class ProbeRow extends Adw.ActionRow {}
