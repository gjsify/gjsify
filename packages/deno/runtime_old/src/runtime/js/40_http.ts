// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/runtime/js/40_http.js
"use strict";

import * as ops from '../../ops/index.js';
import { HttpConn } from '../../ext/http/01_http.js';

import type {
  Conn,
} from '../../types/index.js';

/**
 * Provides an interface to handle HTTP request and responses over TCP or TLS
 * connections. The method returns an {@linkcode HttpConn} which yields up
 * {@linkcode RequestEvent} events, which utilize the web platform standard
 * {@linkcode Request} and {@linkcode Response} objects to handle the request.
 *
 * ```ts
 * const conn = Deno.listen({ port: 80 });
 * const httpConn = Deno.serveHttp(await conn.accept());
 * const e = await httpConn.nextRequest();
 * if (e) {
 *   e.respondWith(new Response("Hello World"));
 * }
 * ```
 *
 * Alternatively, you can also use the async iterator approach:
 *
 * ```ts
 * async function handleHttp(conn: Deno.Conn) {
 *   for await (const e of Deno.serveHttp(conn)) {
 *     e.respondWith(new Response("Hello World"));
 *   }
 * }
 *
 * for await (const conn of Deno.listen({ port: 80 })) {
 *   handleHttp(conn);
 * }
 * ```
 *
 * If `httpConn.nextRequest()` encounters an error or returns `null` then the
 * underlying {@linkcode HttpConn} resource is closed automatically.
 *
 * Also see the experimental Flash HTTP server {@linkcode Deno.serve} which
 * provides a ground up rewrite of handling of HTTP requests and responses
 * within the Deno CLI.
 *
 * Note that this function *consumes* the given connection passed to it, thus
 * the original connection will be unusable after calling this. Additionally,
 * you need to ensure that the connection is not being used elsewhere when
 * calling this function in order for the connection to be consumed properly.
 *
 * For instance, if there is a `Promise` that is waiting for read operation on
 * the connection to complete, it is considered that the connection is being
 * used elsewhere. In such a case, this function will fail.
 *
 * @category HTTP Server
 */
export function serveHttp(conn: Conn): HttpConn {
  const rid = ops.op_http_start(conn.rid);
  return new HttpConn(rid, conn.remoteAddr, conn.localAddr);
}

