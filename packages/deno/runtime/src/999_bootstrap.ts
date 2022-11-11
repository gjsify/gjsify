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

// packages/deno/runtime/src/ext/web/06_streams.ts
window.__bootstrap.streams = {
  // Non-Public
  _state,
  isReadableStreamDisturbed,
  errorReadableStream,
  createProxy,
  writableStreamClose,
  readableStreamClose,
  readableStreamCollectIntoUint8Array,
  readableStreamDisturb,
  readableStreamForRid,
  readableStreamForRidUnrefable,
  readableStreamForRidUnrefableRef,
  readableStreamForRidUnrefableUnref,
  readableStreamThrowIfErrored,
  getReadableStreamResourceBacking,
  writableStreamForRid,
  getWritableStreamResourceBacking,
  Deferred,
  // Exposed in global runtime scope
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
  ReadableStream,
  ReadableStreamPrototype,
  ReadableStreamDefaultReader,
  TransformStream,
  WritableStream,
  WritableStreamDefaultWriter,
  WritableStreamDefaultController,
  ReadableByteStreamController,
  ReadableStreamBYOBReader,
  ReadableStreamBYOBRequest,
  ReadableStreamDefaultController,
  TransformStreamDefaultController,
};

// packages/deno/runtime/src/ext/web/08_text_encoding.ts
window.__bootstrap.encoding = {
  TextEncoder,
  TextDecoder,
  TextEncoderStream,
  TextDecoderStream,
  decode,
};

// packages/deno/runtime/src/ext/web/09_file.ts
window.__bootstrap.file = {
  blobFromObjectUrl,
  getParts,
  Blob,
  BlobPrototype,
  File,
  FilePrototype,
};

// packages/deno/runtime/src/ext/web/10_filereader.ts
window.__bootstrap.fileReader = {
  FileReader,
};

// packages/deno/runtime/src/ext/web/12_location.ts
window.__bootstrap.location = {
  locationConstructorDescriptor,
  workerLocationConstructorDescriptor,
  locationDescriptor,
  workerLocationDescriptor,
  setLocationHref,
  getLocationHref,
};

// packages/deno/runtime/src/ext/web/13_message_port.ts
window.__bootstrap.messagePort = {
  MessageChannel,
  MessagePort,
  MessagePortPrototype,
  deserializeJsMessageData,
  serializeJsMessageData,
  structuredClone,
};

// packages/deno/runtime/src/ext/web/14_compression.ts
window.__bootstrap.compression = {
  CompressionStream,
  DecompressionStream,
};

// packages/deno/runtime/src/ext/web/15_performance.ts
window.__bootstrap.performance = {
  PerformanceEntry,
  PerformanceMark,
  PerformanceMeasure,
  Performance,
  performance,
  setTimeOrigin,
};

// packages/deno/runtime/src/10_permissions.ts
window.__bootstrap.permissions = {
  serializePermissions,
  permissions,
  Permissions,
  PermissionStatus,
};

// packages/deno/runtime/src/11_workers.ts
window.__bootstrap.worker = {
  Worker,
};

// packages/deno/runtime/src/12_io.ts
window.__bootstrap.io = {
  iterSync,
  iter,
  copy,
  SeekMode,
  read,
  readSync,
  write,
  writeSync,
  readAll,
  readAllInner,
  readAllSync,
  readAllSyncSized,
  readAllInnerSized,
};

// packages/deno/runtime/src/13_buffer.ts
window.__bootstrap.buffer = {
  writeAll,
  writeAllSync,
  readAll,
  readAllSync,
  Buffer,
};

// packages/deno/runtime/src/30_fs.ts
window.__bootstrap.fs = {
  cwd,
  chdir,
  chmodSync,
  chmod,
  chown,
  chownSync,
  copyFile,
  copyFileSync,
  makeTempFile,
  makeTempDir,
  makeTempFileSync,
  makeTempDirSync,
  mkdir,
  mkdirSync,
  readDir,
  readDirSync,
  readLinkSync,
  readLink,
  realPathSync,
  realPath,
  remove,
  removeSync,
  renameSync,
  rename,
  lstat,
  lstatSync,
  stat,
  statSync,
  ftruncate,
  ftruncateSync,
  truncate,
  truncateSync,
  umask,
  link,
  linkSync,
  fstatSync,
  fstat,
  futime,
  futimeSync,
  utime,
  utimeSync,
  symlink,
  symlinkSync,
  fdatasync,
  fdatasyncSync,
  fsync,
  fsyncSync,
  flock,
  flockSync,
  funlock,
  funlockSync,
};

// packages/deno/runtime/src/30_os.ts
window.__bootstrap.os = {
  env,
  execPath,
  exit,
  gid,
  hostname,
  loadavg,
  networkInterfaces,
  osRelease,
  setExitHandler,
  systemMemoryInfo,
  uid,
};

// packages/deno/runtime/src/40_diagnostics.ts
window.__bootstrap.diagnostics = {
  DiagnosticCategory,
};

// packages/deno/runtime/src/40_fs_events.ts
window.__bootstrap.fsEvents = {
  watchFs,
};

// packages/deno/runtime/src/40_files.ts
window.__bootstrap.files = {
  stdin,
  stdout,
  stderr,
  File: FsFile,
  FsFile,
  create,
  createSync,
  open,
  openSync,
  seek,
  seekSync,
};