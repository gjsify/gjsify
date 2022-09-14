// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Copyright Joyent, Inc. and Node.js contributors. All rights reserved. MIT license.

import { notImplemented } from "@gjsify/utils";
import { Buffer } from "buffer";
import { BinaryLike } from "./types.js";

export class Certificate {
  static Certificate = Certificate;
  static exportChallenge(_spkac: BinaryLike, _encoding?: string): Buffer {
    notImplemented("crypto.Certificate.exportChallenge");
  }

  static exportPublicKey(_spkac: BinaryLike, _encoding?: string): Buffer {
    notImplemented("crypto.Certificate.exportPublicKey");
  }

  static verifySpkac(_spkac: BinaryLike, _encoding?: string): boolean {
    notImplemented("crypto.Certificate.verifySpkac");
  }
}

export default Certificate;
