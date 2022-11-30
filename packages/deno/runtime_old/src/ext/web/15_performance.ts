// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/denoland/deno/blob/main/ext/web/15_performance.js

"use strict";

import { primordials } from '../../core/00_primordials.js';
const {
  ArrayPrototypeFilter,
  ArrayPrototypeFind,
  ArrayPrototypePush,
  ArrayPrototypeReverse,
  ArrayPrototypeSlice,
  ObjectKeys,
  ObjectPrototypeIsPrototypeOf,
  ReflectHas,
  Symbol,
  SymbolFor,
  TypeError,
} = primordials;

import * as webidl from '../webidl/00_webidl.js';
import { structuredClone } from './02_structured_clone.js';
import * as consoleInternal from '../console/02_console.js';
import { EventTarget } from './02_event.js';
import { opNow } from './02_timers.js';
import { DOMException } from './01_dom_exception.js';

const illegalConstructorKey = Symbol("illegalConstructorKey");
const customInspect = SymbolFor("Deno.customInspect");
let performanceEntries = [];
let timeOrigin;

webidl.converters["PerformanceMarkOptions"] = webidl
  .createDictionaryConverter(
    "PerformanceMarkOptions",
    [
      {
        key: "detail",
        converter: webidl.converters.any,
      },
      {
        key: "startTime",
        converter: webidl.converters.DOMHighResTimeStamp,
      },
    ],
  );

webidl.converters["DOMString or DOMHighResTimeStamp"] = (V, opts) => {
  if (webidl.type(V) === "Number" && V !== null) {
    return webidl.converters.DOMHighResTimeStamp(V, opts);
  }
  return webidl.converters.DOMString(V, opts);
};

webidl.converters["PerformanceMeasureOptions"] = webidl
  .createDictionaryConverter(
    "PerformanceMeasureOptions",
    [
      {
        key: "detail",
        converter: webidl.converters.any,
      },
      {
        key: "start",
        converter: webidl.converters["DOMString or DOMHighResTimeStamp"],
      },
      {
        key: "duration",
        converter: webidl.converters.DOMHighResTimeStamp,
      },
      {
        key: "end",
        converter: webidl.converters["DOMString or DOMHighResTimeStamp"],
      },
    ],
  );

webidl.converters["DOMString or PerformanceMeasureOptions"] = (V, opts) => {
  if (webidl.type(V) === "Object" && V !== null) {
    return webidl.converters["PerformanceMeasureOptions"](V, opts);
  }
  return webidl.converters.DOMString(V, opts);
};

export function setTimeOrigin(origin) {
  timeOrigin = origin;
}

function findMostRecent(
  name,
  type,
) {
  return ArrayPrototypeFind(
    ArrayPrototypeReverse(ArrayPrototypeSlice(performanceEntries)),
    (entry) => entry.name === name && entry.entryType === type,
  );
}

function convertMarkToTimestamp(mark) {
  if (typeof mark === "string") {
    const entry = findMostRecent(mark, "mark");
    if (!entry) {
      throw new DOMException(
        `Cannot find mark: "${mark}".`,
        "SyntaxError",
      );
    }
    return entry.startTime;
  }
  if (mark < 0) {
    throw new TypeError("Mark cannot be negative.");
  }
  return mark;
}

function filterByNameType(
  name?: string,
  type?,
) {
  return ArrayPrototypeFilter(
    performanceEntries,
    (entry) =>
      (name ? entry.name === name : true) &&
      (type ? entry.entryType === type : true),
  );
}

const now = opNow;

const _name = Symbol("[[name]]");
const _entryType = Symbol("[[entryType]]");
const _startTime = Symbol("[[startTime]]");
const _duration = Symbol("[[duration]]");

export class PerformanceEntry {
  // @ts-ignore
  [_name] = "";
  // @ts-ignore
  [_entryType] = "";
  // @ts-ignore
  [_startTime] = 0;
  // @ts-ignore
  [_duration] = 0;

  get name() {
    webidl.assertBranded(this, PerformanceEntryPrototype);
    return this[_name];
  }

  get entryType() {
    webidl.assertBranded(this, PerformanceEntryPrototype);
    return this[_entryType];
  }

  get startTime() {
    webidl.assertBranded(this, PerformanceEntryPrototype);
    return this[_startTime];
  }

  get duration() {
    webidl.assertBranded(this, PerformanceEntryPrototype);
    return this[_duration];
  }

  constructor(
    name = null,
    entryType = null,
    startTime = null,
    duration = null,
    key = undefined,
  ) {
    if (key !== illegalConstructorKey) {
      webidl.illegalConstructor();
    }
    this[webidl.brand] = webidl.brand;

    this[_name] = name;
    this[_entryType] = entryType;
    this[_startTime] = startTime;
    this[_duration] = duration;
  }

  toJSON() {
    webidl.assertBranded(this, PerformanceEntryPrototype);
    return {
      name: this[_name],
      entryType: this[_entryType],
      startTime: this[_startTime],
      duration: this[_duration],
    };
  }

  [customInspect](inspect) {
    return inspect(consoleInternal.createFilteredInspectProxy({
      object: this,
      evaluate: ObjectPrototypeIsPrototypeOf(
        PerformanceEntryPrototype,
        this,
      ),
      keys: [
        "name",
        "entryType",
        "startTime",
        "duration",
      ],
    }));
  }
}
webidl.configurePrototype(PerformanceEntry);
const PerformanceEntryPrototype = PerformanceEntry.prototype;

const _detail = Symbol("[[detail]]");

/** `PerformanceMark` is an abstract interface for `PerformanceEntry` objects
 * with an entryType of `"mark"`. Entries of this type are created by calling
 * `performance.mark()` to add a named `DOMHighResTimeStamp` (the mark) to the
 * performance timeline.
 *
 * @category Performance
 */
export class PerformanceMark extends PerformanceEntry {
  // @ts-ignore
  [_detail] = null;

  get detail(): any {
    webidl.assertBranded(this, PerformanceMarkPrototype);
    return this[_detail];
  }

  get entryType() {
    webidl.assertBranded(this, PerformanceMarkPrototype);
    return "mark";
  }

  constructor(
    name: string,
    options: PerformanceMarkOptions = {},
  ) {
    const prefix = "Failed to construct 'PerformanceMark'";
    webidl.requiredArguments(arguments.length, 1, { prefix });

    name = webidl.converters.DOMString(name, {
      prefix,
      context: "Argument 1",
    });

    options = webidl.converters.PerformanceMarkOptions(options, {
      prefix,
      context: "Argument 2",
    });

    const { detail = null, startTime = now() } = options;

    super(name, "mark", startTime, 0, illegalConstructorKey);
    this[webidl.brand] = webidl.brand;
    if (startTime < 0) {
      throw new TypeError("startTime cannot be negative");
    }
    this[_detail] = structuredClone(detail);
  }

  toJSON() {
    webidl.assertBranded(this, PerformanceMarkPrototype);
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail,
    };
  }

  [customInspect](inspect) {
    return inspect(consoleInternal.createFilteredInspectProxy({
      object: this,
      evaluate: ObjectPrototypeIsPrototypeOf(PerformanceMarkPrototype, this),
      keys: [
        "name",
        "entryType",
        "startTime",
        "duration",
        "detail",
      ],
    }));
  }
}
webidl.configurePrototype(PerformanceMark);
const PerformanceMarkPrototype = PerformanceMark.prototype;
export class PerformanceMeasure extends PerformanceEntry {
  // @ts-ignore
  [_detail] = null;

  get detail() {
    webidl.assertBranded(this, PerformanceMeasurePrototype);
    return this[_detail];
  }

  get entryType() {
    webidl.assertBranded(this, PerformanceMeasurePrototype);
    return "measure";
  }

  constructor(
    name = null,
    startTime = null,
    duration = null,
    detail = null,
    key = undefined,
  ) {
    if (key !== illegalConstructorKey) {
      webidl.illegalConstructor();
    }

    super(name, "measure", startTime, duration, key);
    this[webidl.brand] = webidl.brand;
    this[_detail] = structuredClone(detail);
  }

  toJSON() {
    webidl.assertBranded(this, PerformanceMeasurePrototype);
    return {
      name: this.name,
      entryType: this.entryType,
      startTime: this.startTime,
      duration: this.duration,
      detail: this.detail,
    };
  }

  [customInspect](inspect) {
    return inspect(consoleInternal.createFilteredInspectProxy({
      object: this,
      evaluate: ObjectPrototypeIsPrototypeOf(
        PerformanceMeasurePrototype,
        this,
      ),
      keys: [
        "name",
        "entryType",
        "startTime",
        "duration",
        "detail",
      ],
    }));
  }
}
webidl.configurePrototype(PerformanceMeasure);
const PerformanceMeasurePrototype = PerformanceMeasure.prototype;

/** @category Performance */
export class Performance extends EventTarget {
  constructor(key = null) {
    if (key != illegalConstructorKey) {
      webidl.illegalConstructor();
    }

    super();
    this[webidl.brand] = webidl.brand;
  }

  /** Returns a timestamp representing the start of the performance measurement. */
  get timeOrigin(): number {
    webidl.assertBranded(this, PerformancePrototype);
    return timeOrigin;
  }

  /** Removes the stored timestamp with the associated name. */
  clearMarks(markName: string = undefined): void {
    webidl.assertBranded(this, PerformancePrototype);
    if (markName !== undefined) {
      markName = webidl.converters.DOMString(markName, {
        prefix: "Failed to execute 'clearMarks' on 'Performance'",
        context: "Argument 1",
      });

      performanceEntries = ArrayPrototypeFilter(
        performanceEntries,
        (entry) => !(entry.name === markName && entry.entryType === "mark"),
      );
    } else {
      performanceEntries = ArrayPrototypeFilter(
        performanceEntries,
        (entry) => entry.entryType !== "mark",
      );
    }
  }

  /** Removes stored timestamp with the associated name. */
  clearMeasures(measureName: string = undefined): void {
    webidl.assertBranded(this, PerformancePrototype);
    if (measureName !== undefined) {
      measureName = webidl.converters.DOMString(measureName, {
        prefix: "Failed to execute 'clearMeasures' on 'Performance'",
        context: "Argument 1",
      });

      performanceEntries = ArrayPrototypeFilter(
        performanceEntries,
        (entry) =>
          !(entry.name === measureName && entry.entryType === "measure"),
      );
    } else {
      performanceEntries = ArrayPrototypeFilter(
        performanceEntries,
        (entry) => entry.entryType !== "measure",
      );
    }
  }

  getEntries(): PerformanceEntryList {
    webidl.assertBranded(this, PerformancePrototype);
    return filterByNameType();
  }

  getEntriesByName(
    name: string,
    type: string = undefined,
  ): PerformanceEntryList {
    webidl.assertBranded(this, PerformancePrototype);
    const prefix = "Failed to execute 'getEntriesByName' on 'Performance'";
    webidl.requiredArguments(arguments.length, 1, { prefix });

    name = webidl.converters.DOMString(name, {
      prefix,
      context: "Argument 1",
    });

    if (type !== undefined) {
      type = webidl.converters.DOMString(type, {
        prefix,
        context: "Argument 2",
      });
    }

    return filterByNameType(name, type);
  }

  getEntriesByType(type: string): PerformanceEntryList {
    webidl.assertBranded(this, PerformancePrototype);
    const prefix = "Failed to execute 'getEntriesByName' on 'Performance'";
    webidl.requiredArguments(arguments.length, 1, { prefix });

    type = webidl.converters.DOMString(type, {
      prefix,
      context: "Argument 1",
    });

    return filterByNameType(undefined, type);
  }

  /** Stores a timestamp with the associated name (a "mark"). */
  mark(
    markName: string,
    markOptions: PerformanceMarkOptions = {},
  ): PerformanceMark {
    webidl.assertBranded(this, PerformancePrototype);
    const prefix = "Failed to execute 'mark' on 'Performance'";
    webidl.requiredArguments(arguments.length, 1, { prefix });

    markName = webidl.converters.DOMString(markName, {
      prefix,
      context: "Argument 1",
    });

    markOptions = webidl.converters.PerformanceMarkOptions(markOptions, {
      prefix,
      context: "Argument 2",
    });

    // 3.1.1.1 If the global object is a Window object and markName uses the
    // same name as a read only attribute in the PerformanceTiming interface,
    // throw a SyntaxError. - not implemented
    const entry = new PerformanceMark(markName, markOptions);
    // 3.1.1.7 Queue entry - not implemented
    ArrayPrototypePush(performanceEntries, entry);
    return entry;
  }

  /** Stores the `DOMHighResTimeStamp` duration between two marks along with the
   * associated name (a "measure"). */
   measure(
    measureName: string,
    options?: PerformanceMeasureOptions,
  ): PerformanceMeasure;

  /** Stores the `DOMHighResTimeStamp` duration between two marks along with the
   * associated name (a "measure"). */
   measure(
    measureName: string,
    startMark?: string,
    endMark?: string,
  ): PerformanceMeasure;

  measure(
    measureName: string,
    startOrMeasureOptions: PerformanceMeasureOptions | string = {},
    endMark: string = undefined,
  ) {
    webidl.assertBranded(this, PerformancePrototype);
    const prefix = "Failed to execute 'measure' on 'Performance'";
    webidl.requiredArguments(arguments.length, 1, { prefix });

    measureName = webidl.converters.DOMString(measureName, {
      prefix,
      context: "Argument 1",
    });

    startOrMeasureOptions = webidl.converters
      ["DOMString or PerformanceMeasureOptions"](startOrMeasureOptions, {
        prefix,
        context: "Argument 2",
      });

    if (endMark !== undefined) {
      endMark = webidl.converters.DOMString(endMark, {
        prefix,
        context: "Argument 3",
      });
    }

    if (
      startOrMeasureOptions && typeof startOrMeasureOptions === "object" &&
      ObjectKeys(startOrMeasureOptions).length > 0
    ) {
      if (endMark) {
        throw new TypeError("Options cannot be passed with endMark.");
      }
      if (
        !ReflectHas(startOrMeasureOptions, "start") &&
        !ReflectHas(startOrMeasureOptions, "end")
      ) {
        throw new TypeError(
          "A start or end mark must be supplied in options.",
        );
      }
      if (
        ReflectHas(startOrMeasureOptions, "start") &&
        ReflectHas(startOrMeasureOptions, "duration") &&
        ReflectHas(startOrMeasureOptions, "end")
      ) {
        throw new TypeError(
          "Cannot specify start, end, and duration together in options.",
        );
      }
    }
    let endTime;
    if (endMark) {
      endTime = convertMarkToTimestamp(endMark);
    } else if (
      typeof startOrMeasureOptions === "object" &&
      ReflectHas(startOrMeasureOptions, "end")
    ) {
      endTime = convertMarkToTimestamp(startOrMeasureOptions.end);
    } else if (
      typeof startOrMeasureOptions === "object" &&
      ReflectHas(startOrMeasureOptions, "start") &&
      ReflectHas(startOrMeasureOptions, "duration")
    ) {
      const start = convertMarkToTimestamp(startOrMeasureOptions.start);
      const duration = convertMarkToTimestamp(startOrMeasureOptions.duration);
      endTime = start + duration;
    } else {
      endTime = now();
    }
    let startTime;
    if (
      typeof startOrMeasureOptions === "object" &&
      ReflectHas(startOrMeasureOptions, "start")
    ) {
      startTime = convertMarkToTimestamp(startOrMeasureOptions.start);
    } else if (
      typeof startOrMeasureOptions === "object" &&
      ReflectHas(startOrMeasureOptions, "end") &&
      ReflectHas(startOrMeasureOptions, "duration")
    ) {
      const end = convertMarkToTimestamp(startOrMeasureOptions.end);
      const duration = convertMarkToTimestamp(startOrMeasureOptions.duration);
      startTime = end - duration;
    } else if (typeof startOrMeasureOptions === "string") {
      startTime = convertMarkToTimestamp(startOrMeasureOptions);
    } else {
      startTime = 0;
    }
    const entry = new PerformanceMeasure(
      measureName,
      startTime,
      endTime - startTime,
      typeof startOrMeasureOptions === "object"
        ? startOrMeasureOptions.detail ?? null
        : null,
      illegalConstructorKey,
    );
    ArrayPrototypePush(performanceEntries, entry);
    return entry;
  }

  /** Returns a current time from Deno's start in milliseconds.
   *
   * Use the permission flag `--allow-hrtime` return a precise value.
   *
   * ```ts
   * const t = performance.now();
   * console.log(`${t} ms since start!`);
   * ```
   *
   * @tags allow-hrtime
   */
  now(): number {
    webidl.assertBranded(this, PerformancePrototype);
    return now();
  }

  /** Returns a JSON representation of the performance object. */
  toJSON(): any {
    webidl.assertBranded(this, PerformancePrototype);
    return {
      timeOrigin: this.timeOrigin,
    };
  }

  [customInspect](inspect) {
    return inspect(consoleInternal.createFilteredInspectProxy({
      object: this,
      evaluate: ObjectPrototypeIsPrototypeOf(PerformancePrototype, this),
      keys: [],
    }));
  }
}
webidl.configurePrototype(Performance);
const PerformancePrototype = Performance.prototype;

webidl.converters["Performance"] = webidl.createInterfaceConverter(
  "Performance",
  PerformancePrototype,
);

export const performance = new Performance(illegalConstructorKey);

