// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Forked from https://github.com/denoland/deno/blob/main/core/internal.d.ts

// Based on https://github.com/nodejs/node/blob/889ad35d3d41e376870f785b0c1b669cb732013d/typings/primordials.d.ts
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
// This file subclasses and stores the JS builtins that come from the VM
// so that Node.js's builtin modules do not need to later look these up from
// the global proxy, which can be mutated by users.

/// <reference no-default-lib="true" />
/// <reference lib="esnext" />

import type { Primordials } from '@gjsify/deno_core';
import type { Build, Errors, Version } from './index.js';
import type { 
  Console,
  cssToAnsi,
  inspectArgs,
  parseCss,
  parseCssColor,
  CSI,
  customInspect,
  inspect,
  wrapConsole,
  createFilteredInspectProxy,
  quoteString,
} from '../ext/console/02_console.js';

export interface Bootstrap {
    /**
     * Primordials are a way to safely use globals without fear of global mutation
     * Generally, this means removing `this` parameter usage and instead using
     * a regular parameter:
     *
     * @example
     *
     * ```js
     * 'thing'.startsWith('hello');
     * ```
     *
     * becomes
     *
     * ```js
     * primordials.StringPrototypeStartsWith('thing', 'hello')
     * ```
     */
    primordials: Primordials;
    build: Build;
    errors: {
      errors: Errors;
    }
    version: Version;
    internals: {
      // packages/deno/runtime/src/ext/console/02_console.ts
      Console: typeof Console;
      cssToAnsi: typeof cssToAnsi;
      inspectArgs: typeof inspectArgs;
      parseCss: typeof parseCss;
      parseCssColor: typeof parseCssColor;
    }
    console: {
      CS: typeof CSI;
      inspectArg: typeof inspectArgs;
      Consol: typeof Console;
      customInspec: typeof customInspect;
      inspec: typeof inspect;
      wrapConsol: typeof wrapConsole;
      createFilteredInspectProx: typeof createFilteredInspectProxy;
      quoteStrin: typeof quoteString;
    }
  }
  