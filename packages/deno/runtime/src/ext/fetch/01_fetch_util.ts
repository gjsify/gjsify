// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/fetch/01_fetch_util.js

"use strict";

((window) => {
  const { TypeError } = window.__bootstrap.primordials;
  function requiredArguments(
    name,
    length,
    required,
  ) {
    if (length < required) {
      const errMsg = `${name} requires at least ${required} argument${
        required === 1 ? "" : "s"
      }, but only ${length} present`;
      throw new TypeError(errMsg);
    }
  }

  window.__bootstrap.fetchUtil = {
    requiredArguments,
  };
})(this);
