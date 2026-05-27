// Registers: FormData

import { FormData } from '@gjsify/formdata';

/** Module-local typed view of the globals this file writes. */
interface _FormDataGlobals {
    FormData?: typeof FormData;
}

const g = globalThis as unknown as _FormDataGlobals;

if (typeof globalThis.FormData !== 'function') {
    g.FormData = FormData;
}
