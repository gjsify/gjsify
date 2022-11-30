// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/runtime/js/01_errors.js
"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as core from '../../core/01_core.js';

const { Error } = primordials;
const { BadResource, Interrupted } = core;

export { BadResource, Interrupted }

export class NotFound extends Error {
  name = "NotFound"
  message: string;
  constructor(msg: string) {
    super(msg);
  }
}

export class PermissionDenied extends Error {
  name = "PermissionDenied";
  message: string;
  constructor(msg: string) {
    super(msg);
  }
}

export class ConnectionRefused extends Error {
  name = "ConnectionRefused";
  message: string;
  constructor(msg: string) {
    super(msg);
  }
}

export class ConnectionReset extends Error {
  name = "ConnectionReset";
  message: string;
  constructor(msg: string) {
    super(msg);
  }
}

export class ConnectionAborted extends Error {
  name = "ConnectionAborted";
  message: string;
  constructor(msg: string) {
    super(msg);
  }
}

export class NotConnected extends Error {
  name = "NotConnected";
  message: string;
  constructor(msg: string) {
    super(msg);
  }
}

export class AddrInUse extends Error {
  name = "AddrInUse"
  message: string;
  constructor(msg: string) {
    super(msg);
  }
}

export class AddrNotAvailable extends Error {
  name = "AddrNotAvailable"
  message: string;
  constructor(msg: string) {
    super(msg);
  }
}

export class BrokenPipe extends Error {
  name = "BrokenPipe";
  message: string;
  constructor(msg: string) {
    super(msg);
  }
}

export class AlreadyExists extends Error {
  name = "AlreadyExists";
  message: string;
  constructor(msg: string) {
    super(msg);
  }
}

export class InvalidData extends Error {
  name = "InvalidData";
  message: string;
  constructor(msg: string) {
    super(msg);
  }
}

export class TimedOut extends Error {
  name = "TimedOut";
  message: string;
  constructor(msg: string) {
    super(msg);
  }
}

export class WriteZero extends Error {
  name = "WriteZero";
  message: string;
  constructor(msg: string) {
    super(msg);
  }
}

export class UnexpectedEof extends Error {
  name = "UnexpectedEof"
  constructor(msg: string) {
    super(msg);
  }
}

export class Http extends Error {
  name = "Http";
  message: string;
  constructor(msg: string) {
    super(msg);
  }
}

export class Busy extends Error {
  name = "Busy";
  message: string;
  constructor(msg: string) {
    super(msg);
  }
}

export class NotSupported extends Error {
  name = "NotSupported";
  message: string;
  constructor(msg: string) {
    super(msg);
  }
}
