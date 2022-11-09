import * as build from './01_build.js';
import * as errors from './01_errors.js';
import * as version from './01_version.js';
import * as webUtil from './01_web_util.js';
import * as util from './06_util.js';
import * as webidl from './ext/webidl/00_webidl.js';

window.__bootstrap ??= {};

window.__bootstrap.build = build;
  
window.__bootstrap.errors = {
    errors,
};

window.__bootstrap.version = version;
  
window.__bootstrap.webUtil = webUtil;

window.__bootstrap.internals = {
    ...window.__bootstrap.internals ?? {},
    pathFromURL: util.pathFromURL,
};

window.__bootstrap.webidl = webidl;

window.__bootstrap.url = {
    URL,
    URLPrototype,
    URLSearchParams,
    URLSearchParamsPrototype,
    parseUrlEncoded,
  };
  
  window.__bootstrap.urlPattern = {
    URLPattern,
  };

window.__bootstrap.util = util;

// packages/deno/runtime/src/ext/web/00_infra.ts
window.__bootstrap.infra = {
  collectSequenceOfCodepoints,
  ASCII_DIGIT,
  ASCII_UPPER_ALPHA,
  ASCII_LOWER_ALPHA,
  ASCII_ALPHA,
  ASCII_ALPHANUMERIC,
  HTTP_TAB_OR_SPACE,
  HTTP_WHITESPACE,
  HTTP_TOKEN_CODE_POINT,
  HTTP_TOKEN_CODE_POINT_RE,
  HTTP_QUOTED_STRING_TOKEN_POINT,
  HTTP_QUOTED_STRING_TOKEN_POINT_RE,
  HTTP_TAB_OR_SPACE_PREFIX_RE,
  HTTP_TAB_OR_SPACE_SUFFIX_RE,
  HTTP_WHITESPACE_PREFIX_RE,
  HTTP_WHITESPACE_SUFFIX_RE,
  httpTrim,
  regexMatcher,
  byteUpperCase,
  byteLowerCase,
  collectHttpQuotedString,
  forgivingBase64Encode,
  forgivingBase64Decode,
  AssertionError,
  assert,
  serializeJSValueToJSONString,
};

// packages/deno/runtime/src/ext/web/01_dom_exception.ts
window.__bootstrap.domException = { DOMException };

// packages/deno/runtime/src/ext/console/01_colors.ts
window.__bootstrap.colors = {
  bold,
  italic,
  yellow,
  cyan,
  red,
  green,
  bgRed,
  white,
  gray,
  magenta,
  stripColor,
  maybeColor,
  setNoColor,
  getNoColor,
};

// packages/deno/runtime/src/ext/console/02_console.ts
// Expose these fields to internalObject for tests.
window.__bootstrap.internals = {
  ...window.__bootstrap.internals ?? {},
  Console,
  cssToAnsi,
  inspectArgs,
  parseCss,
  parseCssColor,
};

// packages/deno/runtime/src/ext/console/02_console.ts
window.__bootstrap.console = {
  CSI,
  inspectArgs,
  Console,
  customInspect,
  inspect,
  wrapConsole,
  createFilteredInspectProxy,
  quoteString,
};

// packages/deno/runtime/src/ext/web/01_mimesniff.ts
window.__bootstrap.mimesniff = {
  parseMimeType,
  essence,
  serializeMimeType,
  extractMimeType,
};


// packages/deno/runtime/src/ext/web/02_event.ts
window.__bootstrap.eventTarget = {
  EventTarget,
  setEventTargetData,
  listenerCount,
};

// packages/deno/runtime/src/ext/web/02_event.ts
window.__bootstrap.event = {
  reportException,
  setIsTrusted,
  setTarget,
  defineEventHandler,
  Event,
  ErrorEvent,
  CloseEvent,
  MessageEvent,
  CustomEvent,
  ProgressEvent,
  PromiseRejectionEvent,
  reportError,
};

// packages/deno/runtime/src/ext/web/02_timers.ts
window.__bootstrap.timers = {
  setTimeout,
  setInterval,
  clearTimeout,
  clearInterval,
  handleTimerMacrotask,
  opNow,
  refTimer,
  unrefTimer,
};

// packages/deno/runtime/src/ext/web/03_abort_signal.ts
window.__bootstrap.abortSignal = {
  AbortSignal,
  AbortController,
  AbortSignalPrototype,
  add,
  signalAbort,
  remove,
  follow,
  newSignal,
};

// packages/deno/runtime/src/ext/web/04_global_interfaces.ts
window.__bootstrap.globalInterfaces = {
  DedicatedWorkerGlobalScope,
  Window,
  WorkerGlobalScope,
  dedicatedWorkerGlobalScopeConstructorDescriptor,
  windowConstructorDescriptor,
  workerGlobalScopeConstructorDescriptor,
};

// packages/deno/runtime/src/ext/web/02_structured_clone.ts
window.__bootstrap.structuredClone = structuredClone;

// packages/deno/runtime/src/ext/web/05_base64.ts
window.__bootstrap.base64 = {
  atob,
  btoa,
};

window.__bootstrap.fsEvents = {
    watchFs,
};

