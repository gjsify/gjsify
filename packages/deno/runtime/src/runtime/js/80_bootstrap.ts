import {
  primordials,
  build,
  errors,
  version,
  webUtil,
  util,
  webidl,
  url,
  urlPattern,
  infra,
  domException,
  colors,
  console,
  mimesniff,
  event,
  timers,
  abortSignal,
  globalInterfaces,
  structuredClone,
  base64,
  streams,
  encoding,
  file,
  fileReader,
  location,
  messagePort,
  compression,
  performance,
  permissions,
  worker,
  io,
  buffer,
  fs,
  os,
  diagnostics,
  files,
  fsEvents,
  http,
  process,
  readFile,
  signals,
  spawn,
  testing,
  tty,
  writeFile,
  prompt,
  ffi,
  net,
  tls,
  extHttp,
  caches,
  fetchUtil,
  headers,
  formData,
  fetchBody,
  fetch,
  webgpu,
  webSocket,
  WebSocketStream,
  flash,
  broadcastChannel,
  webStorage,
  crypto,
} from './index.js';

export const __bootstrap = {
  // https://github.com/denoland/deno/blob/main/core/00_primordials.js
  // Provide bootstrap namespace
  primordials,
  build,
  errors: {
    errors
  },
  version,
  webUtil,
  internals: {
    pathFromURL: util.pathFromURL,
    // packages/deno/runtime/src/ext/console/02_console.ts
    // Expose these fields to internalObject for tests.
    Console: console.Console,
    cssToAnsi: console.cssToAnsi,
    inspectArgs: console.inspectArgs,
    parseCss: console.parseCss,
    parseCssColor: console.parseCssColor,
  },
  webidl,
  // packages/deno/runtime/src/ext/url/00_url.ts
  url,
  // packages/deno/runtime/src/ext/url/01_urlpattern.ts
  urlPattern,
  util,
  // packages/deno/runtime/src/ext/web/00_infra.ts
  infra,
  // packages/deno/runtime/src/ext/web/01_dom_exception.ts
  domException,
  // packages/deno/runtime/src/ext/console/01_colors.ts
  colors,
  // packages/deno/runtime/src/ext/console/02_console.ts
  console,
  // packages/deno/runtime/src/ext/web/01_mimesniff.ts
  mimesniff,
  // packages/deno/runtime/src/ext/web/02_event.ts
  eventTarget: {
    EventTarget: event.EventTarget,
    setEventTargetData: event.setEventTargetData,
    listenerCount: event.listenerCount,
  },
  // packages/deno/runtime/src/ext/web/02_event.ts
  event,
  // packages/deno/runtime/src/ext/web/02_timers.ts
  timers,
  // packages/deno/runtime/src/ext/web/03_abort_signal.ts
  abortSignal,
  // packages/deno/runtime/src/ext/web/04_global_interfaces.ts
  globalInterfaces,
  // packages/deno/runtime/src/ext/web/02_structured_clone.ts
  structuredClone,
  // packages/deno/runtime/src/ext/web/05_base64.ts
  base64,
  // packages/deno/runtime/src/ext/web/06_streams.ts
  streams,
  // packages/deno/runtime/src/ext/web/08_text_encoding.ts
  encoding,
  // packages/deno/runtime/src/ext/web/09_file.ts
  file,
  // packages/deno/runtime/src/ext/web/10_filereader.ts
  fileReader,
  // packages/deno/runtime/src/ext/web/12_location.ts
  location,
  // packages/deno/runtime/src/ext/web/13_message_port.ts
  messagePort,
  // packages/deno/runtime/src/ext/web/14_compression.ts
  compression,
  // packages/deno/runtime/src/ext/web/15_performance.ts
  performance,
  // packages/deno/runtime/src/10_permissions.ts
  permissions,
  // packages/deno/runtime/src/11_workers.ts
  worker,
  // packages/deno/runtime/src/12_io.ts
  io,
  // packages/deno/runtime/src/13_buffer.ts
  buffer,
  // packages/deno/runtime/src/30_fs.ts
  fs,
  // packages/deno/runtime/src/30_os.ts
  os,
  // packages/deno/runtime/src/40_diagnostics.ts
  diagnostics,
  // packages/deno/runtime/src/40_files.ts
  files,
  // packages/deno/runtime/src/40_fs_events.ts
  fsEvents,
  http: {
      // packages/deno/runtime/src/40_http.ts
    ...http,
    // packages/deno/runtime/src/ext/http/01_http.ts
    ...extHttp,
  },
  // packages/deno/runtime/src/40_process.ts
  process,
  // packages/deno/runtime/src/40_read_file.ts
  readFile,
  // packages/deno/runtime/src/40_signals.ts
  signals,
  // packages/deno/runtime/src/40_spawn.ts
  spawn,
  // packages/deno/runtime/src/40_testing.ts
  testing,
  // packages/deno/runtime/src/40_tty.ts
  tty,
  // packages/deno/runtime/src/40_write_file.ts
  writeFile,
  // packages/deno/runtime/src/41_prompt.ts
  prompt,
  // packages/deno/runtime/src/ext/ffi/00_ffi.ts
  ffi,
  // packages/deno/runtime/src/ext/net/01_net.ts
  net,
  // packages/deno/runtime/src/ext/net/02_tls.ts
  tls,

  // packages/deno/runtime/src/ext/fetch/01_fetch_util.ts
  fetchUtil,
  // packages/deno/runtime/src/ext/fetch/20_headers.ts
  headers,
  // packages/deno/runtime/src/ext/fetch/21_formdata.ts
  formData,
  // packages/deno/runtime/src/ext/fetch/22_body.ts
  fetchBody,
  // packages/deno/runtime/src/ext/fetch/22_http_client.ts
  // packages/deno/runtime/src/ext/fetch/23_request.ts
  // packages/deno/runtime/src/ext/fetch/26_fetch.ts
  fetch,
  // packages/deno/runtime/src/ext/cache/01_cache.ts
  caches,
  // packages/deno/runtime/src/ext/webgpu/01_webgpu.ts
  webgpu,

  // packages/deno/runtime/src/ext/websocket/01_websocket.ts
  webSocket: {
    ...webSocket,
    WebSocketStream,
  },

  // packages/deno/runtime/src/ext/flash/01_http.ts
  flash,

  // packages/deno/runtime/src/ext/broadcast_channel/01_broadcast_channel.ts
  broadcastChannel,

  // packages/deno/runtime/src/ext/webstorage/01_webstorage.ts
  webStorage,

  // packages/deno/runtime/src/ext/crypto/00_crypto.ts
  crypto,
};
