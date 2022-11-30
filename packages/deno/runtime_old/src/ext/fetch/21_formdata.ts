// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/fetch/21_formdata.js

// @ts-check
// <reference path="../webidl/internal.d.ts" />
// <reference path="../web/internal.d.ts" />
// <reference path="../web/lib.deno_web.d.ts" />
// <reference path="./internal.d.ts" />
// <reference path="../web/06_streams_types.d.ts" />
// <reference path="./lib.deno_fetch.d.ts" />
// <reference lib="esnext" />

"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as core from '../../core/01_core.js';
import * as webidl from '../webidl/00_webidl.js';
import { Blob, BlobPrototype, File, FilePrototype } from '../web/09_file.js';
const {
  ArrayPrototypePush,
  ArrayPrototypeSlice,
  ArrayPrototypeSplice,
  Map,
  MapPrototypeGet,
  MapPrototypeSet,
  MathRandom,
  ObjectPrototypeIsPrototypeOf,
  Symbol,
  StringFromCharCode,
  StringPrototypeTrim,
  StringPrototypeSlice,
  StringPrototypeSplit,
  StringPrototypeReplace,
  StringPrototypeIndexOf,
  StringPrototypePadStart,
  StringPrototypeCodePointAt,
  StringPrototypeReplaceAll,
  TypeError,
  TypedArrayPrototypeSubarray,
} = primordials;

import type { BodyInit } from './lib.deno_fetch';

const entryList = Symbol("entry list");

function createEntry(name: string, value: string | Blob, filename: string | undefined): FormDataEntry {
  if (
    ObjectPrototypeIsPrototypeOf(BlobPrototype, value) &&
    !ObjectPrototypeIsPrototypeOf(FilePrototype, value)
  ) {
    value = new File([value], "blob", { type: (value as Blob).type });
  }
  if (
    ObjectPrototypeIsPrototypeOf(FilePrototype, value) &&
    filename !== undefined
  ) {
    value = new File([value], filename, {
      type: (value as File).type,
      lastModified: (value as File).lastModified,
    });
  }
  return {
    name,
    // @ts-expect-error because TS is not smart enough
    value,
  };
}

export interface FormDataEntry {
  name: string;
  value: FormDataEntryValue;
}

/** Provides a way to easily construct a set of key/value pairs representing
 * form fields and their values, which can then be easily sent using the
 * XMLHttpRequest.send() method. It uses the same format a form would use if the
 * encoding type were set to "multipart/form-data".
 *
 * @category Fetch API
 */
export interface FormData {
  append(name: string, value: string | Blob, fileName?: string): void;
  delete(name: string): void;
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
  has(name: string): boolean;
  set(name: string, value: string | Blob, fileName?: string): void;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  entries(): IterableIterator<[string, FormDataEntryValue]>;
  [Symbol.iterator](): IterableIterator<[string, FormDataEntryValue]>;
  forEach(
    callback: (value: FormDataEntryValue, key: string, parent: this) => void,
    thisArg?: any,
  ): void;
}

/** Provides a way to easily construct a set of key/value pairs representing
 * form fields and their values, which can then be easily sent using the
 * XMLHttpRequest.send() method. It uses the same format a form would use if the
 * encoding type were set to "multipart/form-data".
 *
 * @category Fetch API
 */
export class FormData {
  // @ts-ignore
  [entryList]: FormDataEntry[] = [];

  constructor(form?: undefined) {
    if (form !== undefined) {
      webidl.illegalConstructor();
    }
    this[webidl.brand] = webidl.brand;
  }

  append(name: string, valueOrBlobValue: string | Blob, filename?: string): void {
    webidl.assertBranded(this, FormDataPrototype);
    const prefix = "Failed to execute 'append' on 'FormData'";
    webidl.requiredArguments(arguments.length, 2, { prefix });

    name = webidl.converters["USVString"](name, {
      prefix,
      context: "Argument 1",
    });
    if (ObjectPrototypeIsPrototypeOf(BlobPrototype, valueOrBlobValue)) {
      valueOrBlobValue = webidl.converters["Blob"](valueOrBlobValue, {
        prefix,
        context: "Argument 2",
      });
      if (filename !== undefined) {
        filename = webidl.converters["USVString"](filename, {
          prefix,
          context: "Argument 3",
        });
      }
    } else {
      valueOrBlobValue = webidl.converters["USVString"](valueOrBlobValue, {
        prefix,
        context: "Argument 2",
      });
    }

    const entry = createEntry(name, valueOrBlobValue, filename);

    ArrayPrototypePush(this[entryList], entry);
  }

  delete(name: string): void {
    webidl.assertBranded(this, FormDataPrototype);
    const prefix = "Failed to execute 'name' on 'FormData'";
    webidl.requiredArguments(arguments.length, 1, { prefix });

    name = webidl.converters["USVString"](name, {
      prefix,
      context: "Argument 1",
    });

    const list = this[entryList];
    for (let i = 0; i < list.length; i++) {
      if (list[i].name === name) {
        ArrayPrototypeSplice(list, i, 1);
        i--;
      }
    }
  }

  get(name: string): FormDataEntryValue | null {
    webidl.assertBranded(this, FormDataPrototype);
    const prefix = "Failed to execute 'get' on 'FormData'";
    webidl.requiredArguments(arguments.length, 1, { prefix });

    name = webidl.converters["USVString"](name, {
      prefix,
      context: "Argument 1",
    });

    for (const entry of this[entryList]) {
      if (entry.name === name) return entry.value;
    }
    return null;
  }

  getAll(name: string): FormDataEntryValue[] {
    webidl.assertBranded(this, FormDataPrototype);
    const prefix = "Failed to execute 'getAll' on 'FormData'";
    webidl.requiredArguments(arguments.length, 1, { prefix });

    name = webidl.converters["USVString"](name, {
      prefix,
      context: "Argument 1",
    });

    const returnList = [];
    for (const entry of this[entryList]) {
      if (entry.name === name) ArrayPrototypePush(returnList, entry.value);
    }
    return returnList;
  }

  has(name: string): boolean {
    webidl.assertBranded(this, FormDataPrototype);
    const prefix = "Failed to execute 'has' on 'FormData'";
    webidl.requiredArguments(arguments.length, 1, { prefix });

    name = webidl.converters["USVString"](name, {
      prefix,
      context: "Argument 1",
    });

    for (const entry of this[entryList]) {
      if (entry.name === name) return true;
    }
    return false;
  }

  set(name: string, valueOrBlobValue: string | Blob, filename?: string): void {
    webidl.assertBranded(this, FormDataPrototype);
    const prefix = "Failed to execute 'set' on 'FormData'";
    webidl.requiredArguments(arguments.length, 2, { prefix });

    name = webidl.converters["USVString"](name, {
      prefix,
      context: "Argument 1",
    });
    if (ObjectPrototypeIsPrototypeOf(BlobPrototype, valueOrBlobValue)) {
      valueOrBlobValue = webidl.converters["Blob"](valueOrBlobValue, {
        prefix,
        context: "Argument 2",
      });
      if (filename !== undefined) {
        filename = webidl.converters["USVString"](filename, {
          prefix,
          context: "Argument 3",
        });
      }
    } else {
      valueOrBlobValue = webidl.converters["USVString"](valueOrBlobValue, {
        prefix,
        context: "Argument 2",
      });
    }

    const entry = createEntry(name, valueOrBlobValue, filename);

    const list = this[entryList];
    let added = false;
    for (let i = 0; i < list.length; i++) {
      if (list[i].name === name) {
        if (!added) {
          list[i] = entry;
          added = true;
        } else {
          ArrayPrototypeSplice(list, i, 1);
          i--;
        }
      }
    }
    if (!added) {
      ArrayPrototypePush(list, entry);
    }
  }
}

webidl.mixinPairIterable("FormData", FormData, entryList, "name", "value");

webidl.configurePrototype(FormData);
export const FormDataPrototype = FormData.prototype;

const escape = (str: string, isFilename?: boolean) => {
  const escapeMap = {
    "\n": "%0A",
    "\r": "%0D",
    '"': "%22",
  };

  return StringPrototypeReplace(
    isFilename ? str : StringPrototypeReplace(str, /\r?\n|\r/g, "\r\n" as any),
    /([\n\r"])/g,
    (c) => escapeMap[c],
  );
};

/**
 * convert FormData to a Blob synchronous without reading all of the files
 */
export function formDataToBlob(formData: FormData) {
  const boundary = StringPrototypePadStart(
    StringPrototypeSlice(
      StringPrototypeReplaceAll(`${MathRandom()}${MathRandom()}`, ".", "" as any),
      -28,
    ),
    32,
    "-",
  );
  const chunks = [];
  const prefix = `--${boundary}\r\nContent-Disposition: form-data; name="`;

  // @ts-ignore
  for (const [name, value] of formData) {
    if (typeof value === "string") {
      ArrayPrototypePush(
        chunks,
        prefix + escape(name) + '"' + CRLF + CRLF +
          StringPrototypeReplace(value, /\r(?!\n)|(?<!\r)\n/g, CRLF as any) + CRLF,
      );
    } else {
      ArrayPrototypePush(
        chunks,
        prefix + escape(name) + `"; filename="${escape(value.name, true)}"` +
          CRLF +
          `Content-Type: ${value.type || "application/octet-stream"}\r\n\r\n`,
        value,
        CRLF,
      );
    }
  }

  ArrayPrototypePush(chunks, `--${boundary}--`);

  return new Blob(chunks, {
    type: "multipart/form-data; boundary=" + boundary,
  });
}

function parseContentDisposition(value: string): Map<string, string> {
  /** @type {Map<string, string>} */
  const params = new Map();
  // Forced to do so for some Map constructor param mismatch
  const values = ArrayPrototypeSlice(StringPrototypeSplit(value, ";" as any), 1);
  for (let i = 0; i < values.length; i++) {
    const entries = StringPrototypeSplit(StringPrototypeTrim(values[i]), "=" as any);
    if (entries.length > 1) {
      MapPrototypeSet(
        params,
        entries[0],
        StringPrototypeReplace(entries[1], /^"([^"]*)"$/, "$1" as any),
      );
    }
  }
  return params;
}

const CRLF = "\r\n";
const LF = StringPrototypeCodePointAt(CRLF, 1);
const CR = StringPrototypeCodePointAt(CRLF, 0);

class MultipartParser {

  boundary: string;
  body: Uint8Array;
  boundaryChars: Uint8Array;

  constructor(body: Uint8Array, boundary: string | undefined) {
    if (!boundary) {
      throw new TypeError("multipart/form-data must provide a boundary");
    }

    this.boundary = `--${boundary}`;
    this.body = body;
    this.boundaryChars = core.encode(this.boundary);
  }

  #parseHeaders(headersText: string): { headers: Headers, disposition: Map<string, string> } {
    const headers = new Headers();
    const rawHeaders = StringPrototypeSplit(headersText, "\r\n" as any);
    for (const rawHeader of rawHeaders) {
      const sepIndex = StringPrototypeIndexOf(rawHeader, ":");
      if (sepIndex < 0) {
        continue; // Skip this header
      }
      const key = StringPrototypeSlice(rawHeader, 0, sepIndex);
      const value = StringPrototypeSlice(rawHeader, sepIndex + 1);
      headers.set(key, value);
    }

    const disposition = parseContentDisposition(
      headers.get("Content-Disposition") ?? "",
    );

    return { headers, disposition };
  }

  parse(): FormData {
    // To have fields body must be at least 2 boundaries + \r\n + --
    // on the last boundary.
    if (this.body.length < (this.boundary.length * 2) + 4) {
      const decodedBody = core.decode(this.body);
      const lastBoundary = this.boundary + "--";
      // check if it's an empty valid form data
      if (
        decodedBody === lastBoundary ||
        decodedBody === lastBoundary + "\r\n"
      ) {
        return new FormData();
      }
      throw new TypeError("Unable to parse body as form data.");
    }

    const formData = new FormData();
    let headerText = "";
    let boundaryIndex = 0;
    let state = 0;
    let fileStart = 0;

    for (let i = 0; i < this.body.length; i++) {
      const byte = this.body[i];
      const prevByte = this.body[i - 1];
      const isNewLine = byte === LF && prevByte === CR;

      if (state === 1 || state === 2 || state == 3) {
        headerText += StringFromCharCode(byte);
      }
      if (state === 0 && isNewLine) {
        state = 1;
      } else if (state === 1 && isNewLine) {
        state = 2;
        const headersDone = this.body[i + 1] === CR &&
          this.body[i + 2] === LF;

        if (headersDone) {
          state = 3;
        }
      } else if (state === 2 && isNewLine) {
        state = 3;
      } else if (state === 3 && isNewLine) {
        state = 4;
        fileStart = i + 1;
      } else if (state === 4) {
        if (this.boundaryChars[boundaryIndex] !== byte) {
          boundaryIndex = 0;
        } else {
          boundaryIndex++;
        }

        if (boundaryIndex >= this.boundary.length) {
          const { headers, disposition } = this.#parseHeaders(headerText);
          const content = TypedArrayPrototypeSubarray(
            this.body,
            fileStart,
            i - boundaryIndex - 1,
          );
          // https://fetch.spec.whatwg.org/#ref-for-dom-body-formdata
          const filename = MapPrototypeGet(disposition, "filename");
          const name = MapPrototypeGet(disposition, "name");

          state = 5;
          // Reset
          boundaryIndex = 0;
          headerText = "";

          if (!name) {
            continue; // Skip, unknown name
          }

          if (filename) {
            const blob = new Blob([content], {
              type: headers.get("Content-Type") || "application/octet-stream",
            });
            formData.append(name, blob, filename);
          } else {
            formData.append(name, core.decode(content));
          }
        }
      } else if (state === 5 && isNewLine) {
        state = 1;
      }
    }

    return formData;
  }
}

export function parseFormData(body: Uint8Array, boundary: string | undefined): FormData {
  const parser = new MultipartParser(body, boundary);
  return parser.parse();
}

export function formDataFromEntries(entries: FormDataEntry[]): FormData {
  const fd = new FormData();
  fd[entryList] = entries;
  return fd;
}

webidl.converters["FormData"] = webidl
  .createInterfaceConverter("FormData", FormDataPrototype);
