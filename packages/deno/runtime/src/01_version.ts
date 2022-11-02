// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Forked from https://raw.githubusercontent.com/denoland/deno/main/runtime/js/01_version.js
"use strict";

((window) => {
  const { ObjectFreeze } = window.__bootstrap.primordials;

  const version = {
    deno: "",
    v8: "",
    typescript: "",
  };

  function setVersions(
    denoVersion: string,
    v8Version: string,
    tsVersion: string,
  ) {
    version.deno = denoVersion;
    version.v8 = v8Version;
    version.typescript = tsVersion;

    ObjectFreeze(version);
  }

  window.__bootstrap.version = {
    version,
    setVersions,
  };
})(this);
