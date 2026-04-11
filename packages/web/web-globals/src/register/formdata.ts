// Registers: FormData

import { FormData } from '@gjsify/formdata';

if (typeof globalThis.FormData !== 'function') {
  (globalThis as any).FormData = FormData;
}
