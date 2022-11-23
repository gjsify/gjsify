import { primordials } from '../core/00_primordials.js'

import * as build from './01_build.js';
import * as errors from './01_errors.js';
import * as version from './01_version.js';
import * as webUtil from './01_web_util.js';
import * as util from './06_util.js';

import * as webidl from '../ext/webidl/00_webidl.js';
import * as url from '../ext/url/00_url.js';
import * as urlPattern from '../ext/url/01_urlpattern.js';
import * as infra from '../ext/web/00_infra.js';
import * as domException from '../ext/web/01_dom_exception.js';
import * as colors from '../ext/console/01_colors.js';
import * as console from '../ext/console/02_console.js';
import * as mimesniff from '../ext/web/01_mimesniff.js';
import * as event from '../ext/web/02_event.js';
import * as timers from '../ext/web/02_timers.js';
import * as abortSignal from '../ext/web/03_abort_signal.js';
import * as globalInterfaces from '../ext/web/04_global_interfaces.js';
import * as structuredClone from '../ext/web/02_structured_clone.js';
import * as base64 from '../ext/web/05_base64.js';
import * as streams from '../ext/web/06_streams.js';
import * as encoding from '../ext/web/08_text_encoding.js';
import * as file from '../ext/web/09_file.js';
import * as fileReader from '../ext/web/10_filereader.js';
import * as location from '../ext/web/12_location.js';
import * as messagePort from '../ext/web/13_message_port.js';
import * as compression from '../ext/web/14_compression.js';
import * as performance from '../ext/web/15_performance.js';

import * as permissions from './10_permissions.js';
import * as worker from './11_workers.js';
import * as io from './12_io.js';
import * as buffer from './13_buffer.js';
import * as fs from './30_fs.js';
import * as os from './30_os.js';
import * as diagnostics from './40_diagnostics.js';
import * as files from './40_files.js';
import * as fsEvents from './40_fs_events.js';
import * as http from './40_http.js';
import * as process from './40_process.js';
import * as readFile from './40_read_file.js';
import * as signals from './40_signals.js';
import * as spawn from './40_spawn.js';
import * as testing from './40_testing.js';
import * as tty from './40_tty.js';
import * as writeFile from './40_write_file.js';
import * as prompt from './41_prompt.js';

import * as ffi from '../ext/ffi/00_ffi.js';
import * as net from '../ext/net/01_net.js';
import * as tls from '../ext/net/02_tls.js';
import * as extHttp from '../ext/http/01_http.js';
import * as caches from '../ext/cache/01_cache.js';

import { fetchUtil, headers, formData, fetchBody, fetch } from '../ext/fetch/99_bootstrap';

import * as webgpu from '../ext/webgpu/01_webgpu.js';
import * as webSocket from '../ext/websocket/01_websocket.js';
import { WebSocketStream } from '../ext/websocket/02_websocketstream.js';
import * as flash from '../ext/flash/01_http.js';
import * as broadcastChannel from '../ext/broadcast_channel/01_broadcast_channel.js';

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
  fetch: {
    ...fetch,
    Response,
  },
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
};

// packages/deno/runtime/src/core/02_error.ts
// ObjectAssign(globalThis.__bootstrap.core, { prepareStackTrace });
// ObjectFreeze(globalThis.__bootstrap.core);
