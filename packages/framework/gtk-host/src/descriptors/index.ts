import { registerWidgets } from '../registry.js';
import { ADW_DESCRIPTORS } from './adw.js';
import { GTK_DESCRIPTORS } from './gtk.js';

export { GTK_DESCRIPTORS } from './gtk.js';
export { ADW_DESCRIPTORS } from './adw.js';

export const BUILTIN_DESCRIPTORS = [...GTK_DESCRIPTORS, ...ADW_DESCRIPTORS];

/** Install the built-in table. Idempotent — registration is keyed on the GType name. */
export function registerBuiltinWidgets(): void {
    registerWidgets(BUILTIN_DESCRIPTORS);
}
