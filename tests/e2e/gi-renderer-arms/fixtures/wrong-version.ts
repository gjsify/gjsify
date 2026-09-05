// A version the arm does not answer. GJS itself throws here — measured on gjs 1.88.1,
// `import Adw from 'gi://Adw?version=9'` raises `Requiring Adw, version 9: Typelib file
// for namespace 'Adw', version '9' not found` — so a target that accepted it would be the
// only place a wrong version passes.
import Adw from 'gi://Adw?version=2';

export const kind = typeof Adw.ActionRow;
