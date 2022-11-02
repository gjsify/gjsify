// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Forked from https://github.com/denoland/deno/blob/main/runtime/js/01_build.js
"use strict";

((window: typeof globalThis) => {
  const { ObjectFreeze, StringPrototypeSplit } = window.__bootstrap.primordials;

  const build = {
    target: "unknown",
    arch: "unknown",
    os: "unknown",
    vendor: "unknown",
    env: undefined as string | undefined
  };

  function setBuildInfo(target: string) {
    const [arch, vendor, os, env] = StringPrototypeSplit(target, "-" as any, 4);
    build.target = target;
    build.arch = arch;
    build.vendor = vendor;
    build.os = os;
    build.env = env;
    ObjectFreeze(build);
  }

  window.__bootstrap.build = {
    build,
    setBuildInfo,
  };
})(this);