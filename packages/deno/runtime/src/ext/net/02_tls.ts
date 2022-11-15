// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/net/02_tls.js

"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as core from '../../core/01_core.js';
import * as ops from '../../ops/index.js';
import { Listener, Conn } from './01_net.js';
const { TypeError } = primordials;

function opStartTls(args) {
  return core.opAsync("op_tls_start", args);
}

function opTlsHandshake(rid) {
  return core.opAsync("op_tls_handshake", rid);
}

export class TlsConn extends Conn {
  handshake() {
    return opTlsHandshake(this.rid);
  }
}

export async function connectTls({
  port,
  hostname = "127.0.0.1",
  transport = "tcp",
  certFile = undefined,
  caCerts = [],
  certChain = undefined,
  privateKey = undefined,
  alpnProtocols = undefined,
}) {
  if (transport !== "tcp") {
    throw new TypeError(`Unsupported transport: '${transport}'`);
  }
  const [rid, localAddr, remoteAddr] = await core.opAsync(
    "op_net_connect_tls",
    { hostname, port },
    { certFile, caCerts, certChain, privateKey, alpnProtocols },
  );
  localAddr.transport = "tcp";
  remoteAddr.transport = "tcp";
  return new TlsConn(rid, remoteAddr, localAddr);
}

export class TlsListener extends Listener {
  async accept() {
    const [rid, localAddr, remoteAddr] = await core.opAsync(
      "op_net_accept_tls",
      this.rid,
    );
    localAddr.transport = "tcp";
    remoteAddr.transport = "tcp";
    return new TlsConn(rid, remoteAddr, localAddr);
  }
}

export function listenTls({
  port,
  cert,
  certFile,
  key,
  keyFile,
  hostname = "0.0.0.0",
  transport = "tcp",
  alpnProtocols = undefined,
  reusePort = false,
}) {
  if (transport !== "tcp") {
    throw new TypeError(`Unsupported transport: '${transport}'`);
  }
  const [rid, localAddr] = ops.op_net_listen_tls(
    { hostname, port },
    { cert, certFile, key, keyFile, alpnProtocols, reusePort },
  );
  return new TlsListener(rid, localAddr);
}

export async function startTls(
  conn,
  {
    hostname = "127.0.0.1",
    certFile = undefined,
    caCerts = [],
    alpnProtocols = undefined,
  } = {},
) {
  const [rid, localAddr, remoteAddr] = await opStartTls({
    rid: conn.rid,
    hostname,
    certFile,
    caCerts,
    alpnProtocols,
  });
  return new TlsConn(rid, remoteAddr, localAddr);
}
