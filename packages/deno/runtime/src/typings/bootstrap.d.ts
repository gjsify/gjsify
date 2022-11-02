// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Forked from https://github.com/denoland/deno/blob/main/core/internal.d.ts

import type { Bootstrap } from '../types/bootstrap.js';

declare global {
    var __bootstrap: Bootstrap
}

export {}