// Reference: Node.js lib/util.js
// Reimplemented for GJS.
//
// Composition layout (see each module's header for details):
//   - inspect.ts            — kCustomInspect + inspect + its .custom /
//                              .defaultOptions / .colors / .styles surface
//                              (inspectValue / inspectArray / inspectObject
//                              are module-local helpers).
//   - format.ts             — format / formatWithOptions / styleText /
//                              stripVTControlCharacters (imports inspect).
//   - compat.ts             — promisify / callbackify / deprecate /
//                              debuglog / inherits / isDeepStrictEqual /
//                              toUSVString / aborted.
//   - legacy-predicates.ts  — util.isXxx family (deprecated upstream but
//                              still widely consumed).
//   - types.ts (existing)   — `util.types.isXxx` namespace.
//   - errors.ts (existing)  — getSystemErrorName / getSystemErrorMap.

import * as types from './types.js';
import { getSystemErrorName, getSystemErrorMap } from './errors.js';
import { inspect, kCustomInspect } from './inspect.js';
import { format, formatWithOptions, stripVTControlCharacters, styleText } from './format.js';
import {
    promisify,
    callbackify,
    deprecate,
    debuglog,
    inherits,
    isDeepStrictEqual,
    toUSVString,
    aborted,
} from './compat.js';
import {
    isBoolean,
    isNull,
    isNullOrUndefined,
    isNumber,
    isString,
    isSymbol,
    isUndefined,
    isObject,
    isError,
    isFunction,
    isRegExp,
    isArray,
    isPrimitive,
    isDate,
    isBuffer,
} from './legacy-predicates.js';

export { types };
export { getSystemErrorName, getSystemErrorMap };
export { inspect, kCustomInspect };
export { format, formatWithOptions, stripVTControlCharacters, styleText };
export { promisify, callbackify, deprecate, debuglog, inherits, isDeepStrictEqual, toUSVString, aborted };
export {
    isBoolean,
    isNull,
    isNullOrUndefined,
    isNumber,
    isString,
    isSymbol,
    isUndefined,
    isObject,
    isError,
    isFunction,
    isRegExp,
    isArray,
    isPrimitive,
    isDate,
    isBuffer,
};

// ---- Re-export web-platform globals (Node compat) ----

export const TextDecoder = globalThis.TextDecoder;
export const TextEncoder = globalThis.TextEncoder;

// ---- Default export ----

export default {
    format,
    formatWithOptions,
    styleText,
    stripVTControlCharacters,
    inspect,
    promisify,
    callbackify,
    deprecate,
    debuglog,
    inherits,
    types,
    isBoolean,
    isNull,
    isNullOrUndefined,
    isNumber,
    isString,
    isSymbol,
    isUndefined,
    isObject,
    isError,
    isFunction,
    isRegExp,
    isArray,
    isPrimitive,
    isDate,
    isBuffer,
    isDeepStrictEqual,
    toUSVString,
    aborted,
    TextDecoder: globalThis.TextDecoder,
    TextEncoder: globalThis.TextEncoder,
    getSystemErrorName,
    getSystemErrorMap,
};
