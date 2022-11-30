// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/runtime/js/40_diagnostics.js

// Diagnostic provides an abstraction for advice/errors received from a
// compiler, which is strongly influenced by the format of TypeScript
// diagnostics.
"use strict";

export const DiagnosticCategory = {
  0: "Warning",
  1: "Error",
  2: "Suggestion",
  3: "Message",

  Warning: 0,
  Error: 1,
  Suggestion: 2,
  Message: 3,
};


