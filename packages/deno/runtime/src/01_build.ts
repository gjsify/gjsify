// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Forked from https://github.com/denoland/deno/blob/main/runtime/js/01_build.js
"use strict";

import { primordials } from '@gjsify/deno_core';

const { ObjectFreeze, StringPrototypeSplit } = primordials;

export const build = {
  target: "unknown",
  arch: "unknown",
  os: "unknown",
  vendor: "unknown",
  env: undefined as string | undefined
};

export function setBuildInfo(target: string) {
  const [arch, vendor, os, env] = StringPrototypeSplit(target, "-" as any, 4);
  build.target = target;
  build.arch = arch;
  build.vendor = vendor;
  build.os = os;
  build.env = env;
  ObjectFreeze(build);
}
