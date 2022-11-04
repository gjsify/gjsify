// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Forked from https://github.com/denoland/deno/blob/main/runtime/js/01_errors.js
"use strict";

((window: typeof globalThis) => {
  const core = window.Deno.core;
  const { Error } = window.__bootstrap.primordials;
  const { BadResource, Interrupted } = core;

  class NotFound extends Error {
    name = "NotFound"
    constructor(msg: string) {
      super(msg);
    }
  }

  class PermissionDenied extends Error {
    name = "PermissionDenied";
    constructor(msg: string) {
      super(msg);
    }
  }

  class ConnectionRefused extends Error {
    name = "ConnectionRefused";
    constructor(msg: string) {
      super(msg);
    }
  }

  class ConnectionReset extends Error {
    name = "ConnectionReset";
    constructor(msg: string) {
      super(msg);
    }
  }

  class ConnectionAborted extends Error {
    name = "ConnectionAborted";
    constructor(msg: string) {
      super(msg);
    }
  }

  class NotConnected extends Error {
    name = "NotConnected";
    constructor(msg: string) {
      super(msg);
    }
  }

  class AddrInUse extends Error {
    name = "AddrInUse"
    constructor(msg: string) {
      super(msg);
    }
  }

  class AddrNotAvailable extends Error {
    name = "AddrNotAvailable"
    constructor(msg: string) {
      super(msg);
    }
  }

  class BrokenPipe extends Error {
    name = "BrokenPipe"
    constructor(msg: string) {
      super(msg);
    }
  }

  class AlreadyExists extends Error {
    name = "AlreadyExists"
    constructor(msg: string) {
      super(msg);
    }
  }

  class InvalidData extends Error {
    name = "InvalidData"
    constructor(msg: string) {
      super(msg);
    }
  }

  class TimedOut extends Error {
    name = "TimedOut"
    constructor(msg: string) {
      super(msg);
    }
  }

  class WriteZero extends Error {
    name = "WriteZero"
    constructor(msg: string) {
      super(msg);
    }
  }

  class UnexpectedEof extends Error {
    name = "UnexpectedEof"
    constructor(msg: string) {
      super(msg);
    }
  }

  class Http extends Error {
    name = "Http"
    constructor(msg: string) {
      super(msg);
    }
  }

  class Busy extends Error {
    name = "Busy"
    constructor(msg: string) {
      super(msg);
    }
  }

  class NotSupported extends Error {
    name = "NotSupported"
    constructor(msg: string) {
      super(msg);
    }
  }

  const errors = {
    NotFound,
    PermissionDenied,
    ConnectionRefused,
    ConnectionReset,
    ConnectionAborted,
    NotConnected,
    AddrInUse,
    AddrNotAvailable,
    BrokenPipe,
    AlreadyExists,
    InvalidData,
    TimedOut,
    Interrupted,
    WriteZero,
    UnexpectedEof,
    BadResource,
    Http,
    Busy,
    NotSupported,
  };

  window.__bootstrap.errors = {
    errors,
  };
})(this);
