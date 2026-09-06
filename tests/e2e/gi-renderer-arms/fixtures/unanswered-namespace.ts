// A GI namespace no widget renderer stands behind. Under the arm this is a BUILD-time
// refusal; without it, the specifier becomes an empty module and `Gio.File` is `undefined`.
import Gio from 'gi://Gio?version=2.0';

export const kind = typeof Gio.File;
