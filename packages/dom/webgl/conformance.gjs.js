var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => {
  var ns = __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  if (typeof ns.default !== "undefined") {
    var keys = Object.keys(ns);
    if (keys.length === 1 || (keys.length === 2 && keys.includes("__esModule"))) return ns.default;
  }
  return ns;
};

// ../../infra/esbuild-plugin-gjsify/dist/shims/console-gjs.js
function _formatArgs(...args) {
  const fmt = args[0];
  const rest = args.slice(1);
  if (typeof fmt !== "string" || !/%(s|d|i|f|o|O|c)/.test(fmt)) {
    return args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
  }
  let i = 0;
  const result = fmt.replace(/%([sdifOoc])/g, (_match, spec) => {
    if (i >= rest.length) return _match;
    const val = rest[i++];
    switch (spec) {
      case "s":
        return String(val);
      case "d":
      case "i":
        return String(parseInt(String(val), 10));
      case "f":
        return String(parseFloat(String(val)));
      case "o":
      case "O":
        return JSON.stringify(val);
      case "c":
        return "";
      // CSS styles — ignore
      default:
        return _match;
    }
  });
  const remaining = rest.slice(i);
  if (remaining.length === 0) return result;
  return result + " " + remaining.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
}
var _isGJS, Console, _default, log, info, debug, warn, error, dir, dirxml, table, clear, assert, trace, time, timeEnd, timeLog, count, countReset, group, groupCollapsed, groupEnd, profile, profileEnd, timeStamp, console;
var init_console_gjs = __esm({
  "../../infra/esbuild-plugin-gjsify/dist/shims/console-gjs.js"() {
    _isGJS = typeof print === "function" && typeof printerr === "function";
    Console = class {
      _stdout;
      _stderr;
      _groupDepth = 0;
      _groupIndentation;
      _timers = /* @__PURE__ */ new Map();
      _counters = /* @__PURE__ */ new Map();
      constructor(stdoutOrOptions, stderr2) {
        if (stdoutOrOptions && typeof stdoutOrOptions.write === "function") {
          this._stdout = stdoutOrOptions;
          this._stderr = stderr2 || this._stdout;
        } else if (stdoutOrOptions && typeof stdoutOrOptions === "object") {
          const opts = stdoutOrOptions;
          this._stdout = opts.stdout;
          this._stderr = opts.stderr || opts.stdout;
        }
        this._groupIndentation = 2;
      }
      _write(stream, ...args) {
        const target = stream === "stderr" ? this._stderr || this._stdout : this._stdout;
        if (target) {
          const indent = " ".repeat(this._groupDepth * this._groupIndentation);
          const message = _formatArgs(...args);
          target.write(indent + message + "\n");
        } else if (_isGJS) {
          const indent = " ".repeat(this._groupDepth * this._groupIndentation);
          const message = indent + _formatArgs(...args);
          if (stream === "stderr") {
            printerr(message);
          } else {
            print(message);
          }
        } else {
          const gc = globalThis.console;
          if (stream === "stderr") {
            gc.error(...args);
          } else {
            gc.log(...args);
          }
        }
      }
      log(...args) {
        this._write("stdout", ...args);
      }
      info(...args) {
        this._write("stdout", ...args);
      }
      debug(...args) {
        this._write("stdout", ...args);
      }
      warn(...args) {
        this._write("stderr", ...args);
      }
      error(...args) {
        this._write("stderr", ...args);
      }
      dir(obj, _options) {
        this._write("stdout", obj);
      }
      dirxml(...args) {
        this.log(...args);
      }
      assert(value2, ...args) {
        if (!value2) {
          this.error("Assertion failed:", ...args);
        }
      }
      clear() {
        if (this._stdout) {
          this._stdout.write("\x1Bc");
        } else if (_isGJS) {
          print("\x1Bc");
        } else {
          globalThis.console.clear();
        }
      }
      count(label = "default") {
        const count2 = (this._counters.get(label) || 0) + 1;
        this._counters.set(label, count2);
        this.log(`${label}: ${count2}`);
      }
      countReset(label = "default") {
        this._counters.delete(label);
      }
      group(...args) {
        if (args.length > 0) this.log(...args);
        this._groupDepth++;
      }
      groupCollapsed(...args) {
        this.group(...args);
      }
      groupEnd() {
        if (this._groupDepth > 0) this._groupDepth--;
      }
      table(tabularData, _properties) {
        if (this._stdout) {
          this._write("stdout", tabularData);
        } else if (_isGJS) {
          print(JSON.stringify(tabularData, null, 2));
        } else {
          globalThis.console.table(tabularData, _properties);
        }
      }
      time(label = "default") {
        this._timers.set(label, Date.now());
      }
      timeEnd(label = "default") {
        const start = this._timers.get(label);
        if (start !== void 0) {
          this.log(`${label}: ${Date.now() - start}ms`);
          this._timers.delete(label);
        } else {
          this.warn(`Warning: No such label '${label}' for console.timeEnd()`);
        }
      }
      timeLog(label = "default", ...args) {
        const start = this._timers.get(label);
        if (start !== void 0) {
          this.log(`${label}: ${Date.now() - start}ms`, ...args);
        } else {
          this.warn(`Warning: No such label '${label}' for console.timeLog()`);
        }
      }
      trace(...args) {
        const err = new Error();
        const stack = err.stack?.split("\n").slice(1).join("\n") || "";
        this._write("stderr", "Trace:", ...args, "\n" + stack);
      }
      profile(_label) {
      }
      profileEnd(_label) {
      }
      timeStamp(_label) {
      }
    };
    _default = new Console();
    log = (...args) => _default.log(...args);
    info = (...args) => _default.info(...args);
    debug = (...args) => _default.debug(...args);
    warn = (...args) => _default.warn(...args);
    error = (...args) => _default.error(...args);
    dir = (obj, options) => _default.dir(obj, options);
    dirxml = (...args) => _default.dirxml(...args);
    table = (data, properties) => _default.table(data, properties);
    clear = () => _default.clear();
    assert = (value2, ...args) => _default.assert(value2, ...args);
    trace = (...args) => _default.trace(...args);
    time = (label) => _default.time(label);
    timeEnd = (label) => _default.timeEnd(label);
    timeLog = (label, ...args) => _default.timeLog(label, ...args);
    count = (label) => _default.count(label);
    countReset = (label) => _default.countReset(label);
    group = (...args) => _default.group(...args);
    groupCollapsed = (...args) => _default.groupCollapsed(...args);
    groupEnd = () => _default.groupEnd();
    profile = (_label) => {
    };
    profileEnd = (_label) => {
    };
    timeStamp = (_label) => {
    };
    console = {
      log,
      info,
      debug,
      warn,
      error,
      dir,
      dirxml,
      table,
      time,
      timeEnd,
      timeLog,
      trace,
      assert,
      clear,
      count,
      countReset,
      group,
      groupCollapsed,
      groupEnd,
      profile,
      profileEnd,
      timeStamp
    };
  }
});

// ../../node/assert/lib/esm/inspect-fallback.js
function safeInspect(value2, depth = MAX_DEPTH) {
  if (value2 === null) return "null";
  if (value2 === void 0) return "undefined";
  switch (typeof value2) {
    case "string":
      if (value2.length > MAX_STRING_LENGTH) {
        return `'${value2.slice(0, MAX_STRING_LENGTH)}...'`;
      }
      return `'${value2}'`;
    case "number":
    case "boolean":
    case "bigint":
      return String(value2);
    case "symbol":
      return value2.toString();
    case "function":
      return `[Function: ${value2.name || "anonymous"}]`;
    case "object":
      return inspectObject(value2, depth);
  }
  return String(value2);
}
function inspectObject(obj, depth, seen = /* @__PURE__ */ new WeakSet()) {
  if (seen.has(obj)) return "[Circular]";
  seen.add(obj);
  if (obj instanceof Date) return obj.toISOString();
  if (obj instanceof RegExp) return obj.toString();
  if (obj instanceof Error) return `[${obj.constructor.name}: ${obj.message}]`;
  if (obj instanceof Map) {
    if (depth <= 0) return `Map(${obj.size}) { ... }`;
    const entries2 = [...obj.entries()].slice(0, MAX_ARRAY_LENGTH).map(([k, v]) => `${inspectInner(k, depth - 1, seen)} => ${inspectInner(v, depth - 1, seen)}`);
    const suffix2 = obj.size > MAX_ARRAY_LENGTH ? ", ..." : "";
    return `Map(${obj.size}) { ${entries2.join(", ")}${suffix2} }`;
  }
  if (obj instanceof Set) {
    if (depth <= 0) return `Set(${obj.size}) { ... }`;
    const entries2 = [...obj.values()].slice(0, MAX_ARRAY_LENGTH).map((v) => inspectInner(v, depth - 1, seen));
    const suffix2 = obj.size > MAX_ARRAY_LENGTH ? ", ..." : "";
    return `Set(${obj.size}) { ${entries2.join(", ")}${suffix2} }`;
  }
  if (ArrayBuffer.isView(obj)) {
    const typedName = obj.constructor.name;
    const arr = obj instanceof DataView ? new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength) : obj;
    const len = "length" in arr ? arr.length : 0;
    const shown = Math.min(len, MAX_ARRAY_LENGTH);
    const items = [];
    for (let i = 0; i < shown; i++) items.push(String(arr[i]));
    const suffix2 = len > MAX_ARRAY_LENGTH ? ", ..." : "";
    return `${typedName}(${len}) [ ${items.join(", ")}${suffix2} ]`;
  }
  if (Array.isArray(obj)) {
    if (depth <= 0) return `[ ... ]`;
    const shown = obj.slice(0, MAX_ARRAY_LENGTH).map((v) => inspectInner(v, depth - 1, seen));
    const suffix2 = obj.length > MAX_ARRAY_LENGTH ? ", ..." : "";
    return `[ ${shown.join(", ")}${suffix2} ]`;
  }
  if (depth <= 0) return "{ ... }";
  const keys = Object.keys(obj);
  const entries = keys.slice(0, MAX_ARRAY_LENGTH).map((k) => `${k}: ${inspectInner(obj[k], depth - 1, seen)}`);
  const suffix = keys.length > MAX_ARRAY_LENGTH ? ", ..." : "";
  const prefix2 = obj.constructor && obj.constructor.name !== "Object" ? `${obj.constructor.name} ` : "";
  return `${prefix2}{ ${entries.join(", ")}${suffix} }`;
}
function inspectInner(value2, depth, seen) {
  if (value2 === null) return "null";
  if (value2 === void 0) return "undefined";
  if (typeof value2 === "object") return inspectObject(value2, depth, seen);
  return safeInspect(value2, depth);
}
var MAX_DEPTH, MAX_ARRAY_LENGTH, MAX_STRING_LENGTH;
var init_inspect_fallback = __esm({
  "../../node/assert/lib/esm/inspect-fallback.js"() {
    init_console_gjs();
    MAX_DEPTH = 3;
    MAX_ARRAY_LENGTH = 10;
    MAX_STRING_LENGTH = 128;
  }
});

// ../../node/assert/lib/esm/assertion-error.js
function generateMessage(actual, expected, operator) {
  const header = kReadableOperator[operator] || `Operator: ${operator}`;
  if (operator === "fail") {
    return "Failed";
  }
  const actualStr = safeInspect(actual);
  const expectedStr = safeInspect(expected);
  return `${header}

+ actual - expected

+ ${actualStr}
- ${expectedStr}
`;
}
var AssertionError, kReadableOperator;
var init_assertion_error = __esm({
  "../../node/assert/lib/esm/assertion-error.js"() {
    init_console_gjs();
    init_inspect_fallback();
    AssertionError = class extends Error {
      actual;
      expected;
      operator;
      code;
      generatedMessage;
      constructor(options) {
        const {
          actual,
          expected,
          operator = "fail",
          stackStartFn
        } = options;
        const isGenerated = options.message == null;
        const message = isGenerated ? generateMessage(actual, expected, operator) : String(options.message);
        super(message);
        this.name = "AssertionError";
        this.code = "ERR_ASSERTION";
        this.actual = actual;
        this.expected = expected;
        this.operator = operator;
        this.generatedMessage = isGenerated;
        if (typeof Error.captureStackTrace === "function") {
          Error.captureStackTrace(this, stackStartFn || this.constructor);
        }
      }
      toString() {
        return `${this.name} [${this.code}]: ${this.message}`;
      }
      // Support for util.inspect and console.log
      [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")](_depth, _options) {
        return this.toString();
      }
    };
    kReadableOperator = {
      "deepStrictEqual": "Expected values to be strictly deep-equal:",
      "strictEqual": "Expected values to be strictly equal:",
      "strictEqualObject": 'Expected "actual" to be reference-equal to "expected":',
      "deepEqual": "Expected values to be loosely deep-equal:",
      "notDeepStrictEqual": 'Expected "actual" not to be strictly deep-equal to:',
      "notStrictEqual": 'Expected "actual" to be strictly unequal to:',
      "notStrictEqualObject": 'Expected "actual" not to be reference-equal to "expected":',
      "notDeepEqual": 'Expected "actual" not to be loosely deep-equal to:',
      "notIdentical": "Values have same structure but are not reference-equal:",
      "notEqual": 'Expected "actual" to be loosely unequal to:',
      "equal": "Expected values to be loosely equal:",
      "==": "Expected values to be loosely equal:",
      "!=": 'Expected "actual" to be loosely unequal to:',
      "===": "Expected values to be strictly equal:",
      "!==": 'Expected "actual" to be strictly unequal to:',
      "fail": "Failed"
    };
  }
});

// ../../node/assert/lib/esm/deep-equal.js
function isDate(v) {
  return v instanceof Date;
}
function isRegExp(v) {
  return v instanceof RegExp;
}
function isMap(v) {
  return v instanceof Map;
}
function isSet(v) {
  return v instanceof Set;
}
function isError(v) {
  return v instanceof Error;
}
function isAnyArrayBuffer(v) {
  return v instanceof ArrayBuffer || typeof SharedArrayBuffer !== "undefined" && v instanceof SharedArrayBuffer;
}
function isArrayBufferView(v) {
  return ArrayBuffer.isView(v);
}
function isBoxedPrimitive(v) {
  return v instanceof Number || v instanceof String || v instanceof Boolean || v instanceof BigInt || v instanceof Symbol;
}
function isNumberObject(v) {
  return v instanceof Number;
}
function isStringObject(v) {
  return v instanceof String;
}
function isBooleanObject(v) {
  return v instanceof Boolean;
}
function isBigIntObject(v) {
  return typeof BigInt !== "undefined" && v instanceof Object && Object.prototype.toString.call(v) === "[object BigInt]";
}
function isSymbolObject(v) {
  return v instanceof Object && Object.prototype.toString.call(v) === "[object Symbol]";
}
function isFloatTypedArray(v) {
  return v instanceof Float32Array || v instanceof Float64Array;
}
function getOwnNonIndexProperties(obj, skipSymbols) {
  const keys = Object.getOwnPropertyNames(obj);
  const result = [];
  for (const key of keys) {
    const num = Number(key);
    if (Number.isInteger(num) && num >= 0 && num < 2 ** 32 - 1 && String(num) === key) {
      continue;
    }
    if (!hasEnumerable(obj, key)) {
      continue;
    }
    result.push(key);
  }
  if (!skipSymbols) {
    const symbols = Object.getOwnPropertySymbols(obj);
    for (const sym of symbols) {
      if (hasEnumerable(obj, sym)) {
        result.push(sym);
      }
    }
  }
  return result;
}
function areSimilarRegExps(a, b) {
  return a.source === b.source && a.flags === b.flags && a.lastIndex === b.lastIndex;
}
function areSimilarFloatArrays(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  const viewA = a;
  const viewB = b;
  for (let i = 0; i < viewA.length; i++) {
    if (viewA[i] !== viewB[i]) return false;
  }
  return true;
}
function areSimilarTypedArrays(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  const viewA = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const viewB = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 0; i < viewA.length; i++) {
    if (viewA[i] !== viewB[i]) return false;
  }
  return true;
}
function areEqualArrayBuffers(buf1, buf2) {
  if (buf1.byteLength !== buf2.byteLength) return false;
  const a = new Uint8Array(buf1);
  const b = new Uint8Array(buf2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
function isEqualBoxedPrimitive(val1, val2) {
  if (isNumberObject(val1)) {
    return isNumberObject(val2) && Object.is(val1.valueOf(), val2.valueOf());
  }
  if (isStringObject(val1)) {
    return isStringObject(val2) && val1.valueOf() === val2.valueOf();
  }
  if (isBooleanObject(val1)) {
    return isBooleanObject(val2) && val1.valueOf() === val2.valueOf();
  }
  if (isBigIntObject(val1)) {
    return isBigIntObject(val2) && val1[Symbol.toPrimitive]("number") === val2[Symbol.toPrimitive]("number");
  }
  if (isSymbolObject(val1)) {
    return isSymbolObject(val2) && Symbol.prototype.valueOf.call(val1) === Symbol.prototype.valueOf.call(val2);
  }
  return false;
}
function getTypedArrayTag(val) {
  return Object.prototype.toString.call(val).slice(8, -1);
}
function innerDeepEqual(val1, val2, mode, memos) {
  if (val1 === val2) {
    return val1 !== 0 || Object.is(val1, val2) || mode === kLoose;
  }
  if (mode !== kLoose) {
    if (typeof val1 === "number") {
      return val1 !== val1 && val2 !== val2;
    }
    if (typeof val2 !== "object" || typeof val1 !== "object" || val1 === null || val2 === null) {
      return false;
    }
  } else {
    if (val1 === null || typeof val1 !== "object") {
      return (val2 === null || typeof val2 !== "object") && // eslint-disable-next-line eqeqeq
      (val1 == val2 || val1 !== val1 && val2 !== val2);
    }
    if (val2 === null || typeof val2 !== "object") {
      return false;
    }
  }
  return objectComparisonStart(val1, val2, mode, memos);
}
function objectComparisonStart(val1, val2, mode, memos) {
  if (mode === kStrict) {
    if (wellKnownConstructors.has(val1.constructor) || val1.constructor !== void 0 && !hasOwn(val1, "constructor")) {
      if (val1.constructor !== val2.constructor) {
        return false;
      }
    } else if (Object.getPrototypeOf(val1) !== Object.getPrototypeOf(val2)) {
      return false;
    }
  }
  const val1Tag = Object.prototype.toString.call(val1);
  const val2Tag = Object.prototype.toString.call(val2);
  if (val1Tag !== val2Tag) {
    return false;
  }
  if (Array.isArray(val1)) {
    if (!Array.isArray(val2) || val1.length !== val2.length) {
      return false;
    }
    const keys2 = getOwnNonIndexProperties(val2, mode === kLoose);
    if (keys2.length !== getOwnNonIndexProperties(val1, mode === kLoose).length) {
      return false;
    }
    return keyCheck(val1, val2, mode, memos, 1, keys2);
  } else if (val1Tag === "[object Object]") {
    return keyCheck(
      val1,
      val2,
      mode,
      memos,
      0
      /* noIterator */
    );
  } else if (isDate(val1)) {
    if (!isDate(val2)) return false;
    const time1 = val1.getTime();
    const time2 = val2.getTime();
    if (time1 !== time2 && !(Number.isNaN(time1) && Number.isNaN(time2))) {
      return false;
    }
  } else if (isRegExp(val1)) {
    if (!isRegExp(val2) || !areSimilarRegExps(val1, val2)) {
      return false;
    }
  } else if (isArrayBufferView(val1)) {
    if (getTypedArrayTag(val1) !== getTypedArrayTag(val2)) {
      return false;
    }
    if (mode === kLoose && isFloatTypedArray(val1)) {
      if (!areSimilarFloatArrays(val1, val2)) {
        return false;
      }
    } else if (!areSimilarTypedArrays(val1, val2)) {
      return false;
    }
    const keys2 = getOwnNonIndexProperties(val2, mode === kLoose);
    if (keys2.length !== getOwnNonIndexProperties(val1, mode === kLoose).length) {
      return false;
    }
    return keyCheck(val1, val2, mode, memos, 0, keys2);
  } else if (isSet(val1)) {
    if (!isSet(val2) || val1.size !== val2.size) {
      return false;
    }
    return keyCheck(
      val1,
      val2,
      mode,
      memos,
      2
      /* isSet */
    );
  } else if (isMap(val1)) {
    if (!isMap(val2) || val1.size !== val2.size) {
      return false;
    }
    return keyCheck(
      val1,
      val2,
      mode,
      memos,
      3
      /* isMap */
    );
  } else if (isAnyArrayBuffer(val1)) {
    if (!isAnyArrayBuffer(val2) || !areEqualArrayBuffers(val1, val2)) {
      return false;
    }
  } else if (isError(val1)) {
    if (!isError(val2) || val1.message !== val2.message || val1.name !== val2.name) {
      return false;
    }
    if (hasOwn(val1, "cause") !== hasOwn(val2, "cause")) {
      return false;
    }
    if (hasOwn(val1, "cause") && !innerDeepEqual(val1.cause, val2.cause, mode, memos)) {
      return false;
    }
  } else if (isBoxedPrimitive(val1)) {
    if (!isEqualBoxedPrimitive(val1, val2)) {
      return false;
    }
  } else if (Array.isArray(val2) || isArrayBufferView(val2) || isSet(val2) || isMap(val2) || isDate(val2) || isRegExp(val2) || isAnyArrayBuffer(val2) || isBoxedPrimitive(val2) || isError(val2)) {
    return false;
  }
  return keyCheck(
    val1,
    val2,
    mode,
    memos,
    0
    /* noIterator */
  );
}
function getEnumerables(val, keys) {
  return keys.filter((key) => hasEnumerable(val, key));
}
function keyCheck(val1, val2, mode, memos, iterationType, keys2) {
  const isArrayLikeObject = keys2 !== void 0;
  if (keys2 === void 0) {
    keys2 = Object.keys(val2);
  }
  let keys1;
  if (!isArrayLikeObject) {
    if (keys2.length !== (keys1 = Object.keys(val1)).length) {
      return false;
    } else if (mode === kStrict) {
      const symbolKeysA = Object.getOwnPropertySymbols(val1);
      if (symbolKeysA.length !== 0) {
        let count2 = 0;
        for (const key of symbolKeysA) {
          if (hasEnumerable(val1, key)) {
            if (!hasEnumerable(val2, key)) return false;
            keys2.push(key);
            count2++;
          } else if (hasEnumerable(val2, key)) {
            return false;
          }
        }
        const symbolKeysB = Object.getOwnPropertySymbols(val2);
        if (symbolKeysA.length !== symbolKeysB.length && getEnumerables(val2, symbolKeysB).length !== count2) {
          return false;
        }
      } else {
        const symbolKeysB = Object.getOwnPropertySymbols(val2);
        if (symbolKeysB.length !== 0 && getEnumerables(val2, symbolKeysB).length !== 0) {
          return false;
        }
      }
    }
  }
  if (keys2.length === 0 && (iterationType === 0 || iterationType === 1 && val2.length === 0 || val2.size === 0)) {
    return true;
  }
  if (memos === null) {
    return objEquiv(val1, val2, mode, keys1, keys2, memos, iterationType);
  }
  return handleCycles(val1, val2, mode, keys1, keys2, memos, iterationType);
}
function handleCycles(val1, val2, mode, keys1, keys2, memos, iterationType) {
  if (memos === void 0) {
    memos = {
      set: void 0,
      a: val1,
      b: val2,
      c: void 0,
      d: void 0,
      deep: false
    };
    return objEquiv(val1, val2, mode, keys1, keys2, memos, iterationType);
  }
  if (memos.set === void 0) {
    if (memos.deep === false) {
      if (memos.a === val1) return memos.b === val2;
      if (memos.b === val2) return false;
      memos.c = val1;
      memos.d = val2;
      memos.deep = true;
      const result = objEquiv(val1, val2, mode, keys1, keys2, memos, iterationType);
      memos.deep = false;
      return result;
    }
    memos.set = /* @__PURE__ */ new Set();
    memos.set.add(memos.a);
    memos.set.add(memos.b);
    memos.set.add(memos.c);
    memos.set.add(memos.d);
  }
  const { set } = memos;
  const originalSize = set.size;
  set.add(val1);
  set.add(val2);
  if (originalSize !== set.size - 2) {
    return originalSize === set.size;
  }
  const areEq = objEquiv(val1, val2, mode, keys1, keys2, memos, iterationType);
  set.delete(val1);
  set.delete(val2);
  return areEq;
}
function findLooseMatchingPrimitives(prim) {
  switch (typeof prim) {
    case "undefined":
      return null;
    case "object":
      return void 0;
    case "symbol":
      return false;
    case "string":
      prim = +prim;
    // falls through
    case "number":
      if (prim !== prim) return false;
  }
  return true;
}
function setMightHaveLoosePrim(a, b, prim) {
  const altValue = findLooseMatchingPrimitives(prim);
  if (altValue != null) return altValue;
  return !b.has(altValue) && a.has(altValue);
}
function mapMightHaveLoosePrim(a, b, prim, item2, memo) {
  const altValue = findLooseMatchingPrimitives(prim);
  if (altValue != null) return altValue;
  const item1 = a.get(altValue);
  if (item1 === void 0 && !a.has(altValue) || !innerDeepEqual(item1, item2, kLoose, memo)) {
    return false;
  }
  return !b.has(altValue) && innerDeepEqual(item1, item2, kLoose, memo);
}
function setEquiv(a, b, mode, memo) {
  let array;
  for (const val of b) {
    if (!a.has(val)) {
      if ((typeof val !== "object" || val === null) && (mode !== kLoose || !setMightHaveLoosePrim(a, b, val))) {
        return false;
      }
      if (array === void 0) array = [];
      array.push(val);
    }
  }
  if (array === void 0) return true;
  for (const val1 of a) {
    if (typeof val1 === "object" && val1 !== null) {
      if (!b.has(val1)) {
        let found = false;
        for (let i = 0; i < array.length; i++) {
          if (innerDeepEqual(val1, array[i], mode, memo)) {
            array.splice(i, 1);
            found = true;
            break;
          }
        }
        if (!found) return false;
      }
    } else if (!b.has(val1) && (mode !== kLoose || !setMightHaveLoosePrim(b, a, val1))) {
      let found = false;
      for (let i = 0; i < array.length; i++) {
        if (innerDeepEqual(val1, array[i], mode, memo)) {
          array.splice(i, 1);
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
  }
  return array.length === 0;
}
function mapEquiv(a, b, mode, memo) {
  let array;
  for (const [key2, item2] of b) {
    if (typeof key2 === "object" && key2 !== null) {
      if (array === void 0) {
        if (a.size === 1) {
          const [key1, item1] = a.entries().next().value;
          return innerDeepEqual(key1, key2, mode, memo) && innerDeepEqual(item1, item2, mode, memo);
        }
        array = [];
      }
      array.push(key2);
    } else {
      const item1 = a.get(key2);
      if (item1 === void 0 && !a.has(key2) || !innerDeepEqual(item1, item2, mode, memo)) {
        if (mode !== kLoose) return false;
        if (!mapMightHaveLoosePrim(a, b, key2, item2, memo)) return false;
        if (array === void 0) array = [];
        array.push(key2);
      }
    }
  }
  if (array === void 0) return true;
  for (const [key1, item1] of a) {
    if (typeof key1 === "object" && key1 !== null) {
      if (!b.has(key1)) {
        let found = false;
        for (let i = 0; i < array.length; i++) {
          const key2 = array[i];
          if (innerDeepEqual(key1, key2, mode, memo) && innerDeepEqual(item1, b.get(key2), mode, memo)) {
            array.splice(i, 1);
            found = true;
            break;
          }
        }
        if (!found) return false;
      }
    } else if (mode === kLoose && typeof key1 !== "object" && (!a.has(key1) || !innerDeepEqual(item1, a.get(key1), mode, memo))) {
    }
  }
  return array.length === 0;
}
function objEquiv(a, b, mode, keys1, keys2, memos, iterationType) {
  if (keys2.length > 0) {
    const aRec = a;
    const bRec = b;
    let i = 0;
    if (keys1 !== void 0) {
      for (; i < keys2.length; i++) {
        const key = keys2[i];
        if (keys1[i] !== key) break;
        if (!innerDeepEqual(aRec[key], bRec[key], mode, memos)) return false;
      }
    }
    for (; i < keys2.length; i++) {
      const key = keys2[i];
      const descriptor = Object.getOwnPropertyDescriptor(a, key);
      if (!descriptor?.enumerable || !innerDeepEqual(
        descriptor.value !== void 0 ? descriptor.value : aRec[key],
        bRec[key],
        mode,
        memos
      )) {
        return false;
      }
    }
  }
  if (iterationType === 1) {
    const aArr = a;
    const bArr = b;
    for (let i = 0; i < aArr.length; i++) {
      if (bArr[i] === void 0 && !hasOwn(b, i)) {
        if (aArr[i] !== void 0 || hasOwn(a, i)) return false;
        continue;
      }
      if (mode !== kLoose && aArr[i] === void 0 && !hasOwn(a, i)) {
        return false;
      }
      if (!innerDeepEqual(aArr[i], bArr[i], mode, memos)) return false;
    }
  } else if (iterationType === 2) {
    if (!setEquiv(a, b, mode, memos)) return false;
  } else if (iterationType === 3) {
    if (!mapEquiv(a, b, mode, memos)) return false;
  }
  return true;
}
function isDeepEqual(val1, val2) {
  return detectCycles(val1, val2, kLoose);
}
function isDeepStrictEqual(val1, val2) {
  return detectCycles(val1, val2, kStrict);
}
var kStrict, kLoose, hasOwn, hasEnumerable, wellKnownConstructors, detectCycles;
var init_deep_equal = __esm({
  "../../node/assert/lib/esm/deep-equal.js"() {
    init_console_gjs();
    kStrict = 1;
    kLoose = 0;
    hasOwn = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);
    hasEnumerable = (obj, prop) => Object.prototype.propertyIsEnumerable.call(obj, prop);
    wellKnownConstructors = /* @__PURE__ */ new Set([
      Array,
      ArrayBuffer,
      Boolean,
      DataView,
      Date,
      Error,
      Float32Array,
      Float64Array,
      Function,
      Int8Array,
      Int16Array,
      Int32Array,
      Map,
      Number,
      Object,
      Promise,
      RegExp,
      Set,
      String,
      Symbol,
      Uint8Array,
      Uint16Array,
      Uint32Array,
      Uint8ClampedArray,
      BigInt64Array,
      BigUint64Array,
      WeakMap,
      WeakSet
    ]);
    detectCycles = function(val1, val2, mode) {
      try {
        return innerDeepEqual(val1, val2, mode, null);
      } catch {
        detectCycles = (v1, v2, m) => innerDeepEqual(v1, v2, m, void 0);
        return innerDeepEqual(val1, val2, mode, void 0);
      }
    };
  }
});

// ../../node/assert/lib/esm/index.js
var esm_exports = {};
__export(esm_exports, {
  AssertionError: () => AssertionError,
  deepEqual: () => deepEqual,
  deepStrictEqual: () => deepStrictEqual,
  default: () => index_default,
  doesNotMatch: () => doesNotMatch,
  doesNotReject: () => doesNotReject,
  doesNotThrow: () => doesNotThrow,
  equal: () => equal,
  fail: () => fail,
  ifError: () => ifError,
  match: () => match,
  notDeepEqual: () => notDeepEqual,
  notDeepStrictEqual: () => notDeepStrictEqual,
  notEqual: () => notEqual,
  notStrictEqual: () => notStrictEqual,
  ok: () => ok,
  rejects: () => rejects,
  strict: () => strict,
  strictEqual: () => strictEqual,
  throws: () => throws
});
function innerFail(obj) {
  if (obj.message instanceof Error) throw obj.message;
  throw new AssertionError({
    actual: obj.actual,
    expected: obj.expected,
    message: obj.message,
    operator: obj.operator,
    stackStartFn: obj.stackStartFn
  });
}
function isPromiseLike(val) {
  return val !== null && typeof val === "object" && typeof val.then === "function";
}
function ok(value2, message) {
  if (!value2) {
    innerFail({
      actual: value2,
      expected: true,
      message,
      operator: "==",
      stackStartFn: ok
    });
  }
}
function equal(actual, expected, message) {
  if (actual != expected) {
    innerFail({
      actual,
      expected,
      message,
      operator: "==",
      stackStartFn: equal
    });
  }
}
function notEqual(actual, expected, message) {
  if (actual == expected) {
    innerFail({
      actual,
      expected,
      message,
      operator: "!=",
      stackStartFn: notEqual
    });
  }
}
function strictEqual(actual, expected, message) {
  if (!Object.is(actual, expected)) {
    innerFail({
      actual,
      expected,
      message,
      operator: "strictEqual",
      stackStartFn: strictEqual
    });
  }
}
function notStrictEqual(actual, expected, message) {
  if (Object.is(actual, expected)) {
    innerFail({
      actual,
      expected,
      message,
      operator: "notStrictEqual",
      stackStartFn: notStrictEqual
    });
  }
}
function deepEqual(actual, expected, message) {
  if (!isDeepEqual(actual, expected)) {
    innerFail({
      actual,
      expected,
      message,
      operator: "deepEqual",
      stackStartFn: deepEqual
    });
  }
}
function notDeepEqual(actual, expected, message) {
  if (isDeepEqual(actual, expected)) {
    innerFail({
      actual,
      expected,
      message,
      operator: "notDeepEqual",
      stackStartFn: notDeepEqual
    });
  }
}
function deepStrictEqual(actual, expected, message) {
  if (!isDeepStrictEqual(actual, expected)) {
    innerFail({
      actual,
      expected,
      message,
      operator: "deepStrictEqual",
      stackStartFn: deepStrictEqual
    });
  }
}
function notDeepStrictEqual(actual, expected, message) {
  if (isDeepStrictEqual(actual, expected)) {
    innerFail({
      actual,
      expected,
      message,
      operator: "notDeepStrictEqual",
      stackStartFn: notDeepStrictEqual
    });
  }
}
function getActual(fn) {
  const NO_EXCEPTION = /* @__PURE__ */ Symbol("NO_EXCEPTION");
  try {
    fn();
  } catch (e) {
    return e;
  }
  return NO_EXCEPTION;
}
async function getActualAsync(fn) {
  const NO_EXCEPTION = /* @__PURE__ */ Symbol("NO_EXCEPTION");
  try {
    if (typeof fn === "function") {
      const result = fn();
      if (isPromiseLike(result)) {
        await result;
      }
    } else {
      await fn;
    }
  } catch (e) {
    return e;
  }
  return NO_EXCEPTION;
}
function expectedException(actual, expected, message, fn) {
  if (expected === void 0) return true;
  if (expected instanceof RegExp) {
    const str = String(actual);
    if (expected.test(str)) return true;
    throw new AssertionError({
      actual,
      expected,
      message,
      operator: fn.name,
      stackStartFn: fn
    });
  }
  if (typeof expected === "function") {
    if (expected.prototype !== void 0 && actual instanceof expected) {
      return true;
    }
    if (Error.isPrototypeOf(expected)) {
      return false;
    }
    const result = expected.call({}, actual);
    if (result !== true) {
      throw new AssertionError({
        actual,
        expected,
        message,
        operator: fn.name,
        stackStartFn: fn
      });
    }
    return true;
  }
  if (typeof expected === "object" && expected !== null) {
    const keys = Object.keys(expected);
    for (const key of keys) {
      const expectedObj = expected;
      const actualObj = actual;
      if (typeof actualObj[key] === "string" && expectedObj[key] instanceof RegExp) {
        if (!expectedObj[key].test(actualObj[key])) {
          throw new AssertionError({
            actual,
            expected,
            message,
            operator: fn.name,
            stackStartFn: fn
          });
        }
      } else if (!isDeepStrictEqual(actualObj[key], expectedObj[key])) {
        throw new AssertionError({
          actual,
          expected,
          message,
          operator: fn.name,
          stackStartFn: fn
        });
      }
    }
    return true;
  }
  return true;
}
function throws(fn, errorOrMessage, message) {
  if (typeof fn !== "function") {
    throw new TypeError('The "fn" argument must be of type function.');
  }
  let expected;
  if (typeof errorOrMessage === "string") {
    message = errorOrMessage;
    expected = void 0;
  } else {
    expected = errorOrMessage;
  }
  const actual = getActual(fn);
  if (typeof actual === "symbol") {
    innerFail({
      actual: void 0,
      expected,
      message: message || "Missing expected exception.",
      operator: "throws",
      stackStartFn: throws
    });
  }
  if (expected !== void 0) {
    expectedException(actual, expected, message, throws);
  }
}
function doesNotThrow(fn, errorOrMessage, message) {
  if (typeof fn !== "function") {
    throw new TypeError('The "fn" argument must be of type function.');
  }
  let expected;
  if (typeof errorOrMessage === "string") {
    message = errorOrMessage;
    expected = void 0;
  } else {
    expected = errorOrMessage;
  }
  const actual = getActual(fn);
  if (typeof actual === "symbol") {
    return;
  }
  if (expected !== void 0 && typeof expected === "function" && expected.prototype !== void 0 && actual instanceof expected) {
    innerFail({
      actual,
      expected,
      message: message || `Got unwanted exception.
${actual && actual.message ? actual.message : ""}`,
      operator: "doesNotThrow",
      stackStartFn: doesNotThrow
    });
  }
  if (expected === void 0 || typeof expected === "function" && expected.prototype !== void 0 && actual instanceof expected) {
    innerFail({
      actual,
      expected,
      message: message || `Got unwanted exception.
${actual && actual.message ? actual.message : ""}`,
      operator: "doesNotThrow",
      stackStartFn: doesNotThrow
    });
  }
  throw actual;
}
async function rejects(asyncFn, errorOrMessage, message) {
  let expected;
  if (typeof errorOrMessage === "string") {
    message = errorOrMessage;
    expected = void 0;
  } else {
    expected = errorOrMessage;
  }
  const actual = await getActualAsync(asyncFn);
  if (typeof actual === "symbol") {
    innerFail({
      actual: void 0,
      expected,
      message: message || "Missing expected rejection.",
      operator: "rejects",
      stackStartFn: rejects
    });
  }
  if (expected !== void 0) {
    expectedException(actual, expected, message, rejects);
  }
}
async function doesNotReject(asyncFn, errorOrMessage, message) {
  let expected;
  if (typeof errorOrMessage === "string") {
    message = errorOrMessage;
    expected = void 0;
  } else {
    expected = errorOrMessage;
  }
  const actual = await getActualAsync(asyncFn);
  if (typeof actual !== "symbol") {
    innerFail({
      actual,
      expected,
      message: message || `Got unwanted rejection.
${actual && actual.message ? actual.message : ""}`,
      operator: "doesNotReject",
      stackStartFn: doesNotReject
    });
  }
}
function fail(actualOrMessage, expected, message, operator, stackStartFn) {
  if (arguments.length === 0 || arguments.length === 1) {
    const msg = arguments.length === 0 ? "Failed" : typeof actualOrMessage === "string" ? actualOrMessage : void 0;
    if (actualOrMessage instanceof Error) throw actualOrMessage;
    throw new AssertionError({
      message: msg || "Failed",
      operator: "fail",
      stackStartFn: fail
    });
  }
  throw new AssertionError({
    actual: actualOrMessage,
    expected,
    message,
    operator: operator || "fail",
    stackStartFn: stackStartFn || fail
  });
}
function ifError(value2) {
  if (value2 !== null && value2 !== void 0) {
    let message = "ifError got unwanted exception: ";
    if (typeof value2 === "object" && typeof value2.message === "string") {
      if (value2.message.length === 0 && value2.constructor) {
        message += value2.constructor.name;
      } else {
        message += value2.message;
      }
    } else {
      message += String(value2);
    }
    const err = new AssertionError({
      actual: value2,
      expected: null,
      message,
      operator: "ifError",
      stackStartFn: ifError
    });
    const origStack = value2 instanceof Error ? value2.stack : void 0;
    if (origStack) {
      err.origStack = origStack;
    }
    throw err;
  }
}
function match(actual, expected, message) {
  if (typeof actual !== "string") {
    throw new TypeError('The "actual" argument must be of type string.');
  }
  if (!(expected instanceof RegExp)) {
    throw new TypeError('The "expected" argument must be an instance of RegExp.');
  }
  if (!expected.test(actual)) {
    innerFail({
      actual,
      expected,
      message: message || `The input did not match the regular expression ${expected}. Input:

'${actual}'
`,
      operator: "match",
      stackStartFn: match
    });
  }
}
function doesNotMatch(actual, expected, message) {
  if (typeof actual !== "string") {
    throw new TypeError('The "actual" argument must be of type string.');
  }
  if (!(expected instanceof RegExp)) {
    throw new TypeError('The "expected" argument must be an instance of RegExp.');
  }
  if (expected.test(actual)) {
    innerFail({
      actual,
      expected,
      message: message || `The input was expected to not match the regular expression ${expected}. Input:

'${actual}'
`,
      operator: "doesNotMatch",
      stackStartFn: doesNotMatch
    });
  }
}
var strict, assert2, index_default;
var init_esm = __esm({
  "../../node/assert/lib/esm/index.js"() {
    init_console_gjs();
    init_assertion_error();
    init_deep_equal();
    strict = Object.assign(
      function strict2(value2, message) {
        ok(value2, message);
      },
      {
        AssertionError,
        ok,
        equal: strictEqual,
        notEqual: notStrictEqual,
        deepEqual: deepStrictEqual,
        notDeepEqual: notDeepStrictEqual,
        deepStrictEqual,
        notDeepStrictEqual,
        strictEqual,
        notStrictEqual,
        throws,
        doesNotThrow,
        rejects,
        doesNotReject,
        fail,
        ifError,
        match,
        doesNotMatch,
        strict: void 0
      }
    );
    strict.strict = strict;
    assert2 = Object.assign(
      function assert22(value2, message) {
        ok(value2, message);
      },
      {
        AssertionError,
        ok,
        equal,
        notEqual,
        strictEqual,
        notStrictEqual,
        deepEqual,
        notDeepEqual,
        deepStrictEqual,
        notDeepStrictEqual,
        throws,
        doesNotThrow,
        rejects,
        doesNotReject,
        fail,
        ifError,
        match,
        doesNotMatch,
        strict
      }
    );
    index_default = assert2;
  }
});

// ../../node/assert/cjs-compat.cjs
var require_cjs_compat = __commonJS({
  "../../node/assert/cjs-compat.cjs"(exports, module) {
    init_console_gjs();
    var mod = (init_esm(), __toCommonJS(esm_exports));
    module.exports = mod.default || mod;
  }
});

// ../../gjs/utils/lib/esm/main-loop.js
function quitMainLoop() {
  if (_loop) {
    _loop.quit();
    _started = false;
    _loop = null;
  }
}
var _started, _loop;
var init_main_loop = __esm({
  "../../gjs/utils/lib/esm/main-loop.js"() {
    init_console_gjs();
    _started = false;
    _loop = null;
  }
});

// ../../node/events/lib/esm/event-emitter.js
function onceWrapper() {
  const { target, type, listener } = this;
  if (this.wrapperFn) target.removeListener(type, this.wrapperFn);
  const result = listener.apply(target, arguments);
  return result;
}
function _onceWrap(target, type, listener) {
  const state = { target, type, listener, wrapperFn: void 0 };
  const wrapped = onceWrapper.bind(state);
  state.wrapperFn = wrapped;
  wrapped.listener = listener;
  return wrapped;
}
function arrayClone(arr) {
  switch (arr.length) {
    case 0:
      return [];
    case 1:
      return [arr[0]];
    case 2:
      return [arr[0], arr[1]];
    case 3:
      return [arr[0], arr[1], arr[2]];
    default:
      return arr.slice();
  }
}
function checkListener(listener) {
  if (typeof listener !== "function") {
    throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
  }
}
function validateNumber(value2, name2) {
  if (typeof value2 !== "number" || value2 !== value2) {
    throw new TypeError(`The "${name2}" argument must be of type number. Received type ${typeof value2}`);
  }
}
function spliceOne(list, index) {
  for (; index + 1 < list.length; index++) {
    list[index] = list[index + 1];
  }
  list.pop();
}
function unwrapListeners(arr) {
  const ret = new Array(arr.length);
  for (let i = 0; i < ret.length; ++i) {
    ret[i] = arr[i].listener ?? arr[i];
  }
  return ret;
}
function createAbortError(signal) {
  const err = new Error("The operation was aborted");
  err.name = "AbortError";
  err.code = "ABORT_ERR";
  if (signal?.reason) {
    err.cause = signal.reason;
  }
  return err;
}
var kCapture, kRejection, EventEmitter;
var init_event_emitter = __esm({
  "../../node/events/lib/esm/event-emitter.js"() {
    init_console_gjs();
    kCapture = /* @__PURE__ */ Symbol("kCapture");
    kRejection = /* @__PURE__ */ Symbol.for("nodejs.rejection");
    EventEmitter = class _EventEmitter {
      static defaultMaxListeners = 10;
      static errorMonitor = /* @__PURE__ */ Symbol("events.errorMonitor");
      static captureRejectionSymbol = kRejection;
      static _captureRejections = false;
      static get captureRejections() {
        return _EventEmitter._captureRejections;
      }
      static set captureRejections(value2) {
        if (typeof value2 !== "boolean") {
          throw new TypeError('The "captureRejections" argument must be of type boolean.');
        }
        _EventEmitter._captureRejections = value2;
      }
      _events;
      _eventsCount;
      _maxListeners;
      [kCapture];
      constructor(opts) {
        this._events = /* @__PURE__ */ Object.create(null);
        this._eventsCount = 0;
        this._maxListeners = void 0;
        this[kCapture] = opts?.captureRejections ?? _EventEmitter._captureRejections;
      }
      setMaxListeners(n) {
        validateNumber(n, "n");
        if (n < 0) {
          throw new RangeError('The value of "n" is out of range. It must be a non-negative number. Received ' + n);
        }
        this._maxListeners = n;
        return this;
      }
      getMaxListeners() {
        return this._maxListeners ?? _EventEmitter.defaultMaxListeners;
      }
      emit(type, ...args) {
        const events = this._events;
        let doError = type === "error";
        if (events !== void 0) {
          if (doError && events[_EventEmitter.errorMonitor] !== void 0) {
            this.emit(_EventEmitter.errorMonitor, ...args);
          }
          doError = doError && events.error === void 0;
        } else if (!doError) {
          return false;
        }
        if (doError) {
          let er;
          if (args.length > 0) {
            er = args[0];
          } else {
            er = new Error("Unhandled error.");
          }
          if (er instanceof Error) {
            throw er;
          }
          const err = new Error("Unhandled error. (" + er + ")");
          err.context = er;
          throw err;
        }
        const handler = events[type];
        if (handler === void 0) {
          return false;
        }
        if (typeof handler === "function") {
          const result = handler.apply(this, args);
          if (result !== void 0 && result !== null && this[kCapture]) {
            this._addCatch(result, type, args);
          }
        } else {
          const listeners = arrayClone(handler);
          const len = listeners.length;
          for (let i = 0; i < len; ++i) {
            const result = listeners[i].apply(this, args);
            if (result !== void 0 && result !== null && this[kCapture]) {
              this._addCatch(result, type, args);
            }
          }
        }
        return true;
      }
      _addCatch(result, type, args) {
        if (typeof result?.then === "function") {
          result.then(void 0, (err) => {
            const handler = this[kRejection];
            if (typeof handler === "function") {
              handler.call(this, err, type, ...args);
            } else {
              const prev = this[kCapture];
              try {
                this[kCapture] = false;
                this.emit("error", err);
              } finally {
                this[kCapture] = prev;
              }
            }
          });
        }
      }
      addListener(type, listener) {
        return this._addListener(type, listener, false);
      }
      on(type, listener) {
        return this._addListener(type, listener, false);
      }
      prependListener(type, listener) {
        return this._addListener(type, listener, true);
      }
      _addListener(type, listener, prepend) {
        checkListener(listener);
        let events = this._events;
        if (events === void 0) {
          events = this._events = /* @__PURE__ */ Object.create(null);
          this._eventsCount = 0;
        } else if (events.newListener !== void 0) {
          this.emit("newListener", type, listener.listener ?? listener);
          events = this._events;
        }
        let existing = events[type];
        if (existing === void 0) {
          events[type] = listener;
          ++this._eventsCount;
        } else if (typeof existing === "function") {
          events[type] = prepend ? [listener, existing] : [existing, listener];
        } else {
          if (prepend) {
            existing.unshift(listener);
          } else {
            existing.push(listener);
          }
        }
        const m = this.getMaxListeners();
        if (m > 0) {
          const count2 = typeof events[type] === "function" ? 1 : events[type].length;
          if (count2 > m && !events[type].warned) {
            if (typeof events[type] !== "function") {
              events[type].warned = true;
            }
            const w = new Error(
              `Possible EventEmitter memory leak detected. ${count2} ${String(type)} listeners added to [${this.constructor.name}]. Use emitter.setMaxListeners() to increase limit`
            );
            w.name = "MaxListenersExceededWarning";
            console.warn(w.message);
          }
        }
        return this;
      }
      once(type, listener) {
        checkListener(listener);
        this.on(type, _onceWrap(this, type, listener));
        return this;
      }
      prependOnceListener(type, listener) {
        checkListener(listener);
        this.prependListener(type, _onceWrap(this, type, listener));
        return this;
      }
      removeListener(type, listener) {
        checkListener(listener);
        const events = this._events;
        if (events === void 0) {
          return this;
        }
        const list = events[type];
        if (list === void 0) {
          return this;
        }
        if (list === listener || list.listener === listener) {
          if (--this._eventsCount === 0) {
            this._events = /* @__PURE__ */ Object.create(null);
          } else {
            delete events[type];
            if (events.removeListener) {
              this.emit("removeListener", type, list.listener ?? listener);
            }
          }
        } else if (typeof list !== "function") {
          let position = -1;
          for (let i = list.length - 1; i >= 0; i--) {
            if (list[i] === listener || list[i].listener === listener) {
              position = i;
              break;
            }
          }
          if (position < 0) {
            return this;
          }
          if (position === 0) {
            list.shift();
          } else {
            spliceOne(list, position);
          }
          if (list.length === 1) {
            events[type] = list[0];
          }
          if (events.removeListener !== void 0) {
            this.emit("removeListener", type, listener.listener ?? listener);
          }
        }
        return this;
      }
      off(type, listener) {
        return this.removeListener(type, listener);
      }
      removeAllListeners(type) {
        const events = this._events;
        if (events === void 0) {
          return this;
        }
        if (events.removeListener === void 0) {
          if (arguments.length === 0) {
            this._events = /* @__PURE__ */ Object.create(null);
            this._eventsCount = 0;
          } else if (events[type] !== void 0) {
            if (--this._eventsCount === 0) {
              this._events = /* @__PURE__ */ Object.create(null);
            } else {
              delete events[type];
            }
          }
          return this;
        }
        if (arguments.length === 0) {
          const keys = Object.keys(events);
          for (let i = 0; i < keys.length; ++i) {
            const key = keys[i];
            if (key === "removeListener") continue;
            this.removeAllListeners(key);
          }
          this.removeAllListeners("removeListener");
          this._events = /* @__PURE__ */ Object.create(null);
          this._eventsCount = 0;
          return this;
        }
        const listeners = events[type];
        if (typeof listeners === "function") {
          this.removeListener(type, listeners);
        } else if (listeners !== void 0) {
          for (let i = listeners.length - 1; i >= 0; i--) {
            this.removeListener(type, listeners[i]);
          }
        }
        return this;
      }
      listeners(type) {
        const events = this._events;
        if (events === void 0) {
          return [];
        }
        const evlistener = events[type];
        if (evlistener === void 0) {
          return [];
        }
        if (typeof evlistener === "function") {
          return [evlistener.listener ?? evlistener];
        }
        return unwrapListeners(evlistener);
      }
      rawListeners(type) {
        const events = this._events;
        if (events === void 0) {
          return [];
        }
        const evlistener = events[type];
        if (evlistener === void 0) {
          return [];
        }
        if (typeof evlistener === "function") {
          return [evlistener];
        }
        return arrayClone(evlistener);
      }
      listenerCount(type) {
        const events = this._events;
        if (events === void 0) {
          return 0;
        }
        const evlistener = events[type];
        if (evlistener === void 0) {
          return 0;
        }
        if (typeof evlistener === "function") {
          return 1;
        }
        return evlistener.length;
      }
      eventNames() {
        return (this._eventsCount ?? 0) > 0 ? Reflect.ownKeys(this._events) : [];
      }
      // -- Static methods --
      /**
       * Returns a promise that resolves when the emitter emits the given event,
       * or rejects if the emitter emits 'error' while waiting.
       */
      static once(emitter, name2, options) {
        return new Promise((resolve, reject) => {
          const signal = options?.signal;
          if (signal?.aborted) {
            reject(createAbortError(signal));
            return;
          }
          if (typeof emitter.addEventListener === "function") {
            const eventTarget = emitter;
            const handler = (...args) => {
              if (signal) {
                signal.removeEventListener("abort", abortHandler2);
              }
              resolve(args);
            };
            const errorHandler2 = (err) => {
              if (signal) {
                signal.removeEventListener("abort", abortHandler2);
              }
              eventTarget.removeEventListener("error", errorHandler2);
              reject(err);
            };
            const abortHandler2 = () => {
              eventTarget.removeEventListener(name2, handler);
              eventTarget.removeEventListener("error", errorHandler2);
              reject(createAbortError(signal));
            };
            eventTarget.addEventListener(name2, handler, { once: true });
            if (name2 !== "error") {
              eventTarget.addEventListener("error", errorHandler2, { once: true });
            }
            if (signal) {
              signal.addEventListener("abort", abortHandler2, { once: true });
            }
            return;
          }
          const ee = emitter;
          const eventHandler = (...args) => {
            if (signal) {
              signal.removeEventListener("abort", abortHandler);
            }
            if (errorHandler !== void 0) {
              ee.removeListener("error", errorHandler);
            }
            resolve(args);
          };
          let errorHandler;
          if (name2 !== "error") {
            errorHandler = (err) => {
              ee.removeListener(name2, eventHandler);
              if (signal) {
                signal.removeEventListener("abort", abortHandler);
              }
              reject(err);
            };
            ee.once("error", errorHandler);
          }
          ee.once(name2, eventHandler);
          const abortHandler = () => {
            ee.removeListener(name2, eventHandler);
            if (errorHandler) {
              ee.removeListener("error", errorHandler);
            }
            reject(createAbortError(signal));
          };
          if (signal) {
            signal.addEventListener("abort", abortHandler, { once: true });
          }
        });
      }
      /**
       * Returns an async iterator that yields event arguments each time the emitter emits.
       */
      static on(emitter, event, options) {
        const signal = options?.signal;
        if (signal?.aborted) {
          throw createAbortError(signal);
        }
        const highWaterMark = options?.highWaterMark ?? Number.MAX_SAFE_INTEGER;
        const lowWaterMark = options?.lowWaterMark ?? 1;
        validateNumber(highWaterMark, "highWaterMark");
        validateNumber(lowWaterMark, "lowWaterMark");
        const unconsumedEvents = [];
        const unconsumedPromises = [];
        let error2 = null;
        let finished2 = false;
        let paused = false;
        const eventHandler = (...args) => {
          if (unconsumedPromises.length > 0) {
            const { resolve } = unconsumedPromises.shift();
            resolve({ value: args, done: false });
          } else {
            unconsumedEvents.push(args);
            if (unconsumedEvents.length >= highWaterMark && !paused) {
              paused = true;
              if (typeof emitter.pause === "function") {
                emitter.pause();
              }
            }
          }
        };
        const errorHandler = (err) => {
          error2 = err;
          if (unconsumedPromises.length > 0) {
            const { reject } = unconsumedPromises.shift();
            reject(err);
          }
          iterator.return();
        };
        const abortHandler = () => {
          errorHandler(createAbortError(signal));
        };
        emitter.on(event, eventHandler);
        if (event !== "error") {
          emitter.on("error", errorHandler);
        }
        if (signal) {
          signal.addEventListener("abort", abortHandler, { once: true });
        }
        const cleanup = () => {
          emitter.removeListener(event, eventHandler);
          emitter.removeListener("error", errorHandler);
          if (signal) {
            signal.removeEventListener("abort", abortHandler);
          }
          finished2 = true;
          for (const { resolve } of unconsumedPromises) {
            resolve({ value: void 0, done: true });
          }
          unconsumedPromises.length = 0;
          unconsumedEvents.length = 0;
        };
        const iterator = {
          next() {
            if (unconsumedEvents.length > 0) {
              const value2 = unconsumedEvents.shift();
              if (paused && unconsumedEvents.length < lowWaterMark) {
                paused = false;
                if (typeof emitter.resume === "function") {
                  emitter.resume();
                }
              }
              return Promise.resolve({ value: value2, done: false });
            }
            if (error2) {
              const p = Promise.reject(error2);
              error2 = null;
              return p;
            }
            if (finished2) {
              return Promise.resolve({ value: void 0, done: true });
            }
            return new Promise((resolve, reject) => {
              unconsumedPromises.push({ resolve, reject });
            });
          },
          return() {
            cleanup();
            return Promise.resolve({ value: void 0, done: true });
          },
          throw(err) {
            if (!finished2) {
              error2 = err;
              cleanup();
            }
            return Promise.reject(err);
          },
          [Symbol.asyncIterator]() {
            return this;
          }
        };
        return iterator;
      }
      /**
       * Returns the number of listeners listening to the event name.
       * @deprecated Use emitter.listenerCount() instead.
       */
      static listenerCount(emitter, type) {
        return emitter.listenerCount(type);
      }
      /**
       * Returns a copy of the array of listeners for the event named eventName.
       */
      static getEventListeners(emitter, name2) {
        if (typeof emitter.listeners === "function") {
          return emitter.listeners(name2);
        }
        return [];
      }
      /**
       * Set max listeners on one or more emitters.
       */
      static setMaxListeners(n, ...emitters) {
        validateNumber(n, "n");
        if (n < 0) {
          throw new RangeError('The value of "n" is out of range.');
        }
        if (emitters.length === 0) {
          _EventEmitter.defaultMaxListeners = n;
        } else {
          for (const emitter of emitters) {
            if (typeof emitter.setMaxListeners === "function") {
              emitter.setMaxListeners(n);
            }
          }
        }
      }
      /**
       * Returns the currently set max listeners on the emitter.
       */
      static getMaxListeners(emitter) {
        if (typeof emitter.getMaxListeners === "function") {
          return emitter.getMaxListeners();
        }
        return _EventEmitter.defaultMaxListeners;
      }
      /**
       * Listens once to an abort event on the provided signal and returns a disposable.
       */
      static addAbortListener(signal, listener) {
        if (signal.aborted) {
          Promise.resolve().then(() => listener());
        }
        const handler = () => listener();
        signal.addEventListener("abort", handler, { once: true });
        return {
          [Symbol.dispose]() {
            signal.removeEventListener("abort", handler);
          }
        };
      }
    };
    EventEmitter.EventEmitter = EventEmitter;
  }
});

// ../../node/events/lib/esm/index.js
var esm_exports2 = {};
__export(esm_exports2, {
  EventEmitter: () => EventEmitter,
  addAbortListener: () => addAbortListener,
  captureRejectionSymbol: () => captureRejectionSymbol,
  default: () => index_default2,
  defaultMaxListeners: () => defaultMaxListeners,
  errorMonitor: () => errorMonitor,
  getEventListeners: () => getEventListeners,
  getMaxListeners: () => getMaxListeners,
  listenerCount: () => listenerCount,
  on: () => on,
  once: () => once,
  setMaxListeners: () => setMaxListeners
});
var captureRejectionSymbol, errorMonitor, defaultMaxListeners, setMaxListeners, getMaxListeners, once, on, getEventListeners, listenerCount, addAbortListener, index_default2;
var init_esm2 = __esm({
  "../../node/events/lib/esm/index.js"() {
    init_console_gjs();
    init_event_emitter();
    captureRejectionSymbol = EventEmitter.captureRejectionSymbol;
    errorMonitor = EventEmitter.errorMonitor;
    defaultMaxListeners = EventEmitter.defaultMaxListeners;
    setMaxListeners = EventEmitter.setMaxListeners;
    getMaxListeners = EventEmitter.getMaxListeners;
    once = EventEmitter.once;
    on = EventEmitter.on;
    getEventListeners = EventEmitter.getEventListeners;
    listenerCount = EventEmitter.listenerCount;
    addAbortListener = EventEmitter.addAbortListener;
    index_default2 = EventEmitter;
  }
});

// ../../node/events/cjs-compat.cjs
var require_cjs_compat2 = __commonJS({
  "../../node/events/cjs-compat.cjs"(exports, module) {
    init_console_gjs();
    var mod = (init_esm2(), __toCommonJS(esm_exports2));
    module.exports = mod.default || mod;
  }
});

// ../../node/process/lib/esm/index.js
var esm_exports3 = {};
__export(esm_exports3, {
  abort: () => abort,
  arch: () => arch,
  argv: () => argv,
  argv0: () => argv0,
  chdir: () => chdir,
  config: () => config,
  cpuUsage: () => cpuUsage,
  cwd: () => cwd,
  default: () => index_default3,
  emitWarning: () => emitWarning,
  env: () => env,
  execArgv: () => execArgv,
  execPath: () => execPath,
  exit: () => exit,
  hrtime: () => hrtime,
  kill: () => kill,
  memoryUsage: () => memoryUsage,
  nextTick: () => nextTick,
  pid: () => pid,
  platform: () => platform,
  ppid: () => ppid,
  stderr: () => stderr,
  stdin: () => stdin,
  stdout: () => stdout,
  umask: () => umask,
  uptime: () => uptime,
  version: () => version,
  versions: () => versions
});
function getGjsGlobal() {
  return globalThis;
}
function detectGjsVersion() {
  try {
    const system = getGjsGlobal().imports?.system;
    if (system?.version !== void 0) {
      const v = Number(system.version);
      const major = Math.floor(v / 1e4);
      const minor = Math.floor(v % 1e4 / 100);
      const patch = v % 100;
      return `${major}.${minor}.${patch}`;
    }
  } catch {
  }
  return void 0;
}
function detectNodeVersion() {
  if (typeof globalThis.process?.versions?.node === "string") {
    return globalThis.process.versions.node;
  }
  return void 0;
}
function detectVersionInfo() {
  const nodeVersion = detectNodeVersion();
  if (nodeVersion) {
    return {
      version: globalThis.process.version,
      versions: { ...globalThis.process.versions },
      title: globalThis.process?.title || "node"
    };
  }
  const gjsVersion = detectGjsVersion();
  const versions2 = {
    node: "20.0.0"
    // Compatibility version — many npm packages check process.versions.node
  };
  if (gjsVersion) versions2.gjs = gjsVersion;
  return {
    version: "v20.0.0",
    // Compatibility version for Node.js API level checks
    versions: versions2,
    title: "gjs"
  };
}
function detectPpid() {
  if (typeof globalThis.process?.ppid === "number") {
    return globalThis.process.ppid;
  }
  try {
    const GLib3 = getGjsGlobal().imports?.gi?.GLib;
    if (GLib3) {
      const [, contents] = GLib3.file_get_contents("/proc/self/status");
      if (contents) {
        const str = new TextDecoder().decode(contents);
        const match2 = str.match(/PPid:\s+(\d+)/);
        if (match2) return parseInt(match2[1], 10);
      }
    }
  } catch {
  }
  return 0;
}
function detectPlatform() {
  try {
    const GLib3 = getGjsGlobal().imports?.gi?.GLib;
    if (GLib3) {
      const osInfo = GLib3.get_os_info("ID");
      if (osInfo) return "linux";
    }
  } catch {
  }
  if (typeof getGjsGlobal().imports?.system !== "undefined") {
    return "linux";
  }
  if (typeof globalThis.process?.platform === "string") {
    return globalThis.process.platform;
  }
  return "linux";
}
function detectArch() {
  if (typeof globalThis.process?.arch === "string") {
    return globalThis.process.arch;
  }
  try {
    const system = getGjsGlobal().imports?.system;
    if (system?.programInvocationName) {
    }
  } catch {
  }
  return "x64";
}
function getCwd() {
  try {
    const GLib3 = getGjsGlobal().imports?.gi?.GLib;
    if (GLib3?.get_current_dir) return GLib3.get_current_dir();
  } catch {
  }
  return "/";
}
function getEnvProxy() {
  if (typeof globalThis.process?.env === "object") {
    return globalThis.process.env;
  }
  try {
    const GLib3 = getGjsGlobal().imports?.gi?.GLib;
    if (GLib3) {
      return new Proxy({}, {
        get(_target, prop) {
          if (typeof prop !== "string") return void 0;
          return GLib3.getenv(prop) ?? void 0;
        },
        set(_target, prop, value2) {
          if (typeof prop !== "string") return false;
          GLib3.setenv(prop, String(value2), true);
          return true;
        },
        deleteProperty(_target, prop) {
          if (typeof prop !== "string") return false;
          GLib3.unsetenv(prop);
          return true;
        },
        has(_target, prop) {
          if (typeof prop !== "string") return false;
          return GLib3.getenv(prop) !== null;
        },
        ownKeys(_target) {
          const envp = GLib3.listenv();
          return envp;
        },
        getOwnPropertyDescriptor(_target, prop) {
          if (typeof prop !== "string") return void 0;
          const val = GLib3.getenv(prop);
          if (val === null) return void 0;
          return { configurable: true, enumerable: true, writable: true, value: val };
        }
      });
    }
  } catch {
  }
  return {};
}
function getArgv() {
  if (typeof globalThis.process?.argv !== "undefined") {
    return globalThis.process.argv;
  }
  try {
    const system = getGjsGlobal().imports?.system;
    if (system?.programArgs) {
      return [system.programInvocationName || "gjs", ...system.programArgs];
    }
  } catch {
  }
  return ["gjs"];
}
function getExecPath() {
  if (typeof globalThis.process?.execPath === "string") {
    return globalThis.process.execPath;
  }
  try {
    const system = getGjsGlobal().imports?.system;
    if (system?.programInvocationName) return system.programInvocationName;
  } catch {
  }
  return "/usr/bin/gjs";
}
function getPid() {
  if (typeof globalThis.process?.pid === "number") {
    return globalThis.process.pid;
  }
  try {
    const GLib3 = getGjsGlobal().imports?.gi?.GLib;
    if (GLib3) {
      const [, contents] = GLib3.file_get_contents("/proc/self/stat");
      if (contents) {
        const str = new TextDecoder().decode(contents);
        const pid2 = parseInt(str, 10);
        if (!isNaN(pid2)) return pid2;
      }
    }
  } catch {
  }
  return 0;
}
function getMonotonicTime() {
  try {
    const GLib3 = getGjsGlobal().imports?.gi?.GLib;
    if (GLib3?.get_monotonic_time) {
      return BigInt(GLib3.get_monotonic_time()) * 1000n;
    }
  } catch {
  }
  if (typeof performance?.now === "function") {
    return BigInt(Math.round(performance.now() * 1e6));
  }
  return BigInt(Date.now()) * 1000000n;
}
var import_events, startTime, hrtimeBase, Process, process, platform, arch, env, argv, argv0, execPath, pid, ppid, version, versions, cwd, chdir, exit, nextTick, hrtime, uptime, memoryUsage, cpuUsage, kill, abort, umask, emitWarning, execArgv, config, stdout, stderr, stdin, index_default3;
var init_esm3 = __esm({
  "../../node/process/lib/esm/index.js"() {
    init_console_gjs();
    import_events = __toESM(require_cjs_compat2());
    startTime = Date.now();
    hrtimeBase = getMonotonicTime();
    Process = class extends import_events.EventEmitter {
      platform;
      arch;
      env;
      argv;
      argv0;
      execPath;
      pid;
      ppid;
      version;
      versions;
      title;
      execArgv;
      config;
      exitCode;
      constructor() {
        super();
        this.platform = detectPlatform();
        this.arch = detectArch();
        this.env = getEnvProxy();
        this.argv = getArgv();
        this.argv0 = this.argv[0] || "gjs";
        this.execPath = getExecPath();
        this.execArgv = globalThis.process?.execArgv ?? [];
        this.config = globalThis.process?.config ?? { target_defaults: {}, variables: {} };
        this.pid = getPid();
        this.ppid = detectPpid();
        const versionInfo = detectVersionInfo();
        this.version = versionInfo.version;
        this.versions = versionInfo.versions;
        this.title = versionInfo.title;
      }
      cwd() {
        return getCwd();
      }
      chdir(directory) {
        try {
          const GLib3 = getGjsGlobal().imports?.gi?.GLib;
          if (GLib3?.chdir) {
            if (!GLib3.file_test(
              directory,
              16
              /* G_FILE_TEST_EXISTS */
            )) {
              const err = new Error(`ENOENT: no such file or directory, chdir '${directory}'`);
              err.code = "ENOENT";
              err.syscall = "chdir";
              err.path = directory;
              throw err;
            }
            GLib3.chdir(directory);
            return;
          }
        } catch (e) {
          if (e && typeof e === "object" && e.code === "ENOENT") throw e;
        }
        if (typeof globalThis.process?.chdir === "function") {
          globalThis.process.chdir(directory);
          return;
        }
        throw new Error("process.chdir() is not supported in this environment");
      }
      kill(pid2, signal) {
        if (typeof globalThis.process?.kill === "function") {
          return globalThis.process.kill(pid2, signal);
        }
        try {
          const GLib3 = getGjsGlobal().imports?.gi?.GLib;
          if (GLib3) {
            const sig = typeof signal === "number" ? String(signal) : signal || "SIGTERM";
            const sigArg = sig.startsWith("SIG") ? `-${sig.slice(3)}` : `-${sig}`;
            GLib3.spawn_command_line_sync(`kill ${sigArg} ${pid2}`);
            return true;
          }
        } catch {
        }
        throw new Error("process.kill() is not supported in this environment");
      }
      exit(code) {
        this.exitCode = code ?? this.exitCode ?? 0;
        this.emit("exit", this.exitCode);
        try {
          const system = getGjsGlobal().imports?.system;
          if (system?.exit) {
            system.exit(this.exitCode);
          }
        } catch {
        }
        if (typeof globalThis.process?.exit === "function") {
          globalThis.process.exit(this.exitCode);
        }
        throw new Error(`process.exit(${this.exitCode})`);
      }
      nextTick(callback, ...args) {
        if (typeof queueMicrotask === "function") {
          queueMicrotask(() => callback(...args));
        } else {
          Promise.resolve().then(() => callback(...args));
        }
      }
      hrtime(time2) {
        const now2 = getMonotonicTime() - hrtimeBase;
        const seconds = Number(now2 / 1000000000n);
        const nanoseconds = Number(now2 % 1000000000n);
        if (time2) {
          let diffSec = seconds - time2[0];
          let diffNano = nanoseconds - time2[1];
          if (diffNano < 0) {
            diffSec--;
            diffNano += 1e9;
          }
          return [diffSec, diffNano];
        }
        return [seconds, nanoseconds];
      }
      uptime() {
        return (Date.now() - startTime) / 1e3;
      }
      memoryUsage() {
        try {
          const GLib3 = getGjsGlobal().imports?.gi?.GLib;
          if (GLib3) {
            const [, contents] = GLib3.file_get_contents("/proc/self/status");
            if (contents) {
              const str = new TextDecoder().decode(contents);
              const vmRSS = str.match(/VmRSS:\s+(\d+)/);
              const rss = vmRSS ? parseInt(vmRSS[1], 10) * 1024 : 0;
              return { rss, heapTotal: rss, heapUsed: rss, external: 0, arrayBuffers: 0 };
            }
          }
        } catch {
        }
        if (typeof globalThis.process?.memoryUsage === "function") {
          return globalThis.process.memoryUsage();
        }
        return { rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 };
      }
      cpuUsage(previousValue) {
        if (typeof globalThis.process?.cpuUsage === "function") {
          return globalThis.process.cpuUsage(previousValue);
        }
        return { user: 0, system: 0 };
      }
      // Stub: stdout/stderr/stdin — these need stream to be implemented fully
      // Note: Cannot check globalThis.process.stdout here — on GJS globalThis.process
      // IS this instance, so that would cause infinite recursion.
      stdout = { write: (data) => {
        console.log(data);
        return true;
      }, fd: 1 };
      stderr = { write: (data) => {
        console.error(data);
        return true;
      }, fd: 2 };
      stdin = { fd: 0 };
      abort() {
        this.exit(1);
      }
      // no-op stubs for compatibility
      umask(mask) {
        return 18;
      }
      emitWarning(warning, name2) {
        if (typeof warning === "string") {
          console.warn(`(${name2 || "Warning"}): ${warning}`);
        } else {
          console.warn(warning.message);
        }
      }
    };
    Process.prototype.hrtime.bigint = function() {
      return getMonotonicTime() - hrtimeBase;
    };
    process = new Process();
    platform = process.platform;
    arch = process.arch;
    env = process.env;
    argv = process.argv;
    argv0 = process.argv0;
    execPath = process.execPath;
    pid = process.pid;
    ppid = process.ppid;
    version = process.version;
    versions = process.versions;
    cwd = process.cwd.bind(process);
    chdir = process.chdir.bind(process);
    exit = process.exit.bind(process);
    nextTick = process.nextTick.bind(process);
    hrtime = process.hrtime.bind(process);
    uptime = process.uptime.bind(process);
    memoryUsage = process.memoryUsage.bind(process);
    cpuUsage = process.cpuUsage.bind(process);
    kill = process.kill.bind(process);
    abort = process.abort.bind(process);
    umask = process.umask.bind(process);
    emitWarning = process.emitWarning.bind(process);
    execArgv = process.execArgv;
    config = process.config;
    stdout = process.stdout;
    stderr = process.stderr;
    stdin = process.stdin;
    index_default3 = process;
  }
});

// ../../../node_modules/@girs/gio-2.0/gio-2.0.js
import Gio from "gi://Gio?version=2.0";
var gio_2_0_default;
var init_gio_2_0 = __esm({
  "../../../node_modules/@girs/gio-2.0/gio-2.0.js"() {
    init_console_gjs();
    gio_2_0_default = Gio;
  }
});

// ../../../node_modules/@girs/gio-2.0/index.js
var gio_2_default;
var init_gio_2 = __esm({
  "../../../node_modules/@girs/gio-2.0/index.js"() {
    init_console_gjs();
    init_gio_2_0();
    gio_2_default = gio_2_0_default;
  }
});

// ../../../node_modules/@girs/glib-2.0/glib-2.0.js
import GLib from "gi://GLib?version=2.0";
var glib_2_0_default;
var init_glib_2_0 = __esm({
  "../../../node_modules/@girs/glib-2.0/glib-2.0.js"() {
    init_console_gjs();
    glib_2_0_default = GLib;
  }
});

// ../../../node_modules/@girs/glib-2.0/index.js
var glib_2_default;
var init_glib_2 = __esm({
  "../../../node_modules/@girs/glib-2.0/index.js"() {
    init_console_gjs();
    init_glib_2_0();
    glib_2_default = glib_2_0_default;
  }
});

// ../../gjs/utils/lib/esm/base64.js
function btoaPolyfill(str) {
  if (typeof globalThis.btoa === "function") return globalThis.btoa(str);
  let result = "";
  let i = 0;
  for (; i + 2 < str.length; i += 3) {
    const n = str.charCodeAt(i) << 16 | str.charCodeAt(i + 1) << 8 | str.charCodeAt(i + 2);
    result += B64_CHARS[n >> 18 & 63] + B64_CHARS[n >> 12 & 63] + B64_CHARS[n >> 6 & 63] + B64_CHARS[n & 63];
  }
  if (i + 1 === str.length) {
    const n = str.charCodeAt(i) << 16;
    result += B64_CHARS[n >> 18 & 63] + B64_CHARS[n >> 12 & 63] + "==";
  } else if (i + 2 === str.length) {
    const n = str.charCodeAt(i) << 16 | str.charCodeAt(i + 1) << 8;
    result += B64_CHARS[n >> 18 & 63] + B64_CHARS[n >> 12 & 63] + B64_CHARS[n >> 6 & 63] + "=";
  }
  return result;
}
function base64Decode(str) {
  const cleaned = str.replace(/[=\s]/g, "");
  const bytes = new Uint8Array(cleaned.length * 3 >> 2);
  let bits2 = 0;
  let collected = 0;
  let pos = 0;
  for (let i = 0; i < cleaned.length; i++) {
    bits2 = bits2 << 6 | B64_LOOKUP[cleaned.charCodeAt(i)];
    collected += 6;
    if (collected >= 8) {
      collected -= 8;
      bytes[pos++] = bits2 >> collected & 255;
    }
  }
  return bytes.subarray(0, pos);
}
var B64_CHARS, B64_LOOKUP;
var init_base64 = __esm({
  "../../gjs/utils/lib/esm/base64.js"() {
    init_console_gjs();
    B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    B64_LOOKUP = new Uint8Array(256);
    for (let i = 0; i < B64_CHARS.length; i++) B64_LOOKUP[B64_CHARS.charCodeAt(i)] = i;
  }
});

// ../../gjs/utils/lib/esm/byte-array.js
var init_byte_array = __esm({
  "../../gjs/utils/lib/esm/byte-array.js"() {
    init_console_gjs();
  }
});

// ../../gjs/utils/lib/esm/cli.js
var byteArray;
var init_cli = __esm({
  "../../gjs/utils/lib/esm/cli.js"() {
    init_console_gjs();
    init_glib_2();
    byteArray = imports.byteArray;
  }
});

// ../../gjs/utils/lib/esm/defer.js
var init_defer = __esm({
  "../../gjs/utils/lib/esm/defer.js"() {
    init_console_gjs();
  }
});

// ../../gjs/utils/lib/esm/encoding.js
function normalizeEncoding(enc) {
  if (!enc || enc === "utf8" || enc === "utf-8") return "utf8";
  const lower2 = ("" + enc).toLowerCase().replace(/-/g, "");
  switch (lower2) {
    case "utf8":
      return "utf8";
    case "ascii":
      return "ascii";
    case "latin1":
    case "binary":
      return "latin1";
    case "base64":
      return "base64";
    case "base64url":
      return "base64url";
    case "hex":
      return "hex";
    case "ucs2":
    case "utf16le":
      return "utf16le";
    default:
      return "utf8";
  }
}
function checkEncoding(encoding) {
  const lower2 = ("" + encoding).toLowerCase().replace(/-/g, "");
  if (!VALID_ENCODINGS.includes(lower2)) {
    throw new TypeError(`Unknown encoding: ${encoding}`);
  }
}
var VALID_ENCODINGS;
var init_encoding = __esm({
  "../../gjs/utils/lib/esm/encoding.js"() {
    init_console_gjs();
    VALID_ENCODINGS = ["utf8", "ascii", "latin1", "binary", "base64", "base64url", "hex", "ucs2", "utf16le"];
  }
});

// ../../gjs/utils/lib/esm/globals.js
function registerGlobal(name2, value2) {
  if (typeof globalThis[name2] === "undefined") {
    globalThis[name2] = value2;
  }
}
var init_globals = __esm({
  "../../gjs/utils/lib/esm/globals.js"() {
    init_console_gjs();
  }
});

// ../../gjs/utils/lib/esm/error.js
var init_error = __esm({
  "../../gjs/utils/lib/esm/error.js"() {
    init_console_gjs();
  }
});

// ../../gjs/utils/lib/esm/file.js
var byteArray2;
var init_file = __esm({
  "../../gjs/utils/lib/esm/file.js"() {
    init_console_gjs();
    init_glib_2();
    byteArray2 = imports.byteArray;
  }
});

// ../../../node_modules/@girs/giounix-2.0/giounix-2.0.js
import GioUnix from "gi://GioUnix?version=2.0";
var init_giounix_2_0 = __esm({
  "../../../node_modules/@girs/giounix-2.0/giounix-2.0.js"() {
    init_console_gjs();
  }
});

// ../../../node_modules/@girs/giounix-2.0/index.js
var init_giounix_2 = __esm({
  "../../../node_modules/@girs/giounix-2.0/index.js"() {
    init_console_gjs();
    init_giounix_2_0();
  }
});

// ../../gjs/utils/lib/esm/fs.js
var init_fs = __esm({
  "../../gjs/utils/lib/esm/fs.js"() {
    init_console_gjs();
    init_gio_2();
    init_giounix_2();
  }
});

// ../../gjs/utils/lib/esm/gio.js
async function readBytesAsync(inputStream, count2 = 4096, ioPriority = glib_2_default.PRIORITY_DEFAULT, cancellable = null) {
  return new Promise((resolve, reject) => {
    inputStream.read_bytes_async(count2, ioPriority, cancellable, (_self, asyncRes) => {
      try {
        const res = inputStream.read_bytes_finish(asyncRes);
        if (res.get_size() === 0) {
          return resolve(null);
        }
        return resolve(byteArray3.fromGBytes(res));
      } catch (error2) {
        reject(error2);
      }
    });
  });
}
async function* inputStreamAsyncIterator(inputStream, count2 = 4096, ioPriority = glib_2_default.PRIORITY_DEFAULT, cancellable = null) {
  let chunk;
  while ((chunk = await readBytesAsync(inputStream, count2, ioPriority, cancellable)) !== null) {
    yield chunk;
  }
}
var byteArray3;
var init_gio = __esm({
  "../../gjs/utils/lib/esm/gio.js"() {
    init_console_gjs();
    init_glib_2();
    byteArray3 = imports.byteArray;
  }
});

// ../../gjs/utils/lib/esm/gio-errors.js
var init_gio_errors = __esm({
  "../../gjs/utils/lib/esm/gio-errors.js"() {
    init_console_gjs();
  }
});

// ../../gjs/utils/lib/esm/message.js
var warnNotImplemented;
var init_message = __esm({
  "../../gjs/utils/lib/esm/message.js"() {
    init_console_gjs();
    warnNotImplemented = (msg) => {
      const message = msg ? `Not implemented: ${msg}` : "Not implemented";
      console.warn(message);
      return message;
    };
  }
});

// ../../gjs/utils/lib/esm/next-tick.js
var nextTick2;
var init_next_tick = __esm({
  "../../gjs/utils/lib/esm/next-tick.js"() {
    init_console_gjs();
    nextTick2 = typeof globalThis.process?.nextTick === "function" ? globalThis.process.nextTick : typeof globalThis.queueMicrotask === "function" ? (fn, ...args) => queueMicrotask(() => fn(...args)) : (fn, ...args) => {
      Promise.resolve().then(() => fn(...args));
    };
  }
});

// ../../gjs/utils/lib/esm/path.js
var File;
var init_path = __esm({
  "../../gjs/utils/lib/esm/path.js"() {
    init_console_gjs();
    init_gio_2();
    init_glib_2();
    ({ File } = gio_2_default);
  }
});

// ../../gjs/utils/lib/esm/structured-clone.js
var toString;
var init_structured_clone = __esm({
  "../../gjs/utils/lib/esm/structured-clone.js"() {
    init_console_gjs();
    ({ toString } = Object.prototype);
  }
});

// ../../gjs/utils/lib/esm/index.js
var init_esm4 = __esm({
  "../../gjs/utils/lib/esm/index.js"() {
    init_console_gjs();
    init_base64();
    init_byte_array();
    init_cli();
    init_defer();
    init_encoding();
    init_globals();
    init_error();
    init_file();
    init_fs();
    init_gio();
    init_gio_errors();
    init_message();
    init_next_tick();
    init_path();
    init_structured_clone();
    init_main_loop();
  }
});

// ../../node/stream/lib/esm/index.js
var esm_exports4 = {};
__export(esm_exports4, {
  Duplex: () => Duplex,
  PassThrough: () => PassThrough,
  Readable: () => Readable,
  Stream: () => Stream,
  Transform: () => Transform,
  Writable: () => Writable,
  addAbortSignal: () => addAbortSignal,
  default: () => index_default4,
  finished: () => finished,
  getDefaultHighWaterMark: () => getDefaultHighWaterMark,
  isDestroyed: () => isDestroyed,
  isDisturbed: () => isDisturbed,
  isErrored: () => isErrored,
  isReadable: () => isReadable,
  isWritable: () => isWritable,
  pipeline: () => pipeline,
  setDefaultHighWaterMark: () => setDefaultHighWaterMark
});
function getDefaultHighWaterMark(objectMode) {
  return objectMode ? defaultObjectHighWaterMark : defaultHighWaterMark;
}
function setDefaultHighWaterMark(objectMode, value2) {
  if (typeof value2 !== "number" || value2 < 0 || Number.isNaN(value2)) {
    throw new TypeError(`Invalid highWaterMark: ${value2}`);
  }
  if (objectMode) {
    defaultObjectHighWaterMark = value2;
  } else {
    defaultHighWaterMark = value2;
  }
}
function pipeline(...args) {
  const callback = typeof args[args.length - 1] === "function" ? args.pop() : void 0;
  const streams = args;
  if (streams.length < 2) {
    throw new Error("pipeline requires at least 2 streams");
  }
  let error2 = null;
  function onError(err) {
    if (!error2) {
      error2 = err;
      for (const stream of streams) {
        if (typeof stream.destroy === "function") {
          stream.destroy();
        }
      }
      if (callback) callback(err);
    }
  }
  let current = streams[0];
  for (let i = 1; i < streams.length; i++) {
    const next = streams[i];
    current.pipe(next);
    current.on("error", onError);
    current = next;
  }
  const last = streams[streams.length - 1];
  last.on("error", onError);
  last.on("finish", () => {
    if (callback && !error2) callback(null);
  });
  return last;
}
function finished(stream, optsOrCb, callback) {
  let cb;
  let _opts = {};
  if (typeof optsOrCb === "function") {
    cb = optsOrCb;
  } else {
    _opts = optsOrCb || {};
    cb = callback;
  }
  let called = false;
  function done(err) {
    if (!called) {
      called = true;
      cb(err);
    }
  }
  const onFinish = () => done();
  const onEnd = () => done();
  const onError = (err) => done(err);
  const onClose = () => {
    if (!stream.writableFinished && !stream.readableEnded) {
      done(new Error("premature close"));
    }
  };
  stream.on("finish", onFinish);
  stream.on("end", onEnd);
  stream.on("error", onError);
  stream.on("close", onClose);
  const isWritableStream = typeof stream.write === "function";
  const isReadableStream = typeof stream.read === "function";
  const writableFinished = stream.writableFinished === true;
  const readableEnded = stream.readableEnded === true;
  const destroyed = stream.destroyed === true;
  if (destroyed) {
    queueMicrotask(() => done(stream._err || null));
  } else if (isWritableStream && !isReadableStream && writableFinished) {
    queueMicrotask(() => done());
  } else if (!isWritableStream && isReadableStream && readableEnded) {
    queueMicrotask(() => done());
  } else if (isWritableStream && isReadableStream && writableFinished && readableEnded) {
    queueMicrotask(() => done());
  }
  return function cleanup() {
    stream.removeListener("finish", onFinish);
    stream.removeListener("end", onEnd);
    stream.removeListener("error", onError);
    stream.removeListener("close", onClose);
  };
}
function addAbortSignal(signal, stream) {
  if (!(signal instanceof AbortSignal)) {
    throw new TypeError("The first argument must be an AbortSignal");
  }
  if (!(stream instanceof Stream)) {
    throw new TypeError("The second argument must be a Stream");
  }
  if (signal.aborted) {
    stream.destroy(new Error("The operation was aborted"));
  } else {
    const onAbort = () => {
      stream.destroy(new Error("The operation was aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    stream.once("close", () => {
      signal.removeEventListener("abort", onAbort);
    });
  }
  return stream;
}
function isReadable(stream) {
  if (stream == null) return false;
  const s = stream;
  if (typeof s.readable !== "boolean") return false;
  if (typeof s.read !== "function") return false;
  if (s.destroyed === true) return false;
  if (s.readableEnded === true) return false;
  return s.readable === true;
}
function isWritable(stream) {
  if (stream == null) return false;
  const s = stream;
  if (typeof s.writable !== "boolean") return false;
  if (typeof s.write !== "function") return false;
  if (s.destroyed === true) return false;
  if (s.writableEnded === true) return false;
  return s.writable === true;
}
function isDestroyed(stream) {
  if (stream == null) return false;
  return stream.destroyed === true;
}
function isDisturbed(stream) {
  if (stream == null) return false;
  const s = stream;
  return s.readableDidRead === true || s.readableFlowing !== null && s.readableFlowing !== void 0;
}
function isErrored(stream) {
  if (stream == null) return false;
  const s = stream;
  if (s.destroyed === true && typeof s.readable === "boolean" && s.readable === false) return true;
  if (s.destroyed === true && typeof s.writable === "boolean" && s.writable === false) return true;
  return false;
}
var import_events2, defaultHighWaterMark, defaultObjectHighWaterMark, Stream, Readable, Writable, Duplex, Transform, PassThrough, _default2, index_default4;
var init_esm5 = __esm({
  "../../node/stream/lib/esm/index.js"() {
    init_console_gjs();
    import_events2 = __toESM(require_cjs_compat2(), 1);
    init_esm4();
    defaultHighWaterMark = 16384;
    defaultObjectHighWaterMark = 16;
    Stream = class extends import_events2.EventEmitter {
      constructor(opts) {
        super(opts);
      }
      pipe(destination, options) {
        const source = this;
        const doEnd = options?.end !== false;
        const ondata = (chunk) => {
          if (destination.writable) {
            if (destination.write(chunk) === false && typeof source.pause === "function") {
              source.pause();
            }
          }
        };
        source.on("data", ondata);
        const ondrain = () => {
          if (typeof source.resume === "function") {
            source.resume();
          }
        };
        destination.on("drain", ondrain);
        const onend = () => {
          if (doEnd) {
            destination.end();
          }
        };
        if (doEnd) {
          source.on("end", onend);
        }
        const cleanup = () => {
          source.removeListener("data", ondata);
          destination.removeListener("drain", ondrain);
          source.removeListener("end", onend);
        };
        source.on("close", cleanup);
        destination.on("close", cleanup);
        if (source instanceof Readable) {
          source._pipeDests.push({ dest: destination, ondata, ondrain, onend, cleanup, doEnd });
        }
        destination.emit("pipe", source);
        return destination;
      }
    };
    Readable = class _Readable extends Stream {
      readable = true;
      readableFlowing = null;
      readableLength = 0;
      readableHighWaterMark;
      readableEncoding;
      readableObjectMode;
      readableEnded = false;
      readableAborted = false;
      destroyed = false;
      /** @internal Tracked pipe destinations for unpipe. */
      _pipeDests = [];
      _buffer = [];
      _readableState = { ended: false, endEmitted: false, reading: false, constructed: true };
      _readablePending = false;
      _readImpl;
      _destroyImpl;
      _constructImpl;
      constructor(opts) {
        super(opts);
        this.readableHighWaterMark = opts?.highWaterMark ?? getDefaultHighWaterMark(opts?.objectMode ?? false);
        this.readableEncoding = opts?.encoding ?? null;
        this.readableObjectMode = opts?.objectMode ?? false;
        if (opts?.read) this._readImpl = opts.read;
        if (opts?.destroy) this._destroyImpl = opts.destroy;
        if (opts?.construct) this._constructImpl = opts.construct;
        const hasConstruct = this._constructImpl || this._construct !== _Readable.prototype._construct;
        if (hasConstruct) {
          this._readableState.constructed = false;
          nextTick2(() => {
            this._construct((err) => {
              this._readableState.constructed = true;
              if (err) {
                this.destroy(err);
              } else {
                if (this.readableFlowing === true) {
                  this._flow();
                }
              }
            });
          });
        }
      }
      _construct(callback) {
        if (this._constructImpl) {
          this._constructImpl.call(this, callback);
        } else {
          callback();
        }
      }
      _read(_size) {
        if (this._readImpl) {
          this._readImpl.call(this, _size);
        }
      }
      read(size) {
        if (!this._readableState.constructed) return null;
        if (this._buffer.length === 0) {
          if (this._readableState.ended) return null;
          this._readableState.reading = true;
          this._read(size ?? this.readableHighWaterMark);
          this._readableState.reading = false;
        }
        if (this._buffer.length === 0) return null;
        if (size === 0) return null;
        if (this.readableObjectMode) {
          if (size === void 0) {
            const chunk2 = this._buffer.shift();
            this.readableLength -= 1;
            if (this._readableState.ended && this._buffer.length === 0 && !this._readableState.endEmitted) {
              this._emitEnd();
            }
            return chunk2;
          }
          if (size > this.readableLength) return null;
          const chunk = this._buffer.shift();
          this.readableLength -= 1;
          return chunk;
        }
        if (size !== void 0 && size !== null) {
          if (size > this.readableLength) return null;
          return this._readBytes(size);
        }
        const result = this._buffer.splice(0);
        this.readableLength = 0;
        if (this._readableState.ended && this._buffer.length === 0 && !this._readableState.endEmitted) {
          this._emitEnd();
        }
        if (result.length === 1) return result[0];
        if (result.length === 0) return null;
        if (typeof result[0] === "string") return result.join("");
        const BufCtor = globalThis.Buffer;
        return BufCtor?.concat ? BufCtor.concat(result) : result;
      }
      /** @internal Extract exactly `size` bytes from the internal buffer. */
      _readBytes(size) {
        let collected = 0;
        const parts = [];
        while (collected < size && this._buffer.length > 0) {
          const chunk = this._buffer[0];
          const chunkLen = chunk.length ?? 1;
          if (collected + chunkLen <= size) {
            parts.push(this._buffer.shift());
            collected += chunkLen;
            this.readableLength -= chunkLen;
          } else {
            const needed = size - collected;
            const BufCtor2 = globalThis.Buffer;
            if (BufCtor2 && BufCtor2.isBuffer(chunk)) {
              parts.push(chunk.slice(0, needed));
              this._buffer[0] = chunk.slice(needed);
            } else if (typeof chunk === "string") {
              parts.push(chunk.slice(0, needed));
              this._buffer[0] = chunk.slice(needed);
            } else {
              parts.push(chunk.slice(0, needed));
              this._buffer[0] = chunk.slice(needed);
            }
            this.readableLength -= needed;
            collected += needed;
          }
        }
        if (parts.length === 1) return parts[0];
        const BufCtor = globalThis.Buffer;
        return BufCtor?.concat ? BufCtor.concat(parts) : parts;
      }
      push(chunk, encoding) {
        if (chunk === null) {
          this._readableState.ended = true;
          this.readableEnded = true;
          if (this._buffer.length === 0 && !this._readableState.endEmitted) {
            nextTick2(() => this._emitEnd());
          }
          this._scheduleReadable();
          return false;
        }
        this._buffer.push(chunk);
        this.readableLength += this.readableObjectMode ? 1 : chunk.length ?? 1;
        if (this.readableFlowing && !this._flowing) {
          nextTick2(() => this._flow());
        }
        if (this.readableFlowing !== true) {
          this._scheduleReadable();
        }
        return this.readableLength < this.readableHighWaterMark;
      }
      /** Emit 'end' followed by 'close' (matches Node.js autoDestroy behavior). */
      _emitEnd() {
        if (this._readableState.endEmitted) return;
        this._readableState.endEmitted = true;
        this.emit("end");
        nextTick2(() => this.emit("close"));
      }
      /** Schedule a single 'readable' event per microtask cycle (deduplicates multiple pushes). */
      _scheduleReadable() {
        if (this._readablePending || this.listenerCount("readable") === 0) return;
        this._readablePending = true;
        nextTick2(() => {
          this._readablePending = false;
          if (!this.destroyed) this.emit("readable");
        });
      }
      on(event, listener) {
        super.on(event, listener);
        if (event === "data" && this.readableFlowing !== false) {
          this.resume();
        }
        if (event === "readable" && (this._buffer.length > 0 || this._readableState.ended)) {
          this._scheduleReadable();
        }
        return this;
      }
      unshift(chunk) {
        this._buffer.unshift(chunk);
        this.readableLength += this.readableObjectMode ? 1 : chunk.length ?? 1;
      }
      setEncoding(encoding) {
        this.readableEncoding = encoding;
        return this;
      }
      pause() {
        this.readableFlowing = false;
        this.emit("pause");
        return this;
      }
      resume() {
        if (this.readableFlowing !== true) {
          this.readableFlowing = true;
          this.emit("resume");
          if (this._readableState.constructed) {
            this._flow();
          }
        }
        return this;
      }
      _flowing = false;
      _flow() {
        if (this.readableFlowing !== true || this._flowing || this.destroyed) return;
        if (!this._readableState.constructed) return;
        this._flowing = true;
        try {
          while (this._buffer.length > 0 && this.readableFlowing && !this.destroyed) {
            let chunk = this._buffer.shift();
            this.readableLength -= this.readableObjectMode ? 1 : chunk.length ?? 1;
            if (this.readableEncoding && typeof chunk !== "string") {
              const BufCtor = globalThis.Buffer;
              if (BufCtor && BufCtor.isBuffer(chunk)) {
                chunk = chunk.toString(this.readableEncoding);
              } else if (chunk instanceof Uint8Array) {
                chunk = new TextDecoder(this.readableEncoding).decode(chunk);
              }
            }
            this.emit("data", chunk);
          }
          if (this.destroyed) return;
          if (this._readableState.ended && this._buffer.length === 0 && !this._readableState.endEmitted) {
            nextTick2(() => this._emitEnd());
            return;
          }
          if (!this._readableState.ended && !this._readableState.reading && !this.destroyed) {
            this._readableState.reading = true;
            this._read(this.readableHighWaterMark);
            this._readableState.reading = false;
          }
        } finally {
          this._flowing = false;
        }
        if (this._buffer.length > 0 && this.readableFlowing && !this.destroyed) {
          nextTick2(() => this._flow());
        }
      }
      isPaused() {
        return this.readableFlowing === false;
      }
      unpipe(destination) {
        if (!destination) {
          for (const state of this._pipeDests) {
            state.cleanup();
            state.dest.emit("unpipe", this);
          }
          this._pipeDests = [];
          this.readableFlowing = false;
        } else {
          const idx = this._pipeDests.findIndex((s) => s.dest === destination);
          if (idx !== -1) {
            const state = this._pipeDests[idx];
            state.cleanup();
            this._pipeDests.splice(idx, 1);
            destination.emit("unpipe", this);
            if (this._pipeDests.length === 0) {
              this.readableFlowing = false;
            }
          }
        }
        return this;
      }
      destroy(error2) {
        if (this.destroyed) return this;
        this.destroyed = true;
        this.readable = false;
        this.readableAborted = !this.readableEnded;
        const cb = (err) => {
          if (err) nextTick2(() => this.emit("error", err));
          nextTick2(() => this.emit("close"));
        };
        if (this._destroyImpl) {
          this._destroyImpl.call(this, error2 ?? null, cb);
        } else {
          cb(error2);
        }
        return this;
      }
      [Symbol.asyncIterator]() {
        const readable = this;
        const buffer = [];
        let done = false;
        let error2 = null;
        let waitingResolve = null;
        let waitingReject = null;
        readable.on("data", (chunk) => {
          if (waitingResolve) {
            const resolve = waitingResolve;
            waitingResolve = null;
            waitingReject = null;
            resolve({ value: chunk, done: false });
          } else {
            buffer.push(chunk);
          }
        });
        readable.on("end", () => {
          done = true;
          if (waitingResolve) {
            const resolve = waitingResolve;
            waitingResolve = null;
            waitingReject = null;
            resolve({ value: void 0, done: true });
          }
        });
        readable.on("error", (err) => {
          error2 = err;
          done = true;
          if (waitingReject) {
            const reject = waitingReject;
            waitingResolve = null;
            waitingReject = null;
            reject(err);
          }
        });
        return {
          next() {
            if (error2) return Promise.reject(error2);
            if (buffer.length > 0) return Promise.resolve({ value: buffer.shift(), done: false });
            if (done) return Promise.resolve({ value: void 0, done: true });
            return new Promise((resolve, reject) => {
              waitingResolve = resolve;
              waitingReject = reject;
            });
          },
          return() {
            readable.destroy();
            return Promise.resolve({ value: void 0, done: true });
          },
          [Symbol.asyncIterator]() {
            return this;
          }
        };
      }
      static from(iterable, opts) {
        const readable = new _Readable({
          objectMode: true,
          ...opts,
          read() {
          }
        });
        if (typeof iterable === "string" || ArrayBuffer.isView(iterable)) {
          readable.push(iterable);
          readable.push(null);
          return readable;
        }
        (async () => {
          try {
            for await (const chunk of iterable) {
              if (!readable.push(chunk)) {
                await new Promise((resolve) => readable.once("drain", resolve));
              }
            }
            readable.push(null);
          } catch (err) {
            readable.destroy(err);
          }
        })();
        return readable;
      }
    };
    Writable = class _Writable extends Stream {
      writable = true;
      writableHighWaterMark;
      writableLength = 0;
      writableObjectMode;
      writableEnded = false;
      writableFinished = false;
      writableCorked = 0;
      writableNeedDrain = false;
      destroyed = false;
      _writableState = { ended: false, finished: false, constructed: true, writing: false };
      _corkedBuffer = [];
      _writeBuffer = [];
      _pendingConstruct = [];
      _ending = false;
      _endCallback;
      _pendingEnd = null;
      _writeImpl;
      _writev;
      _finalImpl;
      _destroyImpl;
      _constructImpl;
      _decodeStrings;
      _defaultEncoding = "utf8";
      constructor(opts) {
        super(opts);
        this.writableHighWaterMark = opts?.highWaterMark ?? getDefaultHighWaterMark(opts?.objectMode ?? false);
        this.writableObjectMode = opts?.objectMode ?? false;
        this._decodeStrings = opts?.decodeStrings !== false;
        if (opts?.write) this._writeImpl = opts.write;
        if (opts?.writev) this._writev = opts.writev;
        if (opts?.final) this._finalImpl = opts.final;
        if (opts?.destroy) this._destroyImpl = opts.destroy;
        if (opts?.construct) this._constructImpl = opts.construct;
        const hasConstruct = this._constructImpl || this._construct !== _Writable.prototype._construct;
        if (hasConstruct) {
          this._writableState.constructed = false;
          nextTick2(() => {
            this._construct((err) => {
              this._writableState.constructed = true;
              if (err) {
                this.destroy(err);
              } else {
                this._maybeFlush();
              }
            });
          });
        }
      }
      _construct(callback) {
        if (this._constructImpl) {
          this._constructImpl.call(this, callback);
        } else {
          callback();
        }
      }
      _write(chunk, encoding, callback) {
        if (this._writeImpl) {
          this._writeImpl.call(this, chunk, encoding, callback);
        } else {
          callback();
        }
      }
      _final(callback) {
        if (this._finalImpl) {
          this._finalImpl.call(this, callback);
        } else {
          callback();
        }
      }
      _maybeFlush() {
        const pending = this._pendingConstruct.splice(0);
        if (pending.length > 0) {
          const [first, ...rest] = pending;
          this._writeBuffer.push(...rest);
          this._doWrite(first.chunk, first.encoding, first.callback);
        }
        if (this._pendingEnd) {
          const { chunk, encoding, callback } = this._pendingEnd;
          this._pendingEnd = null;
          this._doEnd(chunk, encoding, callback);
        }
      }
      _doWrite(chunk, encoding, callback) {
        this._writableState.writing = true;
        this._write(chunk, encoding, (err) => {
          this._writableState.writing = false;
          this.writableLength -= this.writableObjectMode ? 1 : chunk?.length ?? 1;
          if (err) {
            nextTick2(() => {
              callback(err);
              this.emit("error", err);
              this._drainWriteBuffer();
            });
          } else {
            nextTick2(() => {
              callback();
              if (this.writableNeedDrain && this.writableLength < this.writableHighWaterMark) {
                this.writableNeedDrain = false;
                this.emit("drain");
              }
              this._drainWriteBuffer();
            });
          }
        });
      }
      _drainWriteBuffer() {
        if (this._writeBuffer.length > 0) {
          const next = this._writeBuffer.shift();
          this._doWrite(next.chunk, next.encoding, next.callback);
        } else {
          this._maybeFinish();
        }
      }
      _maybeFinish() {
        if (!this._ending || this._writableState.finished || this._writableState.writing || this._writeBuffer.length > 0) return;
        this._ending = false;
        this._final((err) => {
          this.writableFinished = true;
          this._writableState.finished = true;
          nextTick2(() => {
            if (err) {
              this.emit("error", err);
            }
            this.emit("finish");
            nextTick2(() => this.emit("close"));
            if (this._endCallback) this._endCallback();
          });
        });
      }
      write(chunk, encoding, callback) {
        if (typeof encoding === "function") {
          callback = encoding;
          encoding = void 0;
        }
        if (encoding === void 0) encoding = this._defaultEncoding;
        callback = callback || (() => {
        });
        if (this._decodeStrings && !this.writableObjectMode && typeof chunk === "string") {
          const BufCtor = globalThis.Buffer;
          if (BufCtor) {
            chunk = BufCtor.from(chunk, encoding);
            encoding = "buffer";
          }
        }
        if (typeof chunk !== "string" && !this.writableObjectMode) {
          const BufCtor = globalThis.Buffer;
          if (BufCtor && BufCtor.isBuffer(chunk) || chunk instanceof Uint8Array) {
            encoding = "buffer";
          }
        }
        if (this.writableEnded) {
          const err = new Error("write after end");
          nextTick2(() => {
            if (callback) callback(err);
            this.emit("error", err);
          });
          return false;
        }
        this.writableLength += this.writableObjectMode ? 1 : chunk?.length ?? 1;
        if (this.writableCorked > 0) {
          this._corkedBuffer.push({ chunk, encoding, callback });
          return this.writableLength < this.writableHighWaterMark;
        }
        if (!this._writableState.constructed) {
          this._pendingConstruct.push({ chunk, encoding, callback });
          return this.writableLength < this.writableHighWaterMark;
        }
        const belowHWM = this.writableLength < this.writableHighWaterMark;
        if (!belowHWM) {
          this.writableNeedDrain = true;
        }
        if (this._writableState.writing) {
          this._writeBuffer.push({ chunk, encoding, callback });
        } else {
          this._doWrite(chunk, encoding, callback);
        }
        return belowHWM;
      }
      _doEnd(chunk, encoding, callback) {
        if (chunk !== void 0 && chunk !== null) {
          this.write(chunk, encoding);
        }
        this.writableEnded = true;
        this._writableState.ended = true;
        this._ending = true;
        this._endCallback = callback;
        this._maybeFinish();
      }
      end(chunk, encoding, callback) {
        if (typeof chunk === "function") {
          callback = chunk;
          chunk = void 0;
        }
        if (typeof encoding === "function") {
          callback = encoding;
          encoding = void 0;
        }
        if (this.writableEnded) {
          if (callback) nextTick2(callback);
          return this;
        }
        if (!this._writableState.constructed) {
          this._pendingEnd = { chunk, encoding, callback };
          return this;
        }
        this._doEnd(chunk, encoding, callback);
        return this;
      }
      cork() {
        this.writableCorked++;
      }
      uncork() {
        if (this.writableCorked > 0) {
          this.writableCorked--;
          if (this.writableCorked === 0 && this._corkedBuffer.length > 0) {
            this._flushCorkedBuffer();
          }
        }
      }
      _flushCorkedBuffer() {
        if (this._writev && this._corkedBuffer.length > 1) {
          const buffered = this._corkedBuffer.splice(0);
          const chunks = buffered.map((b) => ({ chunk: b.chunk, encoding: b.encoding }));
          this._writev.call(this, chunks, (err) => {
            for (const b of buffered) {
              this.writableLength -= this.writableObjectMode ? 1 : b.chunk?.length ?? 1;
            }
            if (err) {
              for (const b of buffered) b.callback(err);
              this.emit("error", err);
            } else {
              for (const b of buffered) b.callback();
              if (this.writableNeedDrain && this.writableLength < this.writableHighWaterMark) {
                this.writableNeedDrain = false;
                this.emit("drain");
              }
            }
          });
        } else {
          const buffered = this._corkedBuffer.splice(0);
          if (buffered.length > 0) {
            const [first, ...rest] = buffered;
            this._writeBuffer.push(...rest);
            this._doWrite(first.chunk, first.encoding, first.callback);
          }
        }
      }
      setDefaultEncoding(encoding) {
        this._defaultEncoding = encoding;
        return this;
      }
      destroy(error2) {
        if (this.destroyed) return this;
        this.destroyed = true;
        this.writable = false;
        const cb = (err) => {
          if (err) nextTick2(() => this.emit("error", err));
          nextTick2(() => this.emit("close"));
        };
        if (this._destroyImpl) {
          this._destroyImpl.call(this, error2 ?? null, cb);
        } else {
          cb(error2);
        }
        return this;
      }
    };
    Duplex = class extends Readable {
      writable = true;
      writableHighWaterMark;
      writableLength = 0;
      writableObjectMode;
      writableEnded = false;
      writableFinished = false;
      writableCorked = 0;
      writableNeedDrain = false;
      allowHalfOpen;
      _decodeStrings;
      _duplexCorkedBuffer = [];
      _writeImpl;
      _finalImpl;
      _defaultEncoding = "utf8";
      _pendingWrites = 0;
      _pendingEndCb = null;
      constructor(opts) {
        super(opts);
        this.writableHighWaterMark = opts?.writableHighWaterMark ?? opts?.highWaterMark ?? getDefaultHighWaterMark(opts?.writableObjectMode ?? opts?.objectMode ?? false);
        this.writableObjectMode = opts?.writableObjectMode ?? opts?.objectMode ?? false;
        this.allowHalfOpen = opts?.allowHalfOpen !== false;
        this._decodeStrings = opts?.decodeStrings !== false;
        if (opts?.write) this._writeImpl = opts.write;
        if (opts?.final) this._finalImpl = opts.final;
        if (!this.allowHalfOpen) {
          this.once("end", () => {
            if (!this.writableEnded) {
              nextTick2(() => this.end());
            }
          });
        }
      }
      _write(chunk, encoding, callback) {
        if (this._writeImpl) {
          this._writeImpl.call(this, chunk, encoding, callback);
        } else {
          callback();
        }
      }
      _final(callback) {
        if (this._finalImpl) {
          this._finalImpl.call(this, callback);
        } else {
          callback();
        }
      }
      destroy(error2) {
        if (this.destroyed) return this;
        this.writable = false;
        return super.destroy(error2);
      }
      write(chunk, encoding, callback) {
        if (typeof encoding === "function") {
          callback = encoding;
          encoding = void 0;
        }
        if (encoding === void 0) encoding = this._defaultEncoding;
        if (this._decodeStrings && !this.writableObjectMode && typeof chunk === "string") {
          const BufCtor = globalThis.Buffer;
          if (BufCtor) {
            chunk = BufCtor.from(chunk, encoding);
            encoding = "buffer";
          }
        }
        if (typeof chunk !== "string" && !this.writableObjectMode) {
          const BufCtor = globalThis.Buffer;
          if (BufCtor && BufCtor.isBuffer(chunk) || chunk instanceof Uint8Array) {
            encoding = "buffer";
          }
        }
        if (this.writableEnded) {
          const err = new Error("write after end");
          const cb2 = callback || (() => {
          });
          nextTick2(() => {
            cb2(err);
            this.emit("error", err);
          });
          return false;
        }
        this.writableLength += this.writableObjectMode ? 1 : chunk?.length ?? 1;
        if (this.writableCorked > 0) {
          this._duplexCorkedBuffer.push({ chunk, encoding, callback: callback || (() => {
          }) });
          return this.writableLength < this.writableHighWaterMark;
        }
        const belowHWM = this.writableLength < this.writableHighWaterMark;
        if (!belowHWM) {
          this.writableNeedDrain = true;
        }
        const cb = callback || (() => {
        });
        this._pendingWrites++;
        this._write(chunk, encoding, (err) => {
          this._pendingWrites--;
          this.writableLength -= this.writableObjectMode ? 1 : chunk?.length ?? 1;
          if (err) {
            nextTick2(() => {
              cb(err);
              this.emit("error", err);
            });
          } else {
            nextTick2(() => {
              cb();
              if (this.writableNeedDrain && this.writableLength < this.writableHighWaterMark) {
                this.writableNeedDrain = false;
                this.emit("drain");
              }
              if (this._pendingWrites === 0 && this._pendingEndCb) {
                const endCb = this._pendingEndCb;
                this._pendingEndCb = null;
                endCb();
              }
            });
          }
        });
        return belowHWM;
      }
      end(chunk, encoding, callback) {
        if (typeof chunk === "function") {
          callback = chunk;
          chunk = void 0;
        }
        if (typeof encoding === "function") {
          callback = encoding;
          encoding = void 0;
        }
        if (chunk !== void 0 && chunk !== null) {
          this.write(chunk, encoding);
        }
        this.writableEnded = true;
        const doFinal = () => {
          this._final((err) => {
            this.writableFinished = true;
            nextTick2(() => {
              if (err) this.emit("error", err);
              this.emit("finish");
              nextTick2(() => this.emit("close"));
              if (callback) callback();
            });
          });
        };
        if (this._pendingWrites > 0) {
          this._pendingEndCb = doFinal;
        } else {
          doFinal();
        }
        return this;
      }
      cork() {
        this.writableCorked++;
      }
      uncork() {
        if (this.writableCorked > 0) {
          this.writableCorked--;
          if (this.writableCorked === 0 && this._duplexCorkedBuffer.length > 0) {
            const buffered = this._duplexCorkedBuffer.splice(0);
            for (const { chunk, encoding, callback } of buffered) {
              this._write(chunk, encoding, (err) => {
                this.writableLength -= this.writableObjectMode ? 1 : chunk?.length ?? 1;
                if (err) {
                  callback(err);
                  this.emit("error", err);
                } else {
                  callback();
                }
              });
            }
            if (this.writableNeedDrain && this.writableLength < this.writableHighWaterMark) {
              this.writableNeedDrain = false;
              nextTick2(() => this.emit("drain"));
            }
          }
        }
      }
      setDefaultEncoding(encoding) {
        this._defaultEncoding = encoding;
        return this;
      }
    };
    Transform = class extends Duplex {
      _transformImpl;
      _flushImpl;
      constructor(opts) {
        super({
          ...opts,
          write: void 0
          // Override write to use transform
        });
        if (opts?.transform) this._transformImpl = opts.transform;
        if (opts?.flush) this._flushImpl = opts.flush;
      }
      _transform(chunk, encoding, callback) {
        if (this._transformImpl) {
          this._transformImpl.call(this, chunk, encoding, callback);
        } else {
          callback(null, chunk);
        }
      }
      _flush(callback) {
        if (this._flushImpl) {
          this._flushImpl.call(this, callback);
        } else {
          callback();
        }
      }
      _write(chunk, encoding, callback) {
        this._transform(chunk, encoding, (err, data) => {
          if (err) {
            callback(err);
            return;
          }
          if (data !== void 0 && data !== null) {
            this.push(data);
          }
          callback();
        });
      }
      _final(callback) {
        this._flush((err, data) => {
          if (err) {
            callback(err);
            return;
          }
          if (data !== void 0 && data !== null) {
            this.push(data);
          }
          this.push(null);
          callback();
        });
      }
    };
    PassThrough = class extends Transform {
      constructor(opts) {
        super({
          ...opts,
          transform(chunk, _encoding, callback) {
            callback(null, chunk);
          }
        });
      }
    };
    _default2 = Object.assign(Stream, {
      Stream,
      Readable,
      Writable,
      Duplex,
      Transform,
      PassThrough,
      pipeline,
      finished,
      addAbortSignal,
      isReadable,
      isWritable,
      isDestroyed,
      isDisturbed,
      isErrored,
      getDefaultHighWaterMark,
      setDefaultHighWaterMark
    });
    index_default4 = _default2;
  }
});

// ../../node/stream/cjs-compat.cjs
var require_cjs_compat3 = __commonJS({
  "../../node/stream/cjs-compat.cjs"(exports, module) {
    init_console_gjs();
    var mod = (init_esm5(), __toCommonJS(esm_exports4));
    module.exports = mod.default || mod;
  }
});

// ../../node/buffer/lib/esm/buffer.js
function encodeString(str, encoding) {
  switch (encoding) {
    case "utf8":
      return textEncoder.encode(str);
    case "ascii": {
      const buf = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) {
        buf[i] = str.charCodeAt(i) & 127;
      }
      return buf;
    }
    case "latin1": {
      const buf = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) {
        buf[i] = str.charCodeAt(i) & 255;
      }
      return buf;
    }
    case "base64": {
      const standard = str.replace(/-/g, "+").replace(/_/g, "/");
      return base64Decode(standard);
    }
    case "base64url": {
      const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
      return encodeString(base64, "base64");
    }
    case "hex": {
      const bytes = str.length >>> 1;
      const buf = new Uint8Array(bytes);
      for (let i = 0; i < bytes; i++) {
        const hi = parseInt(str[i * 2], 16);
        const lo = parseInt(str[i * 2 + 1], 16);
        if (Number.isNaN(hi) || Number.isNaN(lo)) break;
        buf[i] = hi << 4 | lo;
      }
      return buf;
    }
    case "utf16le": {
      const buf = new Uint8Array(str.length * 2);
      for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        buf[i * 2] = code & 255;
        buf[i * 2 + 1] = code >> 8 & 255;
      }
      return buf;
    }
    default:
      return textEncoder.encode(str);
  }
}
function decodeString(buf, encoding, start, end) {
  const slice = start !== void 0 || end !== void 0 ? buf.subarray(start ?? 0, end ?? buf.length) : buf;
  switch (encoding) {
    case "utf8":
      return textDecoder.decode(slice);
    case "ascii": {
      let result = "";
      for (let i = 0; i < slice.length; i++) {
        result += String.fromCharCode(slice[i] & 127);
      }
      return result;
    }
    case "latin1": {
      let result = "";
      for (let i = 0; i < slice.length; i++) {
        result += String.fromCharCode(slice[i]);
      }
      return result;
    }
    case "base64": {
      let binary = "";
      for (let i = 0; i < slice.length; i++) {
        binary += String.fromCharCode(slice[i]);
      }
      return btoaPolyfill(binary);
    }
    case "base64url": {
      const base64 = decodeString(slice, "base64");
      return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }
    case "hex": {
      let result = "";
      for (let i = 0; i < slice.length; i++) {
        result += slice[i].toString(16).padStart(2, "0");
      }
      return result;
    }
    case "utf16le": {
      let result = "";
      for (let i = 0; i + 1 < slice.length; i += 2) {
        result += String.fromCharCode(slice[i] | slice[i + 1] << 8);
      }
      return result;
    }
    default:
      return textDecoder.decode(slice);
  }
}
function checkOffset(offset, ext, length) {
  if (offset + ext > length) {
    throw new RangeError("Attempt to access memory outside buffer bounds");
  }
}
var textEncoder, textDecoder, hasSharedArrayBuffer, Buffer2, kMaxLength, kStringMaxLength;
var init_buffer = __esm({
  "../../node/buffer/lib/esm/buffer.js"() {
    init_console_gjs();
    init_esm4();
    textEncoder = new TextEncoder();
    textDecoder = new TextDecoder();
    hasSharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
    Buffer2 = class _Buffer extends Uint8Array {
      // Marker to identify Buffer instances
      static _isBuffer = true;
      // ---- Static constructors ----
      static alloc(size, fill, encoding) {
        if (typeof size !== "number") {
          throw new TypeError(`The "size" argument must be of type number. Received type ${typeof size}`);
        }
        if (size < 0) {
          throw new RangeError(`The value "${size}" is invalid for option "size"`);
        }
        const buf = new _Buffer(size);
        if (fill !== void 0 && fill !== 0) {
          buf.fill(fill, 0, size, encoding);
        }
        return buf;
      }
      static allocUnsafe(size) {
        if (typeof size !== "number") {
          throw new TypeError(`The "size" argument must be of type number. Received type ${typeof size}`);
        }
        return new _Buffer(size);
      }
      static allocUnsafeSlow(size) {
        return _Buffer.allocUnsafe(size);
      }
      static from(value2, encodingOrOffset, length) {
        if (typeof value2 === "string") {
          const encoding = normalizeEncoding(encodingOrOffset);
          if (encodingOrOffset && typeof encodingOrOffset === "string") {
            const lower2 = ("" + encodingOrOffset).toLowerCase().replace(/-/g, "");
            const valid = ["utf8", "ascii", "latin1", "binary", "base64", "base64url", "hex", "ucs2", "utf16le", ""];
            if (!valid.includes(lower2)) {
              checkEncoding(encodingOrOffset);
            }
          }
          const encoded = encodeString(value2, encoding);
          const buf = new _Buffer(encoded.buffer, encoded.byteOffset, encoded.byteLength);
          return buf;
        }
        if (ArrayBuffer.isView(value2)) {
          const buf = new _Buffer(value2.buffer, value2.byteOffset, value2.byteLength);
          const copy = new _Buffer(buf.length);
          copy.set(buf);
          return copy;
        }
        if (value2 instanceof ArrayBuffer) {
          const offset = encodingOrOffset || 0;
          const len = length !== void 0 ? length : value2.byteLength - offset;
          return new _Buffer(value2, offset, len);
        }
        if (hasSharedArrayBuffer && value2 instanceof SharedArrayBuffer) {
          const offset = encodingOrOffset || 0;
          const len = length !== void 0 ? length : value2.byteLength - offset;
          return new _Buffer(new Uint8Array(value2, offset, len));
        }
        if (Array.isArray(value2)) {
          const buf = new _Buffer(value2.length);
          for (let i = 0; i < value2.length; i++) {
            buf[i] = value2[i] & 255;
          }
          return buf;
        }
        throw new TypeError("The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array");
      }
      // ---- Static methods ----
      static isBuffer(obj) {
        return obj instanceof _Buffer;
      }
      static isEncoding(encoding) {
        if (typeof encoding !== "string") return false;
        const lower2 = encoding.toLowerCase().replace(/-/g, "");
        return ["utf8", "ascii", "latin1", "binary", "base64", "base64url", "hex", "ucs2", "utf16le"].includes(lower2);
      }
      static byteLength(string, encoding) {
        if (typeof string !== "string") {
          if (ArrayBuffer.isView(string)) return string.byteLength;
          if (string instanceof ArrayBuffer) return string.byteLength;
          if (hasSharedArrayBuffer && string instanceof SharedArrayBuffer) return string.byteLength;
          throw new TypeError('The "string" argument must be one of type string, Buffer, or ArrayBuffer');
        }
        const enc = normalizeEncoding(encoding);
        switch (enc) {
          case "utf8":
            return textEncoder.encode(string).byteLength;
          case "ascii":
          case "latin1":
            return string.length;
          case "base64":
          case "base64url": {
            let len = string.length;
            while (len > 0 && (string[len - 1] === "=" || string[len - 1] === " ")) len--;
            return len * 3 >>> 2;
          }
          case "hex":
            return string.length >>> 1;
          case "utf16le":
            return string.length * 2;
          default:
            return textEncoder.encode(string).byteLength;
        }
      }
      static compare(buf1, buf2) {
        if (!(buf1 instanceof Uint8Array) || !(buf2 instanceof Uint8Array)) {
          throw new TypeError("Arguments must be Buffers or Uint8Arrays");
        }
        const len = Math.min(buf1.length, buf2.length);
        for (let i = 0; i < len; i++) {
          if (buf1[i] < buf2[i]) return -1;
          if (buf1[i] > buf2[i]) return 1;
        }
        if (buf1.length < buf2.length) return -1;
        if (buf1.length > buf2.length) return 1;
        return 0;
      }
      static concat(list, totalLength) {
        if (list.length === 0) return _Buffer.alloc(0);
        if (totalLength === void 0) {
          totalLength = 0;
          for (let i = 0; i < list.length; i++) {
            totalLength += list[i].length;
          }
        }
        const result = _Buffer.alloc(totalLength);
        let offset = 0;
        for (let i = 0; i < list.length; i++) {
          const buf = list[i];
          const toCopy = Math.min(buf.length, totalLength - offset);
          if (toCopy <= 0) continue;
          result.set(buf.subarray(0, toCopy), offset);
          offset += toCopy;
        }
        return result;
      }
      static poolSize = 8192;
      // ---- Instance methods ----
      toString(encoding, start, end) {
        const enc = normalizeEncoding(encoding);
        return decodeString(this, enc, start, end);
      }
      toJSON() {
        return {
          type: "Buffer",
          data: Array.from(this)
        };
      }
      equals(otherBuffer) {
        if (!(otherBuffer instanceof Uint8Array)) {
          throw new TypeError("Argument must be a Buffer or Uint8Array");
        }
        if (this.length !== otherBuffer.length) return false;
        for (let i = 0; i < this.length; i++) {
          if (this[i] !== otherBuffer[i]) return false;
        }
        return true;
      }
      compare(target, targetStart, targetEnd, sourceStart, sourceEnd) {
        if (!(target instanceof Uint8Array)) {
          throw new TypeError("Argument must be a Buffer or Uint8Array");
        }
        const src = sourceStart !== void 0 || sourceEnd !== void 0 ? this.subarray(sourceStart ?? 0, sourceEnd ?? this.length) : this;
        const tgt = targetStart !== void 0 || targetEnd !== void 0 ? target.subarray(targetStart ?? 0, targetEnd ?? target.length) : target;
        return _Buffer.compare(src, tgt);
      }
      copy(target, targetStart = 0, sourceStart = 0, sourceEnd) {
        const end = sourceEnd ?? this.length;
        const toCopy = Math.min(end - sourceStart, target.length - targetStart);
        if (toCopy <= 0) return 0;
        target.set(this.subarray(sourceStart, sourceStart + toCopy), targetStart);
        return toCopy;
      }
      // slice returns a Buffer (not Uint8Array) that shares memory
      slice(start, end) {
        const s = start ?? 0;
        const e = end ?? this.length;
        const sub = super.subarray(s, e);
        return new _Buffer(sub.buffer, sub.byteOffset, sub.byteLength);
      }
      // subarray also returns a Buffer
      subarray(start, end) {
        const sub = super.subarray(start, end);
        return new _Buffer(sub.buffer, sub.byteOffset, sub.byteLength);
      }
      write(string, offset, length, encoding) {
        offset = offset ?? 0;
        const enc = normalizeEncoding(encoding || (typeof length === "string" ? length : void 0));
        const encoded = encodeString(string, enc);
        const maxLen = length !== void 0 && typeof length === "number" ? Math.min(length, this.length - offset) : this.length - offset;
        const toCopy = Math.min(encoded.length, maxLen);
        this.set(encoded.subarray(0, toCopy), offset);
        return toCopy;
      }
      fill(value2, offset, end, encoding) {
        const start = offset ?? 0;
        const stop = end ?? this.length;
        if (typeof value2 === "number") {
          super.fill(value2 & 255, start, stop);
        } else if (typeof value2 === "string") {
          const enc = normalizeEncoding(encoding);
          const encoded = encodeString(value2, enc);
          if (encoded.length === 0) {
            super.fill(0, start, stop);
          } else if (encoded.length === 1) {
            super.fill(encoded[0], start, stop);
          } else {
            for (let i = start; i < stop; i++) {
              this[i] = encoded[(i - start) % encoded.length];
            }
          }
        } else if (value2 instanceof Uint8Array) {
          if (value2.length === 0) {
            super.fill(0, start, stop);
          } else {
            for (let i = start; i < stop; i++) {
              this[i] = value2[(i - start) % value2.length];
            }
          }
        }
        return this;
      }
      indexOf(value2, byteOffset, encoding) {
        if (typeof value2 === "number") {
          return super.indexOf(value2 & 255, byteOffset);
        }
        const needle = typeof value2 === "string" ? encodeString(value2, normalizeEncoding(encoding)) : value2;
        const start = byteOffset ?? 0;
        outer:
          for (let i = start; i <= this.length - needle.length; i++) {
            for (let j = 0; j < needle.length; j++) {
              if (this[i + j] !== needle[j]) continue outer;
            }
            return i;
          }
        return -1;
      }
      lastIndexOf(value2, byteOffset, encoding) {
        if (typeof value2 === "number") {
          return byteOffset !== void 0 ? super.lastIndexOf(value2 & 255, byteOffset) : super.lastIndexOf(value2 & 255);
        }
        const needle = typeof value2 === "string" ? encodeString(value2, normalizeEncoding(encoding)) : value2;
        const start = byteOffset !== void 0 ? Math.min(byteOffset, this.length - needle.length) : this.length - needle.length;
        outer:
          for (let i = start; i >= 0; i--) {
            for (let j = 0; j < needle.length; j++) {
              if (this[i + j] !== needle[j]) continue outer;
            }
            return i;
          }
        return -1;
      }
      includes(value2, byteOffset, encoding) {
        return this.indexOf(value2, byteOffset, encoding) !== -1;
      }
      // ---- Read methods ----
      readUInt8(offset = 0) {
        checkOffset(offset, 1, this.length);
        return this[offset];
      }
      readUInt16BE(offset = 0) {
        checkOffset(offset, 2, this.length);
        return this[offset] << 8 | this[offset + 1];
      }
      readUInt16LE(offset = 0) {
        checkOffset(offset, 2, this.length);
        return this[offset] | this[offset + 1] << 8;
      }
      readUInt32BE(offset = 0) {
        checkOffset(offset, 4, this.length);
        return this[offset] * 16777216 + (this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3]);
      }
      readUInt32LE(offset = 0) {
        checkOffset(offset, 4, this.length);
        return this[offset + 3] * 16777216 + (this[offset + 2] << 16 | this[offset + 1] << 8 | this[offset]) >>> 0;
      }
      readInt8(offset = 0) {
        checkOffset(offset, 1, this.length);
        return this[offset] | (this[offset] & 128 ? 4294967040 : 0);
      }
      readInt16BE(offset = 0) {
        checkOffset(offset, 2, this.length);
        const val = this[offset] << 8 | this[offset + 1];
        return val & 32768 ? val | 4294901760 : val;
      }
      readInt16LE(offset = 0) {
        checkOffset(offset, 2, this.length);
        const val = this[offset] | this[offset + 1] << 8;
        return val & 32768 ? val | 4294901760 : val;
      }
      readInt32BE(offset = 0) {
        checkOffset(offset, 4, this.length);
        return this[offset] << 24 | this[offset + 1] << 16 | this[offset + 2] << 8 | this[offset + 3];
      }
      readInt32LE(offset = 0) {
        checkOffset(offset, 4, this.length);
        return this[offset] | this[offset + 1] << 8 | this[offset + 2] << 16 | this[offset + 3] << 24;
      }
      readFloatBE(offset = 0) {
        checkOffset(offset, 4, this.length);
        const view = new DataView(this.buffer, this.byteOffset + offset, 4);
        return view.getFloat32(0, false);
      }
      readFloatLE(offset = 0) {
        checkOffset(offset, 4, this.length);
        const view = new DataView(this.buffer, this.byteOffset + offset, 4);
        return view.getFloat32(0, true);
      }
      readDoubleBE(offset = 0) {
        checkOffset(offset, 8, this.length);
        const view = new DataView(this.buffer, this.byteOffset + offset, 8);
        return view.getFloat64(0, false);
      }
      readDoubleLE(offset = 0) {
        checkOffset(offset, 8, this.length);
        const view = new DataView(this.buffer, this.byteOffset + offset, 8);
        return view.getFloat64(0, true);
      }
      readBigInt64BE(offset = 0) {
        checkOffset(offset, 8, this.length);
        const view = new DataView(this.buffer, this.byteOffset + offset, 8);
        return view.getBigInt64(0, false);
      }
      readBigInt64LE(offset = 0) {
        checkOffset(offset, 8, this.length);
        const view = new DataView(this.buffer, this.byteOffset + offset, 8);
        return view.getBigInt64(0, true);
      }
      readBigUInt64BE(offset = 0) {
        checkOffset(offset, 8, this.length);
        const view = new DataView(this.buffer, this.byteOffset + offset, 8);
        return view.getBigUint64(0, false);
      }
      readBigUInt64LE(offset = 0) {
        checkOffset(offset, 8, this.length);
        const view = new DataView(this.buffer, this.byteOffset + offset, 8);
        return view.getBigUint64(0, true);
      }
      readUIntBE(offset, byteLength) {
        checkOffset(offset, byteLength, this.length);
        let val = 0;
        for (let i = 0; i < byteLength; i++) {
          val = val * 256 + this[offset + i];
        }
        return val;
      }
      readUIntLE(offset, byteLength) {
        checkOffset(offset, byteLength, this.length);
        let val = 0;
        let mul = 1;
        for (let i = 0; i < byteLength; i++) {
          val += this[offset + i] * mul;
          mul *= 256;
        }
        return val;
      }
      readIntBE(offset, byteLength) {
        checkOffset(offset, byteLength, this.length);
        let val = 0;
        for (let i = 0; i < byteLength; i++) {
          val = val * 256 + this[offset + i];
        }
        if (val >= Math.pow(2, 8 * byteLength - 1)) {
          val -= Math.pow(2, 8 * byteLength);
        }
        return val;
      }
      readIntLE(offset, byteLength) {
        checkOffset(offset, byteLength, this.length);
        let val = 0;
        let mul = 1;
        for (let i = 0; i < byteLength; i++) {
          val += this[offset + i] * mul;
          mul *= 256;
        }
        if (val >= Math.pow(2, 8 * byteLength - 1)) {
          val -= Math.pow(2, 8 * byteLength);
        }
        return val;
      }
      // ---- Write methods ----
      writeUInt8(value2, offset = 0) {
        checkOffset(offset, 1, this.length);
        this[offset] = value2 & 255;
        return offset + 1;
      }
      writeUInt16BE(value2, offset = 0) {
        checkOffset(offset, 2, this.length);
        this[offset] = value2 >>> 8 & 255;
        this[offset + 1] = value2 & 255;
        return offset + 2;
      }
      writeUInt16LE(value2, offset = 0) {
        checkOffset(offset, 2, this.length);
        this[offset] = value2 & 255;
        this[offset + 1] = value2 >>> 8 & 255;
        return offset + 2;
      }
      writeUInt32BE(value2, offset = 0) {
        checkOffset(offset, 4, this.length);
        this[offset] = value2 >>> 24 & 255;
        this[offset + 1] = value2 >>> 16 & 255;
        this[offset + 2] = value2 >>> 8 & 255;
        this[offset + 3] = value2 & 255;
        return offset + 4;
      }
      writeUInt32LE(value2, offset = 0) {
        checkOffset(offset, 4, this.length);
        this[offset] = value2 & 255;
        this[offset + 1] = value2 >>> 8 & 255;
        this[offset + 2] = value2 >>> 16 & 255;
        this[offset + 3] = value2 >>> 24 & 255;
        return offset + 4;
      }
      writeInt8(value2, offset = 0) {
        checkOffset(offset, 1, this.length);
        if (value2 < 0) value2 = 255 + value2 + 1;
        this[offset] = value2 & 255;
        return offset + 1;
      }
      writeInt16BE(value2, offset = 0) {
        checkOffset(offset, 2, this.length);
        this[offset] = value2 >>> 8 & 255;
        this[offset + 1] = value2 & 255;
        return offset + 2;
      }
      writeInt16LE(value2, offset = 0) {
        checkOffset(offset, 2, this.length);
        this[offset] = value2 & 255;
        this[offset + 1] = value2 >>> 8 & 255;
        return offset + 2;
      }
      writeInt32BE(value2, offset = 0) {
        checkOffset(offset, 4, this.length);
        this[offset] = value2 >>> 24 & 255;
        this[offset + 1] = value2 >>> 16 & 255;
        this[offset + 2] = value2 >>> 8 & 255;
        this[offset + 3] = value2 & 255;
        return offset + 4;
      }
      writeInt32LE(value2, offset = 0) {
        checkOffset(offset, 4, this.length);
        this[offset] = value2 & 255;
        this[offset + 1] = value2 >>> 8 & 255;
        this[offset + 2] = value2 >>> 16 & 255;
        this[offset + 3] = value2 >>> 24 & 255;
        return offset + 4;
      }
      writeFloatBE(value2, offset = 0) {
        checkOffset(offset, 4, this.length);
        const view = new DataView(this.buffer, this.byteOffset + offset, 4);
        view.setFloat32(0, value2, false);
        return offset + 4;
      }
      writeFloatLE(value2, offset = 0) {
        checkOffset(offset, 4, this.length);
        const view = new DataView(this.buffer, this.byteOffset + offset, 4);
        view.setFloat32(0, value2, true);
        return offset + 4;
      }
      writeDoubleBE(value2, offset = 0) {
        checkOffset(offset, 8, this.length);
        const view = new DataView(this.buffer, this.byteOffset + offset, 8);
        view.setFloat64(0, value2, false);
        return offset + 8;
      }
      writeDoubleLE(value2, offset = 0) {
        checkOffset(offset, 8, this.length);
        const view = new DataView(this.buffer, this.byteOffset + offset, 8);
        view.setFloat64(0, value2, true);
        return offset + 8;
      }
      writeBigInt64BE(value2, offset = 0) {
        checkOffset(offset, 8, this.length);
        const view = new DataView(this.buffer, this.byteOffset + offset, 8);
        view.setBigInt64(0, value2, false);
        return offset + 8;
      }
      writeBigInt64LE(value2, offset = 0) {
        checkOffset(offset, 8, this.length);
        const view = new DataView(this.buffer, this.byteOffset + offset, 8);
        view.setBigInt64(0, value2, true);
        return offset + 8;
      }
      writeBigUInt64BE(value2, offset = 0) {
        checkOffset(offset, 8, this.length);
        const view = new DataView(this.buffer, this.byteOffset + offset, 8);
        view.setBigUint64(0, value2, false);
        return offset + 8;
      }
      writeBigUInt64LE(value2, offset = 0) {
        checkOffset(offset, 8, this.length);
        const view = new DataView(this.buffer, this.byteOffset + offset, 8);
        view.setBigUint64(0, value2, true);
        return offset + 8;
      }
      // ---- Swap methods ----
      swap16() {
        const len = this.length;
        if (len % 2 !== 0) throw new RangeError("Buffer size must be a multiple of 16-bits");
        for (let i = 0; i < len; i += 2) {
          const a = this[i];
          this[i] = this[i + 1];
          this[i + 1] = a;
        }
        return this;
      }
      swap32() {
        const len = this.length;
        if (len % 4 !== 0) throw new RangeError("Buffer size must be a multiple of 32-bits");
        for (let i = 0; i < len; i += 4) {
          const a = this[i];
          const b = this[i + 1];
          this[i] = this[i + 3];
          this[i + 1] = this[i + 2];
          this[i + 2] = b;
          this[i + 3] = a;
        }
        return this;
      }
      swap64() {
        const len = this.length;
        if (len % 8 !== 0) throw new RangeError("Buffer size must be a multiple of 64-bits");
        for (let i = 0; i < len; i += 8) {
          const a = this[i];
          const b = this[i + 1];
          const c = this[i + 2];
          const d = this[i + 3];
          this[i] = this[i + 7];
          this[i + 1] = this[i + 6];
          this[i + 2] = this[i + 5];
          this[i + 3] = this[i + 4];
          this[i + 4] = d;
          this[i + 5] = c;
          this[i + 6] = b;
          this[i + 7] = a;
        }
        return this;
      }
    };
    kMaxLength = 2 ** 31 - 1;
    kStringMaxLength = 2 ** 28 - 16;
  }
});

// ../../node/buffer/lib/esm/blob.js
var _encoder, BlobPolyfill, FilePolyfill, Blob2, File2;
var init_blob = __esm({
  "../../node/buffer/lib/esm/blob.js"() {
    init_console_gjs();
    _encoder = new TextEncoder();
    BlobPolyfill = class _BlobPolyfill {
      _parts;
      size;
      type;
      constructor(parts, options) {
        this._parts = parts || [];
        this.type = options?.type || "";
        this.size = this._parts.reduce((acc, part) => {
          if (typeof part === "string") return acc + _encoder.encode(part).byteLength;
          if (part instanceof ArrayBuffer) return acc + part.byteLength;
          if (ArrayBuffer.isView(part)) return acc + part.byteLength;
          if (part && typeof part.size === "number") return acc + part.size;
          return acc;
        }, 0);
      }
      async bytes() {
        const ab = await this.arrayBuffer();
        return new Uint8Array(ab);
      }
      async text() {
        return new TextDecoder().decode(await this.arrayBuffer());
      }
      async arrayBuffer() {
        const chunks = [];
        for (const part of this._parts) {
          if (typeof part === "string") chunks.push(_encoder.encode(part));
          else if (part instanceof ArrayBuffer) chunks.push(new Uint8Array(part));
          else if (ArrayBuffer.isView(part)) chunks.push(new Uint8Array(part.buffer, part.byteOffset, part.byteLength));
          else if (part && typeof part.arrayBuffer === "function") {
            const ab = await part.arrayBuffer();
            chunks.push(new Uint8Array(ab));
          }
        }
        const total = chunks.reduce((a, c) => a + c.byteLength, 0);
        const result = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
          result.set(c, offset);
          offset += c.byteLength;
        }
        return result.buffer;
      }
      slice(start, end, type) {
        return new _BlobPolyfill([], { type });
      }
      stream() {
        throw new Error("Blob.stream() not implemented");
      }
    };
    FilePolyfill = class extends BlobPolyfill {
      name;
      lastModified;
      webkitRelativePath = "";
      constructor(parts, name2, options) {
        super(parts, options);
        this.name = name2;
        this.lastModified = options?.lastModified ?? Date.now();
      }
    };
    Blob2 = globalThis.Blob ?? BlobPolyfill;
    File2 = globalThis.File ?? FilePolyfill;
  }
});

// ../../node/buffer/lib/esm/index.js
var atob2, btoa;
var init_esm6 = __esm({
  "../../node/buffer/lib/esm/index.js"() {
    init_console_gjs();
    init_buffer();
    init_blob();
    init_esm4();
    registerGlobal("Blob", Blob2);
    registerGlobal("File", File2);
    atob2 = globalThis.atob;
    btoa = globalThis.btoa;
  }
});

// ../../web/fetch/lib/esm/utils/blob-from.js
var init_blob_from = __esm({
  "../../web/fetch/lib/esm/utils/blob-from.js"() {
    init_console_gjs();
    init_esm6();
  }
});

// ../../web/formdata/lib/esm/file.js
var _name, _lastModified, File3;
var init_file2 = __esm({
  "../../web/formdata/lib/esm/file.js"() {
    init_console_gjs();
    _name = /* @__PURE__ */ Symbol("File.name");
    _lastModified = /* @__PURE__ */ Symbol("File.lastModified");
    File3 = class extends Blob {
      [_name];
      [_lastModified];
      webkitRelativePath = "";
      constructor(fileBits, fileName, options) {
        super(fileBits, options);
        this[_name] = String(fileName);
        this[_lastModified] = options?.lastModified ?? Date.now();
      }
      get name() {
        return this[_name];
      }
      get lastModified() {
        return this[_lastModified];
      }
      get [Symbol.toStringTag]() {
        return "File";
      }
    };
  }
});

// ../../web/formdata/lib/esm/formdata.js
function normalizeValue(name2, value2, filename) {
  if (typeof value2 === "string") {
    return value2;
  }
  if (value2 instanceof Blob && !(value2 instanceof File3)) {
    value2 = new File3([value2], filename ?? "blob", { type: value2.type });
  }
  if (value2 instanceof File3 && filename !== void 0) {
    value2 = new File3([value2], filename, {
      type: value2.type,
      lastModified: value2.lastModified
    });
  }
  return value2;
}
var _entries, FormData;
var init_formdata = __esm({
  "../../web/formdata/lib/esm/formdata.js"() {
    init_console_gjs();
    init_file2();
    _entries = /* @__PURE__ */ Symbol("FormData.entries");
    FormData = class {
      [_entries] = [];
      constructor() {
      }
      append(name2, value2, filename) {
        this[_entries].push({
          name: String(name2),
          value: normalizeValue(name2, value2, filename)
        });
      }
      delete(name2) {
        const n = String(name2);
        this[_entries] = this[_entries].filter((e) => e.name !== n);
      }
      get(name2) {
        const n = String(name2);
        const entry = this[_entries].find((e) => e.name === n);
        return entry ? entry.value : null;
      }
      getAll(name2) {
        const n = String(name2);
        return this[_entries].filter((e) => e.name === n).map((e) => e.value);
      }
      has(name2) {
        const n = String(name2);
        return this[_entries].some((e) => e.name === n);
      }
      set(name2, value2, filename) {
        const n = String(name2);
        const normalized = normalizeValue(n, value2, filename);
        let found = false;
        this[_entries] = this[_entries].filter((e) => {
          if (e.name === n) {
            if (!found) {
              found = true;
              e.value = normalized;
              return true;
            }
            return false;
          }
          return true;
        });
        if (!found) {
          this[_entries].push({ name: n, value: normalized });
        }
      }
      forEach(callback, thisArg) {
        for (const entry of this[_entries]) {
          callback.call(thisArg, entry.value, entry.name, this);
        }
      }
      *entries() {
        for (const entry of this[_entries]) {
          yield [entry.name, entry.value];
        }
      }
      *keys() {
        for (const entry of this[_entries]) {
          yield entry.name;
        }
      }
      *values() {
        for (const entry of this[_entries]) {
          yield entry.value;
        }
      }
      [Symbol.iterator]() {
        return this.entries();
      }
      get [Symbol.toStringTag]() {
        return "FormData";
      }
    };
  }
});

// ../../web/formdata/lib/esm/form-data-to-blob.js
function generateBoundary() {
  let boundary = "----formdata-";
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 24; i++) {
    boundary += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return boundary;
}
function escape(str) {
  return str.replace(/\n/g, "%0A").replace(/\r/g, "%0D").replace(/"/g, "%22");
}
function formDataToBlob(formData, boundary) {
  boundary = boundary ?? generateBoundary();
  const chunks = [];
  const prefix2 = `--${boundary}\r
Content-Disposition: form-data; name="`;
  for (const [name2, value2] of formData.entries()) {
    if (typeof value2 === "string") {
      chunks.push(
        `${prefix2}${escape(name2)}"\r
\r
${value2.replace(/\r(?!\n)|(?<!\r)\n/g, "\r\n")}\r
`
      );
    } else {
      const file = value2 instanceof File3 ? value2 : new File3([value2], "blob", { type: value2.type });
      chunks.push(
        `${prefix2}${escape(name2)}"; filename="${escape(file.name)}"\r
Content-Type: ${file.type || "application/octet-stream"}\r
\r
`
      );
      chunks.push(file);
      chunks.push("\r\n");
    }
  }
  chunks.push(`--${boundary}--`);
  return new Blob(chunks, {
    type: `multipart/form-data; boundary=${boundary}`
  });
}
var init_form_data_to_blob = __esm({
  "../../web/formdata/lib/esm/form-data-to-blob.js"() {
    init_console_gjs();
    init_file2();
  }
});

// ../../web/formdata/lib/esm/index.js
var init_esm7 = __esm({
  "../../web/formdata/lib/esm/index.js"() {
    init_console_gjs();
    init_formdata();
    init_file2();
    init_form_data_to_blob();
  }
});

// ../../web/fetch/lib/esm/utils/multipart-parser.js
var multipart_parser_exports = {};
__export(multipart_parser_exports, {
  toFormData: () => toFormData
});
function _fileName(headerValue) {
  const m = headerValue.match(/\bfilename=("(.*?)"|([^()<>@,;:\\"/[\]?={}\s\t]+))($|;\s)/i);
  if (!m) {
    return;
  }
  const match2 = m[2] || m[3] || "";
  let filename = match2.slice(match2.lastIndexOf("\\") + 1);
  filename = filename.replace(/%22/g, '"');
  filename = filename.replace(/&#(\d{4});/g, (m2, code) => {
    return String.fromCharCode(code);
  });
  return filename;
}
async function toFormData(Body2, ct) {
  if (!/multipart/i.test(ct)) {
    throw new TypeError("Failed to fetch");
  }
  const m = ct.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) {
    throw new TypeError("no or bad content-type header, no multipart boundary");
  }
  const parser = new MultipartParser(m[1] || m[2]);
  let headerField;
  let headerValue;
  let entryValue;
  let entryName;
  let contentType;
  let filename;
  const entryChunks = [];
  const formData = new FormData();
  const onPartData = (ui8a) => {
    entryValue += decoder.decode(ui8a, { stream: true });
  };
  const appendToFile = (ui8a) => {
    entryChunks.push(ui8a);
  };
  const appendFileToFormData = () => {
    const file = new File2(entryChunks, filename, { type: contentType });
    formData.append(entryName, file);
  };
  const appendEntryToFormData = () => {
    formData.append(entryName, entryValue);
  };
  const decoder = new TextDecoder("utf-8");
  decoder.decode();
  parser.onPartBegin = function() {
    parser.onPartData = onPartData;
    parser.onPartEnd = appendEntryToFormData;
    headerField = "";
    headerValue = "";
    entryValue = "";
    entryName = "";
    contentType = "";
    filename = null;
    entryChunks.length = 0;
  };
  parser.onHeaderField = function(ui8a) {
    headerField += decoder.decode(ui8a, { stream: true });
  };
  parser.onHeaderValue = function(ui8a) {
    headerValue += decoder.decode(ui8a, { stream: true });
  };
  parser.onHeaderEnd = function() {
    headerValue += decoder.decode();
    headerField = headerField.toLowerCase();
    if (headerField === "content-disposition") {
      const m2 = headerValue.match(/\bname=("([^"]*)"|([^()<>@,;:\\"/[\]?={}\s\t]+))/i);
      if (m2) {
        entryName = m2[2] || m2[3] || "";
      }
      filename = _fileName(headerValue);
      if (filename) {
        parser.onPartData = appendToFile;
        parser.onPartEnd = appendFileToFormData;
      }
    } else if (headerField === "content-type") {
      contentType = headerValue;
    }
    headerValue = "";
    headerField = "";
  };
  for await (const chunk of Body2) {
    parser.write(chunk);
  }
  parser.end();
  return formData;
}
var f, F, LF, CR, SPACE, HYPHEN, COLON, A, Z, lower, noop, MultipartParser;
var init_multipart_parser = __esm({
  "../../web/fetch/lib/esm/utils/multipart-parser.js"() {
    init_console_gjs();
    init_blob_from();
    init_esm7();
    f = 1;
    F = {
      PART_BOUNDARY: f,
      LAST_BOUNDARY: f *= 2
    };
    LF = 10;
    CR = 13;
    SPACE = 32;
    HYPHEN = 45;
    COLON = 58;
    A = 97;
    Z = 122;
    lower = (c) => c | 32;
    noop = (..._args) => {
    };
    MultipartParser = class {
      index = 0;
      flags = 0;
      boundary;
      lookbehind;
      state = 0;
      onHeaderEnd = noop;
      onHeaderField = noop;
      onHeadersEnd = noop;
      onHeaderValue = noop;
      onPartBegin = noop;
      onPartData = noop;
      onPartEnd = noop;
      boundaryChars = {};
      /**
       * @param boundary
       */
      constructor(boundary) {
        boundary = "\r\n--" + boundary;
        const ui8a = new Uint8Array(boundary.length);
        for (let i = 0; i < boundary.length; i++) {
          ui8a[i] = boundary.charCodeAt(i);
          this.boundaryChars[ui8a[i]] = true;
        }
        this.boundary = ui8a;
        this.lookbehind = new Uint8Array(this.boundary.length + 8);
      }
      /**
       * @param data
       */
      write(data) {
        let i = 0;
        const length_ = data.length;
        let previousIndex = this.index;
        let { lookbehind, boundary, boundaryChars, index, state, flags } = this;
        const boundaryLength = this.boundary.length;
        const boundaryEnd = boundaryLength - 1;
        const bufferLength = data.length;
        let c;
        let cl;
        const mark = (name2) => {
          this[name2 + "Mark"] = i;
        };
        const clear2 = (name2) => {
          delete this[name2 + "Mark"];
        };
        const callback = (callbackSymbol, start, end, ui8a) => {
          if (start === void 0 || start !== end) {
            this[callbackSymbol](ui8a && ui8a.subarray(start, end));
          }
        };
        const dataCallback = (name2, clear22 = false) => {
          const markSymbol = name2 + "Mark";
          if (!(markSymbol in this)) {
            return;
          }
          if (clear22) {
            callback(name2, this[markSymbol], i, data);
            delete this[markSymbol];
          } else {
            callback(name2, this[markSymbol], data.length, data);
            this[markSymbol] = 0;
          }
        };
        for (i = 0; i < length_; i++) {
          c = data[i];
          switch (state) {
            case 0:
              if (index === boundary.length - 2) {
                if (c === HYPHEN) {
                  flags |= F.LAST_BOUNDARY;
                } else if (c !== CR) {
                  return;
                }
                index++;
                break;
              } else if (index - 1 === boundary.length - 2) {
                if (flags & F.LAST_BOUNDARY && c === HYPHEN) {
                  state = 9;
                  flags = 0;
                } else if (!(flags & F.LAST_BOUNDARY) && c === LF) {
                  index = 0;
                  callback("onPartBegin");
                  state = 1;
                } else {
                  return;
                }
                break;
              }
              if (c !== boundary[index + 2]) {
                index = -2;
              }
              if (c === boundary[index + 2]) {
                index++;
              }
              break;
            case 1:
              state = 2;
              mark("onHeaderField");
              index = 0;
            // falls through
            case 2:
              if (c === CR) {
                clear2("onHeaderField");
                state = 6;
                break;
              }
              index++;
              if (c === HYPHEN) {
                break;
              }
              if (c === COLON) {
                if (index === 1) {
                  return;
                }
                dataCallback("onHeaderField", true);
                state = 3;
                break;
              }
              cl = lower(c);
              if (cl < A || cl > Z) {
                return;
              }
              break;
            case 3:
              if (c === SPACE) {
                break;
              }
              mark("onHeaderValue");
              state = 4;
            // falls through
            case 4:
              if (c === CR) {
                dataCallback("onHeaderValue", true);
                callback("onHeaderEnd");
                state = 5;
              }
              break;
            case 5:
              if (c !== LF) {
                return;
              }
              state = 1;
              break;
            case 6:
              if (c !== LF) {
                return;
              }
              callback("onHeadersEnd");
              state = 7;
              break;
            case 7:
              state = 8;
              mark("onPartData");
            // falls through
            case 8:
              previousIndex = index;
              if (index === 0) {
                i += boundaryEnd;
                while (i < bufferLength && !(data[i] in boundaryChars)) {
                  i += boundaryLength;
                }
                i -= boundaryEnd;
                c = data[i];
              }
              if (index < boundary.length) {
                if (boundary[index] === c) {
                  if (index === 0) {
                    dataCallback("onPartData", true);
                  }
                  index++;
                } else {
                  index = 0;
                }
              } else if (index === boundary.length) {
                index++;
                if (c === CR) {
                  flags |= F.PART_BOUNDARY;
                } else if (c === HYPHEN) {
                  flags |= F.LAST_BOUNDARY;
                } else {
                  index = 0;
                }
              } else if (index - 1 === boundary.length) {
                if (flags & F.PART_BOUNDARY) {
                  index = 0;
                  if (c === LF) {
                    flags &= ~F.PART_BOUNDARY;
                    callback("onPartEnd");
                    callback("onPartBegin");
                    state = 1;
                    break;
                  }
                } else if (flags & F.LAST_BOUNDARY) {
                  if (c === HYPHEN) {
                    callback("onPartEnd");
                    state = 9;
                    flags = 0;
                  } else {
                    index = 0;
                  }
                } else {
                  index = 0;
                }
              }
              if (index > 0) {
                lookbehind[index - 1] = c;
              } else if (previousIndex > 0) {
                const _lookbehind = new Uint8Array(lookbehind.buffer, lookbehind.byteOffset, lookbehind.byteLength);
                callback("onPartData", 0, previousIndex, _lookbehind);
                previousIndex = 0;
                mark("onPartData");
                i--;
              }
              break;
            case 9:
              break;
            default:
              throw new Error(`Unexpected state entered: ${state}`);
          }
        }
        dataCallback("onHeaderField");
        dataCallback("onHeaderValue");
        dataCallback("onPartData");
        this.index = index;
        this.state = state;
        this.flags = flags;
      }
      end() {
        if (this.state === 1 && this.index === 0 || this.state === 8 && this.index === this.boundary.length) {
          this.onPartEnd();
        } else if (this.state !== 9) {
          throw new Error("MultipartParser.end(): stream ended unexpectedly");
        }
      }
    };
  }
});

// ../../../node_modules/bit-twiddle/twiddle.js
var require_twiddle = __commonJS({
  "../../../node_modules/bit-twiddle/twiddle.js"(exports) {
    "use strict";
    "use restrict";
    init_console_gjs();
    var INT_BITS = 32;
    exports.INT_BITS = INT_BITS;
    exports.INT_MAX = 2147483647;
    exports.INT_MIN = -1 << INT_BITS - 1;
    exports.sign = function(v) {
      return (v > 0) - (v < 0);
    };
    exports.abs = function(v) {
      var mask = v >> INT_BITS - 1;
      return (v ^ mask) - mask;
    };
    exports.min = function(x, y) {
      return y ^ (x ^ y) & -(x < y);
    };
    exports.max = function(x, y) {
      return x ^ (x ^ y) & -(x < y);
    };
    exports.isPow2 = function(v) {
      return !(v & v - 1) && !!v;
    };
    exports.log2 = function(v) {
      var r, shift;
      r = (v > 65535) << 4;
      v >>>= r;
      shift = (v > 255) << 3;
      v >>>= shift;
      r |= shift;
      shift = (v > 15) << 2;
      v >>>= shift;
      r |= shift;
      shift = (v > 3) << 1;
      v >>>= shift;
      r |= shift;
      return r | v >> 1;
    };
    exports.log10 = function(v) {
      return v >= 1e9 ? 9 : v >= 1e8 ? 8 : v >= 1e7 ? 7 : v >= 1e6 ? 6 : v >= 1e5 ? 5 : v >= 1e4 ? 4 : v >= 1e3 ? 3 : v >= 100 ? 2 : v >= 10 ? 1 : 0;
    };
    exports.popCount = function(v) {
      v = v - (v >>> 1 & 1431655765);
      v = (v & 858993459) + (v >>> 2 & 858993459);
      return (v + (v >>> 4) & 252645135) * 16843009 >>> 24;
    };
    function countTrailingZeros(v) {
      var c = 32;
      v &= -v;
      if (v) c--;
      if (v & 65535) c -= 16;
      if (v & 16711935) c -= 8;
      if (v & 252645135) c -= 4;
      if (v & 858993459) c -= 2;
      if (v & 1431655765) c -= 1;
      return c;
    }
    exports.countTrailingZeros = countTrailingZeros;
    exports.nextPow2 = function(v) {
      v += v === 0;
      --v;
      v |= v >>> 1;
      v |= v >>> 2;
      v |= v >>> 4;
      v |= v >>> 8;
      v |= v >>> 16;
      return v + 1;
    };
    exports.prevPow2 = function(v) {
      v |= v >>> 1;
      v |= v >>> 2;
      v |= v >>> 4;
      v |= v >>> 8;
      v |= v >>> 16;
      return v - (v >>> 1);
    };
    exports.parity = function(v) {
      v ^= v >>> 16;
      v ^= v >>> 8;
      v ^= v >>> 4;
      v &= 15;
      return 27030 >>> v & 1;
    };
    var REVERSE_TABLE = new Array(256);
    (function(tab) {
      for (var i = 0; i < 256; ++i) {
        var v = i, r = i, s = 7;
        for (v >>>= 1; v; v >>>= 1) {
          r <<= 1;
          r |= v & 1;
          --s;
        }
        tab[i] = r << s & 255;
      }
    })(REVERSE_TABLE);
    exports.reverse = function(v) {
      return REVERSE_TABLE[v & 255] << 24 | REVERSE_TABLE[v >>> 8 & 255] << 16 | REVERSE_TABLE[v >>> 16 & 255] << 8 | REVERSE_TABLE[v >>> 24 & 255];
    };
    exports.interleave2 = function(x, y) {
      x &= 65535;
      x = (x | x << 8) & 16711935;
      x = (x | x << 4) & 252645135;
      x = (x | x << 2) & 858993459;
      x = (x | x << 1) & 1431655765;
      y &= 65535;
      y = (y | y << 8) & 16711935;
      y = (y | y << 4) & 252645135;
      y = (y | y << 2) & 858993459;
      y = (y | y << 1) & 1431655765;
      return x | y << 1;
    };
    exports.deinterleave2 = function(v, n) {
      v = v >>> n & 1431655765;
      v = (v | v >>> 1) & 858993459;
      v = (v | v >>> 2) & 252645135;
      v = (v | v >>> 4) & 16711935;
      v = (v | v >>> 16) & 65535;
      return v << 16 >> 16;
    };
    exports.interleave3 = function(x, y, z) {
      x &= 1023;
      x = (x | x << 16) & 4278190335;
      x = (x | x << 8) & 251719695;
      x = (x | x << 4) & 3272356035;
      x = (x | x << 2) & 1227133513;
      y &= 1023;
      y = (y | y << 16) & 4278190335;
      y = (y | y << 8) & 251719695;
      y = (y | y << 4) & 3272356035;
      y = (y | y << 2) & 1227133513;
      x |= y << 1;
      z &= 1023;
      z = (z | z << 16) & 4278190335;
      z = (z | z << 8) & 251719695;
      z = (z | z << 4) & 3272356035;
      z = (z | z << 2) & 1227133513;
      return x | z << 2;
    };
    exports.deinterleave3 = function(v, n) {
      v = v >>> n & 1227133513;
      v = (v | v >>> 2) & 3272356035;
      v = (v | v >>> 4) & 251719695;
      v = (v | v >>> 8) & 4278190335;
      v = (v | v >>> 16) & 1023;
      return v << 22 >> 22;
    };
    exports.nextCombination = function(v) {
      var t = v | v - 1;
      return t + 1 | (~t & -~t) - 1 >>> countTrailingZeros(v) + 1;
    };
  }
});

// ../../../node_modules/glsl-tokenizer/lib/literals.js
var require_literals = __commonJS({
  "../../../node_modules/glsl-tokenizer/lib/literals.js"(exports, module) {
    init_console_gjs();
    module.exports = [
      // current
      "precision",
      "highp",
      "mediump",
      "lowp",
      "attribute",
      "const",
      "uniform",
      "varying",
      "break",
      "continue",
      "do",
      "for",
      "while",
      "if",
      "else",
      "in",
      "out",
      "inout",
      "float",
      "int",
      "uint",
      "void",
      "bool",
      "true",
      "false",
      "discard",
      "return",
      "mat2",
      "mat3",
      "mat4",
      "vec2",
      "vec3",
      "vec4",
      "ivec2",
      "ivec3",
      "ivec4",
      "bvec2",
      "bvec3",
      "bvec4",
      "sampler1D",
      "sampler2D",
      "sampler3D",
      "samplerCube",
      "sampler1DShadow",
      "sampler2DShadow",
      "struct",
      "asm",
      "class",
      "union",
      "enum",
      "typedef",
      "template",
      "this",
      "packed",
      "goto",
      "switch",
      "default",
      "inline",
      "noinline",
      "volatile",
      "public",
      "static",
      "extern",
      "external",
      "interface",
      "long",
      "short",
      "double",
      "half",
      "fixed",
      "unsigned",
      "input",
      "output",
      "hvec2",
      "hvec3",
      "hvec4",
      "dvec2",
      "dvec3",
      "dvec4",
      "fvec2",
      "fvec3",
      "fvec4",
      "sampler2DRect",
      "sampler3DRect",
      "sampler2DRectShadow",
      "sizeof",
      "cast",
      "namespace",
      "using"
    ];
  }
});

// ../../../node_modules/glsl-tokenizer/lib/operators.js
var require_operators = __commonJS({
  "../../../node_modules/glsl-tokenizer/lib/operators.js"(exports, module) {
    init_console_gjs();
    module.exports = [
      "<<=",
      ">>=",
      "++",
      "--",
      "<<",
      ">>",
      "<=",
      ">=",
      "==",
      "!=",
      "&&",
      "||",
      "+=",
      "-=",
      "*=",
      "/=",
      "%=",
      "&=",
      "^^",
      "^=",
      "|=",
      "(",
      ")",
      "[",
      "]",
      ".",
      "!",
      "~",
      "*",
      "/",
      "%",
      "+",
      "-",
      "<",
      ">",
      "&",
      "^",
      "|",
      "?",
      ":",
      "=",
      ",",
      ";",
      "{",
      "}"
    ];
  }
});

// ../../../node_modules/glsl-tokenizer/lib/builtins.js
var require_builtins = __commonJS({
  "../../../node_modules/glsl-tokenizer/lib/builtins.js"(exports, module) {
    init_console_gjs();
    module.exports = [
      // Keep this list sorted
      "abs",
      "acos",
      "all",
      "any",
      "asin",
      "atan",
      "ceil",
      "clamp",
      "cos",
      "cross",
      "dFdx",
      "dFdy",
      "degrees",
      "distance",
      "dot",
      "equal",
      "exp",
      "exp2",
      "faceforward",
      "floor",
      "fract",
      "gl_BackColor",
      "gl_BackLightModelProduct",
      "gl_BackLightProduct",
      "gl_BackMaterial",
      "gl_BackSecondaryColor",
      "gl_ClipPlane",
      "gl_ClipVertex",
      "gl_Color",
      "gl_DepthRange",
      "gl_DepthRangeParameters",
      "gl_EyePlaneQ",
      "gl_EyePlaneR",
      "gl_EyePlaneS",
      "gl_EyePlaneT",
      "gl_Fog",
      "gl_FogCoord",
      "gl_FogFragCoord",
      "gl_FogParameters",
      "gl_FragColor",
      "gl_FragCoord",
      "gl_FragData",
      "gl_FragDepth",
      "gl_FragDepthEXT",
      "gl_FrontColor",
      "gl_FrontFacing",
      "gl_FrontLightModelProduct",
      "gl_FrontLightProduct",
      "gl_FrontMaterial",
      "gl_FrontSecondaryColor",
      "gl_LightModel",
      "gl_LightModelParameters",
      "gl_LightModelProducts",
      "gl_LightProducts",
      "gl_LightSource",
      "gl_LightSourceParameters",
      "gl_MaterialParameters",
      "gl_MaxClipPlanes",
      "gl_MaxCombinedTextureImageUnits",
      "gl_MaxDrawBuffers",
      "gl_MaxFragmentUniformComponents",
      "gl_MaxLights",
      "gl_MaxTextureCoords",
      "gl_MaxTextureImageUnits",
      "gl_MaxTextureUnits",
      "gl_MaxVaryingFloats",
      "gl_MaxVertexAttribs",
      "gl_MaxVertexTextureImageUnits",
      "gl_MaxVertexUniformComponents",
      "gl_ModelViewMatrix",
      "gl_ModelViewMatrixInverse",
      "gl_ModelViewMatrixInverseTranspose",
      "gl_ModelViewMatrixTranspose",
      "gl_ModelViewProjectionMatrix",
      "gl_ModelViewProjectionMatrixInverse",
      "gl_ModelViewProjectionMatrixInverseTranspose",
      "gl_ModelViewProjectionMatrixTranspose",
      "gl_MultiTexCoord0",
      "gl_MultiTexCoord1",
      "gl_MultiTexCoord2",
      "gl_MultiTexCoord3",
      "gl_MultiTexCoord4",
      "gl_MultiTexCoord5",
      "gl_MultiTexCoord6",
      "gl_MultiTexCoord7",
      "gl_Normal",
      "gl_NormalMatrix",
      "gl_NormalScale",
      "gl_ObjectPlaneQ",
      "gl_ObjectPlaneR",
      "gl_ObjectPlaneS",
      "gl_ObjectPlaneT",
      "gl_Point",
      "gl_PointCoord",
      "gl_PointParameters",
      "gl_PointSize",
      "gl_Position",
      "gl_ProjectionMatrix",
      "gl_ProjectionMatrixInverse",
      "gl_ProjectionMatrixInverseTranspose",
      "gl_ProjectionMatrixTranspose",
      "gl_SecondaryColor",
      "gl_TexCoord",
      "gl_TextureEnvColor",
      "gl_TextureMatrix",
      "gl_TextureMatrixInverse",
      "gl_TextureMatrixInverseTranspose",
      "gl_TextureMatrixTranspose",
      "gl_Vertex",
      "greaterThan",
      "greaterThanEqual",
      "inversesqrt",
      "length",
      "lessThan",
      "lessThanEqual",
      "log",
      "log2",
      "matrixCompMult",
      "max",
      "min",
      "mix",
      "mod",
      "normalize",
      "not",
      "notEqual",
      "pow",
      "radians",
      "reflect",
      "refract",
      "sign",
      "sin",
      "smoothstep",
      "sqrt",
      "step",
      "tan",
      "texture2D",
      "texture2DLod",
      "texture2DProj",
      "texture2DProjLod",
      "textureCube",
      "textureCubeLod",
      "texture2DLodEXT",
      "texture2DProjLodEXT",
      "textureCubeLodEXT",
      "texture2DGradEXT",
      "texture2DProjGradEXT",
      "textureCubeGradEXT"
    ];
  }
});

// ../../../node_modules/glsl-tokenizer/lib/literals-300es.js
var require_literals_300es = __commonJS({
  "../../../node_modules/glsl-tokenizer/lib/literals-300es.js"(exports, module) {
    init_console_gjs();
    var v100 = require_literals();
    module.exports = v100.slice().concat([
      "layout",
      "centroid",
      "smooth",
      "case",
      "mat2x2",
      "mat2x3",
      "mat2x4",
      "mat3x2",
      "mat3x3",
      "mat3x4",
      "mat4x2",
      "mat4x3",
      "mat4x4",
      "uvec2",
      "uvec3",
      "uvec4",
      "samplerCubeShadow",
      "sampler2DArray",
      "sampler2DArrayShadow",
      "isampler2D",
      "isampler3D",
      "isamplerCube",
      "isampler2DArray",
      "usampler2D",
      "usampler3D",
      "usamplerCube",
      "usampler2DArray",
      "coherent",
      "restrict",
      "readonly",
      "writeonly",
      "resource",
      "atomic_uint",
      "noperspective",
      "patch",
      "sample",
      "subroutine",
      "common",
      "partition",
      "active",
      "filter",
      "image1D",
      "image2D",
      "image3D",
      "imageCube",
      "iimage1D",
      "iimage2D",
      "iimage3D",
      "iimageCube",
      "uimage1D",
      "uimage2D",
      "uimage3D",
      "uimageCube",
      "image1DArray",
      "image2DArray",
      "iimage1DArray",
      "iimage2DArray",
      "uimage1DArray",
      "uimage2DArray",
      "image1DShadow",
      "image2DShadow",
      "image1DArrayShadow",
      "image2DArrayShadow",
      "imageBuffer",
      "iimageBuffer",
      "uimageBuffer",
      "sampler1DArray",
      "sampler1DArrayShadow",
      "isampler1D",
      "isampler1DArray",
      "usampler1D",
      "usampler1DArray",
      "isampler2DRect",
      "usampler2DRect",
      "samplerBuffer",
      "isamplerBuffer",
      "usamplerBuffer",
      "sampler2DMS",
      "isampler2DMS",
      "usampler2DMS",
      "sampler2DMSArray",
      "isampler2DMSArray",
      "usampler2DMSArray"
    ]);
  }
});

// ../../../node_modules/glsl-tokenizer/lib/builtins-300es.js
var require_builtins_300es = __commonJS({
  "../../../node_modules/glsl-tokenizer/lib/builtins-300es.js"(exports, module) {
    init_console_gjs();
    var v100 = require_builtins();
    v100 = v100.slice().filter(function(b) {
      return !/^(gl\_|texture)/.test(b);
    });
    module.exports = v100.concat([
      // the updated gl_ constants
      "gl_VertexID",
      "gl_InstanceID",
      "gl_Position",
      "gl_PointSize",
      "gl_FragCoord",
      "gl_FrontFacing",
      "gl_FragDepth",
      "gl_PointCoord",
      "gl_MaxVertexAttribs",
      "gl_MaxVertexUniformVectors",
      "gl_MaxVertexOutputVectors",
      "gl_MaxFragmentInputVectors",
      "gl_MaxVertexTextureImageUnits",
      "gl_MaxCombinedTextureImageUnits",
      "gl_MaxTextureImageUnits",
      "gl_MaxFragmentUniformVectors",
      "gl_MaxDrawBuffers",
      "gl_MinProgramTexelOffset",
      "gl_MaxProgramTexelOffset",
      "gl_DepthRangeParameters",
      "gl_DepthRange",
      "trunc",
      "round",
      "roundEven",
      "isnan",
      "isinf",
      "floatBitsToInt",
      "floatBitsToUint",
      "intBitsToFloat",
      "uintBitsToFloat",
      "packSnorm2x16",
      "unpackSnorm2x16",
      "packUnorm2x16",
      "unpackUnorm2x16",
      "packHalf2x16",
      "unpackHalf2x16",
      "outerProduct",
      "transpose",
      "determinant",
      "inverse",
      "texture",
      "textureSize",
      "textureProj",
      "textureLod",
      "textureOffset",
      "texelFetch",
      "texelFetchOffset",
      "textureProjOffset",
      "textureLodOffset",
      "textureProjLod",
      "textureProjLodOffset",
      "textureGrad",
      "textureGradOffset",
      "textureProjGrad",
      "textureProjGradOffset"
    ]);
  }
});

// ../../../node_modules/glsl-tokenizer/index.js
var require_glsl_tokenizer = __commonJS({
  "../../../node_modules/glsl-tokenizer/index.js"(exports, module) {
    init_console_gjs();
    module.exports = tokenize2;
    var literals100 = require_literals();
    var operators = require_operators();
    var builtins100 = require_builtins();
    var literals300es = require_literals_300es();
    var builtins300es = require_builtins_300es();
    var NORMAL = 999;
    var TOKEN = 9999;
    var BLOCK_COMMENT = 0;
    var LINE_COMMENT = 1;
    var PREPROCESSOR = 2;
    var OPERATOR = 3;
    var INTEGER = 4;
    var FLOAT = 5;
    var IDENT = 6;
    var BUILTIN = 7;
    var KEYWORD = 8;
    var WHITESPACE = 9;
    var EOF = 10;
    var HEX = 11;
    var map = [
      "block-comment",
      "line-comment",
      "preprocessor",
      "operator",
      "integer",
      "float",
      "ident",
      "builtin",
      "keyword",
      "whitespace",
      "eof",
      "integer"
    ];
    function tokenize2(opt) {
      var i = 0, total = 0, mode = NORMAL, c, last, content = [], tokens = [], token_idx = 0, token_offs = 0, line = 1, col = 0, start = 0, isnum = false, isoperator = false, input = "", len;
      opt = opt || {};
      var allBuiltins = builtins100;
      var allLiterals = literals100;
      if (opt.version === "300 es") {
        allBuiltins = builtins300es;
        allLiterals = literals300es;
      }
      var builtinsDict = {}, literalsDict = {};
      for (var i = 0; i < allBuiltins.length; i++) {
        builtinsDict[allBuiltins[i]] = true;
      }
      for (var i = 0; i < allLiterals.length; i++) {
        literalsDict[allLiterals[i]] = true;
      }
      return function(data) {
        tokens = [];
        if (data !== null) return write(data);
        return end();
      };
      function token(data) {
        if (data.length) {
          tokens.push({
            type: map[mode],
            data,
            position: start,
            line,
            column: col
          });
        }
      }
      function write(chunk) {
        i = 0;
        if (chunk.toString) chunk = chunk.toString();
        input += chunk.replace(/\r\n/g, "\n");
        len = input.length;
        var last2;
        while (c = input[i], i < len) {
          last2 = i;
          switch (mode) {
            case BLOCK_COMMENT:
              i = block_comment();
              break;
            case LINE_COMMENT:
              i = line_comment();
              break;
            case PREPROCESSOR:
              i = preprocessor();
              break;
            case OPERATOR:
              i = operator();
              break;
            case INTEGER:
              i = integer();
              break;
            case HEX:
              i = hex();
              break;
            case FLOAT:
              i = decimal();
              break;
            case TOKEN:
              i = readtoken();
              break;
            case WHITESPACE:
              i = whitespace();
              break;
            case NORMAL:
              i = normal();
              break;
          }
          if (last2 !== i) {
            switch (input[last2]) {
              case "\n":
                col = 0;
                ++line;
                break;
              default:
                ++col;
                break;
            }
          }
        }
        total += i;
        input = input.slice(i);
        return tokens;
      }
      function end(chunk) {
        if (content.length) {
          token(content.join(""));
        }
        mode = EOF;
        token("(eof)");
        return tokens;
      }
      function normal() {
        content = content.length ? [] : content;
        if (last === "/" && c === "*") {
          start = total + i - 1;
          mode = BLOCK_COMMENT;
          last = c;
          return i + 1;
        }
        if (last === "/" && c === "/") {
          start = total + i - 1;
          mode = LINE_COMMENT;
          last = c;
          return i + 1;
        }
        if (c === "#") {
          mode = PREPROCESSOR;
          start = total + i;
          return i;
        }
        if (/\s/.test(c)) {
          mode = WHITESPACE;
          start = total + i;
          return i;
        }
        isnum = /\d/.test(c);
        isoperator = /[^\w_]/.test(c);
        start = total + i;
        mode = isnum ? INTEGER : isoperator ? OPERATOR : TOKEN;
        return i;
      }
      function whitespace() {
        if (/[^\s]/g.test(c)) {
          token(content.join(""));
          mode = NORMAL;
          return i;
        }
        content.push(c);
        last = c;
        return i + 1;
      }
      function preprocessor() {
        if ((c === "\r" || c === "\n") && last !== "\\") {
          token(content.join(""));
          mode = NORMAL;
          return i;
        }
        content.push(c);
        last = c;
        return i + 1;
      }
      function line_comment() {
        return preprocessor();
      }
      function block_comment() {
        if (c === "/" && last === "*") {
          content.push(c);
          token(content.join(""));
          mode = NORMAL;
          return i + 1;
        }
        content.push(c);
        last = c;
        return i + 1;
      }
      function operator() {
        if (last === "." && /\d/.test(c)) {
          mode = FLOAT;
          return i;
        }
        if (last === "/" && c === "*") {
          mode = BLOCK_COMMENT;
          return i;
        }
        if (last === "/" && c === "/") {
          mode = LINE_COMMENT;
          return i;
        }
        if (c === "." && content.length) {
          while (determine_operator(content)) ;
          mode = FLOAT;
          return i;
        }
        if (c === ";" || c === ")" || c === "(") {
          if (content.length) while (determine_operator(content)) ;
          token(c);
          mode = NORMAL;
          return i + 1;
        }
        var is_composite_operator = content.length === 2 && c !== "=";
        if (/[\w_\d\s]/.test(c) || is_composite_operator) {
          while (determine_operator(content)) ;
          mode = NORMAL;
          return i;
        }
        content.push(c);
        last = c;
        return i + 1;
      }
      function determine_operator(buf) {
        var j = 0, idx, res;
        do {
          idx = operators.indexOf(buf.slice(0, buf.length + j).join(""));
          res = operators[idx];
          if (idx === -1) {
            if (j-- + buf.length > 0) continue;
            res = buf.slice(0, 1).join("");
          }
          token(res);
          start += res.length;
          content = content.slice(res.length);
          return content.length;
        } while (1);
      }
      function hex() {
        if (/[^a-fA-F0-9]/.test(c)) {
          token(content.join(""));
          mode = NORMAL;
          return i;
        }
        content.push(c);
        last = c;
        return i + 1;
      }
      function integer() {
        if (c === ".") {
          content.push(c);
          mode = FLOAT;
          last = c;
          return i + 1;
        }
        if (/[eE]/.test(c)) {
          content.push(c);
          mode = FLOAT;
          last = c;
          return i + 1;
        }
        if (c === "x" && content.length === 1 && content[0] === "0") {
          mode = HEX;
          content.push(c);
          last = c;
          return i + 1;
        }
        if (/[^\d]/.test(c)) {
          token(content.join(""));
          mode = NORMAL;
          return i;
        }
        content.push(c);
        last = c;
        return i + 1;
      }
      function decimal() {
        if (c === "f") {
          content.push(c);
          last = c;
          i += 1;
        }
        if (/[eE]/.test(c)) {
          content.push(c);
          last = c;
          return i + 1;
        }
        if ((c === "-" || c === "+") && /[eE]/.test(last)) {
          content.push(c);
          last = c;
          return i + 1;
        }
        if (/[^\d]/.test(c)) {
          token(content.join(""));
          mode = NORMAL;
          return i;
        }
        content.push(c);
        last = c;
        return i + 1;
      }
      function readtoken() {
        if (/[^\d\w_]/.test(c)) {
          var contentstr = content.join("");
          if (literalsDict[contentstr]) {
            mode = KEYWORD;
          } else if (builtinsDict[contentstr]) {
            mode = BUILTIN;
          } else {
            mode = IDENT;
          }
          token(content.join(""));
          mode = NORMAL;
          return i;
        }
        content.push(c);
        last = c;
        return i + 1;
      }
    }
  }
});

// ../../../node_modules/glsl-tokenizer/string.js
var require_string = __commonJS({
  "../../../node_modules/glsl-tokenizer/string.js"(exports, module) {
    init_console_gjs();
    var tokenize2 = require_glsl_tokenizer();
    module.exports = tokenizeString;
    function tokenizeString(str, opt) {
      var generator = tokenize2(opt);
      var tokens = [];
      tokens = tokens.concat(generator(str));
      tokens = tokens.concat(generator(null));
      return tokens;
    }
  }
});

// src/ts/conformance-test.ts
init_console_gjs();

// ../../gjs/unit/lib/esm/index.js
init_console_gjs();

// ../../../node_modules/@girs/gjs/index.js
init_console_gjs();

// ../../../node_modules/@girs/gjs/gjs.js
init_console_gjs();
var imports2 = globalThis.imports || {};

// ../../gjs/unit/lib/esm/spy.js
init_console_gjs();

// ../../gjs/unit/lib/esm/index.js
var import_node_assert = __toESM(require_cjs_compat(), 1);
init_main_loop();
var mainloop = globalThis?.imports?.mainloop;
var countTestsOverall = 0;
var countTestsFailed = 0;
var countTestsIgnored = 0;
var runtime = "";
var runStartTime = 0;
var DEFAULT_TIMEOUT_CONFIG = {
  testTimeout: 5e3,
  suiteTimeout: 3e4,
  runTimeout: 12e4
};
var timeoutConfig = { ...DEFAULT_TIMEOUT_CONFIG };
var TimeoutError = class extends Error {
  constructor(label, timeoutMs) {
    super(`Timeout: "${label}" exceeded ${timeoutMs}ms`);
    this.name = "TimeoutError";
  }
};
async function withTimeout(fn, timeoutMs, label) {
  if (timeoutMs <= 0) return fn();
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new TimeoutError(label, timeoutMs)), timeoutMs);
  });
  const fnPromise = Promise.resolve(fn());
  fnPromise.catch(() => {
  });
  try {
    return await Promise.race([fnPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}
function applyEnvOverrides() {
  try {
    const env2 = globalThis.process?.env;
    if (!env2) return;
    const t = parseInt(env2.GJSIFY_TEST_TIMEOUT, 10);
    if (!isNaN(t) && t >= 0) timeoutConfig.testTimeout = t;
    const s = parseInt(env2.GJSIFY_SUITE_TIMEOUT, 10);
    if (!isNaN(s) && s >= 0) timeoutConfig.suiteTimeout = s;
    const r = parseInt(env2.GJSIFY_RUN_TIMEOUT, 10);
    if (!isNaN(r) && r >= 0) timeoutConfig.runTimeout = r;
  } catch (_e3) {
  }
}
var RED = "\x1B[31m";
var GREEN = "\x1B[32m";
var BLUE = "\x1B[34m";
var GRAY = "\x1B[90m";
var RESET = "\x1B[39m";
var now = () => globalThis.performance?.now?.() ?? Date.now();
var formatDuration = (ms) => {
  if (ms >= 1e3) return `${(ms / 1e3).toFixed(2)}s`;
  if (ms >= 100) return `${Math.round(ms)}ms`;
  return `${ms.toFixed(1)}ms`;
};
var print2 = globalThis.print || console.log;
var MatcherFactory = class _MatcherFactory {
  constructor(actualValue, positive, negated) {
    this.actualValue = actualValue;
    this.positive = positive;
    if (negated) {
      this.not = negated;
    } else {
      this.not = new _MatcherFactory(actualValue, !positive, this);
    }
  }
  not;
  triggerResult(success, msg) {
    if (success && !this.positive || !success && this.positive) {
      const error2 = new Error(msg);
      error2.__testFailureCounted = true;
      ++countTestsFailed;
      throw error2;
    }
  }
  to(callback) {
    this.triggerResult(
      callback(this.actualValue),
      `      Expected callback to validate`
    );
  }
  toBe(expectedValue) {
    this.triggerResult(
      this.actualValue === expectedValue,
      `      Expected values to match using ===
      Expected: ${expectedValue} (${typeof expectedValue})
      Actual: ${this.actualValue} (${typeof this.actualValue})`
    );
  }
  toEqual(expectedValue) {
    this.triggerResult(
      this.actualValue == expectedValue,
      `      Expected values to match using ==
      Expected: ${expectedValue} (${typeof expectedValue})
      Actual: ${this.actualValue} (${typeof this.actualValue})`
    );
  }
  toStrictEqual(expectedValue) {
    let success = true;
    let errorMessage = "";
    try {
      import_node_assert.default.deepStrictEqual(this.actualValue, expectedValue);
    } catch (e) {
      success = false;
      errorMessage = e.message || "";
    }
    this.triggerResult(
      success,
      `      Expected values to be deeply strictly equal
      Expected: ${JSON.stringify(expectedValue)}
      Actual: ${JSON.stringify(this.actualValue)}` + (errorMessage ? `
      ${errorMessage}` : "")
    );
  }
  toEqualArray(expectedValue) {
    let success = Array.isArray(this.actualValue) && Array.isArray(expectedValue) && this.actualValue.length === expectedValue.length;
    for (let i = 0; i < this.actualValue.length; i++) {
      const actualVal = this.actualValue[i];
      const expectedVal = expectedValue[i];
      success = actualVal == expectedVal;
      if (!success) break;
    }
    this.triggerResult(
      success,
      `      Expected array items to match using ==
      Expected: ${expectedValue} (${typeof expectedValue})
      Actual: ${this.actualValue} (${typeof this.actualValue})`
    );
  }
  toBeInstanceOf(expectedType) {
    this.triggerResult(
      this.actualValue instanceof expectedType,
      `      Expected value to be instance of ${expectedType.name || expectedType}
      Actual: ${this.actualValue?.constructor?.name || typeof this.actualValue}`
    );
  }
  toHaveLength(expectedLength) {
    const actualLength = this.actualValue?.length;
    this.triggerResult(
      actualLength === expectedLength,
      `      Expected length: ${expectedLength}
      Actual length: ${actualLength}`
    );
  }
  toMatch(expectedValue) {
    if (typeof this.actualValue.match !== "function") {
      throw new Error(`You can not use toMatch on type ${typeof this.actualValue}`);
    }
    this.triggerResult(
      !!this.actualValue.match(expectedValue),
      "      Expected values to match using regular expression\n      Expression: " + expectedValue + "\n      Actual: " + this.actualValue
    );
  }
  toBeDefined() {
    this.triggerResult(
      typeof this.actualValue !== "undefined",
      `      Expected value to be defined`
    );
  }
  toBeUndefined() {
    this.triggerResult(
      typeof this.actualValue === "undefined",
      `      Expected value to be undefined`
    );
  }
  toBeNull() {
    this.triggerResult(
      this.actualValue === null,
      `      Expected value to be null`
    );
  }
  toBeTruthy() {
    this.triggerResult(
      this.actualValue,
      `      Expected value to be truthy`
    );
  }
  toBeFalsy() {
    this.triggerResult(
      !this.actualValue,
      `      Expected value to be falsy`
    );
  }
  toContain(needle) {
    const value2 = this.actualValue;
    let contains;
    if (typeof value2 === "string") {
      contains = value2.includes(String(needle));
    } else if (value2 instanceof Array) {
      contains = value2.indexOf(needle) !== -1;
    } else {
      contains = false;
    }
    this.triggerResult(
      contains,
      `      Expected ` + value2 + ` to contain ` + needle
    );
  }
  toBeLessThan(greaterValue) {
    this.triggerResult(
      this.actualValue < greaterValue,
      `      Expected ` + this.actualValue + ` to be less than ` + greaterValue
    );
  }
  toBeGreaterThan(smallerValue) {
    this.triggerResult(
      this.actualValue > smallerValue,
      `      Expected ` + this.actualValue + ` to be greater than ` + smallerValue
    );
  }
  toBeGreaterThanOrEqual(value2) {
    this.triggerResult(
      this.actualValue >= value2,
      `      Expected ${this.actualValue} to be greater than or equal to ${value2}`
    );
  }
  toBeLessThanOrEqual(value2) {
    this.triggerResult(
      this.actualValue <= value2,
      `      Expected ${this.actualValue} to be less than or equal to ${value2}`
    );
  }
  toBeCloseTo(expectedValue, precision) {
    const shiftHelper = Math.pow(10, precision);
    this.triggerResult(
      Math.round(this.actualValue * shiftHelper) / shiftHelper === Math.round(expectedValue * shiftHelper) / shiftHelper,
      `      Expected ` + this.actualValue + ` with precision ` + precision + ` to be close to ` + expectedValue
    );
  }
  toThrow(expected) {
    let errorMessage = "";
    let didThrow = false;
    let typeMatch = true;
    let messageMatch = true;
    try {
      this.actualValue();
      didThrow = false;
    } catch (e) {
      errorMessage = e.message || "";
      didThrow = true;
      if (typeof expected === "function") {
        typeMatch = e instanceof expected;
      } else if (typeof expected === "string") {
        messageMatch = errorMessage.includes(expected);
      } else if (expected instanceof RegExp) {
        messageMatch = expected.test(errorMessage);
      }
    }
    const functionName = this.actualValue.name || typeof this.actualValue === "function" ? "[anonymous function]" : this.actualValue.toString();
    this.triggerResult(
      didThrow,
      `      Expected ${functionName} to ${this.positive ? "throw" : "not throw"} an exception ${!this.positive && errorMessage ? `, but an error with the message "${errorMessage}" was thrown` : ""}`
    );
    if (typeof expected === "function") {
      this.triggerResult(
        typeMatch,
        `      Expected Error type '${expected.name}', but the error is not an instance of it`
      );
    } else if (expected !== void 0) {
      this.triggerResult(
        messageMatch,
        `      Expected error message to match ${expected}
      Actual message: "${errorMessage}"`
      );
    }
  }
  async toReject(expected) {
    let didReject = false;
    let errorMessage = "";
    let typeMatch = true;
    let messageMatch = true;
    try {
      await this.actualValue;
      didReject = false;
    } catch (e) {
      didReject = true;
      errorMessage = e?.message || String(e);
      if (typeof expected === "function") {
        typeMatch = e instanceof expected;
      } else if (typeof expected === "string") {
        messageMatch = errorMessage.includes(expected);
      } else if (expected instanceof RegExp) {
        messageMatch = expected.test(errorMessage);
      }
    }
    this.triggerResult(
      didReject,
      `      Expected promise to ${this.positive ? "reject" : "resolve"}${!this.positive && errorMessage ? `, but it rejected with "${errorMessage}"` : ""}`
    );
    if (didReject && typeof expected === "function") {
      this.triggerResult(
        typeMatch,
        `      Expected rejection type '${expected.name}', but the error is not an instance of it`
      );
    } else if (didReject && expected !== void 0) {
      this.triggerResult(
        messageMatch,
        `      Expected rejection message to match ${expected}
      Actual message: "${errorMessage}"`
      );
    }
  }
  async toResolve() {
    let didResolve = false;
    let errorMessage = "";
    try {
      await this.actualValue;
      didResolve = true;
    } catch (e) {
      didResolve = false;
      errorMessage = e?.message || String(e);
    }
    this.triggerResult(
      didResolve,
      `      Expected promise to ${this.positive ? "resolve" : "reject"}${!didResolve ? `, but it rejected with "${errorMessage}"` : ""}`
    );
  }
};
var describe = async function(moduleName, callback, options) {
  const suiteTimeoutMs = typeof options === "number" ? options : options?.timeout ?? timeoutConfig.suiteTimeout;
  print2("\n" + moduleName);
  const t0 = now();
  try {
    await withTimeout(callback, suiteTimeoutMs, `describe: ${moduleName}`);
  } catch (e) {
    if (e instanceof TimeoutError) {
      ++countTestsFailed;
      print2(`  ${RED}\u23F1 Suite timed out: ${e.message}${RESET}`);
    } else {
      throw e;
    }
  }
  const duration = now() - t0;
  print2(`  ${GRAY}\u21B3 ${formatDuration(duration)}${RESET}`);
  beforeEachCb = null;
  afterEachCb = null;
};
describe.skip = async function(moduleName, _callback) {
  ++countTestsIgnored;
  print2(`
${BLUE}- ${moduleName} (skipped)${RESET}`);
};
var hasDisplay = () => {
  const env2 = globalThis.process?.env;
  if (env2) {
    return !!(env2.DISPLAY || env2.WAYLAND_DISPLAY);
  }
  try {
    const GLib3 = globalThis?.imports?.gi?.GLib;
    if (GLib3) {
      return !!(GLib3.getenv("DISPLAY") || GLib3.getenv("WAYLAND_DISPLAY"));
    }
  } catch (_) {
  }
  return false;
};
var runtimeMatch = async function(onRuntime, version2) {
  if (onRuntime.includes("Display")) {
    return { matched: hasDisplay() };
  }
  const currRuntime = await getRuntime();
  const foundRuntime = onRuntime.find((r) => currRuntime.includes(r));
  if (!foundRuntime) {
    return {
      matched: false
    };
  }
  if (typeof version2 === "string") {
    if (!currRuntime.includes(version2)) {
      return {
        matched: false
      };
    }
  }
  return {
    matched: true,
    runtime: foundRuntime,
    version: version2
  };
};
var on2 = async function(onRuntime, version2, callback) {
  if (typeof onRuntime === "string") {
    onRuntime = [onRuntime];
  }
  if (typeof version2 === "function") {
    callback = version2;
    version2 = void 0;
  }
  const { matched } = await runtimeMatch(onRuntime, version2);
  if (!matched) {
    ++countTestsIgnored;
    return;
  }
  print2(`
On ${onRuntime.join(", ")}${version2 ? " " + version2 : ""}`);
  await callback();
};
var beforeEachCb;
var afterEachCb;
var beforeEach = function(callback) {
  beforeEachCb = callback;
};
var it = async function(expectation, callback, options) {
  const timeoutMs = typeof options === "number" ? options : options?.timeout ?? timeoutConfig.testTimeout;
  const t0 = now();
  try {
    if (typeof beforeEachCb === "function") {
      await beforeEachCb();
    }
    await withTimeout(callback, timeoutMs, expectation);
    if (typeof afterEachCb === "function") {
      await afterEachCb();
    }
    const duration = now() - t0;
    print2(`  ${GREEN}\u2714${RESET} ${GRAY}${expectation}  (${formatDuration(duration)})${RESET}`);
  } catch (e) {
    const duration = now() - t0;
    if (!e.__testFailureCounted) {
      ++countTestsFailed;
    }
    const icon = e instanceof TimeoutError ? "\u23F1" : "\u274C";
    print2(`  ${RED}${icon}${RESET} ${GRAY}${expectation}  (${formatDuration(duration)})${RESET}`);
    print2(`${RED}${e.message}${RESET}`);
    if (e.stack) print2(e.stack);
  }
};
it.skip = async function(expectation, _callback) {
  ++countTestsIgnored;
  print2(`  ${BLUE}-${RESET} ${GRAY}${expectation} (skipped)${RESET}`);
};
var expect = function(actualValue) {
  ++countTestsOverall;
  const expecter = new MatcherFactory(actualValue, true);
  return expecter;
};
var assert3 = function(success, message) {
  ++countTestsOverall;
  if (!success) {
    ++countTestsFailed;
  }
  try {
    (0, import_node_assert.default)(success, message);
  } catch (error2) {
    error2.__testFailureCounted = true;
    throw error2;
  }
};
assert3.strictEqual = function(actual, expected, message) {
  ++countTestsOverall;
  try {
    import_node_assert.default.strictEqual(actual, expected, message);
  } catch (error2) {
    ++countTestsFailed;
    error2.__testFailureCounted = true;
    throw error2;
  }
};
assert3.throws = function(promiseFn, ...args) {
  ++countTestsOverall;
  let error2;
  try {
    promiseFn();
  } catch (e) {
    error2 = e;
  }
  if (!error2) ++countTestsFailed;
  import_node_assert.default.throws(() => {
    if (error2) throw error2;
  }, args[0], args[1]);
};
assert3.deepStrictEqual = function(actual, expected, message) {
  ++countTestsOverall;
  try {
    import_node_assert.default.deepStrictEqual(actual, expected, message);
  } catch (error2) {
    ++countTestsFailed;
    error2.__testFailureCounted = true;
    throw error2;
  }
};
var runTests = async function(namespaces) {
  for (const subNamespace in namespaces) {
    const namespace = namespaces[subNamespace];
    if (typeof namespace === "function") {
      await namespace();
    } else if (typeof namespace === "object") {
      await runTests(namespace);
    }
  }
};
var printResult = () => {
  const totalMs = runStartTime > 0 ? now() - runStartTime : 0;
  const durationStr = totalMs > 0 ? `  ${GRAY}(${formatDuration(totalMs)})` : "";
  if (countTestsIgnored) {
    print2(`
${BLUE}\u2714 ${countTestsIgnored} ignored test${countTestsIgnored > 1 ? "s" : ""}${RESET}`);
  }
  if (countTestsFailed) {
    print2(`
${RED}\u274C ${countTestsFailed} of ${countTestsOverall} tests failed${durationStr}${RESET}`);
  } else {
    print2(`
${GREEN}\u2714 ${countTestsOverall} completed${durationStr}${RESET}`);
  }
};
var getRuntime = async () => {
  if (runtime && runtime !== "Unknown") {
    return runtime;
  }
  if (globalThis.Deno?.version?.deno) {
    return "Deno " + globalThis.Deno?.version?.deno;
  } else {
    let process2 = globalThis.process;
    if (!process2) {
      try {
        process2 = await Promise.resolve().then(() => (init_esm3(), esm_exports3));
      } catch (error2) {
        console.error(error2);
        console.warn(error2.message);
        runtime = "Unknown";
      }
    }
    if (process2?.versions?.gjs) {
      runtime = "Gjs " + process2.versions.gjs;
    } else if (process2?.versions?.node) {
      runtime = "Node.js " + process2.versions.node;
    }
  }
  return runtime || "Unknown";
};
var printRuntime = async () => {
  const runtime2 = await getRuntime();
  print2(`
Running on ${runtime2}`);
};
var run = async (namespaces, options) => {
  applyEnvOverrides();
  runStartTime = now();
  if (options) {
    if (typeof options === "number") {
      timeoutConfig.runTimeout = options;
    } else {
      if (options.timeout !== void 0) timeoutConfig.runTimeout = options.timeout;
      if (options.testTimeout !== void 0) timeoutConfig.testTimeout = options.testTimeout;
      if (options.suiteTimeout !== void 0) timeoutConfig.suiteTimeout = options.suiteTimeout;
    }
  }
  printRuntime().then(async () => {
    try {
      await withTimeout(() => runTests(namespaces), timeoutConfig.runTimeout, "entire test run");
    } catch (e) {
      if (e instanceof TimeoutError) {
        print2(`
${RED}\u23F1 ${e.message}${RESET}`);
        ++countTestsFailed;
      } else {
        throw e;
      }
    }
  }).then(async () => {
    printResult();
    print2();
    quitMainLoop();
    mainloop?.quit();
    if (!mainloop) {
      const exitCode = countTestsFailed > 0 ? 1 : 0;
      try {
        const process2 = globalThis.process || await Promise.resolve().then(() => (init_esm3(), esm_exports3));
        process2.exit(exitCode);
      } catch (_e3) {
      }
    }
  });
  mainloop?.run();
  if (mainloop) {
    const exitCode = countTestsFailed > 0 ? 1 : 0;
    try {
      globalThis.imports.system.exit(exitCode);
    } catch (_e3) {
    }
  }
};

// src/ts/conformance/buffers.spec.ts
init_console_gjs();

// src/ts/test-utils.ts
init_console_gjs();
function makeShader(gl, type, src) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  return shader;
}
function makeProgram(gl, vsSrc, fsSrc) {
  const frag = makeShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const vert = makeShader(gl, gl.VERTEX_SHADER, vsSrc);
  const program = gl.createProgram();
  gl.attachShader(program, frag);
  gl.attachShader(program, vert);
  gl.bindAttribLocation(program, 0, "position");
  gl.linkProgram(program);
  return program;
}
function readPixel(gl, x = 0, y = 0) {
  const pixel = new Uint8Array(4);
  gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  return pixel;
}
function pixelClose(a, b, tolerance = 3) {
  for (let i = 0; i < 4; i++) {
    if (Math.abs(a[i] - b[i]) > tolerance) return false;
  }
  return true;
}
function makeTestFBO(gl, width = 4, height = 4) {
  const fb = gl.createFramebuffer();
  const colorTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, colorTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
  gl.viewport(0, 0, width, height);
  return { fb, colorTex, width, height };
}
function destroyTestFBO(gl, fbo) {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteTexture(fbo.colorTex);
  gl.deleteFramebuffer(fbo.fb);
}

// src/ts/conformance/setup.ts
init_console_gjs();

// lib/esm/index.js
init_console_gjs();
init_gio_2();

// ../../../node_modules/@girs/gtk-4.0/index.js
init_console_gjs();

// ../../../node_modules/@girs/gtk-4.0/gtk-4.0.js
init_console_gjs();
import Gtk from "gi://Gtk?version=4.0";
var gtk_4_0_default = Gtk;

// ../../../node_modules/@girs/gtk-4.0/index.js
var gtk_4_default = gtk_4_0_default;

// lib/esm/html-canvas-element.js
init_console_gjs();

// ../dom-elements/lib/esm/index.js
init_console_gjs();

// ../dom-elements/lib/esm/attr.js
init_console_gjs();

// ../dom-elements/lib/esm/property-symbol.js
init_console_gjs();
var nodeType = /* @__PURE__ */ Symbol("nodeType");
var parentNode = /* @__PURE__ */ Symbol("parentNode");
var childNodesList = /* @__PURE__ */ Symbol("childNodesList");
var elementChildren = /* @__PURE__ */ Symbol("elementChildren");
var isConnected = /* @__PURE__ */ Symbol("isConnected");
var tagName = /* @__PURE__ */ Symbol("tagName");
var localName = /* @__PURE__ */ Symbol("localName");
var namespaceURI = /* @__PURE__ */ Symbol("namespaceURI");
var prefix = /* @__PURE__ */ Symbol("prefix");
var attributes = /* @__PURE__ */ Symbol("attributes");
var propertyEventListeners = /* @__PURE__ */ Symbol("propertyEventListeners");
var name = /* @__PURE__ */ Symbol("name");
var value = /* @__PURE__ */ Symbol("value");
var ownerElement = /* @__PURE__ */ Symbol("ownerElement");

// ../dom-elements/lib/esm/attr.js
var Attr = class {
  constructor(name2, value2, namespaceURI2 = null, prefix2 = null, ownerElement2 = null) {
    this.specified = true;
    this[name] = name2;
    this[value] = value2;
    this[ownerElement] = ownerElement2;
    this.namespaceURI = namespaceURI2;
    this.prefix = prefix2;
    const colonIndex = name2.indexOf(":");
    this.localName = colonIndex !== -1 ? name2.slice(colonIndex + 1) : name2;
  }
  get name() {
    return this[name];
  }
  get value() {
    return this[value];
  }
  set value(value2) {
    this[value] = value2;
  }
  get ownerElement() {
    return this[ownerElement];
  }
  get [(name, value, ownerElement, Symbol.toStringTag)]() {
    return "Attr";
  }
};

// ../dom-elements/lib/esm/named-node-map.js
init_console_gjs();

// ../dom-elements/lib/esm/namespace-uri.js
init_console_gjs();
var NamespaceURI = {
  html: "http://www.w3.org/1999/xhtml",
  svg: "http://www.w3.org/2000/svg",
  mathML: "http://www.w3.org/1998/Math/MathML",
  xml: "http://www.w3.org/XML/1998/namespace",
  xmlns: "http://www.w3.org/2000/xmlns/"
};

// ../dom-elements/lib/esm/named-node-map.js
var NamedNodeMap = class {
  constructor(ownerElement2) {
    this._items = [];
    this._ownerElement = ownerElement2;
  }
  get length() {
    return this._items.length;
  }
  item(index) {
    return this._items[index] ?? null;
  }
  getNamedItem(qualifiedName) {
    return this._findByName(qualifiedName);
  }
  getNamedItemNS(namespace, localName2) {
    const ns = namespace === "" ? null : namespace;
    for (const attr of this._items) {
      if (attr.namespaceURI === ns && attr.localName === localName2) {
        return attr;
      }
    }
    return null;
  }
  setNamedItem(attr) {
    return this._setAttr(attr);
  }
  setNamedItemNS(attr) {
    return this._setAttr(attr);
  }
  removeNamedItem(qualifiedName) {
    const existing = this._findByName(qualifiedName);
    if (!existing) {
      throw new DOMException(
        `Failed to execute 'removeNamedItem' on 'NamedNodeMap': No item with name '${qualifiedName}' was found.`,
        "NotFoundError"
      );
    }
    this._removeAttr(existing);
    return existing;
  }
  removeNamedItemNS(namespace, localName2) {
    const existing = this.getNamedItemNS(namespace, localName2);
    if (!existing) {
      throw new DOMException(
        `Failed to execute 'removeNamedItemNS' on 'NamedNodeMap': No item with namespace '${namespace}' and localName '${localName2}' was found.`,
        "NotFoundError"
      );
    }
    this._removeAttr(existing);
    return existing;
  }
  [Symbol.iterator]() {
    return this._items[Symbol.iterator]();
  }
  get [Symbol.toStringTag]() {
    return "NamedNodeMap";
  }
  // -- Internal helpers --
  /** @internal Add or replace an attribute by name. */
  _setNamedItem(name2, value2, namespaceURI2 = null, prefix2 = null) {
    const existing = namespaceURI2 !== null ? this.getNamedItemNS(namespaceURI2, name2.includes(":") ? name2.split(":")[1] : name2) : this._findByName(name2);
    if (existing) {
      existing.value = value2;
    } else {
      const attr = new Attr(name2, value2, namespaceURI2, prefix2, this._ownerElement);
      this._items.push(attr);
    }
  }
  /** @internal Remove an attribute by name. Returns true if removed. */
  _removeNamedItem(name2) {
    const existing = this._findByName(name2);
    if (existing) {
      this._removeAttr(existing);
      return true;
    }
    return false;
  }
  /** @internal Remove an attribute by namespace + localName. Returns true if removed. */
  _removeNamedItemNS(namespace, localName2) {
    const existing = this.getNamedItemNS(namespace, localName2);
    if (existing) {
      this._removeAttr(existing);
      return true;
    }
    return false;
  }
  _findByName(qualifiedName) {
    const isHTML = this._ownerElement.namespaceURI === NamespaceURI.html;
    const searchName = isHTML ? qualifiedName.toLowerCase() : qualifiedName;
    for (const attr of this._items) {
      const attrName = isHTML ? attr.name.toLowerCase() : attr.name;
      if (attrName === searchName) {
        return attr;
      }
    }
    return null;
  }
  _setAttr(attr) {
    let existing = null;
    if (attr.namespaceURI !== null) {
      existing = this.getNamedItemNS(attr.namespaceURI, attr.localName);
    } else {
      existing = this._findByName(attr.name);
    }
    if (existing) {
      const oldAttr = new Attr(existing.name, existing.value, existing.namespaceURI, existing.prefix, existing.ownerElement);
      existing.value = attr.value;
      return oldAttr;
    }
    this._items.push(attr);
    return null;
  }
  _removeAttr(attr) {
    const idx = this._items.indexOf(attr);
    if (idx !== -1) {
      this._items.splice(idx, 1);
    }
  }
};

// ../dom-elements/lib/esm/node-list.js
init_console_gjs();
var NodeList = class {
  constructor(items) {
    this._items = items;
  }
  get length() {
    return this._items.length;
  }
  item(index) {
    return this._items[index] ?? null;
  }
  forEach(callback, thisArg) {
    for (let i = 0; i < this._items.length; i++) {
      callback.call(thisArg, this._items[i], i, this);
    }
  }
  entries() {
    return this._items.entries();
  }
  keys() {
    return this._items.keys();
  }
  values() {
    return this._items.values();
  }
  [Symbol.iterator]() {
    return this._items[Symbol.iterator]();
  }
  get [Symbol.toStringTag]() {
    return "NodeList";
  }
};

// ../dom-elements/lib/esm/node.js
init_console_gjs();

// ../../web/dom-events/lib/esm/index.js
init_console_gjs();

// ../../web/dom-exception/lib/esm/index.js
init_console_gjs();
var DOMExceptionCodes = {
  IndexSizeError: 1,
  HierarchyRequestError: 3,
  WrongDocumentError: 4,
  InvalidCharacterError: 5,
  NoModificationAllowedError: 7,
  NotFoundError: 8,
  NotSupportedError: 9,
  InUseAttributeError: 10,
  InvalidStateError: 11,
  SyntaxError: 12,
  InvalidModificationError: 13,
  NamespaceError: 14,
  InvalidAccessError: 15,
  TypeMismatchError: 17,
  SecurityError: 18,
  NetworkError: 19,
  AbortError: 20,
  URLMismatchError: 21,
  QuotaExceededError: 22,
  TimeoutError: 23,
  InvalidNodeTypeError: 24,
  DataCloneError: 25
};
var _DOMExceptionPolyfill = class extends Error {
  code;
  constructor(message, name2) {
    super(message);
    this.name = name2 || "Error";
    this.code = Object.hasOwn(DOMExceptionCodes, this.name) ? DOMExceptionCodes[this.name] : 0;
  }
};
var DOMException2 = typeof globalThis.DOMException !== "undefined" ? globalThis.DOMException : _DOMExceptionPolyfill;
if (typeof globalThis.DOMException === "undefined") {
  globalThis.DOMException = DOMException2;
}

// ../../web/dom-events/lib/esm/index.js
var kType = /* @__PURE__ */ Symbol("type");
var kBubbles = /* @__PURE__ */ Symbol("bubbles");
var kCancelable = /* @__PURE__ */ Symbol("cancelable");
var kComposed = /* @__PURE__ */ Symbol("composed");
var kTarget = /* @__PURE__ */ Symbol("target");
var kCurrentTarget = /* @__PURE__ */ Symbol("currentTarget");
var kEventPhase = /* @__PURE__ */ Symbol("eventPhase");
var kDefaultPrevented = /* @__PURE__ */ Symbol("defaultPrevented");
var kIsTrusted = /* @__PURE__ */ Symbol("isTrusted");
var kTimeStamp = /* @__PURE__ */ Symbol("timeStamp");
var kStop = /* @__PURE__ */ Symbol("stop");
var kImmediateStop = /* @__PURE__ */ Symbol("immediateStop");
var kDispatching = /* @__PURE__ */ Symbol("dispatching");
var kInPassiveListener = /* @__PURE__ */ Symbol("inPassiveListener");
var Event = class {
  // Internal state
  [kType];
  [kBubbles];
  [kCancelable];
  [kComposed];
  [kTarget] = null;
  [kCurrentTarget] = null;
  [kEventPhase] = 0;
  [kDefaultPrevented] = false;
  [kIsTrusted] = false;
  [kTimeStamp];
  [kStop] = false;
  [kImmediateStop] = false;
  [kDispatching] = false;
  [kInPassiveListener] = false;
  // Readonly getters
  get type() {
    return this[kType];
  }
  get bubbles() {
    return this[kBubbles];
  }
  get cancelable() {
    return this[kCancelable];
  }
  get composed() {
    return this[kComposed];
  }
  get target() {
    return this[kTarget];
  }
  get currentTarget() {
    return this[kCurrentTarget];
  }
  get eventPhase() {
    return this[kEventPhase];
  }
  get defaultPrevented() {
    return this[kDefaultPrevented];
  }
  // isTrusted is defined as a non-configurable own property in the constructor
  get timeStamp() {
    return this[kTimeStamp];
  }
  // Legacy compat
  get cancelBubble() {
    return this[kStop];
  }
  set cancelBubble(value2) {
    if (value2) this.stopPropagation();
  }
  get returnValue() {
    return !this[kDefaultPrevented];
  }
  set returnValue(value2) {
    if (!value2) this.preventDefault();
  }
  get srcElement() {
    return this[kTarget];
  }
  // Phase constants (defined as non-writable, non-configurable on prototype below)
  static NONE = 0;
  static CAPTURING_PHASE = 1;
  static AT_TARGET = 2;
  static BUBBLING_PHASE = 3;
  get [Symbol.toStringTag]() {
    return "Event";
  }
  constructor(type, eventInitDict) {
    this[kType] = type;
    this[kBubbles] = eventInitDict?.bubbles ?? false;
    this[kCancelable] = eventInitDict?.cancelable ?? false;
    this[kComposed] = eventInitDict?.composed ?? false;
    this[kTimeStamp] = Date.now();
    Object.defineProperty(this, "isTrusted", {
      get: () => this[kIsTrusted],
      enumerable: true,
      configurable: false
    });
  }
  composedPath() {
    if (this[kCurrentTarget]) return [this[kCurrentTarget]];
    return [];
  }
  preventDefault() {
    if (this[kCancelable] && !this[kInPassiveListener]) {
      this[kDefaultPrevented] = true;
    }
  }
  stopPropagation() {
    this[kStop] = true;
  }
  stopImmediatePropagation() {
    this[kStop] = true;
    this[kImmediateStop] = true;
  }
};
var EventTarget = class {
  _listeners = /* @__PURE__ */ new Map();
  get [Symbol.toStringTag]() {
    return "EventTarget";
  }
  addEventListener(type, callback, options) {
    if (callback === null) return;
    const capture = typeof options === "boolean" ? options : options?.capture ?? false;
    const once2 = typeof options === "object" ? options?.once ?? false : false;
    const passive = typeof options === "object" ? options?.passive ?? false : false;
    let list = this._listeners.get(type);
    if (!list) {
      list = [];
      this._listeners.set(type, list);
    }
    for (const entry2 of list) {
      if (entry2.listener === callback && entry2.capture === capture) return;
    }
    const entry = { listener: callback, capture, once: once2, passive, removed: false };
    list.push(entry);
    if (typeof options === "object" && options?.signal) {
      options.signal.addEventListener("abort", () => {
        this.removeEventListener(type, callback, { capture });
      }, { once: true });
    }
  }
  removeEventListener(type, callback, options) {
    if (callback === null) return;
    const capture = typeof options === "boolean" ? options : options?.capture ?? false;
    const list = this._listeners.get(type);
    if (!list) return;
    const idx = list.findIndex((e) => e.listener === callback && e.capture === capture);
    if (idx !== -1) {
      list[idx].removed = true;
      list.splice(idx, 1);
      if (list.length === 0) this._listeners.delete(type);
    }
  }
  dispatchEvent(event) {
    if (event[kDispatching]) {
      throw new DOMException2("The event is already being dispatched.", "InvalidStateError");
    }
    event[kDispatching] = true;
    event[kTarget] = this;
    event[kCurrentTarget] = this;
    event[kEventPhase] = Event.AT_TARGET;
    const list = this._listeners.get(event.type);
    if (list) {
      const entries = [...list];
      for (const entry of entries) {
        if (entry.removed) continue;
        if (event[kImmediateStop]) break;
        if (event[kStop]) break;
        if (entry.once) {
          this.removeEventListener(event.type, entry.listener, { capture: entry.capture });
        }
        try {
          if (entry.passive) event[kInPassiveListener] = true;
          if (typeof entry.listener === "function") {
            entry.listener.call(this, event);
          } else if (typeof entry.listener.handleEvent === "function") {
            entry.listener.handleEvent.call(entry.listener, event);
          }
        } catch (err) {
          console.error(err);
        } finally {
          event[kInPassiveListener] = false;
        }
      }
    }
    event[kEventPhase] = Event.NONE;
    event[kCurrentTarget] = null;
    event[kDispatching] = false;
    return !event.defaultPrevented;
  }
};
for (const [name2, value2] of [["NONE", 0], ["CAPTURING_PHASE", 1], ["AT_TARGET", 2], ["BUBBLING_PHASE", 3]]) {
  Object.defineProperty(Event.prototype, name2, { value: value2, writable: false, enumerable: true, configurable: false });
  Object.defineProperty(Event, name2, { value: value2, writable: false, enumerable: true, configurable: false });
}
var UIEvent = class extends Event {
  detail;
  view;
  constructor(type, eventInitDict) {
    super(type, eventInitDict);
    this.detail = eventInitDict?.detail ?? 0;
    this.view = null;
  }
  get [Symbol.toStringTag]() {
    return "UIEvent";
  }
};
var MouseEvent = class extends UIEvent {
  altKey;
  button;
  buttons;
  clientX;
  clientY;
  ctrlKey;
  metaKey;
  movementX;
  movementY;
  offsetX;
  offsetY;
  screenX;
  screenY;
  shiftKey;
  relatedTarget;
  // Legacy aliases
  get pageX() {
    return this.clientX;
  }
  get pageY() {
    return this.clientY;
  }
  get x() {
    return this.clientX;
  }
  get y() {
    return this.clientY;
  }
  constructor(type, eventInitDict) {
    super(type, eventInitDict);
    this.altKey = eventInitDict?.altKey ?? false;
    this.button = eventInitDict?.button ?? 0;
    this.buttons = eventInitDict?.buttons ?? 0;
    this.clientX = eventInitDict?.clientX ?? 0;
    this.clientY = eventInitDict?.clientY ?? 0;
    this.ctrlKey = eventInitDict?.ctrlKey ?? false;
    this.metaKey = eventInitDict?.metaKey ?? false;
    this.movementX = eventInitDict?.movementX ?? 0;
    this.movementY = eventInitDict?.movementY ?? 0;
    this.offsetX = eventInitDict?.offsetX ?? 0;
    this.offsetY = eventInitDict?.offsetY ?? 0;
    this.screenX = eventInitDict?.screenX ?? 0;
    this.screenY = eventInitDict?.screenY ?? 0;
    this.shiftKey = eventInitDict?.shiftKey ?? false;
    this.relatedTarget = eventInitDict?.relatedTarget ?? null;
  }
  getModifierState(key) {
    switch (key) {
      case "Alt":
        return this.altKey;
      case "Control":
        return this.ctrlKey;
      case "Meta":
        return this.metaKey;
      case "Shift":
        return this.shiftKey;
      default:
        return false;
    }
  }
  get [Symbol.toStringTag]() {
    return "MouseEvent";
  }
};
var PointerEvent = class extends MouseEvent {
  pointerId;
  width;
  height;
  pressure;
  tangentialPressure;
  tiltX;
  tiltY;
  twist;
  altitudeAngle;
  azimuthAngle;
  pointerType;
  isPrimary;
  constructor(type, eventInitDict) {
    super(type, eventInitDict);
    this.pointerId = eventInitDict?.pointerId ?? 0;
    this.width = eventInitDict?.width ?? 1;
    this.height = eventInitDict?.height ?? 1;
    this.pressure = eventInitDict?.pressure ?? 0;
    this.tangentialPressure = eventInitDict?.tangentialPressure ?? 0;
    this.tiltX = eventInitDict?.tiltX ?? 0;
    this.tiltY = eventInitDict?.tiltY ?? 0;
    this.twist = eventInitDict?.twist ?? 0;
    this.altitudeAngle = eventInitDict?.altitudeAngle ?? Math.PI / 2;
    this.azimuthAngle = eventInitDict?.azimuthAngle ?? 0;
    this.pointerType = eventInitDict?.pointerType ?? "";
    this.isPrimary = eventInitDict?.isPrimary ?? false;
  }
  getCoalescedEvents() {
    return [];
  }
  getPredictedEvents() {
    return [];
  }
  get [Symbol.toStringTag]() {
    return "PointerEvent";
  }
};
var KeyboardEvent = class extends UIEvent {
  altKey;
  code;
  ctrlKey;
  isComposing;
  key;
  location;
  metaKey;
  repeat;
  shiftKey;
  keyCode;
  which;
  static DOM_KEY_LOCATION_STANDARD = 0;
  static DOM_KEY_LOCATION_LEFT = 1;
  static DOM_KEY_LOCATION_RIGHT = 2;
  static DOM_KEY_LOCATION_NUMPAD = 3;
  constructor(type, eventInitDict) {
    super(type, eventInitDict);
    this.altKey = eventInitDict?.altKey ?? false;
    this.code = eventInitDict?.code ?? "";
    this.ctrlKey = eventInitDict?.ctrlKey ?? false;
    this.isComposing = eventInitDict?.isComposing ?? false;
    this.key = eventInitDict?.key ?? "";
    this.location = eventInitDict?.location ?? 0;
    this.metaKey = eventInitDict?.metaKey ?? false;
    this.repeat = eventInitDict?.repeat ?? false;
    this.shiftKey = eventInitDict?.shiftKey ?? false;
    this.keyCode = eventInitDict?.keyCode ?? 0;
    this.which = eventInitDict?.which ?? 0;
  }
  getModifierState(key) {
    switch (key) {
      case "Alt":
        return this.altKey;
      case "Control":
        return this.ctrlKey;
      case "Meta":
        return this.metaKey;
      case "Shift":
        return this.shiftKey;
      default:
        return false;
    }
  }
  get [Symbol.toStringTag]() {
    return "KeyboardEvent";
  }
};
var WheelEvent = class extends MouseEvent {
  deltaX;
  deltaY;
  deltaZ;
  deltaMode;
  static DOM_DELTA_PIXEL = 0;
  static DOM_DELTA_LINE = 1;
  static DOM_DELTA_PAGE = 2;
  constructor(type, eventInitDict) {
    super(type, eventInitDict);
    this.deltaX = eventInitDict?.deltaX ?? 0;
    this.deltaY = eventInitDict?.deltaY ?? 0;
    this.deltaZ = eventInitDict?.deltaZ ?? 0;
    this.deltaMode = eventInitDict?.deltaMode ?? 0;
  }
  get [Symbol.toStringTag]() {
    return "WheelEvent";
  }
};
var FocusEvent = class extends UIEvent {
  relatedTarget;
  constructor(type, eventInitDict) {
    super(type, eventInitDict);
    this.relatedTarget = eventInitDict?.relatedTarget ?? null;
  }
  get [Symbol.toStringTag]() {
    return "FocusEvent";
  }
};

// ../dom-elements/lib/esm/node-type.js
init_console_gjs();
var NodeType = {
  ELEMENT_NODE: 1,
  ATTRIBUTE_NODE: 2,
  TEXT_NODE: 3,
  CDATA_SECTION_NODE: 4,
  PROCESSING_INSTRUCTION_NODE: 7,
  COMMENT_NODE: 8,
  DOCUMENT_NODE: 9,
  DOCUMENT_TYPE_NODE: 10,
  DOCUMENT_FRAGMENT_NODE: 11
};

// ../dom-elements/lib/esm/node.js
var _a;
var _b;
var _c;
var _d;
var _e;
var Node = class _Node extends EventTarget {
  constructor() {
    super(...arguments);
    this.ELEMENT_NODE = NodeType.ELEMENT_NODE;
    this.ATTRIBUTE_NODE = NodeType.ATTRIBUTE_NODE;
    this.TEXT_NODE = NodeType.TEXT_NODE;
    this.CDATA_SECTION_NODE = NodeType.CDATA_SECTION_NODE;
    this.PROCESSING_INSTRUCTION_NODE = NodeType.PROCESSING_INSTRUCTION_NODE;
    this.COMMENT_NODE = NodeType.COMMENT_NODE;
    this.DOCUMENT_NODE = NodeType.DOCUMENT_NODE;
    this.DOCUMENT_TYPE_NODE = NodeType.DOCUMENT_TYPE_NODE;
    this.DOCUMENT_FRAGMENT_NODE = NodeType.DOCUMENT_FRAGMENT_NODE;
    this[_e] = NodeType.ELEMENT_NODE;
    this[_d] = null;
    this[_c] = [];
    this[_b] = [];
    this[_a] = false;
  }
  static {
    this.ELEMENT_NODE = NodeType.ELEMENT_NODE;
  }
  static {
    this.ATTRIBUTE_NODE = NodeType.ATTRIBUTE_NODE;
  }
  static {
    this.TEXT_NODE = NodeType.TEXT_NODE;
  }
  static {
    this.CDATA_SECTION_NODE = NodeType.CDATA_SECTION_NODE;
  }
  static {
    this.PROCESSING_INSTRUCTION_NODE = NodeType.PROCESSING_INSTRUCTION_NODE;
  }
  static {
    this.COMMENT_NODE = NodeType.COMMENT_NODE;
  }
  static {
    this.DOCUMENT_NODE = NodeType.DOCUMENT_NODE;
  }
  static {
    this.DOCUMENT_TYPE_NODE = NodeType.DOCUMENT_TYPE_NODE;
  }
  static {
    this.DOCUMENT_FRAGMENT_NODE = NodeType.DOCUMENT_FRAGMENT_NODE;
  }
  static {
    this.DOCUMENT_POSITION_DISCONNECTED = 1;
  }
  static {
    this.DOCUMENT_POSITION_PRECEDING = 2;
  }
  static {
    this.DOCUMENT_POSITION_FOLLOWING = 4;
  }
  static {
    this.DOCUMENT_POSITION_CONTAINS = 8;
  }
  static {
    this.DOCUMENT_POSITION_CONTAINED_BY = 16;
  }
  static {
    this.DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC = 32;
  }
  get nodeType() {
    return this[nodeType];
  }
  get nodeName() {
    return "";
  }
  get parentNode() {
    return this[parentNode];
  }
  get parentElement() {
    const parent = this[parentNode];
    return parent && parent[nodeType] === NodeType.ELEMENT_NODE ? parent : null;
  }
  get childNodes() {
    return new NodeList(this[childNodesList]);
  }
  get firstChild() {
    return this[childNodesList][0] ?? null;
  }
  get lastChild() {
    const children = this[childNodesList];
    return children[children.length - 1] ?? null;
  }
  get previousSibling() {
    const parent = this[parentNode];
    if (!parent) return null;
    const siblings = parent[childNodesList];
    const idx = siblings.indexOf(this);
    return idx > 0 ? siblings[idx - 1] : null;
  }
  get nextSibling() {
    const parent = this[parentNode];
    if (!parent) return null;
    const siblings = parent[childNodesList];
    const idx = siblings.indexOf(this);
    return idx !== -1 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
  }
  get textContent() {
    return null;
  }
  set textContent(_value) {
  }
  get nodeValue() {
    return null;
  }
  set nodeValue(_value) {
  }
  get ownerDocument() {
    let root = this;
    while (root[parentNode]) {
      root = root[parentNode];
    }
    const doc = globalThis.document;
    return root === doc ? doc : null;
  }
  get isConnected() {
    return this[isConnected];
  }
  hasChildNodes() {
    return this[childNodesList].length > 0;
  }
  contains(other) {
    if (other === null) return false;
    if (other === this) return true;
    let node = other;
    while (node) {
      if (node === this) return true;
      node = node[parentNode];
    }
    return false;
  }
  getRootNode() {
    let node = this;
    while (node[parentNode]) {
      node = node[parentNode];
    }
    return node;
  }
  appendChild(node) {
    if (node[parentNode]) {
      node[parentNode].removeChild(node);
    }
    node[parentNode] = this;
    this[childNodesList].push(node);
    if (node[nodeType] === NodeType.ELEMENT_NODE) {
      this[elementChildren].push(node);
    }
    return node;
  }
  removeChild(node) {
    const children = this[childNodesList];
    const idx = children.indexOf(node);
    if (idx === -1) {
      throw new DOMException(
        "Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.",
        "NotFoundError"
      );
    }
    children.splice(idx, 1);
    node[parentNode] = null;
    if (node[nodeType] === NodeType.ELEMENT_NODE) {
      const elemIdx = this[elementChildren].indexOf(node);
      if (elemIdx !== -1) {
        this[elementChildren].splice(elemIdx, 1);
      }
    }
    return node;
  }
  insertBefore(newNode, referenceNode) {
    if (referenceNode === null) {
      return this.appendChild(newNode);
    }
    const children = this[childNodesList];
    const refIdx = children.indexOf(referenceNode);
    if (refIdx === -1) {
      throw new DOMException(
        "Failed to execute 'insertBefore' on 'Node': The node before which the new node is to be inserted is not a child of this node.",
        "NotFoundError"
      );
    }
    if (newNode[parentNode]) {
      newNode[parentNode].removeChild(newNode);
    }
    newNode[parentNode] = this;
    children.splice(refIdx, 0, newNode);
    if (newNode[nodeType] === NodeType.ELEMENT_NODE) {
      const elemChildren = this[elementChildren];
      let elemIdx = elemChildren.length;
      for (let i = refIdx; i < children.length; i++) {
        if (children[i][nodeType] === NodeType.ELEMENT_NODE && children[i] !== newNode) {
          elemIdx = elemChildren.indexOf(children[i]);
          break;
        }
      }
      elemChildren.splice(elemIdx, 0, newNode);
    }
    return newNode;
  }
  replaceChild(newChild, oldChild) {
    this.insertBefore(newChild, oldChild);
    this.removeChild(oldChild);
    return oldChild;
  }
  cloneNode(deep = false) {
    const clone2 = new this.constructor();
    clone2[nodeType] = this[nodeType];
    if (deep) {
      for (const child of this[childNodesList]) {
        clone2.appendChild(child.cloneNode(true));
      }
    }
    return clone2;
  }
  /**
   * Override dispatchEvent to support event bubbling through the DOM tree.
   * After AT_TARGET phase, if event.bubbles is true, walk up the parentNode
   * chain and dispatch on each ancestor (BUBBLING_PHASE).
   */
  dispatchEvent(event) {
    const result = super.dispatchEvent(event);
    if (event.bubbles && !event.cancelBubble) {
      let parent = this[parentNode];
      while (parent) {
        Object.getPrototypeOf(_Node.prototype).dispatchEvent.call(parent, event);
        if (event.cancelBubble) break;
        parent = parent[parentNode];
      }
    }
    return result;
  }
  get [(_e = nodeType, _d = parentNode, _c = childNodesList, _b = elementChildren, _a = isConnected, Symbol.toStringTag)]() {
    return "Node";
  }
};

// ../dom-elements/lib/esm/character-data.js
init_console_gjs();
var CharacterData = class extends Node {
  constructor(data = "") {
    super();
    this[nodeType] = NodeType.TEXT_NODE;
    this._data = data;
  }
  get data() {
    return this._data;
  }
  set data(value2) {
    this._data = value2;
  }
  get textContent() {
    return this._data;
  }
  set textContent(value2) {
    this._data = value2;
  }
  get nodeValue() {
    return this._data;
  }
  set nodeValue(value2) {
    this._data = value2;
  }
  get length() {
    return this._data.length;
  }
  appendData(data) {
    this._data += data;
  }
  deleteData(offset, count2) {
    this._data = this._data.substring(0, offset) + this._data.substring(offset + count2);
  }
  insertData(offset, data) {
    this._data = this._data.substring(0, offset) + data + this._data.substring(offset);
  }
  replaceData(offset, count2, data) {
    this._data = this._data.substring(0, offset) + data + this._data.substring(offset + count2);
  }
  substringData(offset, count2) {
    return this._data.substring(offset, offset + count2);
  }
  cloneNode(_deep = false) {
    const clone2 = new this.constructor(this._data);
    return clone2;
  }
  get [Symbol.toStringTag]() {
    return "CharacterData";
  }
};

// ../dom-elements/lib/esm/text.js
init_console_gjs();
var Text = class _Text extends CharacterData {
  constructor(data = "") {
    super(data);
    this[nodeType] = NodeType.TEXT_NODE;
  }
  get nodeName() {
    return "#text";
  }
  /**
   * Returns the combined text of this node and all adjacent Text siblings.
   */
  get wholeText() {
    let text = this.data;
    let prev = this.previousSibling;
    while (prev && prev instanceof _Text) {
      text = prev.data + text;
      prev = prev.previousSibling;
    }
    let next = this.nextSibling;
    while (next && next instanceof _Text) {
      text += next.data;
      next = next.nextSibling;
    }
    return text;
  }
  /**
   * Splits the text node at the given offset, returning the new Text node
   * containing the text after the offset.
   */
  splitText(offset) {
    const newData = this.data.substring(offset);
    this.data = this.data.substring(0, offset);
    const newNode = new _Text(newData);
    if (this.parentNode) {
      this.parentNode.insertBefore(newNode, this.nextSibling);
    }
    return newNode;
  }
  cloneNode(_deep = false) {
    return new _Text(this.data);
  }
  get [Symbol.toStringTag]() {
    return "Text";
  }
};

// ../dom-elements/lib/esm/comment.js
init_console_gjs();
var Comment = class _Comment extends CharacterData {
  constructor(data = "") {
    super(data);
    this[nodeType] = NodeType.COMMENT_NODE;
  }
  get nodeName() {
    return "#comment";
  }
  cloneNode(_deep = false) {
    return new _Comment(this.data);
  }
  get [Symbol.toStringTag]() {
    return "Comment";
  }
};

// ../dom-elements/lib/esm/document-fragment.js
init_console_gjs();
var DocumentFragment = class _DocumentFragment extends Node {
  constructor() {
    super();
    this[nodeType] = NodeType.DOCUMENT_FRAGMENT_NODE;
  }
  get nodeName() {
    return "#document-fragment";
  }
  /** Element children only (excludes text/comment nodes) */
  get children() {
    return this[elementChildren];
  }
  get childElementCount() {
    return this[elementChildren].length;
  }
  get firstElementChild() {
    return this[elementChildren][0] ?? null;
  }
  get lastElementChild() {
    const children = this[elementChildren];
    return children[children.length - 1] ?? null;
  }
  get textContent() {
    let text = "";
    for (const child of this.childNodes) {
      if (child.textContent !== null) {
        text += child.textContent;
      }
    }
    return text;
  }
  set textContent(value2) {
    while (this.firstChild) {
      this.removeChild(this.firstChild);
    }
    if (value2) {
      this.appendChild(new Text(value2));
    }
  }
  /**
   * Append nodes or strings to this fragment.
   */
  append(...nodes) {
    for (const node of nodes) {
      if (typeof node === "string") {
        this.appendChild(new Text(node));
      } else {
        this.appendChild(node);
      }
    }
  }
  /**
   * Prepend nodes or strings to this fragment.
   */
  prepend(...nodes) {
    const firstChild = this.firstChild;
    for (const node of nodes) {
      if (typeof node === "string") {
        this.insertBefore(new Text(node), firstChild);
      } else {
        this.insertBefore(node, firstChild);
      }
    }
  }
  /**
   * Replace all children with the given nodes.
   */
  replaceChildren(...nodes) {
    while (this.firstChild) {
      this.removeChild(this.firstChild);
    }
    this.append(...nodes);
  }
  /**
   * Find an element by ID in this fragment's children.
   */
  getElementById(id) {
    for (const child of this.children) {
      if (child.id === id) return child;
      const found = this._findById(child, id);
      if (found) return found;
    }
    return null;
  }
  _findById(element, id) {
    for (const child of element.children) {
      if (child.id === id) return child;
      const found = this._findById(child, id);
      if (found) return found;
    }
    return null;
  }
  cloneNode(deep = false) {
    const clone2 = new _DocumentFragment();
    if (deep) {
      for (const child of this.childNodes) {
        clone2.appendChild(child.cloneNode(true));
      }
    }
    return clone2;
  }
  get [Symbol.toStringTag]() {
    return "DocumentFragment";
  }
};

// ../dom-elements/lib/esm/dom-token-list.js
init_console_gjs();
var DOMTokenList = class {
  constructor(ownerElement2, attributeName) {
    this._ownerElement = ownerElement2;
    this._attributeName = attributeName;
  }
  _getTokens() {
    const value2 = this._ownerElement.getAttribute(this._attributeName);
    if (!value2) return [];
    return value2.split(/\s+/).filter((t) => t.length > 0);
  }
  _setTokens(tokens) {
    const value2 = tokens.join(" ");
    if (value2) {
      this._ownerElement.setAttribute(this._attributeName, value2);
    } else {
      this._ownerElement.removeAttribute(this._attributeName);
    }
  }
  get length() {
    return this._getTokens().length;
  }
  get value() {
    return this._ownerElement.getAttribute(this._attributeName) ?? "";
  }
  set value(val) {
    if (val) {
      this._ownerElement.setAttribute(this._attributeName, val);
    } else {
      this._ownerElement.removeAttribute(this._attributeName);
    }
  }
  item(index) {
    const tokens = this._getTokens();
    return index >= 0 && index < tokens.length ? tokens[index] : null;
  }
  contains(token) {
    return this._getTokens().includes(token);
  }
  add(...tokens) {
    const current = this._getTokens();
    for (const token of tokens) {
      if (token && !current.includes(token)) {
        current.push(token);
      }
    }
    this._setTokens(current);
  }
  remove(...tokens) {
    const current = this._getTokens().filter((t) => !tokens.includes(t));
    this._setTokens(current);
  }
  toggle(token, force) {
    const has = this.contains(token);
    if (force !== void 0) {
      if (force) {
        this.add(token);
        return true;
      } else {
        this.remove(token);
        return false;
      }
    }
    if (has) {
      this.remove(token);
      return false;
    } else {
      this.add(token);
      return true;
    }
  }
  replace(token, newToken) {
    const tokens = this._getTokens();
    const idx = tokens.indexOf(token);
    if (idx === -1) return false;
    tokens[idx] = newToken;
    this._setTokens(tokens);
    return true;
  }
  supports(_token) {
    return true;
  }
  forEach(callback) {
    const tokens = this._getTokens();
    for (let i = 0; i < tokens.length; i++) {
      callback(tokens[i], i, this);
    }
  }
  keys() {
    return this._getTokens().keys();
  }
  values() {
    return this._getTokens().values();
  }
  entries() {
    return this._getTokens().entries();
  }
  [Symbol.iterator]() {
    return this._getTokens().values();
  }
  toString() {
    return this.value;
  }
  get [Symbol.toStringTag]() {
    return "DOMTokenList";
  }
};

// ../dom-elements/lib/esm/element.js
init_console_gjs();
var _a2;
var _b2;
var _c2;
var _d2;
var _e2;
var _f;
var Element = class extends Node {
  constructor() {
    super();
    this[_f] = "";
    this[_e2] = "";
    this[_d2] = NamespaceURI.html;
    this[_c2] = null;
    this[_b2] = new NamedNodeMap(this);
    this[_a2] = /* @__PURE__ */ new Map();
    this._pointerCaptures = /* @__PURE__ */ new Set();
    this[nodeType] = NodeType.ELEMENT_NODE;
  }
  get tagName() {
    return this[tagName];
  }
  get localName() {
    return this[localName];
  }
  get namespaceURI() {
    return this[namespaceURI];
  }
  get prefix() {
    return this[prefix];
  }
  get nodeName() {
    return this[tagName];
  }
  get attributes() {
    return this[attributes];
  }
  get id() {
    return this.getAttribute("id") ?? "";
  }
  set id(value2) {
    this.setAttribute("id", value2);
  }
  get className() {
    return this.getAttribute("class") ?? "";
  }
  set className(value2) {
    this.setAttribute("class", value2);
  }
  get children() {
    return this[elementChildren];
  }
  get childElementCount() {
    return this[elementChildren].length;
  }
  get firstElementChild() {
    return this[elementChildren][0] ?? null;
  }
  get lastElementChild() {
    const children = this[elementChildren];
    return children[children.length - 1] ?? null;
  }
  get previousElementSibling() {
    const parent = this[parentNode];
    if (!parent) return null;
    const siblings = parent[elementChildren];
    const idx = siblings.indexOf(this);
    return idx > 0 ? siblings[idx - 1] : null;
  }
  get nextElementSibling() {
    const parent = this[parentNode];
    if (!parent) return null;
    const siblings = parent[elementChildren];
    const idx = siblings.indexOf(this);
    return idx !== -1 && idx < siblings.length - 1 ? siblings[idx + 1] : null;
  }
  get textContent() {
    let text = "";
    for (const child of this[childNodesList]) {
      if (child.textContent !== null) {
        text += child.textContent;
      }
    }
    return text;
  }
  set textContent(_value) {
    const children = this[childNodesList];
    while (children.length > 0) {
      this.removeChild(children[0]);
    }
  }
  // -- Attribute methods --
  getAttribute(qualifiedName) {
    const attr = this[attributes].getNamedItem(qualifiedName);
    return attr ? attr.value : null;
  }
  getAttributeNS(namespace, localName2) {
    const attr = this[attributes].getNamedItemNS(namespace, localName2);
    return attr ? attr.value : null;
  }
  setAttribute(qualifiedName, value2) {
    this[attributes]._setNamedItem(qualifiedName, String(value2));
  }
  setAttributeNS(namespace, qualifiedName, value2) {
    const ns = namespace === "" ? null : namespace;
    const parts = qualifiedName.split(":");
    const prefix2 = parts.length > 1 ? parts[0] : null;
    this[attributes]._setNamedItem(qualifiedName, String(value2), ns, prefix2);
  }
  removeAttribute(qualifiedName) {
    this[attributes]._removeNamedItem(qualifiedName);
  }
  removeAttributeNS(namespace, localName2) {
    const ns = namespace === "" ? null : namespace;
    this[attributes]._removeNamedItemNS(ns, localName2);
  }
  hasAttribute(qualifiedName) {
    return this[attributes].getNamedItem(qualifiedName) !== null;
  }
  hasAttributeNS(namespace, localName2) {
    return this[attributes].getNamedItemNS(namespace, localName2) !== null;
  }
  getAttributeNode(qualifiedName) {
    return this[attributes].getNamedItem(qualifiedName);
  }
  setAttributeNode(attr) {
    return this[attributes].setNamedItem(attr);
  }
  removeAttributeNode(attr) {
    const existing = this[attributes].getNamedItem(attr.name);
    if (!existing) {
      throw new DOMException(
        "Failed to execute 'removeAttributeNode' on 'Element': The attribute is not owned by this element.",
        "NotFoundError"
      );
    }
    this[attributes].removeNamedItem(existing.name);
    return existing;
  }
  toggleAttribute(qualifiedName, force) {
    if (force !== void 0) {
      if (force) {
        this.setAttribute(qualifiedName, "");
        return true;
      }
      this.removeAttribute(qualifiedName);
      return false;
    }
    if (this.hasAttribute(qualifiedName)) {
      this.removeAttribute(qualifiedName);
      return false;
    }
    this.setAttribute(qualifiedName, "");
    return true;
  }
  hasAttributes() {
    return this[attributes].length > 0;
  }
  // -- Override dispatchEvent to call on* property handlers --
  dispatchEvent(event) {
    const result = super.dispatchEvent(event);
    const handler = this[propertyEventListeners].get("on" + event.type);
    if (typeof handler === "function") {
      handler.call(this, event);
    }
    return result;
  }
  // -- Stubs for commonly expected methods --
  querySelector(_selectors) {
    return null;
  }
  querySelectorAll(_selectors) {
    return [];
  }
  matches(_selectors) {
    return false;
  }
  closest(_selectors) {
    return null;
  }
  getElementsByTagName(tagName2) {
    const results = [];
    const upperTag = tagName2.toUpperCase();
    const walk = (node) => {
      for (const child of node[childNodesList]) {
        if (child[nodeType] === NodeType.ELEMENT_NODE) {
          const el = child;
          if (tagName2 === "*" || el[tagName] === upperTag) {
            results.push(el);
          }
          walk(el);
        }
      }
    };
    walk(this);
    return results;
  }
  getElementsByClassName(className) {
    const results = [];
    const targetClasses = className.split(/\s+/).filter(Boolean);
    const walk = (node) => {
      for (const child of node[childNodesList]) {
        if (child[nodeType] === NodeType.ELEMENT_NODE) {
          const el = child;
          const elClasses = el.className.split(/\s+/);
          if (targetClasses.every((c) => elClasses.includes(c))) {
            results.push(el);
          }
          walk(el);
        }
      }
    };
    walk(this);
    return results;
  }
  // -- Clone --
  cloneNode(deep = false) {
    const clone2 = super.cloneNode(false);
    clone2[tagName] = this[tagName];
    clone2[localName] = this[localName];
    clone2[namespaceURI] = this[namespaceURI];
    clone2[prefix] = this[prefix];
    for (const attr of this[attributes]) {
      clone2.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
    }
    if (deep) {
      for (const child of this[childNodesList]) {
        clone2.appendChild(child.cloneNode(true));
      }
    }
    return clone2;
  }
  setPointerCapture(pointerId) {
    this._pointerCaptures.add(pointerId);
  }
  releasePointerCapture(pointerId) {
    this._pointerCaptures.delete(pointerId);
  }
  hasPointerCapture(pointerId) {
    return this._pointerCaptures.has(pointerId);
  }
  get [(_f = tagName, _e2 = localName, _d2 = namespaceURI, _c2 = prefix, _b2 = attributes, _a2 = propertyEventListeners, Symbol.toStringTag)]() {
    return "Element";
  }
};

// ../dom-elements/lib/esm/html-element.js
init_console_gjs();
var CSSStyleDeclaration = class {
  constructor() {
    this.cssText = "";
  }
};
var HTMLElement = class extends Element {
  constructor() {
    super(...arguments);
    this.style = new CSSStyleDeclaration();
  }
  // -- Attribute-backed string properties --
  get title() {
    return this.getAttribute("title") ?? "";
  }
  set title(value2) {
    this.setAttribute("title", value2);
  }
  get lang() {
    return this.getAttribute("lang") ?? "";
  }
  set lang(value2) {
    this.setAttribute("lang", value2);
  }
  get dir() {
    return this.getAttribute("dir") ?? "";
  }
  set dir(value2) {
    this.setAttribute("dir", value2);
  }
  get accessKey() {
    return this.getAttribute("accesskey") ?? "";
  }
  set accessKey(value2) {
    this.setAttribute("accesskey", value2);
  }
  get accessKeyLabel() {
    return this.getAttribute("accesskey") ?? "";
  }
  // -- Attribute-backed boolean properties --
  get hidden() {
    return this.hasAttribute("hidden");
  }
  set hidden(value2) {
    if (value2) {
      this.setAttribute("hidden", "");
    } else {
      this.removeAttribute("hidden");
    }
  }
  get draggable() {
    return this.getAttribute("draggable") === "true";
  }
  set draggable(value2) {
    this.setAttribute("draggable", String(value2));
  }
  get spellcheck() {
    const attr = this.getAttribute("spellcheck");
    if (attr === "false") return false;
    return attr !== null;
  }
  set spellcheck(value2) {
    this.setAttribute("spellcheck", String(value2));
  }
  get translate() {
    const attr = this.getAttribute("translate");
    return attr !== "no";
  }
  set translate(value2) {
    this.setAttribute("translate", value2 ? "yes" : "no");
  }
  // -- Attribute-backed numeric properties --
  get tabIndex() {
    const attr = this.getAttribute("tabindex");
    return attr !== null ? Number(attr) : -1;
  }
  set tabIndex(value2) {
    this.setAttribute("tabindex", String(value2));
  }
  // -- Content editable --
  get contentEditable() {
    const attr = this.getAttribute("contenteditable");
    if (attr === "" || attr === "true") return "true";
    if (attr === "false") return "false";
    return "inherit";
  }
  set contentEditable(value2) {
    if (value2 === "inherit") {
      this.removeAttribute("contenteditable");
    } else {
      this.setAttribute("contenteditable", value2);
    }
  }
  get isContentEditable() {
    return this.contentEditable === "true";
  }
  // -- Layout stubs (return 0 — no layout engine) --
  get offsetHeight() {
    return 0;
  }
  get offsetWidth() {
    return 0;
  }
  get offsetLeft() {
    return 0;
  }
  get offsetTop() {
    return 0;
  }
  get offsetParent() {
    return null;
  }
  get clientHeight() {
    return 0;
  }
  get clientWidth() {
    return 0;
  }
  get clientLeft() {
    return 0;
  }
  get clientTop() {
    return 0;
  }
  get scrollHeight() {
    return 0;
  }
  get scrollWidth() {
    return 0;
  }
  get scrollTop() {
    return 0;
  }
  set scrollTop(_value) {
  }
  get scrollLeft() {
    return 0;
  }
  set scrollLeft(_value) {
  }
  getBoundingClientRect() {
    const w = this.clientWidth;
    const h = this.clientHeight;
    return { x: 0, y: 0, top: 0, left: 0, right: w, bottom: h, width: w, height: h, toJSON() {
      return this;
    } };
  }
  // -- Interaction methods --
  click() {
    this.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
  }
  blur() {
    this.dispatchEvent(new Event("blur"));
  }
  focus() {
    this.dispatchEvent(new Event("focus"));
  }
  // -- on* event handler properties --
  // Following happy-dom pattern: stored in propertyEventListeners Map,
  // dispatched automatically by Element.dispatchEvent override
  get onclick() {
    return this[propertyEventListeners].get("onclick") ?? null;
  }
  set onclick(value2) {
    this[propertyEventListeners].set("onclick", value2);
  }
  get ondblclick() {
    return this[propertyEventListeners].get("ondblclick") ?? null;
  }
  set ondblclick(value2) {
    this[propertyEventListeners].set("ondblclick", value2);
  }
  get onload() {
    return this[propertyEventListeners].get("onload") ?? null;
  }
  set onload(value2) {
    this[propertyEventListeners].set("onload", value2);
  }
  get onerror() {
    return this[propertyEventListeners].get("onerror") ?? null;
  }
  set onerror(value2) {
    this[propertyEventListeners].set("onerror", value2);
  }
  get onabort() {
    return this[propertyEventListeners].get("onabort") ?? null;
  }
  set onabort(value2) {
    this[propertyEventListeners].set("onabort", value2);
  }
  get onfocus() {
    return this[propertyEventListeners].get("onfocus") ?? null;
  }
  set onfocus(value2) {
    this[propertyEventListeners].set("onfocus", value2);
  }
  get onblur() {
    return this[propertyEventListeners].get("onblur") ?? null;
  }
  set onblur(value2) {
    this[propertyEventListeners].set("onblur", value2);
  }
  get onchange() {
    return this[propertyEventListeners].get("onchange") ?? null;
  }
  set onchange(value2) {
    this[propertyEventListeners].set("onchange", value2);
  }
  get oninput() {
    return this[propertyEventListeners].get("oninput") ?? null;
  }
  set oninput(value2) {
    this[propertyEventListeners].set("oninput", value2);
  }
  get onsubmit() {
    return this[propertyEventListeners].get("onsubmit") ?? null;
  }
  set onsubmit(value2) {
    this[propertyEventListeners].set("onsubmit", value2);
  }
  get onreset() {
    return this[propertyEventListeners].get("onreset") ?? null;
  }
  set onreset(value2) {
    this[propertyEventListeners].set("onreset", value2);
  }
  get onscroll() {
    return this[propertyEventListeners].get("onscroll") ?? null;
  }
  set onscroll(value2) {
    this[propertyEventListeners].set("onscroll", value2);
  }
  get onresize() {
    return this[propertyEventListeners].get("onresize") ?? null;
  }
  set onresize(value2) {
    this[propertyEventListeners].set("onresize", value2);
  }
  // Mouse events
  get onmousedown() {
    return this[propertyEventListeners].get("onmousedown") ?? null;
  }
  set onmousedown(value2) {
    this[propertyEventListeners].set("onmousedown", value2);
  }
  get onmouseup() {
    return this[propertyEventListeners].get("onmouseup") ?? null;
  }
  set onmouseup(value2) {
    this[propertyEventListeners].set("onmouseup", value2);
  }
  get onmousemove() {
    return this[propertyEventListeners].get("onmousemove") ?? null;
  }
  set onmousemove(value2) {
    this[propertyEventListeners].set("onmousemove", value2);
  }
  get onmouseover() {
    return this[propertyEventListeners].get("onmouseover") ?? null;
  }
  set onmouseover(value2) {
    this[propertyEventListeners].set("onmouseover", value2);
  }
  get onmouseout() {
    return this[propertyEventListeners].get("onmouseout") ?? null;
  }
  set onmouseout(value2) {
    this[propertyEventListeners].set("onmouseout", value2);
  }
  get onmouseenter() {
    return this[propertyEventListeners].get("onmouseenter") ?? null;
  }
  set onmouseenter(value2) {
    this[propertyEventListeners].set("onmouseenter", value2);
  }
  get onmouseleave() {
    return this[propertyEventListeners].get("onmouseleave") ?? null;
  }
  set onmouseleave(value2) {
    this[propertyEventListeners].set("onmouseleave", value2);
  }
  get oncontextmenu() {
    return this[propertyEventListeners].get("oncontextmenu") ?? null;
  }
  set oncontextmenu(value2) {
    this[propertyEventListeners].set("oncontextmenu", value2);
  }
  // Keyboard events
  get onkeydown() {
    return this[propertyEventListeners].get("onkeydown") ?? null;
  }
  set onkeydown(value2) {
    this[propertyEventListeners].set("onkeydown", value2);
  }
  get onkeyup() {
    return this[propertyEventListeners].get("onkeyup") ?? null;
  }
  set onkeyup(value2) {
    this[propertyEventListeners].set("onkeyup", value2);
  }
  // Touch events
  get ontouchstart() {
    return this[propertyEventListeners].get("ontouchstart") ?? null;
  }
  set ontouchstart(value2) {
    this[propertyEventListeners].set("ontouchstart", value2);
  }
  get ontouchend() {
    return this[propertyEventListeners].get("ontouchend") ?? null;
  }
  set ontouchend(value2) {
    this[propertyEventListeners].set("ontouchend", value2);
  }
  get ontouchmove() {
    return this[propertyEventListeners].get("ontouchmove") ?? null;
  }
  set ontouchmove(value2) {
    this[propertyEventListeners].set("ontouchmove", value2);
  }
  // Pointer events
  get onpointerdown() {
    return this[propertyEventListeners].get("onpointerdown") ?? null;
  }
  set onpointerdown(value2) {
    this[propertyEventListeners].set("onpointerdown", value2);
  }
  get onpointerup() {
    return this[propertyEventListeners].get("onpointerup") ?? null;
  }
  set onpointerup(value2) {
    this[propertyEventListeners].set("onpointerup", value2);
  }
  get onpointermove() {
    return this[propertyEventListeners].get("onpointermove") ?? null;
  }
  set onpointermove(value2) {
    this[propertyEventListeners].set("onpointermove", value2);
  }
  // -- Clone --
  cloneNode(deep = false) {
    return super.cloneNode(deep);
  }
  get [Symbol.toStringTag]() {
    return "HTMLElement";
  }
};

// ../dom-elements/lib/esm/html-canvas-element.js
init_console_gjs();
var HTMLCanvasElement = class _HTMLCanvasElement extends HTMLElement {
  constructor() {
    super(...arguments);
    this.oncontextlost = null;
    this.oncontextrestored = null;
    this.onwebglcontextcreationerror = null;
    this.onwebglcontextlost = null;
    this.onwebglcontextrestored = null;
  }
  static {
    this._contextFactories = /* @__PURE__ */ new Map();
  }
  /**
   * Register a rendering context factory for a given context type.
   * Called by packages like @gjsify/canvas2d and @gjsify/webgl to plug in their implementations.
   */
  static registerContextFactory(contextId, factory) {
    _HTMLCanvasElement._contextFactories.set(contextId, factory);
  }
  /** Returns the width of the canvas element. Default: 300. */
  get width() {
    const w = this.getAttribute("width");
    return w !== null ? Number(w) : 300;
  }
  set width(value2) {
    this.setAttribute("width", String(value2));
  }
  /** Returns the height of the canvas element. Default: 150. */
  get height() {
    const h = this.getAttribute("height");
    return h !== null ? Number(h) : 150;
  }
  set height(value2) {
    this.setAttribute("height", String(value2));
  }
  /**
   * Returns a rendering context.
   * Checks the static context factory registry for a matching factory.
   * Subclasses (e.g. @gjsify/webgl) may override and fall through via super.getContext().
   */
  getContext(contextId, options) {
    const factory = _HTMLCanvasElement._contextFactories.get(contextId);
    if (factory) return factory(this, options);
    return null;
  }
  /** Returns a data URL representing the canvas image. Stub — returns empty string. */
  toDataURL(_type, _quality) {
    return "";
  }
  /** Converts the canvas to a Blob and passes it to the callback. Stub — returns empty Blob. */
  toBlob(callback, _type, _quality) {
    callback(new Blob([]));
  }
  /** Returns a MediaStream capturing the canvas. Stub — returns empty object. */
  captureStream(_frameRequestRate) {
    return {};
  }
};

// ../dom-elements/lib/esm/html-image-element.js
init_console_gjs();
init_glib_2();

// ../../../node_modules/@girs/gdkpixbuf-2.0/index.js
init_console_gjs();

// ../../../node_modules/@girs/gdkpixbuf-2.0/gdkpixbuf-2.0.js
init_console_gjs();
import GdkPixbuf from "gi://GdkPixbuf?version=2.0";
var gdkpixbuf_2_0_default = GdkPixbuf;

// ../../../node_modules/@girs/gdkpixbuf-2.0/index.js
var gdkpixbuf_2_default = gdkpixbuf_2_0_default;

// ../dom-elements/lib/esm/html-image-element.js
import System from "system";
var HTMLImageElement = class extends HTMLElement {
  constructor() {
    super();
    this._complete = false;
    this._naturalHeight = 0;
    this._naturalWidth = 0;
    this[tagName] = "IMG";
    this[localName] = "img";
    this[namespaceURI] = NamespaceURI.html;
  }
  // -- Read-only properties --
  get complete() {
    return this._complete;
  }
  get naturalHeight() {
    return this._naturalHeight;
  }
  get naturalWidth() {
    return this._naturalWidth;
  }
  get currentSrc() {
    return this.src;
  }
  get x() {
    return 0;
  }
  get y() {
    return 0;
  }
  // -- Attribute-backed string properties --
  get alt() {
    return this.getAttribute("alt") ?? "";
  }
  set alt(value2) {
    this.setAttribute("alt", value2);
  }
  get crossOrigin() {
    return this.getAttribute("crossorigin");
  }
  set crossOrigin(value2) {
    if (value2 === null) {
      this.removeAttribute("crossorigin");
    } else {
      this.setAttribute("crossorigin", value2);
    }
  }
  get decoding() {
    return this.getAttribute("decoding") ?? "auto";
  }
  set decoding(value2) {
    this.setAttribute("decoding", value2);
  }
  get loading() {
    const value2 = this.getAttribute("loading");
    if (value2 === "lazy" || value2 === "eager") return value2;
    return "auto";
  }
  set loading(value2) {
    this.setAttribute("loading", value2);
  }
  get referrerPolicy() {
    return this.getAttribute("referrerpolicy") ?? "";
  }
  set referrerPolicy(value2) {
    this.setAttribute("referrerpolicy", value2);
  }
  get sizes() {
    return this.getAttribute("sizes") ?? "";
  }
  set sizes(value2) {
    this.setAttribute("sizes", value2);
  }
  get src() {
    return this.getAttribute("src") ?? "";
  }
  set src(src) {
    this.setAttribute("src", src);
    let filename;
    if (src.startsWith("file://")) {
      filename = glib_2_default.filename_from_uri(src)[0];
    } else if (src.startsWith("http://") || src.startsWith("https://") || src.startsWith("data:")) {
      this._complete = true;
      this.dispatchEvent(new Event("error"));
      return;
    } else {
      const dir2 = glib_2_default.path_get_dirname(System.programInvocationName);
      filename = glib_2_default.build_filenamev([dir2, src]);
    }
    try {
      this._pixbuf = gdkpixbuf_2_default.Pixbuf.new_from_file(filename);
      this._naturalWidth = this._pixbuf.get_width();
      this._naturalHeight = this._pixbuf.get_height();
      this._complete = true;
      this.dispatchEvent(new Event("load"));
    } catch (_error) {
      this._complete = true;
      this.dispatchEvent(new Event("error"));
    }
  }
  get srcset() {
    return this.getAttribute("srcset") ?? "";
  }
  set srcset(value2) {
    this.setAttribute("srcset", value2);
  }
  get useMap() {
    return this.getAttribute("usemap") ?? "";
  }
  set useMap(value2) {
    this.setAttribute("usemap", value2);
  }
  // -- Attribute-backed numeric properties --
  get height() {
    if (this._pixbuf) {
      return this._pixbuf.get_height();
    }
    const attr = this.getAttribute("height");
    return attr !== null ? Number(attr) : 0;
  }
  set height(value2) {
    this.setAttribute("height", String(value2));
  }
  get width() {
    if (this._pixbuf) {
      return this._pixbuf.get_width();
    }
    const attr = this.getAttribute("width");
    return attr !== null ? Number(attr) : 0;
  }
  set width(value2) {
    this.setAttribute("width", String(value2));
  }
  // -- Attribute-backed boolean property --
  get isMap() {
    return this.hasAttribute("ismap");
  }
  set isMap(value2) {
    if (value2) {
      this.setAttribute("ismap", "");
    } else {
      this.removeAttribute("ismap");
    }
  }
  // -- Methods --
  /**
   * Decode the image. Returns a promise that resolves when the image is decoded.
   */
  decode() {
    return Promise.resolve();
  }
  /**
   * Clone this node.
   */
  cloneNode(deep = false) {
    return super.cloneNode(deep);
  }
  // -- GJS-specific extensions --
  /**
   * Get the pixels of the loaded GdkPixbuf as ImageData.
   * Always returns RGBA (4 channels) — matches standard browser ImageData behaviour
   * and what WebGL expects for texSubImage2D with format=RGBA.
   * JPEG and other non-alpha formats are promoted to RGBA via add_alpha().
   */
  getImageData() {
    if (!this._pixbuf) return null;
    const rgba = this._pixbuf.get_has_alpha() ? this._pixbuf : this._pixbuf.add_alpha(false, 0, 0, 0) ?? this._pixbuf;
    return {
      colorSpace: "srgb",
      data: new Uint8ClampedArray(rgba.get_pixels()),
      height: rgba.get_height(),
      width: rgba.get_width()
    };
  }
  /**
   * Check if this image is backed by a GdkPixbuf.
   */
  isPixbuf() {
    return !!this._pixbuf;
  }
  get [Symbol.toStringTag]() {
    return "HTMLImageElement";
  }
};

// ../dom-elements/lib/esm/image.js
init_console_gjs();
var Image = class extends HTMLImageElement {
  /**
   * Constructor.
   *
   * @param [width] Width.
   * @param [height] Height.
   */
  constructor(width = null, height = null) {
    super();
    if (width !== null) {
      this.width = width;
    }
    if (height !== null) {
      this.height = height;
    }
  }
};

// ../dom-elements/lib/esm/document.js
init_console_gjs();
var Document = class _Document extends Node {
  constructor() {
    super();
    this.body = new HTMLElement();
    this.head = new HTMLElement();
    this.documentElement = new HTMLElement();
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.body);
  }
  static {
    this._elementFactories = /* @__PURE__ */ new Map();
  }
  /**
   * Register a factory for a custom element tag name.
   * Called as a side-effect by DOM packages to avoid circular dependencies.
   *
   * Example: `Document.registerElementFactory('iframe', () => new HTMLIFrameElement())`
   */
  static registerElementFactory(tagName2, factory) {
    _Document._elementFactories.set(tagName2.toLowerCase(), factory);
  }
  createElementNS(_namespace, tagName2) {
    const tag = tagName2.toLowerCase();
    switch (tag) {
      case "img":
        return new HTMLImageElement();
      case "canvas":
        return new HTMLCanvasElement();
      default: {
        const factory = _Document._elementFactories.get(tag);
        if (factory) return factory();
        return new HTMLElement();
      }
    }
  }
  createElement(tagName2) {
    return this.createElementNS("http://www.w3.org/1999/xhtml", tagName2);
  }
  createTextNode(data) {
    return new Text(data);
  }
  createComment(data) {
    return new Comment(data);
  }
  createDocumentFragment() {
    return new DocumentFragment();
  }
  createEvent(type) {
    return new Event(type);
  }
  /**
   * Find an element by ID. Searches body's descendants.
   */
  getElementById(id) {
    return this._findById(this.body, id);
  }
  _findById(element, id) {
    if (element.id === id) return element;
    for (const child of element.children) {
      const found = this._findById(child, id);
      if (found) return found;
    }
    return null;
  }
  get [Symbol.toStringTag]() {
    return "Document";
  }
};
var document2 = new Document();

// ../dom-elements/lib/esm/mutation-observer.js
init_console_gjs();
var MutationObserver = class {
  constructor(_callback) {
  }
  observe(_target, _options) {
  }
  disconnect() {
  }
  takeRecords() {
    return [];
  }
};

// ../dom-elements/lib/esm/resize-observer.js
init_console_gjs();
var ResizeObserver = class {
  constructor(_callback) {
  }
  observe(_target) {
  }
  unobserve(_target) {
  }
  disconnect() {
  }
};

// ../dom-elements/lib/esm/intersection-observer.js
init_console_gjs();
var IntersectionObserver = class {
  constructor(_callback, options) {
    this.root = options?.root ?? null;
    this.rootMargin = options?.rootMargin ?? "0px";
    this.thresholds = Array.isArray(options?.threshold) ? options.threshold : [options?.threshold ?? 0];
  }
  observe(_target) {
  }
  unobserve(_target) {
  }
  disconnect() {
  }
  takeRecords() {
    return [];
  }
};

// ../../web/abort-controller/lib/esm/index.js
init_console_gjs();
var kAbort = /* @__PURE__ */ Symbol("abort");
var kInternal = /* @__PURE__ */ Symbol("internal");
var AbortSignal2 = class _AbortSignal extends EventTarget {
  #aborted = false;
  reason = void 0;
  onabort = null;
  constructor(key) {
    super();
    if (key !== kInternal) {
      throw new TypeError("Illegal constructor.");
    }
  }
  get aborted() {
    if (!(this instanceof _AbortSignal)) {
      throw new TypeError("'get aborted' called on an object that is not a valid instance of AbortSignal.");
    }
    return this.#aborted;
  }
  get [Symbol.toStringTag]() {
    return "AbortSignal";
  }
  throwIfAborted() {
    if (this.#aborted) {
      throw this.reason;
    }
  }
  [kAbort](reason) {
    if (this.#aborted) return;
    this.#aborted = true;
    this.reason = reason ?? new DOMException2("The operation was aborted.", "AbortError");
    const event = new Event("abort");
    if (typeof this.onabort === "function") {
      this.onabort.call(this, event);
    }
    this.dispatchEvent(event);
  }
  static abort(reason) {
    const signal = new _AbortSignal(kInternal);
    signal[kAbort](reason);
    return signal;
  }
  static timeout(milliseconds) {
    const signal = new _AbortSignal(kInternal);
    setTimeout(() => {
      signal[kAbort](new DOMException2("The operation timed out.", "TimeoutError"));
    }, milliseconds);
    return signal;
  }
  static any(signals) {
    const combined = new _AbortSignal(kInternal);
    for (const signal of signals) {
      if (signal.aborted) {
        combined[kAbort](signal.reason);
        return combined;
      }
    }
    const onAbort = () => {
      if (!combined.aborted) {
        const aborted = signals.find((s) => s.aborted);
        combined[kAbort](aborted?.reason);
      }
    };
    for (const signal of signals) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    return combined;
  }
};
var AbortController = class _AbortController {
  signal;
  constructor() {
    this.signal = new AbortSignal2(kInternal);
  }
  abort(reason) {
    if (!(this instanceof _AbortController)) {
      throw new TypeError("'abort' called on an object that is not a valid instance of AbortController.");
    }
    this.signal[kAbort](reason);
  }
};
if (typeof globalThis.AbortController === "undefined") {
  globalThis.AbortController = AbortController;
}
if (typeof globalThis.AbortSignal === "undefined") {
  globalThis.AbortSignal = AbortSignal2;
}

// ../../web/fetch/lib/esm/index.js
init_console_gjs();
var import_node_stream6 = __toESM(require_cjs_compat3(), 1);

// ../../web/fetch/lib/esm/utils/data-uri.js
init_console_gjs();
function parseDataUri(uri) {
  const match2 = uri.match(/^data:([^,]*?)(;base64)?,(.*)$/s);
  if (!match2) {
    throw new TypeError(`Invalid data URI: ${uri.slice(0, 50)}...`);
  }
  const typeFull = match2[1] || "text/plain;charset=US-ASCII";
  const isBase64 = !!match2[2];
  const data = match2[3];
  let buffer;
  if (isBase64) {
    const binaryString = atob(data);
    buffer = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      buffer[i] = binaryString.charCodeAt(i);
    }
  } else {
    buffer = new TextEncoder().encode(decodeURIComponent(data));
  }
  return { buffer, typeFull };
}

// ../../web/fetch/lib/esm/body.js
init_console_gjs();

// ../../node/url/lib/esm/index.js
init_console_gjs();
init_glib_2();
var PARSE_FLAGS = glib_2_default.UriFlags.HAS_PASSWORD | glib_2_default.UriFlags.ENCODED | glib_2_default.UriFlags.SCHEME_NORMALIZE;
var URLSearchParams = class _URLSearchParams {
  _entries = [];
  constructor(init) {
    if (!init) return;
    if (typeof init === "string") {
      const s = init.startsWith("?") ? init.slice(1) : init;
      if (s) {
        for (const pair of s.split("&")) {
          const eqIdx = pair.indexOf("=");
          if (eqIdx === -1) {
            this._entries.push([decodeComponent(pair), ""]);
          } else {
            this._entries.push([decodeComponent(pair.slice(0, eqIdx)), decodeComponent(pair.slice(eqIdx + 1))]);
          }
        }
      }
    } else if (Array.isArray(init)) {
      for (const [k, v] of init) {
        this._entries.push([String(k), String(v)]);
      }
    } else if (init instanceof _URLSearchParams) {
      this._entries = init._entries.map(([k, v]) => [k, v]);
    } else {
      for (const key of Object.keys(init)) {
        this._entries.push([key, String(init[key])]);
      }
    }
  }
  get(name2) {
    for (const [k, v] of this._entries) {
      if (k === name2) return v;
    }
    return null;
  }
  getAll(name2) {
    return this._entries.filter(([k]) => k === name2).map(([, v]) => v);
  }
  set(name2, value2) {
    let found = false;
    this._entries = this._entries.filter(([k]) => {
      if (k === name2) {
        if (!found) {
          found = true;
          return true;
        }
        return false;
      }
      return true;
    });
    if (found) {
      for (let i = 0; i < this._entries.length; i++) {
        if (this._entries[i][0] === name2) {
          this._entries[i][1] = value2;
          break;
        }
      }
    } else {
      this._entries.push([name2, value2]);
    }
  }
  has(name2) {
    return this._entries.some(([k]) => k === name2);
  }
  delete(name2) {
    this._entries = this._entries.filter(([k]) => k !== name2);
  }
  append(name2, value2) {
    this._entries.push([name2, value2]);
  }
  sort() {
    this._entries.sort((a, b) => {
      if (a[0] < b[0]) return -1;
      if (a[0] > b[0]) return 1;
      return 0;
    });
  }
  toString() {
    return this._entries.map(([k, v]) => encodeComponent(k) + "=" + encodeComponent(v)).join("&");
  }
  forEach(callback) {
    for (const [k, v] of this._entries) {
      callback(v, k, this);
    }
  }
  *entries() {
    yield* this._entries;
  }
  *keys() {
    for (const [k] of this._entries) yield k;
  }
  *values() {
    for (const [, v] of this._entries) yield v;
  }
  [Symbol.iterator]() {
    return this.entries();
  }
  get size() {
    return this._entries.length;
  }
};
function decodeComponent(s) {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}
function encodeComponent(s) {
  return encodeURIComponent(s).replace(/%20/g, "+");
}
var URL = class _URL {
  #uri;
  // GLib.Uri
  #searchParams;
  constructor(url, base) {
    const urlStr = url instanceof _URL ? url.href : String(url);
    try {
      if (base !== void 0) {
        const baseStr = base instanceof _URL ? base.href : String(base);
        const baseUri = glib_2_default.Uri.parse(baseStr, PARSE_FLAGS);
        this.#uri = baseUri.parse_relative(urlStr, PARSE_FLAGS);
      } else {
        this.#uri = glib_2_default.Uri.parse(urlStr, PARSE_FLAGS);
      }
    } catch (e) {
      throw new TypeError(`Invalid URL: ${urlStr}`);
    }
    if (!this.#uri) {
      throw new TypeError(`Invalid URL: ${urlStr}`);
    }
    this.#searchParams = new URLSearchParams(this.#uri.get_query() || "");
  }
  get protocol() {
    return this.#uri.get_scheme() + ":";
  }
  get hostname() {
    return (this.#uri.get_host() || "").toLowerCase();
  }
  get port() {
    const p = this.#uri.get_port();
    if (p === -1) return "";
    const scheme = this.#uri.get_scheme();
    if ((scheme === "http" || scheme === "ws") && p === 80) return "";
    if ((scheme === "https" || scheme === "wss") && p === 443) return "";
    if (scheme === "ftp" && p === 21) return "";
    return String(p);
  }
  get host() {
    const hostname = this.hostname;
    const port = this.port;
    return port ? `${hostname}:${port}` : hostname;
  }
  get pathname() {
    return this.#uri.get_path() || "/";
  }
  get search() {
    const q = this.#uri.get_query();
    return q ? "?" + q : "";
  }
  get hash() {
    const f2 = this.#uri.get_fragment();
    return f2 ? "#" + f2 : "";
  }
  get origin() {
    const p = this.protocol;
    if (p === "http:" || p === "https:" || p === "ftp:") {
      return `${p}//${this.host}`;
    }
    return "null";
  }
  get username() {
    return this.#uri.get_user() || "";
  }
  get password() {
    return this.#uri.get_password() || "";
  }
  get href() {
    let result = this.protocol;
    const scheme = this.#uri.get_scheme();
    const isSpecial = scheme === "http" || scheme === "https" || scheme === "ftp" || scheme === "file" || scheme === "ws" || scheme === "wss";
    if (isSpecial || this.hostname) {
      result += "//";
    }
    const user = this.username;
    const pass = this.password;
    if (user) {
      result += user;
      if (pass) result += ":" + pass;
      result += "@";
    }
    result += this.hostname;
    if (this.port) result += ":" + this.port;
    const pathname = this.pathname;
    result += pathname;
    result += this.search;
    result += this.hash;
    return result;
  }
  get searchParams() {
    return this.#searchParams;
  }
  toString() {
    return this.href;
  }
  toJSON() {
    return this.href;
  }
};

// ../../web/fetch/lib/esm/body.js
init_blob_from();
var import_node_stream = __toESM(require_cjs_compat3(), 1);
init_esm6();
init_esm7();

// ../../web/fetch/lib/esm/errors/fetch-error.js
init_console_gjs();

// ../../web/fetch/lib/esm/errors/base.js
init_console_gjs();
var FetchBaseError = class extends Error {
  type;
  constructor(message, type) {
    super(message);
    if (typeof Error.captureStackTrace === "function") {
      Error.captureStackTrace(this, this.constructor);
    }
    this.type = type;
  }
  get name() {
    return this.constructor.name;
  }
  get [Symbol.toStringTag]() {
    return this.constructor.name;
  }
};

// ../../web/fetch/lib/esm/errors/fetch-error.js
var FetchError = class extends FetchBaseError {
  code;
  errno;
  erroredSysCall;
  /**
   * @param message Error message for human
   * @param type Error type for machine
   * @param systemError For Node.js system error
   */
  constructor(message, type, systemError) {
    super(message, type);
    if (systemError) {
      this.code = this.errno = systemError.code;
      this.erroredSysCall = systemError.syscall;
    }
  }
};

// ../../web/fetch/lib/esm/utils/is.js
init_console_gjs();
var NAME = Symbol.toStringTag;
var isURLSearchParameters = (object) => {
  return typeof object === "object" && typeof object.append === "function" && typeof object.delete === "function" && typeof object.get === "function" && typeof object.getAll === "function" && typeof object.has === "function" && typeof object.set === "function" && typeof object.sort === "function" && object[NAME] === "URLSearchParams";
};
var isBlob = (value2) => {
  if (!value2 || typeof value2 !== "object") return false;
  const obj = value2;
  return typeof obj.arrayBuffer === "function" && typeof obj.type === "string" && typeof obj.stream === "function" && typeof obj.constructor === "function" && /^(Blob|File)$/.test(obj[NAME]);
};
var isAbortSignal = (object) => {
  if (typeof object !== "object" || object === null) return false;
  const obj = object;
  return obj[NAME] === "AbortSignal" || obj[NAME] === "EventTarget";
};
var isDomainOrSubdomain = (destination, original) => {
  const orig = new URL(original).hostname;
  const dest = new URL(destination).hostname;
  return orig === dest || orig.endsWith(`.${dest}`);
};
var isSameProtocol = (destination, original) => {
  const orig = new URL(original).protocol;
  const dest = new URL(destination).protocol;
  return orig === dest;
};

// ../../web/fetch/lib/esm/body.js
var INTERNALS = /* @__PURE__ */ Symbol("Body internals");
function isAnyArrayBuffer2(val) {
  return val instanceof ArrayBuffer || typeof SharedArrayBuffer !== "undefined" && val instanceof SharedArrayBuffer;
}
var Body = class {
  [INTERNALS] = {
    body: null,
    stream: null,
    boundary: "",
    disturbed: false,
    error: null
  };
  size = 0;
  constructor(body, options = { size: 0 }) {
    this.size = options.size || 0;
    if (body === null || body === void 0) {
      this[INTERNALS].body = null;
    } else if (isURLSearchParameters(body)) {
      this[INTERNALS].body = Buffer2.from(body.toString());
    } else if (isBlob(body)) {
      this[INTERNALS].body = body;
    } else if (Buffer2.isBuffer(body)) {
      this[INTERNALS].body = body;
    } else if (isAnyArrayBuffer2(body)) {
      this[INTERNALS].body = Buffer2.from(body);
    } else if (ArrayBuffer.isView(body)) {
      this[INTERNALS].body = Buffer2.from(body.buffer, body.byteOffset, body.byteLength);
    } else if (body instanceof import_node_stream.Readable) {
      this[INTERNALS].body = body;
    } else if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
      this[INTERNALS].body = readableStreamToReadable(body);
    } else if (body instanceof FormData) {
      const blob = formDataToBlob(body);
      this[INTERNALS].body = blob;
      this[INTERNALS].boundary = blob.type?.split("boundary=")?.[1] ?? "";
    } else if (typeof body === "string") {
      this[INTERNALS].body = Buffer2.from(body);
    } else if (body instanceof URLSearchParams) {
      this[INTERNALS].body = Buffer2.from(body.toString());
    } else {
      console.warn(`Unknown body type "${typeof body}", try to parse the body to string!`);
      this[INTERNALS].body = Buffer2.from(String(body));
    }
    const b = this[INTERNALS].body;
    if (Buffer2.isBuffer(b)) {
      this[INTERNALS].stream = import_node_stream.Readable.from(b);
    } else if (isBlob(b)) {
      this[INTERNALS].stream = import_node_stream.Readable.from(blobToAsyncIterable(b));
    } else if (b instanceof import_node_stream.Readable) {
      this[INTERNALS].stream = b;
    }
    if (b instanceof import_node_stream.Stream) {
      b.on("error", (error_) => {
        const error2 = error_ instanceof FetchBaseError ? error_ : new FetchError(`Invalid response body while trying to fetch ${this.url}: ${error_.message}`, "system", error_);
        this[INTERNALS].error = error2;
      });
    }
  }
  get body() {
    const stream = this[INTERNALS].stream;
    if (!stream) return null;
    if (typeof ReadableStream !== "undefined") {
      return new ReadableStream({
        start(controller) {
          stream.on("data", (chunk) => {
            controller.enqueue(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
          });
          stream.on("end", () => {
            controller.close();
          });
          stream.on("error", (err) => {
            controller.error(err);
          });
        },
        cancel() {
          stream.destroy();
        }
      });
    }
    return null;
  }
  get _stream() {
    return this[INTERNALS].stream;
  }
  get bodyUsed() {
    return this[INTERNALS].disturbed;
  }
  /**
   * Decode response as ArrayBuffer
   */
  async arrayBuffer() {
    const { buffer, byteOffset, byteLength } = await consumeBody(this);
    return buffer.slice(byteOffset, byteOffset + byteLength);
  }
  async formData() {
    const ct = this.headers?.get("content-type");
    if (ct?.startsWith("application/x-www-form-urlencoded")) {
      const formData = new FormData();
      const parameters = new URLSearchParams(await this.text());
      for (const [name2, value2] of parameters) {
        formData.append(name2, value2);
      }
      return formData;
    }
    const { toFormData: toFormData2 } = await Promise.resolve().then(() => (init_multipart_parser(), multipart_parser_exports));
    return toFormData2(this.body, ct);
  }
  /**
   * Return raw response as Blob
   */
  async blob() {
    const ct = this.headers?.get("content-type") || this[INTERNALS].body && this[INTERNALS].body.type || "";
    const buf = await this.arrayBuffer();
    return new Blob2([buf], {
      type: ct
    });
  }
  /**
   * Decode response as json
   */
  async json() {
    const text = await this.text();
    return JSON.parse(text);
  }
  /**
   * Decode response as text
   */
  async text() {
    const buffer = await consumeBody(this);
    return new TextDecoder().decode(buffer);
  }
};
Object.defineProperties(Body.prototype, {
  body: { enumerable: true },
  bodyUsed: { enumerable: true },
  arrayBuffer: { enumerable: true },
  blob: { enumerable: true },
  json: { enumerable: true },
  text: { enumerable: true }
});
async function consumeBody(data) {
  if (data[INTERNALS].disturbed) {
    throw new TypeError(`body used already for: ${data.url}`);
  }
  data[INTERNALS].disturbed = true;
  if (data[INTERNALS].error) {
    throw data[INTERNALS].error;
  }
  const { _stream: body } = data;
  if (body === null) {
    return Buffer2.alloc(0);
  }
  if (!(body instanceof import_node_stream.Stream)) {
    return Buffer2.alloc(0);
  }
  const accum = [];
  let accumBytes = 0;
  try {
    for await (const chunk of body) {
      if (data.size > 0 && accumBytes + chunk.length > data.size) {
        const error2 = new FetchError(`content size at ${data.url} over limit: ${data.size}`, "max-size");
        body.destroy(error2);
        throw error2;
      }
      accumBytes += chunk.length;
      accum.push(chunk);
    }
  } catch (error2) {
    const err = error2 instanceof Error ? error2 : new Error(String(error2));
    const error_ = error2 instanceof FetchBaseError ? error2 : new FetchError(`Invalid response body while trying to fetch ${data.url}: ${err.message}`, "system", err);
    throw error_;
  }
  try {
    if (accum.every((c) => typeof c === "string")) {
      return Buffer2.from(accum.join(""));
    }
    return Buffer2.concat(accum, accumBytes);
  } catch (error2) {
    const err = error2 instanceof Error ? error2 : new Error(String(error2));
    throw new FetchError(`Could not create Buffer from response body for ${data.url}: ${err.message}`, "system", err);
  }
}
var clone = (instance, highWaterMark) => {
  let p1;
  let p2;
  let { body } = instance[INTERNALS];
  if (instance.bodyUsed) {
    throw new Error("cannot clone body after it is used");
  }
  if (body instanceof import_node_stream.Stream && typeof body.getBoundary !== "function") {
    p1 = new import_node_stream.PassThrough({ highWaterMark });
    p2 = new import_node_stream.PassThrough({ highWaterMark });
    body.pipe(p1);
    body.pipe(p2);
    instance[INTERNALS].stream = p1;
    body = p2;
  }
  return body;
};
var extractContentType = (body, request) => {
  if (body === null) {
    return null;
  }
  if (typeof body === "string") {
    return "text/plain;charset=UTF-8";
  }
  if (isURLSearchParameters(body)) {
    return "application/x-www-form-urlencoded;charset=UTF-8";
  }
  if (isBlob(body)) {
    return body.type || null;
  }
  if (Buffer2.isBuffer(body) || isAnyArrayBuffer2(body) || ArrayBuffer.isView(body)) {
    return null;
  }
  if (body instanceof FormData) {
    return `multipart/form-data; boundary=${request[INTERNALS].boundary}`;
  }
  if (body instanceof import_node_stream.Stream) {
    return null;
  }
  return "text/plain;charset=UTF-8";
};
var getTotalBytes = (request) => {
  const { body } = request[INTERNALS];
  if (body === null) {
    return 0;
  }
  if (isBlob(body)) {
    return body.size;
  }
  if (Buffer2.isBuffer(body)) {
    return body.length;
  }
  if (body && typeof body.getLengthSync === "function") {
    const streamBody = body;
    return streamBody.hasKnownLength && streamBody.hasKnownLength() ? streamBody.getLengthSync() : null;
  }
  return null;
};
function readableStreamToReadable(webStream) {
  const reader = webStream.getReader();
  return new import_node_stream.Readable({
    async read() {
      try {
        const { done, value: value2 } = await reader.read();
        if (done) {
          this.push(null);
        } else {
          this.push(Buffer2.from(value2));
        }
      } catch (err) {
        this.destroy(err);
      }
    },
    destroy(_err, callback) {
      reader.cancel().then(() => callback(null), callback);
    }
  });
}
async function* blobToAsyncIterable(blob) {
  if (typeof blob.stream === "function") {
    const reader = blob.stream().getReader();
    while (true) {
      const { done, value: value2 } = await reader.read();
      if (done) break;
      yield value2;
    }
  } else {
    yield new Uint8Array(await blob.arrayBuffer());
  }
}

// ../../web/fetch/lib/esm/response.js
init_console_gjs();
init_glib_2();
init_gio_2();

// ../../web/fetch/lib/esm/headers.js
init_console_gjs();

// ../../../node_modules/@girs/soup-3.0/index.js
init_console_gjs();

// ../../../node_modules/@girs/soup-3.0/soup-3.0.js
init_console_gjs();
import Soup from "gi://Soup?version=3.0";
var soup_3_0_default = Soup;

// ../../../node_modules/@girs/soup-3.0/index.js
var soup_3_default = soup_3_0_default;

// ../../node/http/lib/esm/index.js
init_console_gjs();

// ../../node/http/lib/esm/constants.js
init_console_gjs();

// ../../node/http/lib/esm/incoming-message.js
init_console_gjs();
var import_node_stream2 = __toESM(require_cjs_compat3(), 1);
init_esm6();

// ../../node/http/lib/esm/server.js
init_console_gjs();
var import_node_events = __toESM(require_cjs_compat2(), 1);
var import_node_stream4 = __toESM(require_cjs_compat3(), 1);
init_esm6();

// ../../node/net/lib/esm/socket.js
init_console_gjs();
init_gio_2();
init_glib_2();
var import_node_stream3 = __toESM(require_cjs_compat3(), 1);
init_esm6();
init_esm4();

// ../../node/http/lib/esm/server.js
init_esm4();

// ../../node/http/lib/esm/client-request.js
init_console_gjs();
init_glib_2();
init_gio_2();
init_esm6();
init_esm4();

// ../../node/http/lib/esm/index.js
function validateHeaderName(name2) {
  if (typeof name2 !== "string" || !/^[\^`\-\w!#$%&'*+.|~]+$/.test(name2)) {
    const error2 = new TypeError(`Header name must be a valid HTTP token ["${name2}"]`);
    Object.defineProperty(error2, "code", { value: "ERR_INVALID_HTTP_TOKEN" });
    throw error2;
  }
}
function validateHeaderValue(name2, value2) {
  if (value2 === void 0) {
    const error2 = new TypeError(`Header "${name2}" value must not be undefined`);
    Object.defineProperty(error2, "code", { value: "ERR_HTTP_INVALID_HEADER_VALUE" });
    throw error2;
  }
  if (typeof value2 === "string" && /[^\t\u0020-\u007E\u0080-\u00FF]/.test(value2)) {
    const error2 = new TypeError(`Invalid character in header content ["${name2}"]`);
    Object.defineProperty(error2, "code", { value: "ERR_INVALID_CHAR" });
    throw error2;
  }
}
var Agent = class {
  defaultPort = 80;
  protocol = "http:";
  maxSockets;
  maxTotalSockets;
  maxFreeSockets;
  keepAliveMsecs;
  keepAlive;
  scheduling;
  /** Pending requests per host (compatibility — Soup manages internally). */
  requests = {};
  /** Active sockets per host (compatibility — Soup manages internally). */
  sockets = {};
  /** Idle sockets per host (compatibility — Soup manages internally). */
  freeSockets = {};
  constructor(options) {
    this.keepAlive = options?.keepAlive ?? false;
    this.keepAliveMsecs = options?.keepAliveMsecs ?? 1e3;
    this.maxSockets = options?.maxSockets ?? Infinity;
    this.maxTotalSockets = options?.maxTotalSockets ?? Infinity;
    this.maxFreeSockets = options?.maxFreeSockets ?? 256;
    this.scheduling = options?.scheduling ?? "lifo";
  }
  /** Destroy the agent and close idle connections. */
  destroy() {
  }
  /** Return a connection pool key for the given options. */
  getName(options) {
    let name2 = options.host || "localhost";
    if (options.port) name2 += ":" + options.port;
    if (options.localAddress) name2 += ":" + options.localAddress;
    if (options.family === 4 || options.family === 6) name2 += ":" + options.family;
    return name2;
  }
};
var globalAgent = new Agent();

// ../../web/fetch/lib/esm/headers.js
var _headers = /* @__PURE__ */ Symbol("Headers.headers");
function isBoxedPrimitive2(val) {
  return val instanceof String || val instanceof Number || val instanceof Boolean || typeof Symbol !== "undefined" && val instanceof Symbol || typeof BigInt !== "undefined" && val instanceof BigInt;
}
var Headers = class _Headers {
  [_headers];
  constructor(init) {
    this[_headers] = /* @__PURE__ */ new Map();
    if (init == null) {
      return;
    }
    if (init instanceof _Headers) {
      for (const [name2, values] of init[_headers]) {
        this[_headers].set(name2, [...values]);
      }
      return;
    }
    if (typeof init === "object" && !isBoxedPrimitive2(init)) {
      const method = init[Symbol.iterator];
      if (method == null) {
        for (const [name2, value2] of Object.entries(init)) {
          validateHeaderName(name2);
          validateHeaderValue(name2, String(value2));
          this.append(name2, String(value2));
        }
      } else {
        if (typeof method !== "function") {
          throw new TypeError("Header pairs must be iterable");
        }
        for (const pair of init) {
          if (typeof pair !== "object" || isBoxedPrimitive2(pair)) {
            throw new TypeError("Each header pair must be an iterable object");
          }
          const arr = [...pair];
          if (arr.length !== 2) {
            throw new TypeError("Each header pair must be a name/value tuple");
          }
          validateHeaderName(arr[0]);
          validateHeaderValue(arr[0], String(arr[1]));
          this.append(arr[0], String(arr[1]));
        }
      }
    } else {
      throw new TypeError(
        "Failed to construct 'Headers': The provided value is not of type '(sequence<sequence<ByteString>> or record<ByteString, ByteString>)'"
      );
    }
  }
  append(name2, value2) {
    validateHeaderName(name2);
    validateHeaderValue(name2, value2);
    const lowerName = String(name2).toLowerCase();
    const strValue = String(value2);
    const existing = this[_headers].get(lowerName);
    if (existing) {
      existing.push(strValue);
    } else {
      this[_headers].set(lowerName, [strValue]);
    }
  }
  set(name2, value2) {
    validateHeaderName(name2);
    validateHeaderValue(name2, value2);
    const lowerName = String(name2).toLowerCase();
    this[_headers].set(lowerName, [String(value2)]);
  }
  delete(name2) {
    this[_headers].delete(String(name2).toLowerCase());
  }
  has(name2) {
    return this[_headers].has(String(name2).toLowerCase());
  }
  get(name2) {
    const values = this[_headers].get(String(name2).toLowerCase());
    if (!values || values.length === 0) {
      return null;
    }
    let value2 = values.join(", ");
    if (/^content-encoding$/i.test(name2)) {
      value2 = value2.toLowerCase();
    }
    return value2;
  }
  getAll(name2) {
    return this[_headers].get(String(name2).toLowerCase()) ?? [];
  }
  getSetCookie() {
    return this[_headers].get("set-cookie") ?? [];
  }
  forEach(callback, thisArg) {
    for (const name2 of this.keys()) {
      Reflect.apply(callback, thisArg, [this.get(name2), name2, this]);
    }
  }
  *keys() {
    const sorted = [...this[_headers].keys()].sort();
    const seen = /* @__PURE__ */ new Set();
    for (const key of sorted) {
      if (!seen.has(key)) {
        seen.add(key);
        yield key;
      }
    }
  }
  *values() {
    for (const name2 of this.keys()) {
      yield this.get(name2);
    }
  }
  *entries() {
    for (const name2 of this.keys()) {
      yield [name2, this.get(name2)];
    }
  }
  [Symbol.iterator]() {
    return this.entries();
  }
  get [Symbol.toStringTag]() {
    return "Headers";
  }
  toString() {
    return Object.prototype.toString.call(this);
  }
  /**
   * Node-fetch non-spec method: return all headers and their values as arrays.
   */
  raw() {
    const result = {};
    for (const name2 of this.keys()) {
      result[name2] = this.getAll(name2);
    }
    return result;
  }
  /**
   * Append all headers to a Soup.Message for sending.
   */
  _appendToSoupMessage(message, type = soup_3_default.MessageHeadersType.REQUEST) {
    const soupHeaders = message ? message.get_request_headers() : new soup_3_default.MessageHeaders(type);
    for (const [name2, value2] of this.entries()) {
      soupHeaders.append(name2, value2);
    }
    return soupHeaders;
  }
  /**
   * Create a Headers instance from a Soup.Message's headers.
   */
  static _newFromSoupMessage(message, type = soup_3_default.MessageHeadersType.RESPONSE) {
    const headers = new _Headers();
    let soupHeaders;
    if (type === soup_3_default.MessageHeadersType.RESPONSE) {
      soupHeaders = message.get_response_headers();
    } else {
      soupHeaders = message.get_request_headers();
    }
    soupHeaders.foreach((name2, value2) => {
      headers.append(name2, value2);
    });
    return headers;
  }
  /**
   * For better console.log(headers)
   */
  [/* @__PURE__ */ Symbol.for("nodejs.util.inspect.custom")]() {
    const result = {};
    for (const key of this.keys()) {
      const values = this.getAll(key);
      if (key === "host") {
        result[key] = values[0];
      } else {
        result[key] = values.length > 1 ? values : values[0];
      }
    }
    return result;
  }
};
Object.defineProperties(
  Headers.prototype,
  ["get", "entries", "forEach", "values"].reduce((result, property) => {
    result[property] = { enumerable: true };
    return result;
  }, {})
);

// ../../web/fetch/lib/esm/utils/is-redirect.js
init_console_gjs();
var redirectStatus = /* @__PURE__ */ new Set([301, 302, 303, 307, 308]);
var isRedirect = (code) => {
  return redirectStatus.has(code);
};

// ../../web/fetch/lib/esm/response.js
var INTERNALS2 = /* @__PURE__ */ Symbol("Response internals");
var Response = class _Response extends Body {
  [INTERNALS2];
  _inputStream = null;
  constructor(body = null, options = {}) {
    super(body, options);
    const status = options.status != null ? options.status : 200;
    const headers = new Headers(options.headers);
    if (body !== null && !headers.has("Content-Type")) {
      const contentType = extractContentType(body, this);
      if (contentType) {
        headers.append("Content-Type", contentType);
      }
    }
    this[INTERNALS2] = {
      type: "default",
      url: options.url,
      status,
      statusText: options.statusText || "",
      headers,
      counter: options.counter,
      highWaterMark: options.highWaterMark
    };
  }
  get type() {
    return this[INTERNALS2].type;
  }
  get url() {
    return this[INTERNALS2].url || "";
  }
  get status() {
    return this[INTERNALS2].status;
  }
  /**
   * Convenience property representing if the request ended normally
   */
  get ok() {
    return this[INTERNALS2].status >= 200 && this[INTERNALS2].status < 300;
  }
  get redirected() {
    return this[INTERNALS2].counter > 0;
  }
  get statusText() {
    return this[INTERNALS2].statusText;
  }
  get headers() {
    return this[INTERNALS2].headers;
  }
  get highWaterMark() {
    return this[INTERNALS2].highWaterMark;
  }
  /**
   * Clone this response
   *
   * @return  Response
   */
  clone() {
    return new _Response(clone(this, this.highWaterMark), {
      type: this.type,
      url: this.url,
      status: this.status,
      statusText: this.statusText,
      headers: this.headers,
      ok: this.ok,
      redirected: this.redirected,
      size: this.size,
      highWaterMark: this.highWaterMark
    });
  }
  /**
   * @param url The URL that the new response is to originate from.
   * @param status An optional status code for the response (e.g., 302.)
   * @returns A Response object.
   */
  static redirect(url, status = 302) {
    if (!isRedirect(status)) {
      throw new RangeError('Failed to execute "redirect" on "response": Invalid status code');
    }
    return new _Response(null, {
      headers: {
        location: new URL(url).toString()
      },
      status
    });
  }
  static error() {
    const response = new _Response(null, { status: 0, statusText: "" });
    response[INTERNALS2].type = "error";
    return response;
  }
  /**
   * Create a Response with a JSON body.
   * @param data The data to serialize as JSON.
   * @param init Optional response init options.
   * @returns A Response with the JSON body and appropriate content-type header.
   */
  static json(data, init) {
    const body = JSON.stringify(data);
    const options = { ...init };
    const headers = new Headers(options.headers);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    options.headers = headers;
    return new _Response(body, options);
  }
  get [Symbol.toStringTag]() {
    return "Response";
  }
  async text() {
    if (!this._inputStream) {
      return super.text();
    }
    const outputStream = gio_2_default.MemoryOutputStream.new_resizable();
    await new Promise((resolve, reject) => {
      outputStream.splice_async(this._inputStream, gio_2_default.OutputStreamSpliceFlags.CLOSE_TARGET | gio_2_default.OutputStreamSpliceFlags.CLOSE_SOURCE, glib_2_default.PRIORITY_DEFAULT, null, (_self, res) => {
        try {
          resolve(outputStream.splice_finish(res));
        } catch (error2) {
          reject(error2);
        }
      });
    });
    const bytes = outputStream.steal_as_bytes();
    return new TextDecoder().decode(bytes.toArray());
  }
};
Object.defineProperties(Response.prototype, {
  type: { enumerable: true },
  url: { enumerable: true },
  status: { enumerable: true },
  ok: { enumerable: true },
  redirected: { enumerable: true },
  statusText: { enumerable: true },
  headers: { enumerable: true },
  clone: { enumerable: true }
});
var response_default = Response;

// ../../web/fetch/lib/esm/request.js
init_console_gjs();
init_glib_2();
init_gio_2();

// ../../web/fetch/lib/esm/utils/soup-helpers.js
init_console_gjs();
init_glib_2();
var import_node_stream5 = __toESM(require_cjs_compat3(), 1);
init_esm4();
async function soupSendAsync(session, msg, ioPriority = glib_2_default.PRIORITY_DEFAULT, cancellable = null) {
  return new Promise((resolve, reject) => {
    session.send_async(msg, ioPriority, cancellable, (_self, asyncRes) => {
      try {
        const inputStream = session.send_finish(asyncRes);
        resolve(inputStream);
      } catch (error2) {
        reject(error2);
      }
    });
  });
}
function inputStreamToReadable(inputStream, options = {}) {
  return import_node_stream5.Readable.from(inputStreamAsyncIterator(inputStream), options);
}

// ../../web/fetch/lib/esm/utils/referrer.js
init_console_gjs();

// ../../node/net/lib/esm/index.js
init_console_gjs();
init_gio_2();

// ../../node/net/lib/esm/server.js
init_console_gjs();
init_gio_2();
var import_node_events2 = __toESM(require_cjs_compat2(), 1);
init_esm4();

// ../../node/net/lib/esm/index.js
function isIP(input) {
  if (typeof input !== "string") return 0;
  const stripped = input.includes("%") ? input.split("%")[0] : input;
  const addr = gio_2_default.InetAddress.new_from_string(stripped);
  if (!addr) return 0;
  const family = addr.get_family();
  switch (family) {
    case gio_2_default.SocketFamily.INVALID:
      return 0;
    case gio_2_default.SocketFamily.IPV4:
      return 4;
    case gio_2_default.SocketFamily.IPV6:
      return 6;
  }
}

// ../../web/fetch/lib/esm/utils/referrer.js
function stripURLForUseAsAReferrer(url, originOnly = false) {
  if (url == null || url === "no-referrer") {
    return "no-referrer";
  }
  const u = new URL(url);
  if (/^(about|blob|data):$/.test(u.protocol)) {
    return "no-referrer";
  }
  u.username = "";
  u.password = "";
  u.hash = "";
  if (originOnly) {
    u.pathname = "";
    u.search = "";
  }
  return u;
}
var ReferrerPolicy = /* @__PURE__ */ new Set([
  "",
  "no-referrer",
  "no-referrer-when-downgrade",
  "same-origin",
  "origin",
  "strict-origin",
  "origin-when-cross-origin",
  "strict-origin-when-cross-origin",
  "unsafe-url"
]);
var DEFAULT_REFERRER_POLICY = "strict-origin-when-cross-origin";
function validateReferrerPolicy(referrerPolicy) {
  if (!ReferrerPolicy.has(referrerPolicy)) {
    throw new TypeError(`Invalid referrerPolicy: ${referrerPolicy}`);
  }
  return referrerPolicy;
}
function isOriginPotentiallyTrustworthy(url) {
  if (/^(http|ws)s:$/.test(url.protocol)) {
    return true;
  }
  const hostIp = url.host.replace(/(^\[)|(]$)/g, "");
  const hostIPVersion = isIP(hostIp);
  if (hostIPVersion === 4 && /^127\./.test(hostIp)) {
    return true;
  }
  if (hostIPVersion === 6 && /^(((0+:){7})|(::(0+:){0,6}))0*1$/.test(hostIp)) {
    return true;
  }
  if (url.host === "localhost" || url.host.endsWith(".localhost")) {
    return false;
  }
  if (url.protocol === "file:") {
    return true;
  }
  return false;
}
function isUrlPotentiallyTrustworthy(url) {
  if (/^about:(blank|srcdoc)$/.test(url.toString())) {
    return true;
  }
  if (typeof url === "string") {
    url = new URL(url);
  }
  if (url.protocol === "data:") {
    return true;
  }
  if (/^(blob|filesystem):$/.test(url.protocol)) {
    return true;
  }
  return isOriginPotentiallyTrustworthy(url);
}
function determineRequestsReferrer(request, obj = {}) {
  const { referrerURLCallback, referrerOriginCallback } = obj;
  if (request.referrer === "no-referrer" || request.referrerPolicy === "") {
    return null;
  }
  const policy = request.referrerPolicy;
  if (request.referrer === "about:client") {
    return "no-referrer";
  }
  const referrerSource = new URL(request.referrer);
  let referrerURL = stripURLForUseAsAReferrer(referrerSource);
  let referrerOrigin = stripURLForUseAsAReferrer(referrerSource, true);
  if (referrerURL.toString().length > 4096) {
    referrerURL = referrerOrigin;
  }
  if (referrerURLCallback) {
    referrerURL = referrerURLCallback(referrerURL);
  }
  if (referrerOriginCallback) {
    referrerOrigin = referrerOriginCallback(referrerOrigin);
  }
  const currentURL = new URL(request.url);
  switch (policy) {
    case "no-referrer":
      return "no-referrer";
    case "origin":
      return referrerOrigin;
    case "unsafe-url":
      return referrerURL;
    case "strict-origin":
      if (isUrlPotentiallyTrustworthy(referrerURL) && !isUrlPotentiallyTrustworthy(currentURL)) {
        return "no-referrer";
      }
      return referrerOrigin.toString();
    case "strict-origin-when-cross-origin":
      if (referrerURL.origin === currentURL.origin) {
        return referrerURL;
      }
      if (isUrlPotentiallyTrustworthy(referrerURL) && !isUrlPotentiallyTrustworthy(currentURL)) {
        return "no-referrer";
      }
      return referrerOrigin;
    case "same-origin":
      if (referrerURL.origin === currentURL.origin) {
        return referrerURL;
      }
      return "no-referrer";
    case "origin-when-cross-origin":
      if (referrerURL.origin === currentURL.origin) {
        return referrerURL;
      }
      return referrerOrigin;
    case "no-referrer-when-downgrade":
      if (isUrlPotentiallyTrustworthy(referrerURL) && !isUrlPotentiallyTrustworthy(currentURL)) {
        return "no-referrer";
      }
      return referrerURL;
    default:
      throw new TypeError(`Invalid referrerPolicy: ${policy}`);
  }
}
function parseReferrerPolicyFromHeader(headers) {
  const policyTokens = (headers.get("referrer-policy") || "").split(/[,\s]+/);
  let policy = "";
  for (const token of policyTokens) {
    if (token && ReferrerPolicy.has(token)) {
      policy = token;
    }
  }
  return policy;
}

// ../../web/fetch/lib/esm/request.js
var INTERNALS3 = /* @__PURE__ */ Symbol("Request internals");
var isRequest = (obj) => {
  return typeof obj === "object" && typeof obj.url === "string";
};
var Request = class _Request extends Body {
  /** Returns the cache mode associated with request, which is a string indicating how the request will interact with the browser's cache when fetching. */
  cache;
  /** Returns the credentials mode associated with request, which is a string indicating whether credentials will be sent with the request always, never, or only when sent to a same-origin URL. */
  credentials;
  /** Returns the kind of resource requested by request, e.g., "document" or "script". */
  destination;
  /** Returns a Headers object consisting of the headers associated with request. Note that headers added in the network layer by the user agent will not be accounted for in this object, e.g., the "Host" header. */
  get headers() {
    return this[INTERNALS3].headers;
  }
  /** Returns request's subresource integrity metadata, which is a cryptographic hash of the resource being fetched. Its value consists of multiple hashes separated by whitespace. [SRI] */
  integrity;
  /** Returns a boolean indicating whether or not request can outlive the global in which it was created. */
  keepalive;
  /** Returns request's HTTP method, which is "GET" by default. */
  get method() {
    return this[INTERNALS3].method;
  }
  /** Returns the mode associated with request, which is a string indicating whether the request will use CORS, or will be restricted to same-origin URLs. */
  mode;
  /** Returns the redirect mode associated with request, which is a string indicating how redirects for the request will be handled during fetching. A request will follow redirects by default. */
  get redirect() {
    return this[INTERNALS3].redirect;
  }
  /**
   * Returns the referrer of request.
   * Its value can be a same-origin URL if explicitly set in init, the empty string to indicate no referrer, and "about:client" when defaulting to the global's default.
   * This is used during fetching to determine the value of the `Referer` header of the request being made.
   * @see https://fetch.spec.whatwg.org/#dom-request-referrer
   **/
  get referrer() {
    if (this[INTERNALS3].referrer === "no-referrer") {
      return "";
    }
    if (this[INTERNALS3].referrer === "client") {
      return "about:client";
    }
    if (this[INTERNALS3].referrer) {
      return this[INTERNALS3].referrer.toString();
    }
    return void 0;
  }
  /** Returns the referrer policy associated with request. This is used during fetching to compute the value of the request's referrer. */
  get referrerPolicy() {
    return this[INTERNALS3].referrerPolicy;
  }
  set referrerPolicy(referrerPolicy) {
    this[INTERNALS3].referrerPolicy = validateReferrerPolicy(referrerPolicy);
  }
  /** Returns the signal associated with request, which is an AbortSignal object indicating whether or not request has been aborted, and its abort event handler. */
  get signal() {
    return this[INTERNALS3].signal;
  }
  /** Returns the URL of request as a string. */
  get url() {
    return this[INTERNALS3].parsedURL.toString();
  }
  get _uri() {
    return glib_2_default.Uri.parse(this.url, glib_2_default.UriFlags.NONE);
  }
  get _session() {
    return this[INTERNALS3].session;
  }
  get _message() {
    return this[INTERNALS3].message;
  }
  get _inputStream() {
    return this[INTERNALS3].inputStream;
  }
  get [Symbol.toStringTag]() {
    return "Request";
  }
  [INTERNALS3];
  // Node-fetch-only options
  follow;
  compress = false;
  counter = 0;
  agent = "";
  highWaterMark = 16384;
  insecureHTTPParser = false;
  constructor(input, init) {
    const inputRL = input;
    const initRL = init || {};
    let parsedURL;
    let requestObj = {};
    if (isRequest(input)) {
      parsedURL = new URL(inputRL.url);
      requestObj = inputRL;
    } else {
      parsedURL = new URL(input);
    }
    if (parsedURL.username !== "" || parsedURL.password !== "") {
      throw new TypeError(`${parsedURL} is an url with embedded credentials.`);
    }
    let method = initRL.method || requestObj.method || "GET";
    if (/^(delete|get|head|options|post|put)$/i.test(method)) {
      method = method.toUpperCase();
    }
    if ((init?.body != null || isRequest(input) && inputRL.body !== null) && (method === "GET" || method === "HEAD")) {
      throw new TypeError("Request with GET/HEAD method cannot have body");
    }
    const inputBody = init?.body ? init.body : isRequest(input) && inputRL.body !== null ? clone(input) : null;
    super(inputBody, {
      size: initRL.size || 0
    });
    const headers = new Headers(init?.headers || inputRL.headers || {});
    if (inputBody !== null && !headers.has("Content-Type")) {
      const contentType = extractContentType(inputBody, this);
      if (contentType) {
        headers.set("Content-Type", contentType);
      }
    }
    let signal = isRequest(input) ? inputRL.signal : null;
    if (init && "signal" in init) {
      signal = init.signal;
    }
    if (signal != null && !isAbortSignal(signal)) {
      throw new TypeError("Expected signal to be an instanceof AbortSignal or EventTarget");
    }
    let referrer = init?.referrer == null ? inputRL.referrer : init.referrer;
    if (referrer === "") {
      referrer = "no-referrer";
    } else if (referrer) {
      const parsedReferrer = new URL(referrer);
      referrer = /^about:(\/\/)?client$/.test(parsedReferrer.toString()) ? "client" : parsedReferrer;
    } else {
      referrer = void 0;
    }
    const scheme = parsedURL.protocol;
    let session = null;
    let message = null;
    if (scheme === "http:" || scheme === "https:") {
      session = new soup_3_default.Session();
      message = new soup_3_default.Message({
        method,
        uri: glib_2_default.Uri.parse(parsedURL.toString(), glib_2_default.UriFlags.NONE)
      });
    }
    this[INTERNALS3] = {
      method,
      redirect: init?.redirect || inputRL.redirect || "follow",
      headers,
      parsedURL,
      signal,
      referrer,
      referrerPolicy: "",
      session,
      message
    };
    this.follow = initRL.follow === void 0 ? inputRL.follow === void 0 ? 20 : inputRL.follow : initRL.follow;
    this.compress = initRL.compress === void 0 ? inputRL.compress === void 0 ? true : inputRL.compress : initRL.compress;
    this.counter = initRL.counter || inputRL.counter || 0;
    this.agent = initRL.agent || inputRL.agent;
    this.highWaterMark = initRL.highWaterMark || inputRL.highWaterMark || 16384;
    this.insecureHTTPParser = initRL.insecureHTTPParser || inputRL.insecureHTTPParser || false;
    this.referrerPolicy = init?.referrerPolicy || inputRL.referrerPolicy || "";
  }
  /**
   * Send the request using Soup.
   */
  async _send(options) {
    const { session, message } = this[INTERNALS3];
    if (!session || !message) {
      throw new Error("Cannot send request: no Soup session (non-HTTP URL?)");
    }
    options.headers._appendToSoupMessage(message);
    const cancellable = new gio_2_default.Cancellable();
    this[INTERNALS3].inputStream = await soupSendAsync(session, message, glib_2_default.PRIORITY_DEFAULT, cancellable);
    this[INTERNALS3].readable = inputStreamToReadable(this[INTERNALS3].inputStream);
    return {
      inputStream: this[INTERNALS3].inputStream,
      readable: this[INTERNALS3].readable,
      cancellable
    };
  }
  /**
   * Clone this request
   */
  clone() {
    return new _Request(this);
  }
  async arrayBuffer() {
    return super.arrayBuffer();
  }
  async blob() {
    return super.blob();
  }
  async formData() {
    return super.formData();
  }
  async json() {
    return super.json();
  }
  async text() {
    return super.text();
  }
};
Object.defineProperties(Request.prototype, {
  method: { enumerable: true },
  url: { enumerable: true },
  headers: { enumerable: true },
  redirect: { enumerable: true },
  clone: { enumerable: true },
  signal: { enumerable: true },
  referrer: { enumerable: true },
  referrerPolicy: { enumerable: true }
});
var request_default = Request;
var getSoupRequestOptions = (request) => {
  const { parsedURL } = request[INTERNALS3];
  const headers = new Headers(request[INTERNALS3].headers);
  if (!headers.has("Accept")) {
    headers.set("Accept", "*/*");
  }
  let contentLengthValue = null;
  if (request.body === null && /^(post|put)$/i.test(request.method)) {
    contentLengthValue = "0";
  }
  if (request.body !== null) {
    const totalBytes = getTotalBytes(request);
    if (typeof totalBytes === "number" && !Number.isNaN(totalBytes)) {
      contentLengthValue = String(totalBytes);
    }
  }
  if (contentLengthValue) {
    headers.set("Content-Length", contentLengthValue);
  }
  if (request.referrerPolicy === "") {
    request.referrerPolicy = DEFAULT_REFERRER_POLICY;
  }
  if (request.referrer && request.referrer !== "no-referrer") {
    request[INTERNALS3].referrer = determineRequestsReferrer(request);
  } else {
    request[INTERNALS3].referrer = "no-referrer";
  }
  if (request[INTERNALS3].referrer instanceof URL) {
    headers.set("Referer", request.referrer);
  }
  if (!headers.has("User-Agent")) {
    headers.set("User-Agent", "gjsify-fetch");
  }
  if (request.compress && !headers.has("Accept-Encoding")) {
    headers.set("Accept-Encoding", "gzip, deflate, br");
  }
  let { agent } = request;
  if (typeof agent === "function") {
    agent = agent(parsedURL);
  }
  if (!headers.has("Connection") && !agent) {
    headers.set("Connection", "close");
  }
  const options = {
    headers
  };
  return {
    parsedURL,
    options
  };
};

// ../../web/fetch/lib/esm/errors/abort-error.js
init_console_gjs();
var AbortError = class extends FetchBaseError {
  constructor(message, type = "aborted") {
    super(message, type);
  }
};

// ../../web/fetch/lib/esm/index.js
init_esm7();
init_blob_from();
var supportedSchemas = /* @__PURE__ */ new Set(["data:", "http:", "https:"]);
async function fetch(url, init = {}) {
  const request = new request_default(url, init);
  const { parsedURL, options } = getSoupRequestOptions(request);
  if (!supportedSchemas.has(parsedURL.protocol)) {
    throw new TypeError(`@gjsify/fetch cannot load ${url}. URL scheme "${parsedURL.protocol.replace(/:$/, "")}" is not supported.`);
  }
  if (parsedURL.protocol === "data:") {
    const { buffer, typeFull } = parseDataUri(request.url);
    const response = new response_default(Buffer.from(buffer), { headers: { "Content-Type": typeFull } });
    return response;
  }
  const { signal } = request;
  if (signal && signal.aborted) {
    throw new AbortError("The operation was aborted.");
  }
  let readable;
  let cancellable;
  try {
    const sendRes = await request._send(options);
    readable = sendRes.readable;
    cancellable = sendRes.cancellable;
  } catch (error2) {
    const err = error2 instanceof Error ? error2 : new Error(String(error2));
    throw new FetchError(`request to ${request.url} failed, reason: ${err.message}`, "system", err);
  }
  const abortHandler = () => {
    cancellable.cancel();
  };
  if (signal) {
    signal.addEventListener("abort", abortHandler, { once: true });
  }
  const finalize = () => {
    if (signal) {
      signal.removeEventListener("abort", abortHandler);
    }
  };
  cancellable.connect("cancelled", () => {
    readable.destroy(new AbortError("The operation was aborted."));
  });
  readable.on("error", (error2) => {
    finalize();
  });
  const message = request._message;
  const headers = Headers._newFromSoupMessage(message);
  const statusCode = message.status_code;
  const statusMessage = message.get_reason_phrase();
  if (isRedirect(statusCode)) {
    const location = headers.get("Location");
    let locationURL = null;
    try {
      locationURL = location === null ? null : new URL(location, request.url);
    } catch {
      if (request.redirect !== "manual") {
        finalize();
        throw new FetchError(`uri requested responds with an invalid redirect URL: ${location}`, "invalid-redirect");
      }
    }
    switch (request.redirect) {
      case "error":
        finalize();
        throw new FetchError(`uri requested responds with a redirect, redirect mode is set to error: ${request.url}`, "no-redirect");
      case "manual":
        break;
      case "follow": {
        if (locationURL === null) {
          break;
        }
        if (request.counter >= request.follow) {
          finalize();
          throw new FetchError(`maximum redirect reached at: ${request.url}`, "max-redirect");
        }
        const requestOptions = {
          headers: new Headers(request.headers),
          follow: request.follow,
          counter: request.counter + 1,
          agent: request.agent,
          compress: request.compress,
          method: request.method,
          body: clone(request),
          signal: request.signal,
          size: request.size,
          referrer: request.referrer,
          referrerPolicy: request.referrerPolicy
        };
        if (!isDomainOrSubdomain(request.url, locationURL) || !isSameProtocol(request.url, locationURL)) {
          for (const name2 of ["authorization", "www-authenticate", "cookie", "cookie2"]) {
            requestOptions.headers.delete(name2);
          }
        }
        if (statusCode !== 303 && request.body && init.body instanceof import_node_stream6.default.Readable) {
          finalize();
          throw new FetchError("Cannot follow redirect with body being a readable stream", "unsupported-redirect");
        }
        if (statusCode === 303 || (statusCode === 301 || statusCode === 302) && request.method === "POST") {
          requestOptions.method = "GET";
          requestOptions.body = void 0;
          requestOptions.headers.delete("content-length");
        }
        const responseReferrerPolicy = parseReferrerPolicyFromHeader(headers);
        if (responseReferrerPolicy) {
          requestOptions.referrerPolicy = responseReferrerPolicy;
        }
        finalize();
        return fetch(new request_default(locationURL, requestOptions));
      }
      default:
        throw new TypeError(`Redirect option '${request.redirect}' is not a valid value of RequestRedirect`);
    }
  }
  const responseOptions = {
    url: request.url,
    status: statusCode,
    statusText: statusMessage,
    headers,
    size: request.size,
    counter: request.counter,
    highWaterMark: request.highWaterMark
  };
  const codings = headers.get("Content-Encoding");
  if (!request.compress || request.method === "HEAD" || codings === null || statusCode === 204 || statusCode === 304) {
    finalize();
    return new response_default(readable, responseOptions);
  }
  if (typeof DecompressionStream !== "undefined") {
    let format = null;
    if (codings === "gzip" || codings === "x-gzip") {
      format = "gzip";
    } else if (codings === "deflate" || codings === "x-deflate") {
      format = "deflate";
    }
    if (format) {
      const webBody = new response_default(readable, responseOptions).body;
      if (webBody) {
        const decompressed = webBody.pipeThrough(new DecompressionStream(format));
        finalize();
        return new response_default(decompressed, responseOptions);
      }
    }
  }
  finalize();
  return new response_default(readable, responseOptions);
}
var _isGJS2 = typeof globalThis.imports !== "undefined";
if (_isGJS2) {
  globalThis.fetch = fetch;
  globalThis.Headers = Headers;
  globalThis.Request = request_default;
  globalThis.Response = response_default;
}

// ../dom-elements/lib/esm/index.js
Object.defineProperty(globalThis, "Text", {
  value: Text,
  writable: true,
  configurable: true
});
Object.defineProperty(globalThis, "Comment", {
  value: Comment,
  writable: true,
  configurable: true
});
Object.defineProperty(globalThis, "DocumentFragment", {
  value: DocumentFragment,
  writable: true,
  configurable: true
});
Object.defineProperty(globalThis, "DOMTokenList", {
  value: DOMTokenList,
  writable: true,
  configurable: true
});
Object.defineProperty(globalThis, "HTMLCanvasElement", {
  value: HTMLCanvasElement,
  writable: true,
  configurable: true
});
Object.defineProperty(globalThis, "HTMLImageElement", {
  value: HTMLImageElement,
  writable: true,
  configurable: true
});
Object.defineProperty(globalThis, "Image", {
  value: Image,
  writable: true,
  configurable: true
});
Object.defineProperty(globalThis, "document", {
  value: document2,
  writable: true,
  configurable: true
});
Object.defineProperty(globalThis, "MutationObserver", {
  value: MutationObserver,
  writable: true,
  configurable: true
});
Object.defineProperty(globalThis, "ResizeObserver", {
  value: ResizeObserver,
  writable: true,
  configurable: true
});
Object.defineProperty(globalThis, "IntersectionObserver", {
  value: IntersectionObserver,
  writable: true,
  configurable: true
});
if (typeof globalThis.self === "undefined") {
  Object.defineProperty(globalThis, "self", { value: globalThis, writable: true, configurable: true });
}
if (typeof globalThis.devicePixelRatio === "undefined") {
  Object.defineProperty(globalThis, "devicePixelRatio", { value: 1, writable: true, configurable: true });
}
if (typeof globalThis.alert === "undefined") {
  Object.defineProperty(globalThis, "alert", {
    value: (...args) => console.error("alert:", ...args),
    writable: true,
    configurable: true
  });
}

// lib/esm/webgl-rendering-context.js
init_console_gjs();

// ../../../node_modules/@girs/gwebgl-0.1/index.js
init_console_gjs();

// ../../../node_modules/@girs/gwebgl-0.1/gwebgl-0.1.js
init_console_gjs();
import Gwebgl from "gi://Gwebgl?version=0.1";
var gwebgl_0_1_default = Gwebgl;

// ../../../node_modules/@girs/gwebgl-0.1/index.js
var gwebgl_0_default = gwebgl_0_1_default;

// lib/esm/webgl-context-base.js
init_console_gjs();
var bits = __toESM(require_twiddle(), 1);
var import_string = __toESM(require_string(), 1);
import GdkPixbuf2 from "gi://GdkPixbuf?version=2.0";

// lib/esm/webgl-context-attributes.js
init_console_gjs();
var WebGLContextAttributes = class {
  constructor(alpha, depth, stencil, antialias, premultipliedAlpha, preserveDrawingBuffer, preferLowPowerToHighPerformance, failIfMajorPerformanceCaveat) {
    this.alpha = alpha;
    this.depth = depth;
    this.stencil = stencil;
    this.antialias = antialias;
    this.premultipliedAlpha = premultipliedAlpha;
    this.preserveDrawingBuffer = preserveDrawingBuffer;
    this.preferLowPowerToHighPerformance = preferLowPowerToHighPerformance;
    this.failIfMajorPerformanceCaveat = failIfMajorPerformanceCaveat;
    this.alpha = alpha;
    this.depth = depth;
    this.stencil = stencil;
    this.antialias = antialias;
    this.premultipliedAlpha = premultipliedAlpha;
    this.preserveDrawingBuffer = preserveDrawingBuffer;
    this.preferLowPowerToHighPerformance = preferLowPowerToHighPerformance;
    this.failIfMajorPerformanceCaveat = failIfMajorPerformanceCaveat;
  }
};

// lib/esm/utils.js
init_console_gjs();

// lib/esm/webgl-uniform-location.js
init_console_gjs();
var WebGLUniformLocation = class {
  constructor(_, program, info2) {
    this._linkCount = 0;
    this._array = null;
    this._ = _;
    this._program = program;
    this._linkCount = program._linkCount;
    this._activeInfo = info2;
    this._array = null;
  }
};

// lib/esm/utils.js
init_glib_2();
function checkObject(object) {
  return typeof object === "object" || object === void 0;
}
function checkUniform(program, location) {
  return location instanceof WebGLUniformLocation && location._program === program && location._linkCount === program._linkCount;
}
function isTypedArray(data) {
  return data instanceof Uint8Array || data instanceof Uint8ClampedArray || data instanceof Int8Array || data instanceof Uint16Array || data instanceof Int16Array || data instanceof Uint32Array || data instanceof Int32Array || data instanceof Float32Array || data instanceof Float64Array;
}
function isValidString(str) {
  const c = str.replace(/(?:\/\*(?:[\s\S]*?)\*\/)|(?:([\s;])+\/\/(?:.*)$)/gm, "");
  return !/["$`@\\'\0]/.test(c);
}
function vertexCount(gl, primitive, count2) {
  switch (primitive) {
    case gl.TRIANGLES:
      return count2 - count2 % 3;
    case gl.LINES:
      return count2 - count2 % 2;
    case gl.LINE_LOOP:
    case gl.POINTS:
      return count2;
    case gl.TRIANGLE_FAN:
    case gl.LINE_STRIP:
      if (count2 < 2) {
        return 0;
      }
      return count2;
    case gl.TRIANGLE_STRIP:
      if (count2 < 3) {
        return 0;
      }
      return count2;
    default:
      return -1;
  }
}
function typeSize(gl, type) {
  switch (type) {
    case gl.UNSIGNED_BYTE:
    case gl.BYTE:
      return 1;
    case gl.UNSIGNED_SHORT:
    case gl.SHORT:
      return 2;
    case gl.UNSIGNED_INT:
    case gl.INT:
    case gl.FLOAT:
      return 4;
  }
  return 0;
}
function uniformTypeSize(gl, type) {
  switch (type) {
    case gl.BOOL_VEC4:
    case gl.INT_VEC4:
    case gl.FLOAT_VEC4:
      return 4;
    case gl.BOOL_VEC3:
    case gl.INT_VEC3:
    case gl.FLOAT_VEC3:
      return 3;
    case gl.BOOL_VEC2:
    case gl.INT_VEC2:
    case gl.FLOAT_VEC2:
      return 2;
    case gl.BOOL:
    case gl.INT:
    case gl.FLOAT:
    case gl.SAMPLER_2D:
    case gl.SAMPLER_CUBE:
      return 1;
    default:
      return 0;
  }
}
var listToArray = (values) => {
  const array = [];
  for (const value2 of values.values()) {
    array.push(value2);
  }
  return array;
};
function arrayToUint8Array(array) {
  if (isTypedArray(array)) {
    return new Uint8Array(array.buffer).subarray(
      array.byteOffset,
      array.byteLength + array.byteOffset
    );
  }
  if (Array.isArray(array) || array instanceof ArrayBuffer) {
    return new Uint8Array(array);
  }
  if (typeof array.values === "function") {
    return new Uint8Array(listToArray(array));
  }
  throw new Error("Can't unpack typed array!");
}
function Uint8ArrayToVariant(array) {
  const variant = new glib_2_default.Variant("ay", array);
  return variant;
}
var extractImageData = (pixels) => {
  const width = pixels.width;
  const height = pixels.height;
  if (typeof pixels === "object" && typeof width !== "undefined" && typeof height !== "undefined") {
    if (typeof pixels.data !== "undefined") {
      return pixels;
    }
    let context = null;
    if (typeof pixels.getContext === "function") {
      context = pixels.getContext("2d");
    } else if (typeof pixels.isPixbuf()) {
      return pixels.getImageData();
    } else if (typeof pixels.src !== "undefined" && typeof document === "object" && typeof document.createElement === "function") {
      const canvas = document.createElement("canvas");
      if (typeof canvas === "object" && typeof canvas.getContext === "function") {
        canvas.width = width;
        canvas.height = height;
        context = canvas.getContext("2d");
        if (context !== null) {
          context.drawImage(pixels, 0, 0);
        }
      }
    }
    if (context !== null) {
      return context.getImageData(0, 0, width, height);
    }
  }
  return null;
};
function formatSize(gl, internalFormat) {
  switch (internalFormat) {
    case gl.ALPHA:
    case gl.LUMINANCE:
      return 1;
    case gl.LUMINANCE_ALPHA:
      return 2;
    case gl.RGB:
      return 3;
    case gl.RGBA:
      return 4;
  }
  return 0;
}
function convertPixels(pixels) {
  if (typeof pixels === "object" && pixels !== null) {
    if (pixels instanceof ArrayBuffer) {
      return new Uint8Array(pixels);
    } else if (pixels instanceof Uint8Array || pixels instanceof Uint16Array || pixels instanceof Uint8ClampedArray || pixels instanceof Float32Array) {
      return arrayToUint8Array(pixels);
    } else if (pixels instanceof Buffer) {
      return new Uint8Array(pixels);
    }
  }
  return null;
}
function checkFormat(gl, format) {
  return format === gl.ALPHA || format === gl.LUMINANCE_ALPHA || format === gl.LUMINANCE || format === gl.RGB || format === gl.RGBA;
}
function validCubeTarget(gl, target) {
  return target === gl.TEXTURE_CUBE_MAP_POSITIVE_X || target === gl.TEXTURE_CUBE_MAP_NEGATIVE_X || target === gl.TEXTURE_CUBE_MAP_POSITIVE_Y || target === gl.TEXTURE_CUBE_MAP_NEGATIVE_Y || target === gl.TEXTURE_CUBE_MAP_POSITIVE_Z || target === gl.TEXTURE_CUBE_MAP_NEGATIVE_Z;
}
function flag(options, name2, dflt) {
  if (!options || !(typeof options === "object") || !(name2 in options)) {
    return dflt;
  }
  return !!options[name2];
}

// lib/esm/extensions/oes-element-index-unit.js
init_console_gjs();
var OESElementIndexUint = class {
};
function getOESElementIndexUint(context) {
  let result = null;
  const exts = context.getSupportedExtensions();
  if (exts && exts.indexOf("OES_element_index_uint") >= 0) {
    result = new OESElementIndexUint();
  }
  return result;
}

// lib/esm/extensions/oes-standard-derivatives.js
init_console_gjs();
var OESStandardDerivatives = class {
  constructor() {
    this.FRAGMENT_SHADER_DERIVATIVE_HINT_OES = 35723;
  }
};
function getOESStandardDerivatives(context) {
  let result = null;
  const exts = context.getSupportedExtensions();
  if (exts && exts.indexOf("OES_standard_derivatives") >= 0) {
    result = new OESStandardDerivatives();
  }
  return result;
}

// lib/esm/extensions/oes-texture-float.js
init_console_gjs();
var OESTextureFloat = class {
};
function getOESTextureFloat(context) {
  let result = null;
  const exts = context.getSupportedExtensions();
  if (exts && exts.indexOf("OES_texture_float") >= 0) {
    result = new OESTextureFloat();
  }
  return result;
}

// lib/esm/extensions/oes-texture-float-linear.js
init_console_gjs();
var OESTextureFloatLinear = class {
};
function getOESTextureFloatLinear(context) {
  let result = null;
  const exts = context.getSupportedExtensions();
  if (exts && exts.indexOf("OES_texture_float_linear") >= 0) {
    result = new OESTextureFloatLinear();
  }
  return result;
}

// lib/esm/extensions/stackgl-destroy-context.js
init_console_gjs();
var STACKGLDestroyContext = class {
  constructor(ctx) {
    this.destroy = ctx.destroy.bind(ctx);
  }
};
function getSTACKGLDestroyContext(ctx) {
  return new STACKGLDestroyContext(ctx);
}

// lib/esm/extensions/stackgl-resize-drawing-buffer.js
init_console_gjs();
var STACKGLResizeDrawingBuffer = class {
  constructor(ctx) {
    this.resize = ctx.resize.bind(ctx);
  }
};
function getSTACKGLResizeDrawingBuffer(ctx) {
  return new STACKGLResizeDrawingBuffer(ctx);
}

// lib/esm/extensions/ext-blend-minmax.js
init_console_gjs();
var EXTBlendMinMax = class {
  constructor() {
    this.MIN_EXT = 32775;
    this.MAX_EXT = 32776;
  }
};
function getEXTBlendMinMax(context) {
  let result = null;
  const exts = context.getSupportedExtensions();
  if (exts && exts.indexOf("EXT_blend_minmax") >= 0) {
    result = new EXTBlendMinMax();
  }
  return result;
}

// lib/esm/extensions/ext-color-buffer-float.js
init_console_gjs();
var EXTColorBufferFloat = class {
};
function getEXTColorBufferFloat(context) {
  const exts = context.getSupportedExtensions();
  if (exts && exts.indexOf("EXT_color_buffer_float") >= 0) {
    return new EXTColorBufferFloat();
  }
  return null;
}

// lib/esm/extensions/ext-color-buffer-half-float.js
init_console_gjs();
var EXTColorBufferHalfFloat = class {
};
function getEXTColorBufferHalfFloat(context) {
  const exts = context.getSupportedExtensions();
  if (exts && exts.indexOf("EXT_color_buffer_half_float") >= 0) {
    return new EXTColorBufferHalfFloat();
  }
  return null;
}

// lib/esm/extensions/ext-texture-filter-anisotropic.js
init_console_gjs();
var EXTTextureFilterAnisotropic = class {
  constructor() {
    this.TEXTURE_MAX_ANISOTROPY_EXT = 34046;
    this.MAX_TEXTURE_MAX_ANISOTROPY_EXT = 34047;
  }
};
function getEXTTextureFilterAnisotropic(context) {
  let result = null;
  const exts = context.getSupportedExtensions();
  if (exts && exts.indexOf("EXT_texture_filter_anisotropic") >= 0) {
    result = new EXTTextureFilterAnisotropic();
  }
  return result;
}

// lib/esm/extensions/oes-texture-half-float.js
init_console_gjs();
var OESTextureHalfFloat = class {
  constructor() {
    this.HALF_FLOAT_OES = 36193;
  }
};
function getOESTextureHalfFloat(context) {
  const exts = context.getSupportedExtensions();
  if (exts && exts.indexOf("OES_texture_half_float") >= 0) {
    return new OESTextureHalfFloat();
  }
  if (context._native2) {
    return new OESTextureHalfFloat();
  }
  return null;
}

// lib/esm/webgl-active-info.js
init_console_gjs();
var WebGLActiveInfo = class {
  constructor(_) {
    this.size = _.size;
    this.type = _.type;
    this.name = _.name;
  }
};

// lib/esm/webgl-framebuffer.js
init_console_gjs();

// lib/esm/linkable.js
init_console_gjs();
var Linkable = class {
  constructor(_) {
    this._ = 0;
    this._references = [];
    this._refCount = 0;
    this._pendingDelete = false;
    this._binding = 0;
    this._ = _;
    this._references = [];
    this._refCount = 0;
    this._pendingDelete = false;
    this._binding = 0;
  }
  _link(b) {
    this._references.push(b);
    b._refCount += 1;
    return true;
  }
  _unlink(b) {
    let idx = this._references.indexOf(b);
    if (idx < 0) {
      return false;
    }
    while (idx >= 0) {
      this._references[idx] = this._references[this._references.length - 1];
      this._references.pop();
      b._refCount -= 1;
      b._checkDelete();
      idx = this._references.indexOf(b);
    }
    return true;
  }
  _linked(b) {
    return this._references.indexOf(b) >= 0;
  }
  _checkDelete() {
    if (this._refCount <= 0 && this._pendingDelete && this._ !== 0) {
      while (this._references.length > 0) {
        this._unlink(this._references[0]);
      }
      this._performDelete();
      this._ = 0;
    }
  }
  _performDelete() {
  }
};

// lib/esm/webgl-framebuffer.js
var WebGLFramebuffer = class extends Linkable {
  constructor(_, ctx) {
    super(_);
    this._binding = 0;
    this._width = 0;
    this._height = 0;
    this._status = null;
    this._ctx = ctx;
    this._attachments = {};
    this._attachments[ctx.COLOR_ATTACHMENT0] = null;
    this._attachments[ctx.DEPTH_ATTACHMENT] = null;
    this._attachments[ctx.STENCIL_ATTACHMENT] = null;
    this._attachments[ctx.DEPTH_STENCIL_ATTACHMENT] = null;
    this._attachmentLevel = {};
    this._attachmentLevel[ctx.COLOR_ATTACHMENT0] = 0;
    this._attachmentLevel[ctx.DEPTH_ATTACHMENT] = 0;
    this._attachmentLevel[ctx.STENCIL_ATTACHMENT] = 0;
    this._attachmentLevel[ctx.DEPTH_STENCIL_ATTACHMENT] = 0;
    this._attachmentFace = {};
    this._attachmentFace[ctx.COLOR_ATTACHMENT0] = 0;
    this._attachmentFace[ctx.DEPTH_ATTACHMENT] = 0;
    this._attachmentFace[ctx.STENCIL_ATTACHMENT] = 0;
    this._attachmentFace[ctx.DEPTH_STENCIL_ATTACHMENT] = 0;
    if (ctx._extensions.webgl_draw_buffers) {
      const webGLDrawBuffers = ctx._extensions.webgl_draw_buffers;
      this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT1_WEBGL] = null;
      this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT2_WEBGL] = null;
      this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT3_WEBGL] = null;
      this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT4_WEBGL] = null;
      this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT5_WEBGL] = null;
      this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT6_WEBGL] = null;
      this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT7_WEBGL] = null;
      this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT8_WEBGL] = null;
      this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT9_WEBGL] = null;
      this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT10_WEBGL] = null;
      this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT11_WEBGL] = null;
      this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT12_WEBGL] = null;
      this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT13_WEBGL] = null;
      this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT14_WEBGL] = null;
      this._attachments[webGLDrawBuffers.COLOR_ATTACHMENT15_WEBGL] = null;
      this._attachments[ctx.NONE] = null;
      this._attachments[ctx.BACK] = null;
      this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT1_WEBGL] = 0;
      this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT2_WEBGL] = 0;
      this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT3_WEBGL] = 0;
      this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT4_WEBGL] = 0;
      this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT5_WEBGL] = 0;
      this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT6_WEBGL] = 0;
      this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT7_WEBGL] = 0;
      this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT8_WEBGL] = 0;
      this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT9_WEBGL] = 0;
      this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT10_WEBGL] = 0;
      this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT11_WEBGL] = 0;
      this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT12_WEBGL] = 0;
      this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT13_WEBGL] = 0;
      this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT14_WEBGL] = 0;
      this._attachmentLevel[webGLDrawBuffers.COLOR_ATTACHMENT15_WEBGL] = 0;
      this._attachmentLevel[ctx.NONE] = null;
      this._attachmentLevel[ctx.BACK] = null;
      this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT1_WEBGL] = 0;
      this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT2_WEBGL] = 0;
      this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT3_WEBGL] = 0;
      this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT4_WEBGL] = 0;
      this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT5_WEBGL] = 0;
      this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT6_WEBGL] = 0;
      this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT7_WEBGL] = 0;
      this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT8_WEBGL] = 0;
      this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT9_WEBGL] = 0;
      this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT10_WEBGL] = 0;
      this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT11_WEBGL] = 0;
      this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT12_WEBGL] = 0;
      this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT13_WEBGL] = 0;
      this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT14_WEBGL] = 0;
      this._attachmentFace[webGLDrawBuffers.COLOR_ATTACHMENT15_WEBGL] = 0;
      this._attachmentFace[ctx.NONE] = null;
      this._attachmentFace[ctx.BACK] = null;
    }
  }
  _clearAttachment(attachment) {
    const object = this._attachments[attachment];
    if (!object) {
      return;
    }
    this._attachments[attachment] = null;
    this._unlink(object);
  }
  _setAttachment(object, attachment) {
    const prevObject = this._attachments[attachment];
    if (prevObject === object) {
      return;
    }
    this._clearAttachment(attachment);
    if (!object) {
      return;
    }
    this._attachments[attachment] = object;
    this._link(object);
  }
  _performDelete() {
    const ctx = this._ctx;
    delete ctx._framebuffers[this._ | 0];
    ctx._gl.deleteFramebuffer(this._ | 0);
  }
};

// lib/esm/webgl-buffer.js
init_console_gjs();
var WebGLBuffer = class extends Linkable {
  constructor(_, ctx) {
    super(_);
    this._size = 0;
    this._elements = new Uint8Array(0);
    this._ctx = ctx;
  }
  _performDelete() {
    const ctx = this._ctx;
    delete ctx._buffers[this._ | 0];
    ctx._gl.deleteBuffer(this._);
  }
};

// lib/esm/webgl-drawing-buffer-wrapper.js
init_console_gjs();
var WebGLDrawingBufferWrapper = class {
  constructor(framebuffer, color, depthStencil) {
    this._framebuffer = framebuffer;
    this._color = color;
    this._depthStencil = depthStencil;
  }
};

// lib/esm/webgl-program.js
init_console_gjs();
var WebGLProgram = class extends Linkable {
  constructor(_, ctx) {
    super(_);
    this._linkCount = 0;
    this._linkStatus = false;
    this._linkInfoLog = "not linked";
    this._attributes = [];
    this._uniforms = [];
    this._ctx = ctx;
    this._linkCount = 0;
    this._linkStatus = false;
    this._linkInfoLog = "not linked";
    this._attributes = [];
    this._uniforms = [];
  }
  _performDelete() {
    const ctx = this._ctx;
    delete ctx._programs[this._ | 0];
    ctx._gl.deleteProgram(this._ | 0);
  }
};

// lib/esm/webgl-renderbuffer.js
init_console_gjs();
var WebGLRenderbuffer = class extends Linkable {
  constructor(_, ctx) {
    super(_);
    this._binding = 0;
    this._width = 0;
    this._height = 0;
    this._format = 0;
    this._ctx = ctx;
    this._binding = 0;
    this._width = 0;
    this._height = 0;
    this._format = 0;
  }
  _performDelete() {
    const ctx = this._ctx;
    delete ctx._renderbuffers[this._ | 0];
    ctx._gl.deleteRenderbuffer(this._);
  }
};

// lib/esm/webgl-shader.js
init_console_gjs();
var WebGLShader = class extends Linkable {
  constructor(_, ctx, type) {
    super(_);
    this._source = "";
    this._compileStatus = false;
    this._compileInfo = "";
    this._type = type;
    this._ctx = ctx;
    this._source = "";
    this._compileStatus = false;
    this._compileInfo = "";
  }
  _performDelete() {
    const ctx = this._ctx;
    delete ctx._shaders[this._ | 0];
    ctx._gl.deleteShader(this._ | 0);
  }
};

// lib/esm/webgl-shader-precision-format.js
init_console_gjs();
var WebGLShaderPrecisionFormat = class {
  constructor(_) {
    this.rangeMin = _.rangeMin;
    this.rangeMax = _.rangeMax;
    this.precision = _.precision;
  }
};

// lib/esm/webgl-texture-unit.js
init_console_gjs();
var WebGLTextureUnit = class {
  constructor(ctx, idx) {
    this._mode = 0;
    this._bind2D = null;
    this._bindCube = null;
    this._ctx = ctx;
    this._idx = idx;
  }
};

// lib/esm/webgl-texture.js
init_console_gjs();
var WebGLTexture = class extends Linkable {
  constructor(_, ctx) {
    super(_);
    this._binding = 0;
    this._levelWidth = new Int32Array(32);
    this._levelHeight = new Int32Array(32);
    this._format = 0;
    this._type = 0;
    this._complete = true;
    this._ctx = ctx;
  }
  _performDelete() {
    const ctx = this._ctx;
    delete ctx._textures[this._ | 0];
    ctx._gl.deleteTexture(this._ | 0);
  }
};

// lib/esm/webgl-vertex-attribute.js
init_console_gjs();
var WebGLVertexArrayObjectAttribute = class {
  constructor(ctx, idx) {
    this._isPointer = false;
    this._pointerBuffer = null;
    this._pointerOffset = 0;
    this._pointerSize = 0;
    this._pointerStride = 0;
    this._pointerType = 0;
    this._pointerNormal = false;
    this._divisor = 0;
    this._inputSize = 4;
    this._inputStride = 0;
    this._ctx = ctx;
    this._idx = idx;
    this._pointerType = ctx.FLOAT;
    this._clear();
  }
  _clear() {
    this._isPointer = false;
    this._pointerBuffer = null;
    this._pointerOffset = 0;
    this._pointerSize = 0;
    this._pointerStride = 0;
    this._pointerType = this._ctx.FLOAT;
    this._pointerNormal = false;
    this._divisor = 0;
    this._inputSize = 4;
    this._inputStride = 0;
  }
};
var WebGLVertexArrayGlobalAttribute = class {
  constructor(idx) {
    this._idx = 0;
    this._idx = idx;
    this._data = new Float32Array([0, 0, 0, 1]);
  }
};
var WebGLVertexArrayObjectState = class {
  constructor(ctx) {
    this._elementArrayBufferBinding = null;
    const numAttribs = ctx.getParameter(ctx.MAX_VERTEX_ATTRIBS);
    this._attribs = new Array(numAttribs);
    for (let i = 0; i < numAttribs; ++i) {
      this._attribs[i] = new WebGLVertexArrayObjectAttribute(ctx, i);
    }
    this._elementArrayBufferBinding = null;
  }
  setElementArrayBuffer(buffer) {
    if (buffer !== null && !(buffer instanceof WebGLBuffer)) {
      throw new TypeError("setElementArrayBuffer(WebGLBuffer?)");
    }
    const current = this._elementArrayBufferBinding;
    if (current !== buffer) {
      if (current) {
        current._refCount -= 1;
        current._checkDelete();
      }
      if (buffer) {
        buffer._refCount += 1;
      }
      this._elementArrayBufferBinding = buffer;
    }
  }
  cleanUp() {
    const elementArrayBuffer = this._elementArrayBufferBinding;
    if (elementArrayBuffer) {
      elementArrayBuffer._refCount -= 1;
      elementArrayBuffer._checkDelete();
      this._elementArrayBufferBinding = null;
    }
    for (let i = 0; i < this._attribs.length; ++i) {
      const attrib = this._attribs[i];
      if (attrib._pointerBuffer) {
        attrib._pointerBuffer._refCount -= 1;
        attrib._pointerBuffer._checkDelete();
      }
      attrib._clear();
    }
  }
  releaseArrayBuffer(buffer) {
    if (!buffer) {
      return;
    }
    for (let i = 0; i < this._attribs.length; ++i) {
      const attrib = this._attribs[i];
      if (attrib._pointerBuffer === buffer) {
        attrib._pointerBuffer._refCount -= 1;
        attrib._pointerBuffer._checkDelete();
        attrib._clear();
      }
    }
  }
  setVertexAttribPointer(buffer, index, pointerSize, pointerOffset, pointerStride, pointerType, pointerNormal, inputStride, inputSize) {
    const attrib = this._attribs[index];
    if (buffer !== attrib._pointerBuffer) {
      if (attrib._pointerBuffer) {
        attrib._pointerBuffer._refCount -= 1;
        attrib._pointerBuffer._checkDelete();
      }
      if (buffer) {
        buffer._refCount += 1;
      }
      attrib._pointerBuffer = buffer;
    }
    attrib._pointerSize = pointerSize;
    attrib._pointerOffset = pointerOffset;
    attrib._pointerStride = pointerStride;
    attrib._pointerType = pointerType;
    attrib._pointerNormal = pointerNormal;
    attrib._inputStride = inputStride;
    attrib._inputSize = inputSize;
  }
};
var WebGLVertexArrayGlobalState = class {
  constructor(ctx) {
    this._arrayBufferBinding = null;
    const numAttribs = ctx.getParameter(ctx.MAX_VERTEX_ATTRIBS);
    this._attribs = new Array(numAttribs);
    for (let i = 0; i < numAttribs; ++i) {
      this._attribs[i] = new WebGLVertexArrayGlobalAttribute(i);
    }
    this._arrayBufferBinding = null;
  }
  setArrayBuffer(buffer) {
    if (buffer !== null && !(buffer instanceof WebGLBuffer)) {
      throw new TypeError("setArrayBuffer(WebGLBuffer?)");
    }
    const current = this._arrayBufferBinding;
    if (current !== buffer) {
      if (current) {
        current._refCount -= 1;
        current._checkDelete();
      }
      if (buffer) {
        buffer._refCount += 1;
      }
      this._arrayBufferBinding = buffer;
    }
  }
};

// lib/esm/webgl-context-base.js
init_esm4();
var VERSION = "0.0.1";
var CONTEXT_COUNTER = 0;
var MAX_UNIFORM_LENGTH = 256;
var MAX_ATTRIBUTE_LENGTH = 256;
var availableExtensions = {
  // angle_instanced_arrays: getANGLEInstancedArrays,
  oes_element_index_uint: getOESElementIndexUint,
  oes_texture_float: getOESTextureFloat,
  oes_texture_float_linear: getOESTextureFloatLinear,
  oes_standard_derivatives: getOESStandardDerivatives,
  // oes_vertex_array_object: getOESVertexArrayObject,
  stackgl_destroy_context: getSTACKGLDestroyContext,
  stackgl_resize_drawingbuffer: getSTACKGLResizeDrawingBuffer,
  // webgl_draw_buffers: getWebGLDrawBuffers,
  ext_blend_minmax: getEXTBlendMinMax,
  ext_color_buffer_float: getEXTColorBufferFloat,
  ext_color_buffer_half_float: getEXTColorBufferHalfFloat,
  ext_texture_filter_anisotropic: getEXTTextureFilterAnisotropic,
  oes_texture_half_float: getOESTextureHalfFloat
};
var WebGLContextBase = class {
  constructor(canvas, options = {}) {
    this.unpackColorSpace = "srgb";
    this.RGBA8 = 32856;
    this.DEFAULT_ATTACHMENTS = [];
    this.DEFAULT_COLOR_ATTACHMENTS = [];
    this._ = 0;
    this._extensions = {};
    this._programs = {};
    this._shaders = {};
    this._textures = {};
    this._framebuffers = {};
    this._renderbuffers = {};
    this._buffers = {};
    this._activeProgram = null;
    this._activeFramebuffer = null;
    this._activeRenderbuffer = null;
    this._checkStencil = false;
    this._stencilState = true;
    this._activeTextureUnit = 0;
    this._errorStack = [];
    this._maxTextureSize = 0;
    this._maxTextureLevel = 0;
    this._maxCubeMapSize = 0;
    this._maxCubeMapLevel = 0;
    this._unpackAlignment = 4;
    this._packAlignment = 4;
    this._viewport = new Int32Array([0, 0, 0, 0]);
    this._scissorBox = new Int32Array([0, 0, 0, 0]);
    this._gtkFboId = 0;
    this._textureUnits = [];
    this._drawingBuffer = null;
    this.canvas = canvas;
    this._contextAttributes = new WebGLContextAttributes(
      flag(options, "alpha", true),
      flag(options, "depth", true),
      flag(options, "stencil", false),
      false,
      // flag(options, 'antialias', true),
      flag(options, "premultipliedAlpha", true),
      flag(options, "preserveDrawingBuffer", false),
      flag(options, "preferLowPowerToHighPerformance", false),
      flag(options, "failIfMajorPerformanceCaveat", false)
    );
    this._contextAttributes.premultipliedAlpha = this._contextAttributes.premultipliedAlpha && this._contextAttributes.alpha;
  }
  get drawingBufferHeight() {
    return this.canvas.height || 0;
  }
  get drawingBufferWidth() {
    return this.canvas.width || 0;
  }
  /**
   * Must be called by subclass constructors AFTER setting up the native GL object
   * so that `this._gl` is available for GL-dependent initialization.
   */
  _init() {
    const gtkFboVariant = this._gl.getParameterx(36006);
    this._gtkFboId = gtkFboVariant?.deepUnpack() | 0;
    this._initGLConstants();
    this.DEFAULT_ATTACHMENTS = [
      this.COLOR_ATTACHMENT0,
      this.DEPTH_ATTACHMENT,
      this.STENCIL_ATTACHMENT,
      this.DEPTH_STENCIL_ATTACHMENT
    ];
    this.DEFAULT_COLOR_ATTACHMENTS = [this.COLOR_ATTACHMENT0];
    const options = this._contextAttributes;
    const width = this.drawingBufferWidth || options.width || 0;
    const height = this.drawingBufferHeight || options.height || 0;
    this._ = CONTEXT_COUNTER++;
    const numTextures = this.getParameter(this.MAX_COMBINED_TEXTURE_IMAGE_UNITS);
    this._textureUnits = new Array(numTextures);
    for (let i = 0; i < numTextures; ++i) {
      this._textureUnits[i] = new WebGLTextureUnit(this, i);
    }
    this.activeTexture(this.TEXTURE0);
    this._defaultVertexObjectState = new WebGLVertexArrayObjectState(this);
    this._vertexObjectState = this._defaultVertexObjectState;
    this._vertexGlobalState = new WebGLVertexArrayGlobalState(this);
    this._maxTextureSize = this.getParameter(this.MAX_TEXTURE_SIZE);
    this._maxTextureLevel = bits.log2(bits.nextPow2(this._maxTextureSize));
    this._maxCubeMapSize = this.getParameter(this.MAX_CUBE_MAP_TEXTURE_SIZE);
    this._maxCubeMapLevel = bits.log2(bits.nextPow2(this._maxCubeMapSize));
    this._unpackAlignment = 4;
    this._packAlignment = 4;
    this.bindBuffer(this.ARRAY_BUFFER, null);
    this.bindBuffer(this.ELEMENT_ARRAY_BUFFER, null);
    this.bindFramebuffer(this.FRAMEBUFFER, null);
    this.bindRenderbuffer(this.RENDERBUFFER, null);
    this.viewport(0, 0, width, height);
    this.scissor(0, 0, width, height);
    this.clearDepth(1);
    this.clearColor(0, 0, 0, 0);
    this.clearStencil(0);
    this.clear(this.COLOR_BUFFER_BIT | this.DEPTH_BUFFER_BIT | this.STENCIL_BUFFER_BIT);
  }
  _initGLConstants() {
    const giBaseClass = new gwebgl_0_default.WebGLRenderingContextBase();
    const hash = giBaseClass.get_webgl_constants();
    for (const [k, v] of Object.entries(hash)) {
      Object.defineProperty(this, k, { value: v });
    }
  }
  _getGlslVersion(es) {
    return es ? "100" : "120";
  }
  // extWEBGL_draw_buffers() {
  //     return this._gl.extWEBGL_draw_buffers().deepUnpack<Record<string, number>>();
  // }
  _checkDimensions(target, width, height, level) {
    if (level < 0 || width < 0 || height < 0) {
      this.setError(this.INVALID_VALUE);
      return false;
    }
    if (target === this.TEXTURE_2D) {
      if (width > this._maxTextureSize || height > this._maxTextureSize || level > this._maxTextureLevel) {
        this.setError(this.INVALID_VALUE);
        return false;
      }
    } else if (this._validCubeTarget(target)) {
      if (width > this._maxCubeMapSize || height > this._maxCubeMapSize || level > this._maxCubeMapLevel) {
        this.setError(this.INVALID_VALUE);
        return false;
      }
    } else {
      this.setError(this.INVALID_ENUM);
      return false;
    }
    return true;
  }
  _checkLocation(location) {
    if (!(location instanceof WebGLUniformLocation)) {
      this.setError(this.INVALID_VALUE);
      return false;
    } else if (location._program._ctx !== this || location._linkCount !== location._program._linkCount) {
      this.setError(this.INVALID_OPERATION);
      return false;
    }
    return true;
  }
  _checkLocationActive(location) {
    if (!location) {
      return false;
    } else if (!this._checkLocation(location)) {
      return false;
    } else if (location._program !== this._activeProgram) {
      this.setError(this.INVALID_OPERATION);
      return false;
    }
    return true;
  }
  _checkOwns(object) {
    return typeof object === "object" && object._ctx === this;
  }
  _checkShaderSource(shader) {
    const source = shader._source;
    const tokens = (0, import_string.default)(source);
    let errorStatus = false;
    const errorLog = [];
    for (let i = 0; i < tokens.length; ++i) {
      const tok = tokens[i];
      if (!tok) continue;
      switch (tok.type) {
        case "ident":
          if (!this._validGLSLIdentifier(tok.data)) {
            errorStatus = true;
            errorLog.push(tok.line + ":" + tok.column + " invalid identifier - " + tok.data);
          }
          break;
        case "preprocessor": {
          const match2 = tok.data.match(/^\s*#\s*(.*)$/);
          if (!match2 || match2?.length < 2) {
            break;
          }
          const bodyToks = (0, import_string.default)(match2[1]);
          for (let j = 0; j < bodyToks.length; ++j) {
            const btok = bodyToks[j];
            if (btok.type === "ident" || btok.type === void 0) {
              if (!this._validGLSLIdentifier(btok.data)) {
                errorStatus = true;
                errorLog.push(tok.line + ":" + btok.column + " invalid identifier - " + btok.data);
              }
            }
          }
          break;
        }
        case "keyword":
          switch (tok.data) {
            case "do":
              errorStatus = true;
              errorLog.push(tok.line + ":" + tok.column + " do not supported");
              break;
          }
          break;
        case "builtin":
          switch (tok.data) {
            case "dFdx":
            case "dFdy":
            case "fwidth":
              if (!this._extensions.oes_standard_derivatives && this._getGlslVersion(true) === "100") {
                errorStatus = true;
                errorLog.push(tok.line + ":" + tok.column + " " + tok.data + " not supported");
              }
              break;
          }
      }
    }
    if (errorStatus) {
      shader._compileInfo = errorLog.join("\n");
    }
    return !errorStatus;
  }
  _checkStencilState() {
    if (!this._checkStencil) {
      return this._stencilState;
    }
    this._checkStencil = false;
    this._stencilState = true;
    if (this.getParameter(this.STENCIL_WRITEMASK) !== this.getParameter(this.STENCIL_BACK_WRITEMASK) || this.getParameter(this.STENCIL_VALUE_MASK) !== this.getParameter(this.STENCIL_BACK_VALUE_MASK) || this.getParameter(this.STENCIL_REF) !== this.getParameter(this.STENCIL_BACK_REF)) {
      this.setError(this.INVALID_OPERATION);
      this._stencilState = false;
    }
    return this._stencilState;
  }
  _checkTextureTarget(target) {
    const unit = this._getActiveTextureUnit();
    let tex = null;
    if (target === this.TEXTURE_2D) {
      tex = unit._bind2D;
    } else if (target === this.TEXTURE_CUBE_MAP) {
      tex = unit._bindCube;
    } else {
      this.setError(this.INVALID_ENUM);
      return false;
    }
    if (!tex) {
      this.setError(this.INVALID_OPERATION);
      return false;
    }
    return true;
  }
  _checkWrapper(object, Wrapper) {
    if (!this._checkValid(object, Wrapper)) {
      this.setError(this.INVALID_VALUE);
      return false;
    } else if (!this._checkOwns(object)) {
      this.setError(this.INVALID_OPERATION);
      return false;
    }
    return true;
  }
  _checkValid(object, Type) {
    return object instanceof Type && object._ !== 0;
  }
  _checkVertexAttribState(maxIndex) {
    const program = this._activeProgram;
    if (!program) {
      this.setError(this.INVALID_OPERATION);
      return false;
    }
    const attribs = this._vertexObjectState._attribs;
    for (let i = 0; i < attribs.length; ++i) {
      const attrib = attribs[i];
      if (attrib._isPointer) {
        const buffer = attrib._pointerBuffer;
        if (!buffer) {
          this.setError(this.INVALID_OPERATION);
          return false;
        }
        if (program._attributes.indexOf(i) >= 0) {
          let maxByte = 0;
          if (attrib._divisor) {
            maxByte = attrib._pointerSize + attrib._pointerOffset;
          } else {
            maxByte = attrib._pointerStride * maxIndex + attrib._pointerSize + attrib._pointerOffset;
          }
          if (maxByte > buffer._size) {
            this.setError(this.INVALID_OPERATION);
            return false;
          }
        }
      }
    }
    return true;
  }
  _checkVertexIndex(index) {
    if (index < 0 || index >= this._vertexObjectState._attribs.length) {
      this.setError(this.INVALID_VALUE);
      return false;
    }
    return true;
  }
  _computePixelSize(type, internalFormat) {
    const pixelSize = formatSize(this, internalFormat);
    if (pixelSize === 0) {
      this.setError(this.INVALID_ENUM);
      return 0;
    }
    switch (type) {
      case this.UNSIGNED_BYTE:
        return pixelSize;
      case this.UNSIGNED_SHORT_5_6_5:
        if (internalFormat !== this.RGB) {
          this.setError(this.INVALID_OPERATION);
          break;
        }
        return 2;
      case this.UNSIGNED_SHORT_4_4_4_4:
      case this.UNSIGNED_SHORT_5_5_5_1:
        if (internalFormat !== this.RGBA) {
          this.setError(this.INVALID_OPERATION);
          break;
        }
        return 2;
      case this.FLOAT:
        return 1;
    }
    this.setError(this.INVALID_ENUM);
    return 0;
  }
  _computeRowStride(width, pixelSize) {
    let rowStride = width * pixelSize;
    if (rowStride % this._unpackAlignment) {
      rowStride += this._unpackAlignment - rowStride % this._unpackAlignment;
    }
    return rowStride;
  }
  _fixupLink(program) {
    if (!this._gl.getProgramParameter(program._, this.LINK_STATUS)) {
      program._linkInfoLog = this._gl.getProgramInfoLog(program._);
      return false;
    }
    const numAttribs = this.getProgramParameter(program, this.ACTIVE_ATTRIBUTES);
    const names = new Array(numAttribs);
    program._attributes.length = numAttribs;
    for (let i = 0; i < numAttribs; ++i) {
      names[i] = this.getActiveAttrib(program, i)?.name;
      program._attributes[i] = this.getAttribLocation(program, names[i]) | 0;
    }
    for (let i = 0; i < names.length; ++i) {
      if (names[i].length > MAX_ATTRIBUTE_LENGTH) {
        program._linkInfoLog = "attribute " + names[i] + " is too long";
        return false;
      }
    }
    for (let i = 0; i < numAttribs; ++i) {
      if (program._attributes[i] < 0) continue;
      this._gl.bindAttribLocation(
        program._ | 0,
        program._attributes[i],
        names[i]
      );
    }
    this._gl.linkProgram(program._ | 0);
    if (!this._gl.getProgramParameter(program._ | 0, this.LINK_STATUS)) {
      program._linkInfoLog = this._gl.getProgramInfoLog(program._);
      return false;
    }
    const numUniforms = this.getProgramParameter(program, this.ACTIVE_UNIFORMS);
    program._uniforms.length = numUniforms;
    for (let i = 0; i < numUniforms; ++i) {
      const info2 = this.getActiveUniform(program, i);
      if (info2) program._uniforms[i] = info2;
    }
    for (let i = 0; i < program._uniforms.length; ++i) {
      if (program._uniforms[i].name.length > MAX_UNIFORM_LENGTH) {
        program._linkInfoLog = "uniform " + program._uniforms[i].name + " is too long";
        return false;
      }
    }
    program._linkInfoLog = "";
    return true;
  }
  _framebufferOk() {
    const framebuffer = this._activeFramebuffer;
    if (framebuffer && this._preCheckFramebufferStatus(framebuffer) !== this.FRAMEBUFFER_COMPLETE) {
      this.setError(this.INVALID_FRAMEBUFFER_OPERATION);
      return false;
    }
    return true;
  }
  _getActiveBuffer(target) {
    if (target === this.ARRAY_BUFFER) {
      return this._vertexGlobalState._arrayBufferBinding;
    } else if (target === this.ELEMENT_ARRAY_BUFFER) {
      return this._vertexObjectState._elementArrayBufferBinding;
    }
    return null;
  }
  _getActiveTextureUnit() {
    return this._textureUnits[this._activeTextureUnit];
  }
  _getActiveTexture(target) {
    const activeUnit = this._getActiveTextureUnit();
    if (target === this.TEXTURE_2D) {
      return activeUnit._bind2D;
    } else if (target === this.TEXTURE_CUBE_MAP) {
      return activeUnit._bindCube;
    }
    return null;
  }
  _getAttachments() {
    return this._extensions.webgl_draw_buffers ? this._extensions.webgl_draw_buffers._ALL_ATTACHMENTS : this.DEFAULT_ATTACHMENTS;
  }
  _getColorAttachments() {
    return this._extensions.webgl_draw_buffers ? this._extensions.webgl_draw_buffers._ALL_COLOR_ATTACHMENTS : this.DEFAULT_COLOR_ATTACHMENTS;
  }
  _getParameterDirect(pname) {
    return this._gl.getParameterx(pname)?.deepUnpack();
  }
  _getTexImage(target) {
    const unit = this._getActiveTextureUnit();
    if (target === this.TEXTURE_2D) {
      return unit._bind2D;
    } else if (validCubeTarget(this, target)) {
      return unit._bindCube;
    }
    this.setError(this.INVALID_ENUM);
    return null;
  }
  _preCheckFramebufferStatus(framebuffer) {
    const attachments = framebuffer._attachments;
    const width = [];
    const height = [];
    const depthAttachment = attachments[this.DEPTH_ATTACHMENT];
    const depthStencilAttachment = attachments[this.DEPTH_STENCIL_ATTACHMENT];
    const stencilAttachment = attachments[this.STENCIL_ATTACHMENT];
    if (depthStencilAttachment && (stencilAttachment || depthAttachment) || stencilAttachment && depthAttachment) {
      return this.FRAMEBUFFER_UNSUPPORTED;
    }
    const colorAttachments = this._getColorAttachments();
    let colorAttachmentCount = 0;
    for (const attachmentEnum in attachments) {
      if (attachments[attachmentEnum] && colorAttachments.indexOf(Number(attachmentEnum)) !== -1) {
        colorAttachmentCount++;
      }
    }
    if (colorAttachmentCount === 0) {
      return this.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT;
    }
    if (depthStencilAttachment instanceof WebGLTexture) {
      return this.FRAMEBUFFER_UNSUPPORTED;
    } else if (depthStencilAttachment instanceof WebGLRenderbuffer) {
      if (depthStencilAttachment._format !== this.DEPTH_STENCIL) {
        return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
      }
      width.push(depthStencilAttachment._width);
      height.push(depthStencilAttachment._height);
    }
    if (depthAttachment instanceof WebGLTexture) {
      return this.FRAMEBUFFER_UNSUPPORTED;
    } else if (depthAttachment instanceof WebGLRenderbuffer) {
      if (depthAttachment._format !== this.DEPTH_COMPONENT16) {
        return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
      }
      width.push(depthAttachment._width);
      height.push(depthAttachment._height);
    }
    if (stencilAttachment instanceof WebGLTexture) {
      return this.FRAMEBUFFER_UNSUPPORTED;
    } else if (stencilAttachment instanceof WebGLRenderbuffer) {
      if (stencilAttachment._format !== this.STENCIL_INDEX8) {
        return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
      }
      width.push(stencilAttachment._width);
      height.push(stencilAttachment._height);
    }
    let colorAttached = false;
    for (let i = 0; i < colorAttachments.length; ++i) {
      const colorAttachment = attachments[colorAttachments[i]];
      if (colorAttachment instanceof WebGLTexture) {
        if (colorAttachment._format !== this.RGBA || !(colorAttachment._type === this.UNSIGNED_BYTE || colorAttachment._type === this.FLOAT)) {
          return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
        }
        colorAttached = true;
        const level = framebuffer._attachmentLevel[this.COLOR_ATTACHMENT0];
        if (level === null) throw new TypeError("level is null!");
        width.push(colorAttachment._levelWidth[level]);
        height.push(colorAttachment._levelHeight[level]);
      } else if (colorAttachment instanceof WebGLRenderbuffer) {
        const format = colorAttachment._format;
        if (format !== this.RGBA4 && format !== this.RGB565 && format !== this.RGB5_A1) {
          return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
        }
        colorAttached = true;
        width.push(colorAttachment._width);
        height.push(colorAttachment._height);
      }
    }
    if (!colorAttached && !stencilAttachment && !depthAttachment && !depthStencilAttachment) {
      return this.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT;
    }
    if (width.length <= 0 || height.length <= 0) {
      return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
    }
    for (let i = 1; i < width.length; ++i) {
      if (width[i - 1] !== width[i] || height[i - 1] !== height[i]) {
        return this.FRAMEBUFFER_INCOMPLETE_DIMENSIONS;
      }
    }
    if (width[0] === 0 || height[0] === 0) {
      return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
    }
    framebuffer._width = width[0];
    framebuffer._height = height[0];
    return this.FRAMEBUFFER_COMPLETE;
  }
  _isConstantBlendFunc(factor) {
    return factor === this.CONSTANT_COLOR || factor === this.ONE_MINUS_CONSTANT_COLOR || factor === this.CONSTANT_ALPHA || factor === this.ONE_MINUS_CONSTANT_ALPHA;
  }
  _isObject(object, method, Wrapper) {
    if (!(object === null || object === void 0) && !(object instanceof Wrapper)) {
      throw new TypeError(method + "(" + Wrapper.name + ")");
    }
    if (this._checkValid(object, Wrapper) && this._checkOwns(object)) {
      return true;
    }
    return false;
  }
  _resizeDrawingBuffer(width, height) {
    const prevFramebuffer = this._activeFramebuffer;
    const prevTexture = this._getActiveTexture(this.TEXTURE_2D);
    const prevRenderbuffer = this._activeRenderbuffer;
    const contextAttributes = this._contextAttributes;
    const drawingBuffer = this._drawingBuffer;
    if (drawingBuffer?._framebuffer) {
      this._gl.bindFramebuffer(this.FRAMEBUFFER, drawingBuffer?._framebuffer);
    }
    const attachments = this._getAttachments();
    for (let i = 0; i < attachments.length; ++i) {
      this._gl.framebufferTexture2D(
        this.FRAMEBUFFER,
        attachments[i],
        this.TEXTURE_2D,
        0,
        0
      );
    }
    if (drawingBuffer?._color) {
      this._gl.bindTexture(this.TEXTURE_2D, drawingBuffer?._color);
    }
    const colorFormat = contextAttributes.alpha ? this.RGBA : this.RGB;
    this._gl.texImage2D(
      this.TEXTURE_2D,
      0,
      colorFormat,
      width,
      height,
      0,
      colorFormat,
      this.UNSIGNED_BYTE,
      Uint8ArrayToVariant(null)
    );
    this._gl.texParameteri(this.TEXTURE_2D, this.TEXTURE_MIN_FILTER, this.NEAREST);
    this._gl.texParameteri(this.TEXTURE_2D, this.TEXTURE_MAG_FILTER, this.NEAREST);
    if (drawingBuffer?._color) {
      this._gl.framebufferTexture2D(
        this.FRAMEBUFFER,
        this.COLOR_ATTACHMENT0,
        this.TEXTURE_2D,
        drawingBuffer?._color,
        0
      );
    }
    let storage = 0;
    let attachment = 0;
    if (contextAttributes.depth && contextAttributes.stencil) {
      storage = this.DEPTH_STENCIL;
      attachment = this.DEPTH_STENCIL_ATTACHMENT;
    } else if (contextAttributes.depth) {
      storage = 33191;
      attachment = this.DEPTH_ATTACHMENT;
    } else if (contextAttributes.stencil) {
      storage = this.STENCIL_INDEX8;
      attachment = this.STENCIL_ATTACHMENT;
    }
    if (storage) {
      if (drawingBuffer?._depthStencil) {
        this._gl.bindRenderbuffer(
          this.RENDERBUFFER,
          drawingBuffer?._depthStencil
        );
      }
      this._gl.renderbufferStorage(
        this.RENDERBUFFER,
        storage,
        width,
        height
      );
      if (drawingBuffer?._depthStencil) {
        this._gl.framebufferRenderbuffer(
          this.FRAMEBUFFER,
          attachment,
          this.RENDERBUFFER,
          drawingBuffer?._depthStencil
        );
      }
    }
    this.bindFramebuffer(this.FRAMEBUFFER, prevFramebuffer);
    this.bindTexture(this.TEXTURE_2D, prevTexture);
    this.bindRenderbuffer(this.RENDERBUFFER, prevRenderbuffer);
  }
  _restoreError(lastError) {
    const topError = this._errorStack.pop();
    if (topError === this.NO_ERROR) {
      this.setError(lastError);
    } else if (topError) {
      this.setError(topError);
    }
  }
  _saveError() {
    this._errorStack.push(this.getError());
  }
  _switchActiveProgram(active) {
    if (active) {
      active._refCount -= 1;
      active._checkDelete();
    }
  }
  _tryDetachFramebuffer(framebuffer, renderbuffer) {
    if (framebuffer && framebuffer._linked(renderbuffer)) {
      const attachments = this._getAttachments();
      const framebufferAttachments = Object.keys(framebuffer._attachments);
      for (let i = 0; i < framebufferAttachments.length; ++i) {
        if (framebuffer._attachments[attachments[i]] === renderbuffer) {
          this.framebufferTexture2D(
            this.FRAMEBUFFER,
            attachments[i] | 0,
            this.TEXTURE_2D,
            null
          );
        }
      }
    }
  }
  _updateFramebufferAttachments(framebuffer) {
    if (!framebuffer) {
      return;
    }
    const prevStatus = framebuffer._status;
    const attachments = this._getAttachments();
    framebuffer._status = this._preCheckFramebufferStatus(framebuffer);
    if (framebuffer._status !== this.FRAMEBUFFER_COMPLETE) {
      if (prevStatus === this.FRAMEBUFFER_COMPLETE) {
        for (let i = 0; i < attachments.length; ++i) {
          const attachmentEnum = attachments[i];
          this._gl.framebufferTexture2D(
            this.FRAMEBUFFER,
            attachmentEnum,
            framebuffer._attachmentFace[attachmentEnum] || 0,
            0,
            framebuffer._attachmentLevel[attachmentEnum] || 0
          );
        }
      }
      return;
    }
    for (let i = 0; i < attachments.length; ++i) {
      const attachmentEnum = attachments[i];
      this._gl.framebufferTexture2D(
        this.FRAMEBUFFER,
        attachmentEnum,
        framebuffer._attachmentFace[attachmentEnum] || 0,
        0,
        framebuffer._attachmentLevel[attachmentEnum] || 0
      );
    }
    for (let i = 0; i < attachments.length; ++i) {
      const attachmentEnum = attachments[i];
      const attachment = framebuffer._attachments[attachmentEnum];
      if (attachment instanceof WebGLTexture) {
        this._gl.framebufferTexture2D(
          this.FRAMEBUFFER,
          attachmentEnum,
          framebuffer._attachmentFace[attachmentEnum] || 0,
          attachment._ | 0,
          framebuffer._attachmentLevel[attachmentEnum] || 0
        );
      } else if (attachment instanceof WebGLRenderbuffer) {
        this._gl.framebufferRenderbuffer(
          this.FRAMEBUFFER,
          attachmentEnum,
          this.RENDERBUFFER,
          attachment._ | 0
        );
      }
    }
  }
  _validBlendFunc(factor) {
    return factor === this.ZERO || factor === this.ONE || factor === this.SRC_COLOR || factor === this.ONE_MINUS_SRC_COLOR || factor === this.DST_COLOR || factor === this.ONE_MINUS_DST_COLOR || factor === this.SRC_ALPHA || factor === this.ONE_MINUS_SRC_ALPHA || factor === this.DST_ALPHA || factor === this.ONE_MINUS_DST_ALPHA || factor === this.SRC_ALPHA_SATURATE || factor === this.CONSTANT_COLOR || factor === this.ONE_MINUS_CONSTANT_COLOR || factor === this.CONSTANT_ALPHA || factor === this.ONE_MINUS_CONSTANT_ALPHA;
  }
  _validBlendMode(mode) {
    return mode === this.FUNC_ADD || mode === this.FUNC_SUBTRACT || mode === this.FUNC_REVERSE_SUBTRACT || this._extensions.ext_blend_minmax && (mode === this._extensions.ext_blend_minmax.MIN_EXT || mode === this._extensions.ext_blend_minmax.MAX_EXT);
  }
  _validCubeTarget(target) {
    return target === this.TEXTURE_CUBE_MAP_POSITIVE_X || target === this.TEXTURE_CUBE_MAP_NEGATIVE_X || target === this.TEXTURE_CUBE_MAP_POSITIVE_Y || target === this.TEXTURE_CUBE_MAP_NEGATIVE_Y || target === this.TEXTURE_CUBE_MAP_POSITIVE_Z || target === this.TEXTURE_CUBE_MAP_NEGATIVE_Z;
  }
  _validFramebufferAttachment(attachment) {
    switch (attachment) {
      case this.DEPTH_ATTACHMENT:
      case this.STENCIL_ATTACHMENT:
      case this.DEPTH_STENCIL_ATTACHMENT:
      case this.COLOR_ATTACHMENT0:
        return true;
    }
    if (this._extensions.webgl_draw_buffers) {
      const { webgl_draw_buffers } = this._extensions;
      return attachment < webgl_draw_buffers.COLOR_ATTACHMENT0_WEBGL + webgl_draw_buffers._maxDrawBuffers;
    }
    return false;
  }
  _validGLSLIdentifier(str) {
    return !(str.indexOf("webgl_") === 0 || str.indexOf("_webgl_") === 0 || str.length > 256);
  }
  _validTextureTarget(target) {
    return target === this.TEXTURE_2D || target === this.TEXTURE_CUBE_MAP;
  }
  _verifyTextureCompleteness(target, pname, param) {
    const unit = this._getActiveTextureUnit();
    let texture = null;
    if (target === this.TEXTURE_2D) {
      texture = unit._bind2D;
    } else if (this._validCubeTarget(target)) {
      texture = unit._bindCube;
    }
    if (this._extensions.oes_texture_float && !this._extensions.oes_texture_float_linear && texture && texture._type === this.FLOAT && (pname === this.TEXTURE_MAG_FILTER || pname === this.TEXTURE_MIN_FILTER) && (param === this.LINEAR || param === this.LINEAR_MIPMAP_NEAREST || param === this.NEAREST_MIPMAP_LINEAR || param === this.LINEAR_MIPMAP_LINEAR)) {
      texture._complete = false;
      this.bindTexture(target, texture);
      return;
    }
    if (texture && texture._complete === false) {
      texture._complete = true;
      this.bindTexture(target, texture);
    }
  }
  _wrapShader(_type, source) {
    const hasVersion = source.startsWith("#version") || source.includes("\n#version");
    let preamble = "";
    if (!this._extensions.oes_standard_derivatives && /#ifdef\s+GL_OES_standard_derivatives/.test(source)) {
      preamble += "#undef GL_OES_standard_derivatives\n";
    }
    if (!this._extensions.webgl_draw_buffers && !hasVersion) {
      preamble += "#define gl_MaxDrawBuffers 1\n";
    }
    if (hasVersion) {
      if (preamble) {
        const newline = source.indexOf("\n");
        if (newline !== -1) {
          source = source.slice(0, newline + 1) + preamble + source.slice(newline + 1);
        } else {
          source = source + "\n" + preamble;
        }
      }
    } else {
      if (this.canvas) {
        const glArea = this.canvas.getGlArea();
        const es = glArea.get_use_es();
        const usesGlsl1Syntax = /\b(attribute|varying)\b/.test(source);
        const version2 = usesGlsl1Syntax ? es ? "100" : "120" : this._getGlslVersion(es);
        if (version2) {
          source = "#version " + version2 + "\n" + preamble + source;
        } else if (preamble) {
          source = preamble + source;
        }
      } else if (preamble) {
        source = preamble + source;
      }
    }
    return source;
  }
  _allocateDrawingBuffer(width, height) {
    this._drawingBuffer = new WebGLDrawingBufferWrapper(
      this._gl.createFramebuffer(),
      this._gl.createTexture(),
      this._gl.createRenderbuffer()
    );
    this._resizeDrawingBuffer(width, height);
  }
  /**
   * The `WebGLRenderingContext.getContextAttributes()` method returns a `WebGLContextAttributes` object that contains the actual context parameters.
   * Might return `null`, if the context is lost. 
   * @see https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/getContextAttributes
   * @returns A `WebGLContextAttributes` object that contains the actual context parameters, or `null` if the context is lost. 
   */
  getContextAttributes() {
    return this._contextAttributes;
  }
  getExtension(name2) {
    const str = name2.toLowerCase();
    if (str in this._extensions) {
      return this._extensions[str];
    }
    const ext = availableExtensions[str] ? availableExtensions[str](this) : null;
    if (ext) {
      this._extensions[str] = ext;
    }
    return ext;
  }
  bufferData(target = 0, dataOrSize, usage = 0) {
    let size = 0;
    let data = null;
    if (typeof dataOrSize === "number") {
      size = dataOrSize;
    } else if (typeof dataOrSize === "object") {
      data = dataOrSize;
    }
    if (usage !== this.STREAM_DRAW && usage !== this.STATIC_DRAW && usage !== this.DYNAMIC_DRAW) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    if (target !== this.ARRAY_BUFFER && target !== this.ELEMENT_ARRAY_BUFFER) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    const active = this._getActiveBuffer(target);
    if (!active) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    if (data) {
      let u8Data = null;
      if (isTypedArray(data) || data instanceof DataView) {
        u8Data = arrayToUint8Array(data);
      } else {
        this.setError(this.INVALID_VALUE);
        return;
      }
      this._saveError();
      this._gl.bufferData(
        target,
        Uint8ArrayToVariant(u8Data),
        usage
      );
      const error2 = this.getError();
      this._restoreError(error2);
      if (error2 !== this.NO_ERROR) {
        return;
      }
      active._size = u8Data.length;
      if (target === this.ELEMENT_ARRAY_BUFFER) {
        active._elements = new Uint8Array(u8Data);
      }
    } else if (typeof dataOrSize === "number") {
      if (size < 0) {
        this.setError(this.INVALID_VALUE);
        return;
      }
      this._saveError();
      this._gl.bufferDataSizeOnly(
        target,
        size,
        usage
      );
      const error2 = this.getError();
      this._restoreError(error2);
      if (error2 !== this.NO_ERROR) {
        return;
      }
      active._size = size;
      if (target === this.ELEMENT_ARRAY_BUFFER) {
        active._elements = new Uint8Array(size);
      }
    } else {
      this.setError(this.INVALID_VALUE);
    }
  }
  bufferSubData(target = 0, offset = 0, data) {
    if (target !== this.ARRAY_BUFFER && target !== this.ELEMENT_ARRAY_BUFFER) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    if (data === null) {
      return;
    }
    if (!data || typeof data !== "object") {
      this.setError(this.INVALID_VALUE);
      return;
    }
    const active = this._getActiveBuffer(target);
    if (!active) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    if (offset < 0 || offset >= active._size) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    let u8Data = null;
    if (isTypedArray(data) || data instanceof DataView) {
      u8Data = arrayToUint8Array(data);
    } else {
      this.setError(this.INVALID_VALUE);
      return;
    }
    if (offset + u8Data.length > active._size) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    if (target === this.ELEMENT_ARRAY_BUFFER) {
      active._elements.set(u8Data, offset);
    }
    this._gl.bufferSubData(target, offset, Uint8ArrayToVariant(u8Data));
  }
  compressedTexImage2D(target, level, internalFormat, width, height, border, data) {
    return this._gl.compressedTexImage2D(target, level, internalFormat, width, height, border, Uint8ArrayToVariant(arrayToUint8Array(data)));
  }
  compressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, data) {
    return this._gl.compressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, Uint8ArrayToVariant(arrayToUint8Array(data)));
  }
  readPixels(x = 0, y = 0, width = 0, height = 0, format = 0, type = 0, pixels) {
    if (!pixels) return;
    if (!(this._extensions.oes_texture_float && type === this.FLOAT && format === this.RGBA)) {
      if (format === this.RGB || format === this.ALPHA || type !== this.UNSIGNED_BYTE) {
        this.setError(this.INVALID_OPERATION);
        return;
      } else if (format !== this.RGBA) {
        this.setError(this.INVALID_ENUM);
        return;
      } else if (width < 0 || height < 0 || !(pixels instanceof Uint8Array)) {
        this.setError(this.INVALID_VALUE);
        return;
      }
    }
    if (!this._framebufferOk()) {
      console.error("framebuffer is not okay!");
      return;
    }
    let rowStride = width * 4;
    if (rowStride % this._packAlignment !== 0) {
      rowStride += this._packAlignment - rowStride % this._packAlignment;
    }
    const imageSize = rowStride * (height - 1) + width * 4;
    if (imageSize <= 0) {
      return;
    }
    const pixelsLength = pixels.length || pixels.byteLength || 0;
    if (pixelsLength < imageSize) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    let viewWidth = this.drawingBufferWidth;
    let viewHeight = this.drawingBufferHeight;
    if (this._activeFramebuffer) {
      viewWidth = this._activeFramebuffer._width;
      viewHeight = this._activeFramebuffer._height;
    }
    const pixelData = arrayToUint8Array(pixels);
    if (x >= viewWidth || x + width <= 0 || y >= viewHeight || y + height <= 0) {
      for (let i = 0; i < pixelData.length; ++i) {
        pixelData[i] = 0;
      }
    } else if (x < 0 || x + width > viewWidth || y < 0 || y + height > viewHeight) {
      for (let i = 0; i < pixelData.length; ++i) {
        pixelData[i] = 0;
      }
      let nx = x;
      let nWidth = width;
      if (x < 0) {
        nWidth += x;
        nx = 0;
      }
      if (nx + width > viewWidth) {
        nWidth = viewWidth - nx;
      }
      let ny = y;
      let nHeight = height;
      if (y < 0) {
        nHeight += y;
        ny = 0;
      }
      if (ny + height > viewHeight) {
        nHeight = viewHeight - ny;
      }
      let nRowStride = nWidth * 4;
      if (nRowStride % this._packAlignment !== 0) {
        nRowStride += this._packAlignment - nRowStride % this._packAlignment;
      }
      if (nWidth > 0 && nHeight > 0) {
        const subPixels = new Uint8Array(nRowStride * nHeight);
        const result = this._gl.readPixels(
          nx,
          ny,
          nWidth,
          nHeight,
          format,
          type,
          Uint8ArrayToVariant(subPixels)
        );
        const src = result && result.length > 0 ? result : subPixels;
        const offset = 4 * (nx - x) + (ny - y) * rowStride;
        for (let j = 0; j < nHeight; ++j) {
          for (let i = 0; i < nWidth; ++i) {
            for (let k = 0; k < 4; ++k) {
              pixelData[offset + j * rowStride + 4 * i + k] = src[j * nRowStride + 4 * i + k];
            }
          }
        }
      }
    } else {
      const result = this._gl.readPixels(
        x,
        y,
        width,
        height,
        format,
        type,
        Uint8ArrayToVariant(pixelData)
      );
      if (result && result.length > 0) {
        pixelData.set(result);
      }
    }
  }
  // https://github.com/stackgl/headless-gl/blob/ce1c08c0ef0c31d8c308cb828fd2f172c0bf5084/src/javascript/webgl-rendering-context.js#L3131
  texImage2D(target = 0, level = 0, internalFormat = 0, formatOrWidth = 0, typeOrHeight = 0, sourceOrBorder = 0, _format = 0, type = 0, pixels) {
    let width = 0;
    let height = 0;
    let format = 0;
    let source;
    let pixbuf;
    let border = 0;
    if (arguments.length === 6) {
      type = typeOrHeight;
      format = formatOrWidth;
      if (sourceOrBorder instanceof GdkPixbuf2.Pixbuf) {
        pixbuf = sourceOrBorder;
        width = pixbuf.get_width();
        height = pixbuf.get_height();
        ;
        pixels = pixbuf.get_pixels();
      } else {
        source = sourceOrBorder;
        const imageData = extractImageData(source);
        if (imageData == null) {
          throw new TypeError("texImage2D(GLenum, GLint, GLenum, GLint, GLenum, GLenum, ImageData | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement)");
        }
        width = imageData.width;
        height = imageData.height;
        pixels = imageData.data;
      }
    } else if (arguments.length === 9) {
      width = formatOrWidth;
      height = typeOrHeight;
      border = sourceOrBorder;
      format = _format;
      type = type;
      pixels = pixels;
    }
    if (typeof pixels !== "object" && pixels !== void 0) {
      throw new TypeError("texImage2D(GLenum, GLint, GLenum, GLint, GLint, GLint, GLenum, GLenum, Uint8Array)");
    }
    if (!checkFormat(this, format) || !checkFormat(this, internalFormat)) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    if (type === this.FLOAT && !this._extensions.oes_texture_float) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    const texture = this._getTexImage(target);
    if (!texture || format !== internalFormat) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    const pixelSize = this._computePixelSize(type, format);
    if (pixelSize === 0) {
      return;
    }
    if (!this._checkDimensions(
      target,
      width,
      height,
      level
    )) {
      return;
    }
    const data = convertPixels(pixels);
    const rowStride = this._computeRowStride(width, pixelSize);
    const imageSize = rowStride * height;
    if (data && data.length < imageSize) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    if (border !== 0 || validCubeTarget(this, target) && width !== height) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    this._saveError();
    this._gl.texImage2D(target, level, internalFormat, width, height, border, format, type, Uint8ArrayToVariant(data));
    const error2 = this.getError();
    this._restoreError(error2);
    if (error2 !== this.NO_ERROR) {
      return;
    }
    texture._levelWidth[level] = width;
    texture._levelHeight[level] = height;
    texture._format = format;
    texture._type = type;
    const activeFramebuffer = this._activeFramebuffer;
    if (activeFramebuffer) {
      let needsUpdate = false;
      const attachments = this._getAttachments();
      for (let i = 0; i < attachments.length; ++i) {
        if (activeFramebuffer._attachments[attachments[i]] === texture) {
          needsUpdate = true;
          break;
        }
      }
      if (needsUpdate && this._activeFramebuffer) {
        this._updateFramebufferAttachments(this._activeFramebuffer);
      }
    }
  }
  texSubImage2D(target = 0, level = 0, xoffset = 0, yoffset = 0, formatOrWidth = 0, typeOrHeight = 0, sourceOrFormat = 0, type = 0, pixels) {
    let width = 0;
    let height = 0;
    let format = 0;
    let source;
    let pixbuf;
    if (arguments.length === 7) {
      type = typeOrHeight;
      format = formatOrWidth;
      if (sourceOrFormat instanceof GdkPixbuf2.Pixbuf) {
        pixbuf = sourceOrFormat;
        width = pixbuf.get_width();
        height = pixbuf.get_height();
        ;
        pixels = pixbuf.get_pixels();
      } else {
        source = sourceOrFormat;
        const imageData = extractImageData(source);
        if (imageData == null) {
          throw new TypeError("texSubImage2D(GLenum, GLint, GLint, GLint, GLenum, GLenum, ImageData | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement)");
        }
        width = imageData.width;
        height = imageData.height;
        pixels = imageData.data;
      }
    } else {
      width = formatOrWidth;
      height = typeOrHeight;
      format = sourceOrFormat;
    }
    if (typeof pixels !== "object") {
      throw new TypeError("texSubImage2D(GLenum, GLint, GLint, GLint, GLint, GLint, GLenum, GLenum, Uint8Array)");
    }
    const texture = this._getTexImage(target);
    if (!texture) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    if (type === this.FLOAT && !this._extensions.oes_texture_float) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    const pixelSize = this._computePixelSize(type, format);
    if (pixelSize === 0) {
      return;
    }
    if (!this._checkDimensions(
      target,
      width,
      height,
      level
    )) {
      return;
    }
    if (xoffset < 0 || yoffset < 0) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    const data = convertPixels(pixels);
    const rowStride = this._computeRowStride(width, pixelSize);
    const imageSize = rowStride * height;
    if (!data || data.length < imageSize) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    this._gl.texSubImage2D(
      target,
      level,
      xoffset,
      yoffset,
      width,
      height,
      format,
      type,
      Uint8ArrayToVariant(data)
    );
  }
  _checkUniformValid(location, v0, name2, count2, type) {
    if (!checkObject(location)) {
      throw new TypeError(`${name2}(WebGLUniformLocation, ...)`);
    } else if (!location) {
      return false;
    } else if (this._checkLocationActive(location)) {
      const utype = location._activeInfo.type;
      if (utype === this.SAMPLER_2D || utype === this.SAMPLER_CUBE) {
        if (count2 !== 1) {
          this.setError(this.INVALID_VALUE);
          return;
        }
        if (type !== "i") {
          this.setError(this.INVALID_OPERATION);
          return;
        }
        if (v0 < 0 || v0 >= this._textureUnits.length) {
          this.setError(this.INVALID_VALUE);
          return false;
        }
      }
      if (uniformTypeSize(this, utype) > count2) {
        this.setError(this.INVALID_OPERATION);
        return false;
      }
      return true;
    }
    return false;
  }
  _checkUniformValueValid(location, value2, name2, count2, _type) {
    if (!checkObject(location) || !checkObject(value2)) {
      throw new TypeError(`${name2}v(WebGLUniformLocation, Array)`);
    } else if (!location) {
      return false;
    } else if (!this._checkLocationActive(location)) {
      return false;
    } else if (typeof value2 !== "object" || !value2 || typeof value2.length !== "number") {
      throw new TypeError(`Second argument to ${name2} must be array`);
    } else if (uniformTypeSize(this, location._activeInfo.type) > count2) {
      this.setError(this.INVALID_OPERATION);
      return false;
    } else if (value2.length >= count2 && value2.length % count2 === 0) {
      if (location._array) {
        return true;
      } else if (value2.length === count2) {
        return true;
      } else {
        this.setError(this.INVALID_OPERATION);
        return false;
      }
    }
    this.setError(this.INVALID_VALUE);
    return false;
  }
  uniform1fv(location, value2) {
    if (!location || !this._checkUniformValueValid(location, value2, "uniform1fv", 1, "f")) return;
    if (location?._array) {
      const locs = location._array;
      for (let i = 0; i < locs.length && i < value2.length; ++i) {
        const loc = locs[i];
        if (loc) {
          this._gl.uniform1f(loc, value2[i]);
        }
      }
      return;
    }
    this._gl.uniform1f(location?._ | 0, value2[0]);
  }
  uniform1iv(location, v) {
    if (!this._checkUniformValueValid(location, v, "uniform1iv", 1, "i")) return;
    if (location?._array) {
      const locs = location._array;
      for (let i = 0; i < locs.length && i < v.length; ++i) {
        const loc = locs[i];
        if (loc) {
          this._gl.uniform1i(loc, v[i]);
        }
      }
      return;
    }
    this.uniform1i(location, v[0]);
  }
  uniform2fv(location, v) {
    if (!this._checkUniformValueValid(location, v, "uniform2fv", 2, "f")) return;
    if (location?._array) {
      const locs = location._array;
      for (let i = 0; i < locs.length && 2 * i < v.length; ++i) {
        const loc = locs[i];
        if (loc) {
          this._gl.uniform2f(loc, v[2 * i], v[2 * i + 1]);
        }
      }
      return;
    }
    this._gl.uniform2f(location?._ || 0, v[0], v[1]);
  }
  uniform2iv(location, v) {
    if (!this._checkUniformValueValid(location, v, "uniform2iv", 2, "i")) return;
    if (location?._array) {
      const locs = location._array;
      for (let i = 0; i < locs.length && 2 * i < v.length; ++i) {
        const loc = locs[i];
        if (loc) {
          this._gl.uniform2i(loc, v[2 * i], v[2 * i + 1]);
        }
      }
      return;
    }
    this.uniform2i(location, v[0], v[1]);
  }
  uniform3fv(location, v) {
    if (!this._checkUniformValueValid(location, v, "uniform3fv", 3, "f")) return;
    if (location?._array) {
      const locs = location._array;
      for (let i = 0; i < locs.length && 3 * i < v.length; ++i) {
        const loc = locs[i];
        if (loc) {
          this._gl.uniform3f(loc, v[3 * i], v[3 * i + 1], v[3 * i + 2]);
        }
      }
      return;
    }
    this._gl.uniform3f(location?._ || 0, v[0], v[1], v[2]);
  }
  uniform3iv(location, v) {
    if (!this._checkUniformValueValid(location, v, "uniform3iv", 3, "i")) return;
    if (location?._array) {
      const locs = location._array;
      for (let i = 0; i < locs.length && 3 * i < v.length; ++i) {
        const loc = locs[i];
        if (loc) {
          this._gl.uniform3i(loc, v[3 * i], v[3 * i + 1], v[3 * i + 2]);
        }
      }
      return;
    }
    this.uniform3i(location, v[0], v[1], v[2]);
  }
  uniform4fv(location, v) {
    if (!this._checkUniformValueValid(location, v, "uniform4fv", 4, "f")) return;
    if (location?._array) {
      const locs = location._array;
      for (let i = 0; i < locs.length && 4 * i < v.length; ++i) {
        const loc = locs[i];
        if (loc) {
          this._gl.uniform4f(loc, v[4 * i], v[4 * i + 1], v[4 * i + 2], v[4 * i + 3]);
        }
      }
      return;
    }
    this._gl.uniform4f(location?._ || 0, v[0], v[1], v[2], v[3]);
  }
  uniform4iv(location, v) {
    if (!this._checkUniformValueValid(location, v, "uniform4iv", 4, "i")) return;
    if (location?._array) {
      const locs = location._array;
      for (let i = 0; i < locs.length && 4 * i < v.length; ++i) {
        const loc = locs[i];
        if (loc) {
          this._gl.uniform4i(loc, v[4 * i], v[4 * i + 1], v[4 * i + 2], v[4 * i + 3]);
        }
      }
      return;
    }
    this.uniform4i(location, v[0], v[1], v[2], v[3]);
  }
  _checkUniformMatrix(location, transpose, value2, name2, count2) {
    if (!checkObject(location) || typeof value2 !== "object") {
      throw new TypeError(name2 + "(WebGLUniformLocation, Boolean, Array)");
    } else if (!!transpose || typeof value2 !== "object" || value2 === null || !value2.length || value2.length % count2 * count2 !== 0) {
      this.setError(this.INVALID_VALUE);
      return false;
    }
    if (!location) {
      return false;
    }
    if (!this._checkLocationActive(location)) {
      return false;
    }
    if (value2.length === count2 * count2) {
      return true;
    } else if (location._array) {
      return true;
    }
    this.setError(this.INVALID_VALUE);
    return false;
  }
  uniformMatrix2fv(location, transpose, value2) {
    if (!this._checkUniformMatrix(location, transpose, value2, "uniformMatrix2fv", 2)) return;
    const data = new Float32Array(value2);
    this._gl.uniformMatrix2fv(
      location?._ || 0,
      !!transpose,
      listToArray(data)
    );
  }
  uniformMatrix3fv(location, transpose, value2) {
    if (!this._checkUniformMatrix(location, transpose, value2, "uniformMatrix3fv", 3)) return;
    const data = new Float32Array(value2);
    this._gl.uniformMatrix3fv(
      location?._ || 0,
      !!transpose,
      listToArray(data)
    );
  }
  uniformMatrix4fv(location, transpose, value2) {
    if (!this._checkUniformMatrix(location, transpose, value2, "uniformMatrix4fv", 4)) return;
    const data = new Float32Array(value2);
    this._gl.uniformMatrix4fv(
      location?._ || 0,
      !!transpose,
      listToArray(data)
    );
  }
  //////////// BASE ////////////
  activeTexture(texture = 0) {
    const texNum = texture - this.TEXTURE0;
    if (texNum >= 0 && texNum < this._textureUnits.length) {
      this._activeTextureUnit = texNum;
      return this._gl.activeTexture(texture);
    }
    this.setError(this.INVALID_ENUM);
  }
  attachShader(program, shader) {
    if (!checkObject(program) || !checkObject(shader)) {
      throw new TypeError("attachShader(WebGLProgram, WebGLShader)");
    }
    if (!program || !shader) {
      this.setError(this.INVALID_VALUE);
      return;
    } else if (program instanceof WebGLProgram && shader instanceof WebGLShader && this._checkOwns(program) && this._checkOwns(shader)) {
      if (!program._linked(shader)) {
        this._saveError();
        this._gl.attachShader(
          program._ | 0,
          shader._ | 0
        );
        const error2 = this.getError();
        this._restoreError(error2);
        if (error2 === this.NO_ERROR) {
          program._link(shader);
        }
        return;
      }
    }
    this.setError(this.INVALID_OPERATION);
  }
  bindAttribLocation(program, index, name2) {
    if (!checkObject(program) || typeof name2 !== "string") {
      throw new TypeError("bindAttribLocation(WebGLProgram, GLint, String)");
    }
    name2 += "";
    if (!isValidString(name2) || name2.length > MAX_ATTRIBUTE_LENGTH) {
      this.setError(this.INVALID_VALUE);
    } else if (/^_?webgl_a/.test(name2)) {
      this.setError(this.INVALID_OPERATION);
    } else if (this._checkWrapper(program, WebGLProgram)) {
      return this._gl.bindAttribLocation(
        program._ | 0,
        index | 0,
        name2
      );
    }
  }
  bindBuffer(target = 0, buffer) {
    if (!checkObject(buffer)) {
      throw new TypeError("bindBuffer(GLenum, WebGLBuffer)");
    }
    if (target !== this.ARRAY_BUFFER && target !== this.ELEMENT_ARRAY_BUFFER) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    if (!buffer) {
      buffer = null;
      this._gl.bindBuffer(target, 0);
    } else if (buffer._pendingDelete) {
      return;
    } else if (this._checkWrapper(buffer, WebGLBuffer)) {
      if (buffer._binding && buffer._binding !== target) {
        this.setError(this.INVALID_OPERATION);
        return;
      }
      buffer._binding = target | 0;
      this._gl.bindBuffer(target, buffer._ | 0);
    } else {
      return;
    }
    if (target === this.ARRAY_BUFFER) {
      this._vertexGlobalState.setArrayBuffer(buffer);
    } else {
      this._vertexObjectState.setElementArrayBuffer(buffer);
    }
  }
  bindFramebuffer(target, framebuffer) {
    if (!checkObject(framebuffer)) {
      throw new TypeError("bindFramebuffer(GLenum, WebGLFramebuffer)");
    }
    if (target !== this.FRAMEBUFFER) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    if (!framebuffer) {
      this._gl.bindFramebuffer(this.FRAMEBUFFER, this._gtkFboId);
    } else if (framebuffer._pendingDelete) {
      return;
    } else if (this._checkWrapper(framebuffer, WebGLFramebuffer)) {
      this._gl.bindFramebuffer(
        this.FRAMEBUFFER,
        framebuffer._ | 0
      );
    } else {
      return;
    }
    const activeFramebuffer = this._activeFramebuffer;
    if (activeFramebuffer !== framebuffer) {
      if (activeFramebuffer) {
        activeFramebuffer._refCount -= 1;
        activeFramebuffer._checkDelete();
      }
      if (framebuffer) {
        framebuffer._refCount += 1;
      }
    }
    this._activeFramebuffer = framebuffer;
    if (framebuffer) {
      this._updateFramebufferAttachments(framebuffer);
    }
  }
  bindRenderbuffer(target, renderbuffer) {
    if (!checkObject(renderbuffer)) {
      throw new TypeError("bindRenderbuffer(GLenum, WebGLRenderbuffer)");
    }
    if (target !== this.RENDERBUFFER) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    if (!renderbuffer) {
      this._gl.bindRenderbuffer(
        target | 0,
        0
      );
    } else if (renderbuffer._pendingDelete) {
      return;
    } else if (this._checkWrapper(renderbuffer, WebGLRenderbuffer)) {
      this._gl.bindRenderbuffer(
        target | 0,
        renderbuffer._ | 0
      );
    } else {
      return;
    }
    const active = this._activeRenderbuffer;
    if (active !== renderbuffer) {
      if (active) {
        active._refCount -= 1;
        active._checkDelete();
      }
      if (renderbuffer) {
        renderbuffer._refCount += 1;
      }
    }
    this._activeRenderbuffer = renderbuffer;
  }
  bindTexture(target = 0, texture) {
    if (!checkObject(texture)) {
      throw new TypeError("bindTexture(GLenum, WebGLTexture)");
    }
    if (!this._validTextureTarget(target)) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    let textureId = 0;
    if (!texture) {
      texture = null;
    } else if (texture instanceof WebGLTexture && texture._pendingDelete) {
      return;
    } else if (this._checkWrapper(texture, WebGLTexture)) {
      if (texture._binding && texture._binding !== target) {
        this.setError(this.INVALID_OPERATION);
        return;
      }
      texture._binding = target;
      if (texture._complete) {
        textureId = texture._ | 0;
      }
    } else {
      return;
    }
    this._saveError();
    this._gl.bindTexture(
      target,
      textureId
    );
    const error2 = this.getError();
    this._restoreError(error2);
    if (error2 !== this.NO_ERROR) {
      return;
    }
    const activeUnit = this._getActiveTextureUnit();
    const activeTex = this._getActiveTexture(target);
    if (activeTex !== texture) {
      if (activeTex) {
        activeTex._refCount -= 1;
        activeTex._checkDelete();
      }
      if (texture) {
        texture._refCount += 1;
      }
    }
    if (target === this.TEXTURE_2D) {
      activeUnit._bind2D = texture;
    } else if (target === this.TEXTURE_CUBE_MAP) {
      activeUnit._bindCube = texture;
    }
  }
  blendColor(red = 0, green = 0, blue = 0, alpha = 0) {
    return this._gl.blendColor(+red, +green, +blue, +alpha);
  }
  blendEquation(mode = 0) {
    if (this._validBlendMode(mode)) {
      return this._gl.blendEquation(mode);
    }
    this.setError(this.INVALID_ENUM);
  }
  blendEquationSeparate(modeRGB = 0, modeAlpha = 0) {
    if (this._validBlendMode(modeRGB) && this._validBlendMode(modeAlpha)) {
      return this._gl.blendEquationSeparate(modeRGB, modeAlpha);
    }
    this.setError(this.INVALID_ENUM);
  }
  blendFunc(sfactor = 0, dfactor = 0) {
    if (!this._validBlendFunc(sfactor) || !this._validBlendFunc(dfactor)) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    if (this._isConstantBlendFunc(sfactor) && this._isConstantBlendFunc(dfactor)) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    this._gl.blendFunc(sfactor, dfactor);
  }
  blendFuncSeparate(srcRGB = 0, dstRGB = 0, srcAlpha = 0, dstAlpha = 0) {
    if (!(this._validBlendFunc(srcRGB) && this._validBlendFunc(dstRGB) && this._validBlendFunc(srcAlpha) && this._validBlendFunc(dstAlpha))) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    if (this._isConstantBlendFunc(srcRGB) && this._isConstantBlendFunc(dstRGB) || this._isConstantBlendFunc(srcAlpha) && this._isConstantBlendFunc(dstAlpha)) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    this._gl.blendFuncSeparate(
      srcRGB,
      dstRGB,
      srcAlpha,
      dstAlpha
    );
  }
  checkFramebufferStatus(target) {
    if (target !== this.FRAMEBUFFER) {
      this.setError(this.INVALID_ENUM);
      return 0;
    }
    const framebuffer = this._activeFramebuffer;
    if (!framebuffer) {
      return this.FRAMEBUFFER_COMPLETE;
    }
    return this._preCheckFramebufferStatus(framebuffer);
  }
  clear(mask = 0) {
    if (!this._framebufferOk()) {
      return;
    }
    return this._gl.clear(mask);
  }
  clearColor(red, green, blue, alpha) {
    return this._gl.clearColor(+red, +green, +blue, +alpha);
  }
  clearDepth(depth) {
    return this._gl.clearDepth(+depth);
  }
  clearStencil(s = 0) {
    this._checkStencil = false;
    return this._gl.clearStencil(s);
  }
  colorMask(red, green, blue, alpha) {
    return this._gl.colorMask(!!red, !!green, !!blue, !!alpha);
  }
  compileShader(shader) {
    if (!checkObject(shader)) {
      throw new TypeError("compileShader(WebGLShader)");
    }
    if (this._checkWrapper(shader, WebGLShader) && this._checkShaderSource(shader)) {
      const prevError = this.getError();
      this._gl.compileShader(shader._ | 0);
      const error2 = this.getError();
      shader._compileStatus = !!this._gl.getShaderParameter(
        shader._ | 0,
        this.COMPILE_STATUS
      );
      shader._compileInfo = this._gl.getShaderInfoLog(shader._ | 0) || "null";
      this.getError();
      this.setError(prevError || error2);
    }
  }
  copyTexImage2D(target = 0, level = 0, internalFormat = 0, x = 0, y = 0, width = 0, height = 0, border = 0) {
    const texture = this._getTexImage(target);
    if (!texture) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    if (internalFormat !== this.RGBA && internalFormat !== this.RGB && internalFormat !== this.ALPHA && internalFormat !== this.LUMINANCE && internalFormat !== this.LUMINANCE_ALPHA) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    if (level < 0 || width < 0 || height < 0 || border !== 0) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    if (level > 0 && !(bits.isPow2(width) && bits.isPow2(height))) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    this._saveError();
    this._gl.copyTexImage2D(
      target,
      level,
      internalFormat,
      x,
      y,
      width,
      height,
      border
    );
    const error2 = this.getError();
    this._restoreError(error2);
    if (error2 === this.NO_ERROR) {
      texture._levelWidth[level] = width;
      texture._levelHeight[level] = height;
      texture._format = this.RGBA;
      texture._type = this.UNSIGNED_BYTE;
    }
  }
  copyTexSubImage2D(target = 0, level = 0, xoffset = 0, yoffset = 0, x = 0, y = 0, width = 0, height = 0) {
    const texture = this._getTexImage(target);
    if (!texture) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    if (width < 0 || height < 0 || xoffset < 0 || yoffset < 0 || level < 0) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    this._gl.copyTexSubImage2D(
      target,
      level,
      xoffset,
      yoffset,
      x,
      y,
      width,
      height
    );
  }
  createBuffer() {
    const id = this._gl.createBuffer();
    if (!id || id <= 0) return null;
    const webGLBuffer = new WebGLBuffer(id, this);
    this._buffers[id] = webGLBuffer;
    return webGLBuffer;
  }
  createFramebuffer() {
    const id = this._gl.createFramebuffer();
    if (id <= 0) return null;
    const webGLFramebuffer = new WebGLFramebuffer(id, this);
    this._framebuffers[id] = webGLFramebuffer;
    return webGLFramebuffer;
  }
  createProgram() {
    const id = this._gl.createProgram();
    if (id <= 0) return null;
    const webGLProgram = new WebGLProgram(id, this);
    this._programs[id] = webGLProgram;
    return webGLProgram;
  }
  createRenderbuffer() {
    const id = this._gl.createRenderbuffer();
    if (id <= 0) return null;
    const webGLRenderbuffer = new WebGLRenderbuffer(id, this);
    this._renderbuffers[id] = webGLRenderbuffer;
    return webGLRenderbuffer;
  }
  createShader(type = 0) {
    if (type !== this.FRAGMENT_SHADER && type !== this.VERTEX_SHADER) {
      this.setError(this.INVALID_ENUM);
      return null;
    }
    const id = this._gl.createShader(type);
    if (id < 0) {
      return null;
    }
    const result = new WebGLShader(id, this, type);
    this._shaders[id] = result;
    return result;
  }
  createTexture() {
    const id = this._gl.createTexture();
    if (id <= 0) return null;
    const webGlTexture = new WebGLTexture(id, this);
    this._textures[id] = webGlTexture;
    return webGlTexture;
  }
  cullFace(mode) {
    return this._gl.cullFace(mode | 0);
  }
  deleteBuffer(buffer) {
    if (!checkObject(buffer) || buffer !== null && !(buffer instanceof WebGLBuffer)) {
      throw new TypeError("deleteBuffer(WebGLBuffer)");
    }
    if (!(buffer instanceof WebGLBuffer && this._checkOwns(buffer))) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    if (this._vertexGlobalState._arrayBufferBinding === buffer) {
      this.bindBuffer(this.ARRAY_BUFFER, null);
    }
    if (this._vertexObjectState._elementArrayBufferBinding === buffer) {
      this.bindBuffer(this.ELEMENT_ARRAY_BUFFER, null);
    }
    if (this._vertexObjectState === this._defaultVertexObjectState) {
      this._vertexObjectState.releaseArrayBuffer(buffer);
    }
    buffer._pendingDelete = true;
    buffer._checkDelete();
  }
  deleteFramebuffer(framebuffer) {
    if (!checkObject(framebuffer)) {
      throw new TypeError("deleteFramebuffer(WebGLFramebuffer)");
    }
    if (!(framebuffer instanceof WebGLFramebuffer && this._checkOwns(framebuffer))) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    if (this._activeFramebuffer === framebuffer) {
      this.bindFramebuffer(this.FRAMEBUFFER, null);
    }
    framebuffer._pendingDelete = true;
    framebuffer._checkDelete();
  }
  _deleteLinkable(name2, object, Type) {
    if (!checkObject(object)) {
      throw new TypeError(name2 + "(" + Type.name + ")");
    }
    if (object instanceof Type && this._checkOwns(object)) {
      object._pendingDelete = true;
      object._checkDelete();
      return;
    }
    this.setError(this.INVALID_OPERATION);
  }
  deleteProgram(program) {
    return this._deleteLinkable("deleteProgram", program, WebGLProgram);
  }
  // Need to handle textures and render buffers as a special case:
  // When a texture gets deleted, we need to do the following extra steps:
  //  1. Is it bound to the current texture unit?
  //     If so, then unbind it
  //  2. Is it attached to the active fbo?
  //     If so, then detach it
  //
  // For renderbuffers only need to do second step
  //
  // After this, proceed with the usual deletion algorithm
  //
  deleteRenderbuffer(renderbuffer) {
    if (!checkObject(renderbuffer)) {
      throw new TypeError("deleteRenderbuffer(WebGLRenderbuffer)");
    }
    if (!(renderbuffer instanceof WebGLRenderbuffer && this._checkOwns(renderbuffer))) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    if (this._activeRenderbuffer === renderbuffer) {
      this.bindRenderbuffer(this.RENDERBUFFER, null);
    }
    const activeFramebuffer = this._activeFramebuffer;
    this._tryDetachFramebuffer(activeFramebuffer, renderbuffer);
    renderbuffer._pendingDelete = true;
    renderbuffer._checkDelete();
  }
  deleteShader(shader) {
    return this._deleteLinkable("deleteShader", shader, WebGLShader);
  }
  deleteTexture(texture) {
    if (!checkObject(texture)) {
      throw new TypeError("deleteTexture(WebGLTexture)");
    }
    if (texture instanceof WebGLTexture) {
      if (!this._checkOwns(texture)) {
        this.setError(this.INVALID_OPERATION);
        return;
      }
    } else {
      return;
    }
    const curActive = this._activeTextureUnit;
    for (let i = 0; i < this._textureUnits.length; ++i) {
      const unit = this._textureUnits[i];
      if (unit._bind2D === texture) {
        this.activeTexture(this.TEXTURE0 + i);
        this.bindTexture(this.TEXTURE_2D, null);
      } else if (unit._bindCube === texture) {
        this.activeTexture(this.TEXTURE0 + i);
        this.bindTexture(this.TEXTURE_CUBE_MAP, null);
      }
    }
    this.activeTexture(this.TEXTURE0 + curActive);
    const ctx = this;
    const activeFramebuffer = this._activeFramebuffer;
    const tryDetach = (framebuffer) => {
      if (framebuffer && framebuffer._linked(texture)) {
        const attachments = ctx._getAttachments();
        for (let i = 0; i < attachments.length; ++i) {
          const attachment = attachments[i];
          if (framebuffer._attachments[attachment] === texture) {
            ctx.framebufferTexture2D(
              this.FRAMEBUFFER,
              attachment,
              this.TEXTURE_2D,
              null
            );
          }
        }
      }
    };
    tryDetach(activeFramebuffer);
    texture._pendingDelete = true;
    texture._checkDelete();
  }
  depthFunc(func) {
    func |= 0;
    switch (func) {
      case this.NEVER:
      case this.LESS:
      case this.EQUAL:
      case this.LEQUAL:
      case this.GREATER:
      case this.NOTEQUAL:
      case this.GEQUAL:
      case this.ALWAYS:
        return this._gl.depthFunc(func);
      default:
        this.setError(this.INVALID_ENUM);
    }
  }
  depthMask(flag2) {
    return this._gl.depthMask(!!flag2);
  }
  depthRange(zNear, zFar) {
    zNear = +zNear;
    zFar = +zFar;
    if (zNear <= zFar) {
      return this._gl.depthRange(zNear, zFar);
    }
    this.setError(this.INVALID_OPERATION);
  }
  destroy() {
    warnNotImplemented("destroy");
  }
  detachShader(program, shader) {
    if (!checkObject(program) || !checkObject(shader)) {
      throw new TypeError("detachShader(WebGLProgram, WebGLShader)");
    }
    if (this._checkWrapper(program, WebGLProgram) && this._checkWrapper(shader, WebGLShader)) {
      if (program._linked(shader)) {
        this._gl.detachShader(program._, shader._);
        program._unlink(shader);
      } else {
        this.setError(this.INVALID_OPERATION);
      }
    }
  }
  disable(cap = 0) {
    this._gl.disable(cap);
    if (cap === this.TEXTURE_2D || cap === this.TEXTURE_CUBE_MAP) {
      const active = this._getActiveTextureUnit();
      if (active._mode === cap) {
        active._mode = 0;
      }
    }
  }
  disableVertexAttribArray(index = 0) {
    if (index < 0 || index >= this._vertexObjectState._attribs.length) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    this._gl.disableVertexAttribArray(index);
    this._vertexObjectState._attribs[index]._isPointer = false;
  }
  drawArrays(mode = 0, first = 0, count2 = 0) {
    if (first < 0 || count2 < 0) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    if (!this._checkStencilState()) {
      return;
    }
    const reducedCount = vertexCount(this, mode, count2);
    if (reducedCount < 0) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    if (!this._framebufferOk()) {
      return;
    }
    if (count2 === 0) {
      return;
    }
    let maxIndex = first;
    if (count2 > 0) {
      maxIndex = count2 + first - 1 >>> 0;
    }
    if (this._checkVertexAttribState(maxIndex)) {
      this._gl.drawArrays(mode, first, reducedCount);
    }
  }
  drawElements(mode = 0, count2 = 0, type = 0, ioffset = 0) {
    if (count2 < 0 || ioffset < 0) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    if (!this._checkStencilState()) {
      return;
    }
    const elementBuffer = this._vertexObjectState._elementArrayBufferBinding;
    if (!elementBuffer) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    let elementData = null;
    let offset = ioffset;
    if (type === this.UNSIGNED_SHORT) {
      if (offset % 2) {
        this.setError(this.INVALID_OPERATION);
        return;
      }
      offset >>= 1;
      elementData = new Uint16Array(elementBuffer._elements.buffer);
    } else if (this._extensions.oes_element_index_uint && type === this.UNSIGNED_INT) {
      if (offset % 4) {
        this.setError(this.INVALID_OPERATION);
        return;
      }
      offset >>= 2;
      elementData = new Uint32Array(elementBuffer._elements.buffer);
    } else if (type === this.UNSIGNED_BYTE) {
      elementData = elementBuffer._elements;
    } else {
      this.setError(this.INVALID_ENUM);
      return;
    }
    let reducedCount = count2;
    switch (mode) {
      case this.TRIANGLES:
        if (count2 % 3) {
          reducedCount -= count2 % 3;
        }
        break;
      case this.LINES:
        if (count2 % 2) {
          reducedCount -= count2 % 2;
        }
        break;
      case this.POINTS:
        break;
      case this.LINE_LOOP:
      case this.LINE_STRIP:
        if (count2 < 2) {
          this.setError(this.INVALID_OPERATION);
          return;
        }
        break;
      case this.TRIANGLE_FAN:
      case this.TRIANGLE_STRIP:
        if (count2 < 3) {
          this.setError(this.INVALID_OPERATION);
          return;
        }
        break;
      default:
        this.setError(this.INVALID_ENUM);
        return;
    }
    if (!this._framebufferOk()) {
      return;
    }
    if (count2 === 0) {
      this._checkVertexAttribState(0);
      return;
    }
    if (count2 + offset >>> 0 > elementData.length) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    let maxIndex = -1;
    for (let i = offset; i < offset + count2; ++i) {
      maxIndex = Math.max(maxIndex, elementData[i]);
    }
    if (maxIndex < 0) {
      this._checkVertexAttribState(0);
      return;
    }
    if (this._checkVertexAttribState(maxIndex)) {
      if (reducedCount > 0) {
        this._gl.drawElements(mode, reducedCount, type, ioffset);
      }
    }
  }
  enable(cap = 0) {
    return this._gl.enable(cap);
  }
  enableVertexAttribArray(index) {
    if (index < 0 || index >= this._vertexObjectState._attribs.length) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    this._gl.enableVertexAttribArray(index);
    this._vertexObjectState._attribs[index]._isPointer = true;
  }
  finish() {
    return this._gl.finish();
  }
  flush() {
    return this._gl.flush();
  }
  framebufferRenderbuffer(target, attachment, renderbufferTarget, renderbuffer) {
    if (!checkObject(renderbuffer)) {
      throw new TypeError("framebufferRenderbuffer(GLenum, GLenum, GLenum, WebGLRenderbuffer)");
    }
    if (target !== this.FRAMEBUFFER || !this._validFramebufferAttachment(attachment) || renderbufferTarget !== this.RENDERBUFFER) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    const framebuffer = this._activeFramebuffer;
    if (!framebuffer) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    if (renderbuffer && !this._checkWrapper(renderbuffer, WebGLRenderbuffer)) {
      return;
    }
    framebuffer._setAttachment(renderbuffer, attachment);
    this._updateFramebufferAttachments(framebuffer);
  }
  framebufferTexture2D(target, attachment, textarget, texture, level = 0) {
    target |= 0;
    attachment |= 0;
    textarget |= 0;
    level |= 0;
    if (!checkObject(texture)) {
      throw new TypeError("framebufferTexture2D(GLenum, GLenum, GLenum, WebGLTexture, GLint)");
    }
    if (target !== this.FRAMEBUFFER || !this._validFramebufferAttachment(attachment)) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    if (level !== 0) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    if (texture && !this._checkWrapper(texture, WebGLTexture)) {
      return;
    }
    if (textarget === this.TEXTURE_2D) {
      if (texture && texture._binding !== this.TEXTURE_2D) {
        this.setError(this.INVALID_OPERATION);
        return;
      }
    } else if (this._validCubeTarget(textarget)) {
      if (texture && texture._binding !== this.TEXTURE_CUBE_MAP) {
        this.setError(this.INVALID_OPERATION);
        return;
      }
    } else {
      this.setError(this.INVALID_ENUM);
      return;
    }
    const framebuffer = this._activeFramebuffer;
    if (!framebuffer) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    framebuffer._attachmentLevel[attachment] = level;
    framebuffer._attachmentFace[attachment] = textarget;
    framebuffer._setAttachment(texture, attachment);
    this._updateFramebufferAttachments(framebuffer);
  }
  frontFace(mode = 0) {
    return this._gl.frontFace(mode);
  }
  generateMipmap(target = 0) {
    return this._gl.generateMipmap(target);
  }
  getActiveAttrib(program, index) {
    if (!checkObject(program)) {
      throw new TypeError("getActiveAttrib(WebGLProgram)");
    } else if (!program) {
      this.setError(this.INVALID_VALUE);
    } else if (this._checkWrapper(program, WebGLProgram)) {
      const info2 = this._gl.getActiveAttrib(program._ | 0, index | 0);
      if (info2) {
        return new WebGLActiveInfo(info2);
      }
    }
    return null;
  }
  getActiveUniform(program, index) {
    if (!checkObject(program)) {
      throw new TypeError("getActiveUniform(WebGLProgram, GLint)");
    } else if (!program) {
      this.setError(this.INVALID_VALUE);
    } else if (this._checkWrapper(program, WebGLProgram)) {
      const info2 = this._gl.getActiveUniform(program._ | 0, index | 0);
      if (info2) {
        return new WebGLActiveInfo(info2);
      }
    }
    return null;
  }
  getAttachedShaders(program) {
    if (!checkObject(program) || typeof program === "object" && program !== null && !(program instanceof WebGLProgram)) {
      throw new TypeError("getAttachedShaders(WebGLProgram)");
    }
    if (!program) {
      this.setError(this.INVALID_VALUE);
    } else if (this._checkWrapper(program, WebGLProgram)) {
      const shaderArray = this._gl.getAttachedShaders(program._ | 0);
      if (!shaderArray) {
        return null;
      }
      const unboxedShaders = new Array(shaderArray.length);
      for (let i = 0; i < shaderArray.length; ++i) {
        unboxedShaders[i] = this._shaders[shaderArray[i]];
      }
      return unboxedShaders;
    }
    return null;
  }
  getAttribLocation(program, name2) {
    if (!checkObject(program)) {
      throw new TypeError("getAttribLocation(WebGLProgram, String)");
    }
    name2 += "";
    if (!isValidString(name2) || name2.length > MAX_ATTRIBUTE_LENGTH) {
      this.setError(this.INVALID_VALUE);
    } else if (this._checkWrapper(program, WebGLProgram)) {
      return this._gl.getAttribLocation(program._ | 0, name2 + "");
    }
    return -1;
  }
  getBufferParameter(target = 0, pname = 0) {
    if (target !== this.ARRAY_BUFFER && target !== this.ELEMENT_ARRAY_BUFFER) {
      this.setError(this.INVALID_ENUM);
      return null;
    }
    switch (pname) {
      case this.BUFFER_SIZE:
      case this.BUFFER_USAGE:
        return this._gl.getBufferParameteriv(target | 0, pname | 0)[0];
      default:
        this.setError(this.INVALID_ENUM);
        return null;
    }
  }
  getError() {
    return this._gl.getError();
  }
  setError(error2) {
    this._gl.setError(error2);
  }
  getFramebufferAttachmentParameter(target = 0, attachment = 0, pname = 0) {
    if (target !== this.FRAMEBUFFER || !this._validFramebufferAttachment(attachment)) {
      this.setError(this.INVALID_ENUM);
      return null;
    }
    const framebuffer = this._activeFramebuffer;
    if (!framebuffer) {
      this.setError(this.INVALID_OPERATION);
      return null;
    }
    const object = framebuffer._attachments[attachment];
    if (object === null) {
      if (pname === this.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE) {
        return this.NONE;
      }
    } else if (object instanceof WebGLTexture) {
      switch (pname) {
        case this.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME:
          return object;
        case this.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE:
          return this.TEXTURE;
        case this.FRAMEBUFFER_ATTACHMENT_TEXTURE_LEVEL:
          return framebuffer._attachmentLevel[attachment];
        case this.FRAMEBUFFER_ATTACHMENT_TEXTURE_CUBE_MAP_FACE: {
          const face = framebuffer._attachmentFace[attachment];
          if (face === this.TEXTURE_2D) {
            return 0;
          }
          return face;
        }
      }
    } else if (object instanceof WebGLRenderbuffer) {
      switch (pname) {
        case this.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME:
          return object;
        case this.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE:
          return this.RENDERBUFFER;
      }
    }
    this.setError(this.INVALID_ENUM);
    return null;
  }
  getParameter(pname = 0) {
    switch (pname) {
      case this.ARRAY_BUFFER_BINDING:
        return this._vertexGlobalState._arrayBufferBinding;
      case this.ELEMENT_ARRAY_BUFFER_BINDING:
        return this._vertexObjectState._elementArrayBufferBinding;
      case this.CURRENT_PROGRAM:
        return this._activeProgram;
      case this.FRAMEBUFFER_BINDING:
        return this._activeFramebuffer;
      case this.RENDERBUFFER_BINDING:
        return this._activeRenderbuffer;
      case this.TEXTURE_BINDING_2D:
        return this._getActiveTextureUnit()._bind2D;
      case this.TEXTURE_BINDING_CUBE_MAP:
        return this._getActiveTextureUnit()._bindCube;
      case this.VERSION:
        return "WebGL 1.0  " + VERSION;
      case this.VENDOR:
        return "";
      case this.RENDERER:
        return "ANGLE";
      case this.SHADING_LANGUAGE_VERSION:
        return "WebGL GLSL ES 1.0 ";
      case this.COMPRESSED_TEXTURE_FORMATS:
        return new Uint32Array(0);
      // Int arrays — tracked in JS (native getParameterx crashes for array returns)
      case this.SCISSOR_BOX:
        return new Int32Array(this._scissorBox);
      case this.VIEWPORT:
        return new Int32Array(this._viewport);
      case this.MAX_VIEWPORT_DIMS:
        return new Int32Array([32767, 32767]);
      // Float arrays — return safe defaults (native getParameterx crashes for these)
      case this.ALIASED_LINE_WIDTH_RANGE:
      case this.ALIASED_POINT_SIZE_RANGE:
        return new Float32Array([1, 1]);
      case this.DEPTH_RANGE:
        return new Float32Array([0, 1]);
      case this.BLEND_COLOR:
      case this.COLOR_CLEAR_VALUE:
        return new Float32Array([0, 0, 0, 0]);
      case this.COLOR_WRITEMASK:
        return this._gl.getParameterbv(pname, 16);
      // return boolArray(this._gl.getParameterbv(pname, 16));
      case this.DEPTH_CLEAR_VALUE:
      case this.LINE_WIDTH:
      case this.POLYGON_OFFSET_FACTOR:
      case this.POLYGON_OFFSET_UNITS:
      case this.SAMPLE_COVERAGE_VALUE:
        return +this._getParameterDirect(pname);
      case this.BLEND:
      case this.CULL_FACE:
      case this.DEPTH_TEST:
      case this.DEPTH_WRITEMASK:
      case this.DITHER:
      case this.POLYGON_OFFSET_FILL:
      case this.SAMPLE_COVERAGE_INVERT:
      case this.SCISSOR_TEST:
      case this.STENCIL_TEST:
      case this.UNPACK_FLIP_Y_WEBGL:
      case this.UNPACK_PREMULTIPLY_ALPHA_WEBGL:
        return !!this._getParameterDirect(pname);
      case this.ACTIVE_TEXTURE:
      case this.ALPHA_BITS:
      case this.BLEND_DST_ALPHA:
      case this.BLEND_DST_RGB:
      case this.BLEND_EQUATION_ALPHA:
      case this.BLEND_EQUATION_RGB:
      case this.BLEND_SRC_ALPHA:
      case this.BLEND_SRC_RGB:
      case this.BLUE_BITS:
      case this.CULL_FACE_MODE:
      case this.DEPTH_BITS:
      case this.DEPTH_FUNC:
      case this.FRONT_FACE:
      case this.GENERATE_MIPMAP_HINT:
      case this.GREEN_BITS:
      case this.MAX_COMBINED_TEXTURE_IMAGE_UNITS:
      case this.MAX_CUBE_MAP_TEXTURE_SIZE:
      case this.MAX_FRAGMENT_UNIFORM_VECTORS:
      case this.MAX_RENDERBUFFER_SIZE:
      case this.MAX_TEXTURE_IMAGE_UNITS:
      case this.MAX_TEXTURE_SIZE:
      case this.MAX_VARYING_VECTORS:
      case this.MAX_VERTEX_ATTRIBS:
      case this.MAX_VERTEX_TEXTURE_IMAGE_UNITS:
      case this.MAX_VERTEX_UNIFORM_VECTORS:
      case this.PACK_ALIGNMENT:
      case this.RED_BITS:
      case this.SAMPLE_BUFFERS:
      case this.SAMPLES:
      case this.STENCIL_BACK_FAIL:
      case this.STENCIL_BACK_FUNC:
      case this.STENCIL_BACK_PASS_DEPTH_FAIL:
      case this.STENCIL_BACK_PASS_DEPTH_PASS:
      case this.STENCIL_BACK_REF:
      case this.STENCIL_BACK_VALUE_MASK:
      case this.STENCIL_BACK_WRITEMASK:
      case this.STENCIL_BITS:
      case this.STENCIL_CLEAR_VALUE:
      case this.STENCIL_FAIL:
      case this.STENCIL_FUNC:
      case this.STENCIL_PASS_DEPTH_FAIL:
      case this.STENCIL_PASS_DEPTH_PASS:
      case this.STENCIL_REF:
      case this.STENCIL_VALUE_MASK:
      case this.STENCIL_WRITEMASK:
      case this.SUBPIXEL_BITS:
      case this.UNPACK_ALIGNMENT:
      case this.UNPACK_COLORSPACE_CONVERSION_WEBGL:
        return this._getParameterDirect(pname) | 0;
      case this.IMPLEMENTATION_COLOR_READ_FORMAT:
      case this.IMPLEMENTATION_COLOR_READ_TYPE:
        return this._getParameterDirect(pname);
      default:
        if (this._extensions.webgl_draw_buffers) {
          const ext = this._extensions.webgl_draw_buffers;
          switch (pname) {
            case ext.DRAW_BUFFER0_WEBGL:
            case ext.DRAW_BUFFER1_WEBGL:
            case ext.DRAW_BUFFER2_WEBGL:
            case ext.DRAW_BUFFER3_WEBGL:
            case ext.DRAW_BUFFER4_WEBGL:
            case ext.DRAW_BUFFER5_WEBGL:
            case ext.DRAW_BUFFER6_WEBGL:
            case ext.DRAW_BUFFER7_WEBGL:
            case ext.DRAW_BUFFER8_WEBGL:
            case ext.DRAW_BUFFER9_WEBGL:
            case ext.DRAW_BUFFER10_WEBGL:
            case ext.DRAW_BUFFER11_WEBGL:
            case ext.DRAW_BUFFER12_WEBGL:
            case ext.DRAW_BUFFER13_WEBGL:
            case ext.DRAW_BUFFER14_WEBGL:
            case ext.DRAW_BUFFER15_WEBGL:
              if (ext._buffersState.length === 1 && ext._buffersState[0] === this.BACK) {
                return this.BACK;
              }
              return this._getParameterDirect(pname);
            case ext.MAX_DRAW_BUFFERS_WEBGL:
            case ext.MAX_COLOR_ATTACHMENTS_WEBGL:
              return this._getParameterDirect(pname);
          }
        }
        if (this._extensions.oes_standard_derivatives && pname === this._extensions.oes_standard_derivatives.FRAGMENT_SHADER_DERIVATIVE_HINT_OES) {
          return this._getParameterDirect(pname);
        }
        if (this._extensions.ext_texture_filter_anisotropic && pname === this._extensions.ext_texture_filter_anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT) {
          return this._getParameterDirect(pname);
        }
        if (this._extensions.oes_vertex_array_object && pname === this._extensions.oes_vertex_array_object.VERTEX_ARRAY_BINDING_OES) {
          return this._extensions.oes_vertex_array_object._activeVertexArrayObject;
        }
        this.setError(this.INVALID_ENUM);
        return null;
    }
  }
  getProgramInfoLog(program) {
    if (!checkObject(program)) {
      throw new TypeError("getProgramInfoLog(WebGLProgram)");
    } else if (this._checkWrapper(program, WebGLProgram)) {
      return program._linkInfoLog;
    }
    return null;
  }
  getProgramParameter(program, pname = 0) {
    if (!checkObject(program)) {
      throw new TypeError("getProgramParameter(WebGLProgram, GLenum)");
    } else if (this._checkWrapper(program, WebGLProgram)) {
      switch (pname) {
        case this.DELETE_STATUS:
          return program._pendingDelete;
        case this.LINK_STATUS:
          return program._linkStatus;
        case this.VALIDATE_STATUS:
          return !!this._gl.getProgramParameter(program._, pname);
        case this.ATTACHED_SHADERS:
        case this.ACTIVE_ATTRIBUTES:
        case this.ACTIVE_UNIFORMS:
          return this._gl.getProgramParameter(program._, pname);
      }
      this.setError(this.INVALID_ENUM);
    }
    return null;
  }
  getRenderbufferParameter(target = 0, pname = 0) {
    if (target !== this.RENDERBUFFER) {
      this.setError(this.INVALID_ENUM);
      return null;
    }
    const renderbuffer = this._activeRenderbuffer;
    if (!renderbuffer) {
      this.setError(this.INVALID_OPERATION);
      return null;
    }
    switch (pname) {
      case this.RENDERBUFFER_INTERNAL_FORMAT:
        return renderbuffer._format;
      case this.RENDERBUFFER_WIDTH:
        return renderbuffer._width;
      case this.RENDERBUFFER_HEIGHT:
        return renderbuffer._height;
      case this.MAX_RENDERBUFFER_SIZE:
      // TODO?
      case this.RENDERBUFFER_RED_SIZE:
      case this.RENDERBUFFER_GREEN_SIZE:
      case this.RENDERBUFFER_BLUE_SIZE:
      case this.RENDERBUFFER_ALPHA_SIZE:
      case this.RENDERBUFFER_DEPTH_SIZE:
      case this.RENDERBUFFER_STENCIL_SIZE:
        return this._gl.getRenderbufferParameter(target, pname);
    }
    this.setError(this.INVALID_ENUM);
    return null;
  }
  getShaderInfoLog(shader) {
    if (!checkObject(shader)) {
      throw new TypeError("getShaderInfoLog(WebGLShader)");
    } else if (this._checkWrapper(shader, WebGLShader)) {
      return shader._compileInfo;
    }
    return null;
  }
  getShaderParameter(shader, pname = 0) {
    if (!checkObject(shader)) {
      throw new TypeError("getShaderParameter(WebGLShader, GLenum)");
    } else if (this._checkWrapper(shader, WebGLShader)) {
      switch (pname) {
        case this.DELETE_STATUS:
          return shader._pendingDelete;
        case this.COMPILE_STATUS:
          return shader._compileStatus;
        case this.SHADER_TYPE:
          return shader._type;
      }
      this.setError(this.INVALID_ENUM);
    }
    return null;
  }
  getShaderPrecisionFormat(shaderType = 0, precisionType = 0) {
    if (!(shaderType === this.FRAGMENT_SHADER || shaderType === this.VERTEX_SHADER) || !(precisionType === this.LOW_FLOAT || precisionType === this.MEDIUM_FLOAT || precisionType === this.HIGH_FLOAT || precisionType === this.LOW_INT || precisionType === this.MEDIUM_INT || precisionType === this.HIGH_INT)) {
      this.setError(this.INVALID_ENUM);
      return null;
    }
    const format = this._gl.getShaderPrecisionFormat(shaderType, precisionType);
    if (!format) {
      return null;
    }
    return new WebGLShaderPrecisionFormat(format);
  }
  getShaderSource(shader) {
    if (!checkObject(shader)) {
      throw new TypeError("Input to getShaderSource must be an object");
    } else if (this._checkWrapper(shader, WebGLShader)) {
      return shader._source;
    }
    return null;
  }
  getSupportedExtensions() {
    const exts = [
      "ANGLE_instanced_arrays",
      "STACKGL_resize_drawingbuffer",
      "STACKGL_destroy_context"
    ];
    const supportedExts = this._gl.getSupportedExtensions();
    if (!supportedExts) {
      return exts;
    }
    if (supportedExts.indexOf("GL_OES_element_index_uint") >= 0) {
      exts.push("OES_element_index_uint");
    }
    if (supportedExts.indexOf("GL_OES_standard_derivatives") >= 0) {
      exts.push("OES_standard_derivatives");
    }
    if (supportedExts.indexOf("GL_OES_texture_float") >= 0) {
      exts.push("OES_texture_float");
    }
    if (supportedExts.indexOf("GL_OES_texture_float_linear") >= 0) {
      exts.push("OES_texture_float_linear");
    }
    if (supportedExts.indexOf("GL_OES_texture_half_float") >= 0 || supportedExts.indexOf("GL_ARB_half_float_pixel") >= 0) {
      exts.push("OES_texture_half_float");
    }
    if (supportedExts.indexOf("GL_EXT_color_buffer_float") >= 0 || supportedExts.indexOf("GL_ARB_color_buffer_float") >= 0) {
      exts.push("EXT_color_buffer_float");
    }
    if (supportedExts.indexOf("GL_EXT_color_buffer_half_float") >= 0) {
      exts.push("EXT_color_buffer_half_float");
    }
    if (supportedExts.indexOf("EXT_draw_buffers") >= 0) {
      exts.push("WEBGL_draw_buffers");
    }
    if (supportedExts.indexOf("EXT_blend_minmax") >= 0) {
      exts.push("EXT_blend_minmax");
    }
    if (supportedExts.indexOf("EXT_texture_filter_anisotropic") >= 0) {
      exts.push("EXT_texture_filter_anisotropic");
    }
    if (supportedExts.indexOf("GL_OES_vertex_array_object") >= 0) {
      exts.push("OES_vertex_array_object");
    }
    return exts;
  }
  _getTexParameterDirect(target = 0, pname = 0) {
    return this._gl.getTexParameterx(target, pname)?.unpack();
  }
  getTexParameter(target = 0, pname = 0) {
    if (!this._checkTextureTarget(target)) {
      return null;
    }
    const unit = this._getActiveTextureUnit();
    if (target === this.TEXTURE_2D && !unit._bind2D || target === this.TEXTURE_CUBE_MAP && !unit._bindCube) {
      this.setError(this.INVALID_OPERATION);
      return null;
    }
    switch (pname) {
      case this.TEXTURE_MAG_FILTER:
      case this.TEXTURE_MIN_FILTER:
      case this.TEXTURE_WRAP_S:
      case this.TEXTURE_WRAP_T:
        return this._getTexParameterDirect(target, pname);
    }
    if (this._extensions.ext_texture_filter_anisotropic && pname === this._extensions.ext_texture_filter_anisotropic.TEXTURE_MAX_ANISOTROPY_EXT) {
      return this._getTexParameterDirect(target, pname);
    }
    this.setError(this.INVALID_ENUM);
    return null;
  }
  getUniform(program, location) {
    if (!checkObject(program) || !checkObject(location)) {
      throw new TypeError("getUniform(WebGLProgram, WebGLUniformLocation)");
    } else if (!program) {
      this.setError(this.INVALID_VALUE);
      return null;
    } else if (!location) {
      return null;
    } else if (this._checkWrapper(program, WebGLProgram)) {
      if (!checkUniform(program, location)) {
        this.setError(this.INVALID_OPERATION);
        return null;
      }
      const data = this._gl.getUniform(program._ | 0, location._ | 0);
      if (!data) {
        return null;
      }
      switch (location._activeInfo.type) {
        case this.FLOAT:
          return data[0];
        case this.FLOAT_VEC2:
          return new Float32Array(data.slice(0, 2));
        case this.FLOAT_VEC3:
          return new Float32Array(data.slice(0, 3));
        case this.FLOAT_VEC4:
          return new Float32Array(data.slice(0, 4));
        case this.INT:
          return data[0] | 0;
        case this.INT_VEC2:
          return new Int32Array(data.slice(0, 2));
        case this.INT_VEC3:
          return new Int32Array(data.slice(0, 3));
        case this.INT_VEC4:
          return new Int32Array(data.slice(0, 4));
        case this.BOOL:
          return !!data[0];
        case this.BOOL_VEC2:
          return [!!data[0], !!data[1]];
        case this.BOOL_VEC3:
          return [!!data[0], !!data[1], !!data[2]];
        case this.BOOL_VEC4:
          return [!!data[0], !!data[1], !!data[2], !!data[3]];
        case this.FLOAT_MAT2:
          return new Float32Array(data.slice(0, 4));
        case this.FLOAT_MAT3:
          return new Float32Array(data.slice(0, 9));
        case this.FLOAT_MAT4:
          return new Float32Array(data.slice(0, 16));
        case this.SAMPLER_2D:
        case this.SAMPLER_CUBE:
          return data[0] | 0;
        default:
          return null;
      }
    }
    return null;
  }
  getUniformLocation(program, name2) {
    if (!checkObject(program)) {
      throw new TypeError("getUniformLocation(WebGLProgram, String)");
    }
    name2 += "";
    if (!isValidString(name2)) {
      this.setError(this.INVALID_VALUE);
      return null;
    }
    if (this._checkWrapper(program, WebGLProgram)) {
      const loc = this._gl.getUniformLocation(program._ | 0, name2);
      if (loc !== null && loc >= 0) {
        let searchName = name2;
        if (/\[\d+\]$/.test(name2)) {
          searchName = name2.replace(/\[\d+\]$/, "[0]");
        }
        let info2 = null;
        for (let i = 0; i < program._uniforms.length; ++i) {
          const infoItem = program._uniforms[i];
          if (infoItem.name === searchName) {
            info2 = {
              size: infoItem.size,
              type: infoItem.type,
              name: infoItem.name
            };
          }
        }
        if (!info2) {
          return null;
        }
        const result = new WebGLUniformLocation(
          loc,
          program,
          info2
        );
        if (/\[0\]$/.test(name2)) {
          const baseName = name2.replace(/\[0\]$/, "");
          const arrayLocs = [];
          this._saveError();
          for (let i = 0; this.getError() === this.NO_ERROR; ++i) {
            const xloc = this._gl.getUniformLocation(
              program._ | 0,
              baseName + "[" + i + "]"
            );
            if (this.getError() !== this.NO_ERROR || !xloc || xloc < 0) {
              break;
            }
            arrayLocs.push(xloc);
          }
          this._restoreError(this.NO_ERROR);
          result._array = arrayLocs;
        } else if (name2 && /\[(\d+)\]$/.test(name2)) {
          const _regexExec = /\[(\d+)\]$/.exec(name2);
          if (!_regexExec || _regexExec.length <= 0) {
            return null;
          }
          const offset = +_regexExec[1];
          if (offset < 0 || offset >= info2.size) {
            return null;
          }
        }
        return result;
      }
    }
    return null;
  }
  getVertexAttrib(index = 0, pname = 0) {
    if (index < 0 || index >= this._vertexObjectState._attribs.length) {
      this.setError(this.INVALID_VALUE);
      return null;
    }
    const attrib = this._vertexObjectState._attribs[index];
    const vertexAttribValue = this._vertexGlobalState._attribs[index]._data;
    const extInstancing = this._extensions.angle_instanced_arrays;
    if (extInstancing) {
      if (pname === extInstancing.VERTEX_ATTRIB_ARRAY_DIVISOR_ANGLE) {
        return attrib._divisor;
      }
    }
    switch (pname) {
      case this.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING:
        return attrib._pointerBuffer;
      case this.VERTEX_ATTRIB_ARRAY_ENABLED:
        return attrib._isPointer;
      case this.VERTEX_ATTRIB_ARRAY_SIZE:
        return attrib._inputSize;
      case this.VERTEX_ATTRIB_ARRAY_STRIDE:
        return attrib._inputStride;
      case this.VERTEX_ATTRIB_ARRAY_TYPE:
        return attrib._pointerType;
      case this.VERTEX_ATTRIB_ARRAY_NORMALIZED:
        return attrib._pointerNormal;
      case this.CURRENT_VERTEX_ATTRIB:
        return new Float32Array(vertexAttribValue);
      default:
        this.setError(this.INVALID_ENUM);
        return null;
    }
  }
  getVertexAttribOffset(index = 0, pname = 0) {
    if (index < 0 || index >= this._vertexObjectState._attribs.length) {
      this.setError(this.INVALID_VALUE);
      return -1;
    }
    if (pname === this.VERTEX_ATTRIB_ARRAY_POINTER) {
      return this._vertexObjectState._attribs[index]._pointerOffset;
    } else {
      this.setError(this.INVALID_ENUM);
      return -1;
    }
  }
  hint(target = 0, mode = 0) {
    if (!(target === this.GENERATE_MIPMAP_HINT || this._extensions.oes_standard_derivatives && target === this._extensions.oes_standard_derivatives.FRAGMENT_SHADER_DERIVATIVE_HINT_OES)) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    if (mode !== this.FASTEST && mode !== this.NICEST && mode !== this.DONT_CARE) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    return this._gl.hint(target, mode);
  }
  isBuffer(buffer) {
    if (!this._isObject(buffer, "isBuffer", WebGLBuffer)) return false;
    return this._gl.isBuffer(buffer?._);
  }
  isContextLost() {
    return false;
  }
  isEnabled(cap = 0) {
    return this._gl.isEnabled(cap);
  }
  isFramebuffer(framebuffer) {
    if (!this._isObject(framebuffer, "isFramebuffer", WebGLFramebuffer)) return false;
    return this._gl.isFramebuffer(framebuffer?._);
  }
  isProgram(program) {
    if (!this._isObject(program, "isProgram", WebGLProgram)) return false;
    return this._gl.isProgram(program?._);
  }
  isRenderbuffer(renderbuffer) {
    if (!this._isObject(renderbuffer, "isRenderbuffer", WebGLRenderbuffer)) return false;
    return this._gl.isRenderbuffer(renderbuffer?._);
  }
  isShader(shader) {
    if (!this._isObject(shader, "isShader", WebGLShader)) return false;
    return this._gl.isShader(shader?._);
  }
  isTexture(texture) {
    if (!this._isObject(texture, "isTexture", WebGLTexture)) return false;
    return this._gl.isTexture(texture?._);
  }
  lineWidth(width) {
    if (isNaN(width)) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    return this._gl.lineWidth(+width);
  }
  linkProgram(program) {
    if (!checkObject(program)) {
      throw new TypeError("linkProgram(WebGLProgram)");
    }
    if (this._checkWrapper(program, WebGLProgram)) {
      program._linkCount += 1;
      program._attributes = [];
      const prevError = this.getError();
      this._gl.linkProgram(program._ | 0);
      const error2 = this.getError();
      if (error2 === this.NO_ERROR) {
        program._linkStatus = this._fixupLink(program);
      }
      this.getError();
      this.setError(prevError || error2);
    }
  }
  /** The `WebGLRenderingContext.pixelStorei()` method of the WebGL API specifies the pixel storage modes. */
  pixelStorei(pname = 0, param = 0) {
    if (typeof param === "boolean") {
      param = param === false ? 0 : 1;
    }
    if (pname === this.UNPACK_ALIGNMENT) {
      if (param === 1 || param === 2 || param === 4 || param === 8) {
        this._unpackAlignment = param;
      } else {
        this.setError(this.INVALID_VALUE);
        return;
      }
    } else if (pname === this.PACK_ALIGNMENT) {
      if (param === 1 || param === 2 || param === 4 || param === 8) {
        this._packAlignment = param;
      } else {
        this.setError(this.INVALID_VALUE);
        return;
      }
    } else if (pname === this.UNPACK_COLORSPACE_CONVERSION_WEBGL) {
      if (!(param === this.NONE || param === this.BROWSER_DEFAULT_WEBGL)) {
        this.setError(this.INVALID_VALUE);
        return;
      }
    }
    return this._gl.pixelStorei(pname, param);
  }
  polygonOffset(factor, units) {
    return this._gl.polygonOffset(+factor, +units);
  }
  renderbufferStorage(target = 0, internalFormat = 0, width = 0, height = 0) {
    if (target !== this.RENDERBUFFER) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    const renderbuffer = this._activeRenderbuffer;
    if (!renderbuffer) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    if (internalFormat !== this.RGBA4 && internalFormat !== this.RGB565 && internalFormat !== this.RGB5_A1 && internalFormat !== this.DEPTH_COMPONENT16 && internalFormat !== this.STENCIL_INDEX && internalFormat !== this.STENCIL_INDEX8 && internalFormat !== this.DEPTH_STENCIL) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    this._saveError();
    this._gl.renderbufferStorage(
      target,
      internalFormat,
      width,
      height
    );
    const error2 = this.getError();
    this._restoreError(error2);
    if (error2 !== this.NO_ERROR) {
      return;
    }
    renderbuffer._width = width;
    renderbuffer._height = height;
    renderbuffer._format = internalFormat;
    const activeFramebuffer = this._activeFramebuffer;
    if (activeFramebuffer) {
      let needsUpdate = false;
      const attachments = this._getAttachments();
      for (let i = 0; i < attachments.length; ++i) {
        if (activeFramebuffer._attachments[attachments[i]] === renderbuffer) {
          needsUpdate = true;
          break;
        }
      }
      if (needsUpdate) {
        this._updateFramebufferAttachments(this._activeFramebuffer);
      }
    }
  }
  resize(width = 0, height = 0) {
    width = width | 0;
    height = height | 0;
    if (!(width > 0 && height > 0)) {
      throw new Error("Invalid surface dimensions");
    } else if (width !== this.drawingBufferWidth || height !== this.drawingBufferHeight) {
      this._resizeDrawingBuffer(width, height);
    }
  }
  sampleCoverage(value2, invert) {
    return this._gl.sampleCoverage(+value2, !!invert);
  }
  scissor(x, y, width, height) {
    this._scissorBox[0] = x | 0;
    this._scissorBox[1] = y | 0;
    this._scissorBox[2] = width | 0;
    this._scissorBox[3] = height | 0;
    return this._gl.scissor(x | 0, y | 0, width | 0, height | 0);
  }
  shaderSource(shader, source) {
    if (!checkObject(shader)) {
      throw new TypeError("shaderSource(WebGLShader, String)");
    }
    if (!shader || !source && typeof source !== "string") {
      this.setError(this.INVALID_VALUE);
      return;
    }
    if (!isValidString(source)) {
      this.setError(this.INVALID_VALUE);
    } else if (this._checkWrapper(shader, WebGLShader)) {
      source = this._wrapShader(shader._type, source);
      this._gl.shaderSource(shader._ | 0, source);
      shader._source = source;
    }
  }
  stencilFunc(func, ref, mask) {
    this._checkStencil = true;
    return this._gl.stencilFunc(func | 0, ref | 0, mask | 0);
  }
  stencilFuncSeparate(face, func, ref, mask) {
    this._checkStencil = true;
    return this._gl.stencilFuncSeparate(face | 0, func | 0, ref | 0, mask | 0);
  }
  stencilMask(mask) {
    this._checkStencil = true;
    return this._gl.stencilMask(mask >>> 0);
  }
  stencilMaskSeparate(face, mask) {
    this._checkStencil = true;
    return this._gl.stencilMaskSeparate(face | 0, mask >>> 0);
  }
  stencilOp(fail2, zfail, zpass) {
    this._checkStencil = true;
    return this._gl.stencilOp(fail2 | 0, zfail | 0, zpass | 0);
  }
  stencilOpSeparate(face, fail2, zfail, zpass) {
    this._checkStencil = true;
    return this._gl.stencilOpSeparate(face | 0, fail2 | 0, zfail | 0, zpass | 0);
  }
  texParameterf(target = 0, pname = 0, param) {
    param = +param;
    if (this._checkTextureTarget(target)) {
      this._verifyTextureCompleteness(target, pname, param);
      switch (pname) {
        case this.TEXTURE_MIN_FILTER:
        case this.TEXTURE_MAG_FILTER:
        case this.TEXTURE_WRAP_S:
        case this.TEXTURE_WRAP_T:
          return this._gl.texParameterf(target, pname, param);
      }
      if (this._extensions.ext_texture_filter_anisotropic && pname === this._extensions.ext_texture_filter_anisotropic.TEXTURE_MAX_ANISOTROPY_EXT) {
        return this._gl.texParameterf(target, pname, param);
      }
      this.setError(this.INVALID_ENUM);
    }
  }
  texParameteri(target = 0, pname = 0, param = 0) {
    if (this._checkTextureTarget(target)) {
      this._verifyTextureCompleteness(target, pname, param);
      switch (pname) {
        case this.TEXTURE_MIN_FILTER:
        case this.TEXTURE_MAG_FILTER:
        case this.TEXTURE_WRAP_S:
        case this.TEXTURE_WRAP_T:
          return this._gl.texParameteri(target, pname, param);
      }
      if (this._extensions.ext_texture_filter_anisotropic && pname === this._extensions.ext_texture_filter_anisotropic.TEXTURE_MAX_ANISOTROPY_EXT) {
        return this._gl.texParameteri(target, pname, param);
      }
      this.setError(this.INVALID_ENUM);
    }
  }
  uniform1f(location, x) {
    if (!this._checkUniformValid(location, x, "uniform1f", 1, "f")) return;
    return this._gl.uniform1f(location?._ || 0, x);
  }
  uniform1i(location, x) {
    return this._gl.uniform1i(location?._ || 0, x);
  }
  uniform2f(location, x, y) {
    if (!this._checkUniformValid(location, x, "uniform2f", 2, "f")) return;
    return this._gl.uniform2f(location?._ || 0, x, y);
  }
  uniform2i(location, x, y) {
    if (!this._checkUniformValid(location, x, "uniform2i", 2, "i")) return;
    this._gl.uniform2i(location?._ || 0, x, y);
  }
  uniform3f(location, x, y, z) {
    if (!this._checkUniformValid(location, x, "uniform3f", 3, "f")) return;
    return this._gl.uniform3f(location?._ || 0, x, y, z);
  }
  uniform3i(location, x, y, z) {
    if (!this._checkUniformValid(location, x, "uniform3i", 3, "i")) return;
    return this._gl.uniform3i(location?._ || 0, x, y, z);
  }
  uniform4f(location, x, y, z, w) {
    if (!this._checkUniformValid(location, x, "uniform4f", 4, "f")) {
      console.error("uniform4f is not valid!");
      return;
    }
    return this._gl.uniform4f(location?._ || 0, x, y, z, w);
  }
  uniform4i(location, x, y, z, w) {
    if (!this._checkUniformValid(location, x, "uniform4i", 4, "i")) return;
    return this._gl.uniform4i(location?._ || 0, x, y, z, w);
  }
  useProgram(program) {
    if (!checkObject(program)) {
      throw new TypeError("useProgram(WebGLProgram)");
    } else if (!program) {
      this._switchActiveProgram(this._activeProgram);
      this._activeProgram = null;
      return this._gl.useProgram(0);
    } else if (this._checkWrapper(program, WebGLProgram)) {
      if (this._activeProgram !== program) {
        this._switchActiveProgram(this._activeProgram);
        this._activeProgram = program;
        program._refCount += 1;
      }
      return this._gl.useProgram(program._ | 0);
    }
  }
  validateProgram(program) {
    if (this._checkWrapper(program, WebGLProgram)) {
      this._gl.validateProgram(program._ | 0);
      const error2 = this.getError();
      if (error2 === this.NO_ERROR) {
        program._linkInfoLog = this._gl.getProgramInfoLog(program._ | 0);
      }
      this.getError();
      this.setError(error2);
    }
  }
  vertexAttrib1f(index, x) {
    index |= 0;
    if (!this._checkVertexIndex(index)) return;
    const data = this._vertexGlobalState._attribs[index]._data;
    data[3] = 1;
    data[1] = data[2] = 0;
    data[0] = x;
    return this._gl.vertexAttrib1f(index | 0, +x);
  }
  vertexAttrib1fv(index, values) {
    if (typeof values !== "object" || values === null || values.length < 1) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    const data = this._vertexGlobalState._attribs[index]._data;
    data[3] = 1;
    data[2] = 0;
    data[1] = 0;
    data[0] = values[0];
    return this._gl.vertexAttrib1f(index | 0, +values[0]);
  }
  vertexAttrib2f(index, x, y) {
    index |= 0;
    if (!this._checkVertexIndex(index)) return;
    const data = this._vertexGlobalState._attribs[index]._data;
    data[3] = 1;
    data[2] = 0;
    data[1] = y;
    data[0] = x;
    return this._gl.vertexAttrib2f(index | 0, +x, +y);
  }
  vertexAttrib2fv(index, values) {
    if (typeof values !== "object" || values === null || values.length < 2) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    const data = this._vertexGlobalState._attribs[index]._data;
    data[3] = 1;
    data[2] = 0;
    data[1] = values[1];
    data[0] = values[0];
    return this._gl.vertexAttrib2f(index | 0, +values[0], +values[1]);
  }
  vertexAttrib3f(index, x, y, z) {
    index |= 0;
    if (!this._checkVertexIndex(index)) return;
    const data = this._vertexGlobalState._attribs[index]._data;
    data[3] = 1;
    data[2] = z;
    data[1] = y;
    data[0] = x;
    return this._gl.vertexAttrib3f(index | 0, +x, +y, +z);
  }
  vertexAttrib3fv(index, values) {
    if (typeof values !== "object" || values === null || values.length < 3) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    const data = this._vertexGlobalState._attribs[index]._data;
    data[3] = 1;
    data[2] = values[2];
    data[1] = values[1];
    data[0] = values[0];
    return this._gl.vertexAttrib3f(index | 0, +values[0], +values[1], +values[2]);
  }
  vertexAttrib4f(index = 0, x, y, z, w) {
    if (!this._checkVertexIndex(index)) return;
    const data = this._vertexGlobalState._attribs[index]._data;
    data[3] = w;
    data[2] = z;
    data[1] = y;
    data[0] = x;
    return this._gl.vertexAttrib4f(index | 0, +x, +y, +z, +w);
  }
  vertexAttrib4fv(index, values) {
    if (typeof values !== "object" || values === null || values.length < 4) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    const data = this._vertexGlobalState._attribs[index]._data;
    data[3] = values[3];
    data[2] = values[2];
    data[1] = values[1];
    data[0] = values[0];
    return this._gl.vertexAttrib4f(index | 0, +values[0], +values[1], +values[2], +values[3]);
  }
  vertexAttribPointer(index = 0, size = 0, type = 0, normalized = false, stride = 0, offset = 0) {
    if (stride < 0 || offset < 0) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    if (stride < 0 || offset < 0 || index < 0 || index >= this._vertexObjectState._attribs.length || !(size === 1 || size === 2 || size === 3 || size === 4)) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    if (this._vertexGlobalState._arrayBufferBinding === null) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    const byteSize = typeSize(this, type);
    if (byteSize === 0 || type === this.INT || type === this.UNSIGNED_INT) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    if (stride > 255 || stride < 0) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    if (stride % byteSize !== 0 || offset % byteSize !== 0) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    this._gl.vertexAttribPointer(index, size, type, normalized, stride, offset);
    this._vertexObjectState.setVertexAttribPointer(
      /* buffer */
      this._vertexGlobalState._arrayBufferBinding,
      /* index */
      index,
      /* pointerSize */
      size * byteSize,
      /* pointerOffset */
      offset,
      /* pointerStride */
      stride || size * byteSize,
      /* pointerType */
      type,
      /* pointerNormal */
      normalized,
      /* inputStride */
      stride,
      /* inputSize */
      size
    );
  }
  viewport(x, y, width, height) {
    this._viewport[0] = x | 0;
    this._viewport[1] = y | 0;
    this._viewport[2] = width | 0;
    this._viewport[3] = height | 0;
    return this._gl.viewport(x, y, width, height);
  }
};

// lib/esm/webgl-rendering-context.js
var WebGLRenderingContext = class extends WebGLContextBase {
  constructor(canvas, options = {}) {
    super(canvas, options);
    this._attrib0Buffer = null;
    this._native = new gwebgl_0_default.WebGLRenderingContext({});
    this._init();
    const attrib0Buffer = this.createBuffer();
    this._attrib0Buffer = attrib0Buffer;
  }
  get _gl() {
    return this._native;
  }
  // ─── Attrib0 Hack (WebGL1 / GLES2 only) ─────────────────────────────
  _beginAttrib0Hack() {
    this._native.bindBuffer(this.ARRAY_BUFFER, this._attrib0Buffer?._ || 0);
    const uInt8Data = new Uint8Array(this._vertexGlobalState._attribs[0]._data.buffer);
    this._native.bufferData(
      this.ARRAY_BUFFER,
      Uint8ArrayToVariant(uInt8Data),
      this.STREAM_DRAW
    );
    this._native.enableVertexAttribArray(0);
    this._native.vertexAttribPointer(0, 4, this.FLOAT, false, 0, 0);
    this._native._vertexAttribDivisor(0, 1);
  }
  _endAttrib0Hack() {
    const attrib = this._vertexObjectState._attribs[0];
    if (attrib._pointerBuffer) {
      this._native.bindBuffer(this.ARRAY_BUFFER, attrib._pointerBuffer._);
    } else {
      this._native.bindBuffer(this.ARRAY_BUFFER, 0);
    }
    this._native.vertexAttribPointer(
      0,
      attrib._inputSize,
      attrib._pointerType,
      attrib._pointerNormal,
      attrib._inputStride,
      attrib._pointerOffset
    );
    this._native._vertexAttribDivisor(0, attrib._divisor);
    this._native.disableVertexAttribArray(0);
    if (this._vertexGlobalState._arrayBufferBinding) {
      this._native.bindBuffer(this.ARRAY_BUFFER, this._vertexGlobalState._arrayBufferBinding._);
    } else {
      this._native.bindBuffer(this.ARRAY_BUFFER, 0);
    }
  }
  // ─── drawArrays / drawElements with attrib0 hack ─────────────────────
  drawArrays(mode = 0, first = 0, count2 = 0) {
    if (first < 0 || count2 < 0) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    if (!this._checkStencilState()) {
      return;
    }
    const reducedCount = vertexCount(this, mode, count2);
    if (reducedCount < 0) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    if (!this._framebufferOk()) {
      return;
    }
    if (count2 === 0) {
      return;
    }
    let maxIndex = first;
    if (count2 > 0) {
      maxIndex = count2 + first - 1 >>> 0;
    }
    if (this._checkVertexAttribState(maxIndex)) {
      if (this._vertexObjectState._attribs[0]._isPointer || this._extensions.webgl_draw_buffers && this._extensions.webgl_draw_buffers._buffersState && this._extensions.webgl_draw_buffers._buffersState.length > 0) {
        return this._native.drawArrays(mode, first, reducedCount);
      } else {
        this._beginAttrib0Hack();
        this._native._drawArraysInstanced(mode, first, reducedCount, 1);
        this._endAttrib0Hack();
      }
    }
  }
  drawElements(mode = 0, count2 = 0, type = 0, ioffset = 0) {
    if (count2 < 0 || ioffset < 0) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    if (!this._checkStencilState()) {
      return;
    }
    const elementBuffer = this._vertexObjectState._elementArrayBufferBinding;
    if (!elementBuffer) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    let elementData = null;
    let offset = ioffset;
    if (type === this.UNSIGNED_SHORT) {
      if (offset % 2) {
        this.setError(this.INVALID_OPERATION);
        return;
      }
      offset >>= 1;
      elementData = new Uint16Array(elementBuffer._elements.buffer);
    } else if (this._extensions.oes_element_index_uint && type === this.UNSIGNED_INT) {
      if (offset % 4) {
        this.setError(this.INVALID_OPERATION);
        return;
      }
      offset >>= 2;
      elementData = new Uint32Array(elementBuffer._elements.buffer);
    } else if (type === this.UNSIGNED_BYTE) {
      elementData = elementBuffer._elements;
    } else {
      this.setError(this.INVALID_ENUM);
      return;
    }
    let reducedCount = count2;
    switch (mode) {
      case this.TRIANGLES:
        if (count2 % 3) {
          reducedCount -= count2 % 3;
        }
        break;
      case this.LINES:
        if (count2 % 2) {
          reducedCount -= count2 % 2;
        }
        break;
      case this.POINTS:
        break;
      case this.LINE_LOOP:
      case this.LINE_STRIP:
        if (count2 < 2) {
          this.setError(this.INVALID_OPERATION);
          return;
        }
        break;
      case this.TRIANGLE_FAN:
      case this.TRIANGLE_STRIP:
        if (count2 < 3) {
          this.setError(this.INVALID_OPERATION);
          return;
        }
        break;
      default:
        this.setError(this.INVALID_ENUM);
        return;
    }
    if (!this._framebufferOk()) {
      return;
    }
    if (count2 === 0) {
      this._checkVertexAttribState(0);
      return;
    }
    if (count2 + offset >>> 0 > elementData.length) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    let maxIndex = -1;
    for (let i = offset; i < offset + count2; ++i) {
      maxIndex = Math.max(maxIndex, elementData[i]);
    }
    if (maxIndex < 0) {
      this._checkVertexAttribState(0);
      return;
    }
    if (this._checkVertexAttribState(maxIndex)) {
      if (reducedCount > 0) {
        if (this._vertexObjectState._attribs[0]._isPointer) {
          return this._native.drawElements(mode, reducedCount, type, ioffset);
        } else {
          this._beginAttrib0Hack();
          this._native._drawElementsInstanced(mode, reducedCount, type, ioffset, 1);
          this._endAttrib0Hack();
        }
      }
    }
  }
};

// lib/esm/webgl2-rendering-context.js
init_console_gjs();
import GdkPixbuf3 from "gi://GdkPixbuf?version=2.0";

// lib/esm/webgl-query.js
init_console_gjs();
var WebGLQuery = class extends Linkable {
  constructor(_, ctx) {
    super(_);
    this._ctx = ctx;
  }
  _performDelete() {
    const ctx = this._ctx;
    delete ctx._queries[this._ | 0];
    ctx._native2.deleteQuery(this._ | 0);
  }
};

// lib/esm/webgl-sampler.js
init_console_gjs();
var WebGLSampler = class extends Linkable {
  constructor(_, ctx) {
    super(_);
    this._ctx = ctx;
  }
  _performDelete() {
    const ctx = this._ctx;
    delete ctx._samplers[this._ | 0];
    ctx._native2.deleteSampler(this._ | 0);
  }
};

// lib/esm/webgl-sync.js
init_console_gjs();
var WebGLSync = class extends Linkable {
  constructor(_, ctx) {
    super(_);
    this._ctx = ctx;
  }
  _performDelete() {
    const ctx = this._ctx;
    delete ctx._syncs[this._ | 0];
    ctx._native2.deleteSync(this._ | 0);
  }
};

// lib/esm/webgl-transform-feedback.js
init_console_gjs();
var WebGLTransformFeedback = class extends Linkable {
  constructor(_, ctx) {
    super(_);
    this._ctx = ctx;
  }
  _performDelete() {
    const ctx = this._ctx;
    delete ctx._transformFeedbacks[this._ | 0];
    ctx._native2.deleteTransformFeedback(this._ | 0);
  }
};

// lib/esm/webgl-vertex-array-object.js
init_console_gjs();
var WebGLVertexArrayObject = class extends Linkable {
  constructor(_, ctx) {
    super(_);
    this._ctx = ctx;
    this._objectState = new WebGLVertexArrayObjectState(ctx);
  }
  _performDelete() {
    const ctx = this._ctx;
    if (ctx._vertexObjectState === this._objectState) {
      ctx._vertexObjectState = ctx._defaultVertexObjectState;
    }
    this._objectState.cleanUp();
    delete ctx._vertexArrayObjects[this._ | 0];
    ctx._native2.deleteVertexArray(this._ | 0);
  }
};

// lib/esm/webgl2-rendering-context.js
init_esm4();
var WebGL2RenderingContext = class _WebGL2RenderingContext extends WebGLContextBase {
  constructor(canvas, options = {}) {
    super(canvas, options);
    this._queries = {};
    this._samplers = {};
    this._transformFeedbacks = {};
    this._vertexArrayObjects = {};
    this._syncs = {};
    this._activeReadFramebuffer = null;
    this._activeDrawFramebuffer = null;
    this._native2 = new gwebgl_0_default.WebGL2RenderingContext({});
    this._init();
  }
  get _gl() {
    return this._native2;
  }
  _getGlslVersion(es) {
    return es ? "300 es" : "130";
  }
  // ─── WebGL2 overrides for WebGL1 validation that's too strict ─────────
  /**
   * WebGL2 delegates framebuffer completeness to the native GL driver.
   * Called by _framebufferOk() before draw calls and by _updateFramebufferAttachments.
   * The base class version uses JS-side format whitelists that reject valid WebGL2 formats.
   */
  /** WebGL2 allows COLOR_ATTACHMENT1–15 as framebuffer attachment points. */
  _validFramebufferAttachment(attachment) {
    if (super._validFramebufferAttachment(attachment)) return true;
    return attachment >= 36065 && attachment <= 36079;
  }
  static {
    this._WGL2_ALL_COLOR_ATTACHMENTS = [
      36064,
      36065,
      36066,
      36067,
      36068,
      36069,
      36070,
      36071,
      36072,
      36073,
      36074,
      36075,
      36076,
      36077,
      36078,
      36079
    ];
  }
  _getColorAttachments() {
    return _WebGL2RenderingContext._WGL2_ALL_COLOR_ATTACHMENTS;
  }
  /**
   * WebGL2 extends the base-class framebuffer completeness pre-check to
   * accept WebGL2-specific formats that the WebGL1 whitelist rejects.
   *
   * NOTE: This is called by _updateFramebufferAttachments BEFORE the native
   * GL attachments are set, so we must NOT query glCheckFramebufferStatus
   * here (it would see an empty FBO and always return INCOMPLETE).
   * Instead we extend the JS-side format whitelist to cover WebGL2 formats.
   */
  _preCheckFramebufferStatus(framebuffer) {
    const attachments = framebuffer._attachments;
    let bestWidth = 0;
    let bestHeight = 0;
    const allEnums = [
      this.COLOR_ATTACHMENT0,
      this.DEPTH_ATTACHMENT,
      this.STENCIL_ATTACHMENT,
      this.DEPTH_STENCIL_ATTACHMENT,
      ..._WebGL2RenderingContext._WGL2_ALL_COLOR_ATTACHMENTS
    ];
    for (const enumVal of allEnums) {
      const attach = attachments[enumVal];
      if (!attach) continue;
      if (attach instanceof WebGLTexture) {
        const level = framebuffer._attachmentLevel[enumVal] ?? 0;
        const w = attach._levelWidth[level] ?? 0;
        const h = attach._levelHeight[level] ?? 0;
        if (w > 0 && h > 0) {
          bestWidth = w;
          bestHeight = h;
          break;
        }
      } else if (attach instanceof WebGLRenderbuffer) {
        if (attach._width > 0 && attach._height > 0) {
          bestWidth = attach._width;
          bestHeight = attach._height;
          break;
        }
      }
    }
    if (bestWidth > 0 && bestHeight > 0) {
      framebuffer._width = bestWidth;
      framebuffer._height = bestHeight;
      return this.FRAMEBUFFER_COMPLETE;
    }
    return this.FRAMEBUFFER_INCOMPLETE_ATTACHMENT;
  }
  /**
   * WebGL2 completely replaces the base class framebuffer attachment flow.
   *
   * The base class flow is: (1) pre-check formats in JS → (2) set native
   * attachments only if pre-check passes. This is wrong for WebGL2 because
   * the JS pre-check uses WebGL1 format whitelists that reject valid WebGL2
   * formats.
   *
   * WebGL2 flow: (1) always set native attachments first → (2) query native
   * glCheckFramebufferStatus to determine completeness. This delegates all
   * format validation to the native GL driver, matching browser behavior.
   *
   * Also handles COLOR_ATTACHMENT1–15 (WebGL2 MRT) that the base class
   * doesn't know about.
   */
  /**
   * Apply COLOR_ATTACHMENT1–15 to the native GL FBO (WebGL2 MRT).
   * The base class handles CA0, DEPTH, STENCIL, DEPTH_STENCIL and calls
   * _preCheckFramebufferStatus (which we override to query native GL).
   */
  _updateFramebufferAttachments(framebuffer) {
    super._updateFramebufferAttachments(framebuffer);
    if (!framebuffer) return;
    for (let i = 1; i <= 15; i++) {
      const attachmentEnum = 36064 + i;
      if (!(attachmentEnum in framebuffer._attachments)) continue;
      const attachment = framebuffer._attachments[attachmentEnum];
      if (attachment instanceof WebGLTexture) {
        const face = framebuffer._attachmentFace[attachmentEnum] || this.TEXTURE_2D;
        const level = framebuffer._attachmentLevel[attachmentEnum] ?? 0;
        this._gl.framebufferTexture2D(this.FRAMEBUFFER, attachmentEnum, face, attachment._ | 0, level | 0);
      } else if (attachment instanceof WebGLRenderbuffer) {
        this._gl.framebufferRenderbuffer(this.FRAMEBUFFER, attachmentEnum, this.RENDERBUFFER, attachment._ | 0);
      } else {
        this._gl.framebufferTexture2D(this.FRAMEBUFFER, attachmentEnum, this.TEXTURE_2D, 0, 0);
      }
    }
  }
  /** WebGL2 adds UNIFORM_BUFFER, TRANSFORM_FEEDBACK_BUFFER, etc. targets. */
  bindBuffer(target, buffer) {
    const isWebGL2Target = target === 35345 || target === 35982 || target === 36662 || target === 36663;
    if (isWebGL2Target) {
      const id = buffer ? buffer._ | 0 : 0;
      this._gl.bindBuffer(target, id);
      return;
    }
    super.bindBuffer(target, buffer);
  }
  /**
   * WebGL2 adds READ_FRAMEBUFFER (0x8CA8) and DRAW_FRAMEBUFFER (0x8CA9) targets.
   * The base class only accepts FRAMEBUFFER; this override handles the two new targets
   * and keeps _activeReadFramebuffer / _activeDrawFramebuffer in sync.
   */
  bindFramebuffer(target, framebuffer) {
    if (target === 36008 || target === 36009) {
      if (!checkObject(framebuffer)) {
        throw new TypeError("bindFramebuffer(GLenum, WebGLFramebuffer)");
      }
      if (framebuffer && framebuffer._pendingDelete) return;
      if (framebuffer && !this._checkWrapper(framebuffer, WebGLFramebuffer)) return;
      const id = framebuffer ? framebuffer._ | 0 : this._gtkFboId;
      this._gl.bindFramebuffer(target, id);
      if (target === 36008) {
        const prev = this._activeReadFramebuffer;
        if (prev !== framebuffer) {
          if (prev) {
            prev._refCount -= 1;
            prev._checkDelete();
          }
          if (framebuffer) framebuffer._refCount += 1;
        }
        this._activeReadFramebuffer = framebuffer;
      } else {
        const prev = this._activeDrawFramebuffer;
        if (prev !== framebuffer) {
          if (prev) {
            prev._refCount -= 1;
            prev._checkDelete();
          }
          if (framebuffer) framebuffer._refCount += 1;
        }
        this._activeDrawFramebuffer = framebuffer;
        this._activeFramebuffer = framebuffer;
      }
      return;
    }
    super.bindFramebuffer(this.FRAMEBUFFER, framebuffer);
    this._activeReadFramebuffer = framebuffer;
    this._activeDrawFramebuffer = framebuffer;
  }
  /** WebGL2 also unbinds from read/draw framebuffer slots when deleting. */
  deleteFramebuffer(framebuffer) {
    if (this._activeReadFramebuffer === framebuffer) {
      this.bindFramebuffer(36008, null);
    }
    if (this._activeDrawFramebuffer === framebuffer) {
      this.bindFramebuffer(36009, null);
    }
    super.deleteFramebuffer(framebuffer);
  }
  /** WebGL2 adds READ/COPY buffer usages and additional buffer targets. */
  bufferData(target, dataOrSize, usage) {
    const isWebGL2Target = target === 35345 || target === 35982 || target === 36662 || target === 36663;
    const isReadOrCopy = usage === 35041 || usage === 35043 || usage === 35045 || usage === 35042 || usage === 35044 || usage === 35046;
    const remappedUsage = isReadOrCopy ? this.STATIC_DRAW : usage;
    if (isWebGL2Target) {
      if (typeof dataOrSize === "number") {
        if (dataOrSize >= 0) this._gl.bufferDataSizeOnly(target, dataOrSize, remappedUsage);
      } else if (dataOrSize !== null && typeof dataOrSize === "object") {
        const u8Data = arrayToUint8Array(dataOrSize);
        this._gl.bufferData(target, Uint8ArrayToVariant(u8Data), remappedUsage);
      }
      return;
    }
    super.bufferData(target, dataOrSize, remappedUsage);
  }
  /** WebGL2 adds UNIFORM_BUFFER, TRANSFORM_FEEDBACK_BUFFER, COPY_READ/WRITE targets. */
  bufferSubData(target, offset, data) {
    const isWebGL2Target = target === 35345 || target === 35982 || target === 36662 || target === 36663;
    if (isWebGL2Target) {
      if (offset < 0) {
        this.setError(this.INVALID_VALUE);
        return;
      }
      if (!data) {
        this.setError(this.INVALID_VALUE);
        return;
      }
      const u8Data = arrayToUint8Array(data);
      this._gl.bufferSubData(target, offset, Uint8ArrayToVariant(u8Data));
      return;
    }
    super.bufferSubData(target, offset, data);
  }
  /** WebGL2 adds TEXTURE_3D and TEXTURE_2D_ARRAY target support. */
  bindTexture(target, texture) {
    if (target === 32879 || target === 35866) {
      const id = texture ? texture._ | 0 : 0;
      this._gl.bindTexture(target, id);
      if (texture) texture._binding = target;
      return;
    }
    super.bindTexture(target, texture);
  }
  /** WebGL2 adds TEXTURE_3D/TEXTURE_2D_ARRAY targets and many new pnames. */
  texParameteri(target, pname, param) {
    if (target === 32879 || target === 35866) {
      this._gl.texParameteri(target, pname, param);
      return;
    }
    const isWebGL2Pname = pname === 32882 || pname === 34892 || pname === 34893 || pname === 33084 || pname === 33085 || pname === 33083 || pname === 33082;
    if (isWebGL2Pname) {
      this._gl.texParameteri(target, pname, param);
      return;
    }
    super.texParameteri(target, pname, param);
  }
  /**
   * In WebGL2/GLES3 the attribute-0 requirement from WebGL1 does not apply.
   * Override drawArrays to skip the attrib0 hack and call glDrawArrays directly.
   */
  /**
   * In WebGL2/GLES3 the attribute-0 requirement from WebGL1 does not apply.
   * Override drawArrays to skip the attrib0 hack and call glDrawArrays directly.
   */
  drawArrays(mode, first, count2) {
    if (first < 0 || count2 < 0) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    if (!this._checkStencilState()) return;
    const rc = vertexCount(this, mode, count2);
    if (rc < 0) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    if (!this._framebufferOk()) return;
    if (count2 === 0) return;
    if (!this._checkVertexAttribState(count2 + first - 1 >>> 0)) return;
    this._native2.drawArrays(mode, first, rc);
  }
  /**
   * In WebGL2, UNSIGNED_INT element indices are a core feature — no extension needed.
   * Override drawElements to skip the oes_element_index_uint extension check.
   */
  drawElements(mode = 0, count2 = 0, type = 0, offset = 0) {
    if (count2 < 0 || offset < 0) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    if (!this._checkStencilState()) return;
    const elementBuffer = this._vertexObjectState._elementArrayBufferBinding;
    if (!elementBuffer) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    let elementData = null;
    let adjustedOffset = offset;
    if (type === this.UNSIGNED_SHORT) {
      if (adjustedOffset % 2) {
        this.setError(this.INVALID_OPERATION);
        return;
      }
      adjustedOffset >>= 1;
      elementData = new Uint16Array(elementBuffer._elements.buffer);
    } else if (type === this.UNSIGNED_INT) {
      if (adjustedOffset % 4) {
        this.setError(this.INVALID_OPERATION);
        return;
      }
      adjustedOffset >>= 2;
      elementData = new Uint32Array(elementBuffer._elements.buffer);
    } else if (type === this.UNSIGNED_BYTE) {
      elementData = elementBuffer._elements;
    } else {
      this.setError(this.INVALID_ENUM);
      return;
    }
    let reducedCount = count2;
    switch (mode) {
      case this.TRIANGLES:
        if (count2 % 3) reducedCount -= count2 % 3;
        break;
      case this.LINES:
        if (count2 % 2) reducedCount -= count2 % 2;
        break;
      case this.POINTS:
        break;
      case this.LINE_LOOP:
      case this.LINE_STRIP:
        if (count2 < 2) {
          this.setError(this.INVALID_OPERATION);
          return;
        }
        break;
      case this.TRIANGLE_FAN:
      case this.TRIANGLE_STRIP:
        if (count2 < 3) {
          this.setError(this.INVALID_OPERATION);
          return;
        }
        break;
      default:
        this.setError(this.INVALID_ENUM);
        return;
    }
    if (!this._framebufferOk()) return;
    if (count2 === 0) return;
    let maxIndex = 0;
    for (let i = adjustedOffset; i < adjustedOffset + reducedCount; ++i) {
      if (i < elementData.length && elementData[i] > maxIndex) maxIndex = elementData[i];
    }
    if (this._checkVertexAttribState(maxIndex)) {
      this._native2.drawElements(mode, reducedCount, type, offset);
    }
  }
  // ─── Vertex Array Objects ─────────────────────────────────────────────
  createVertexArray() {
    const id = this._native2.createVertexArray();
    if (!id) return null;
    const vao = new WebGLVertexArrayObject(id, this);
    this._vertexArrayObjects[id] = vao;
    return vao;
  }
  deleteVertexArray(vertexArray) {
    if (!vertexArray || !(vertexArray instanceof WebGLVertexArrayObject)) return;
    vertexArray._pendingDelete = true;
    vertexArray._checkDelete();
  }
  isVertexArray(vertexArray) {
    if (!vertexArray || !(vertexArray instanceof WebGLVertexArrayObject)) return false;
    return this._native2.isVertexArray(vertexArray._);
  }
  bindVertexArray(array) {
    if (array === null) {
      this._native2.bindVertexArray(0);
      this._vertexObjectState = this._defaultVertexObjectState;
    } else if (array instanceof WebGLVertexArrayObject) {
      this._native2.bindVertexArray(array._);
      this._vertexObjectState = array._objectState;
    } else {
      this.setError(this.INVALID_OPERATION);
    }
  }
  // ─── Query Objects ────────────────────────────────────────────────────
  createQuery() {
    const id = this._native2.createQuery();
    if (!id) return null;
    const query = new WebGLQuery(id, this);
    this._queries[id] = query;
    return query;
  }
  deleteQuery(query) {
    if (!query || !(query instanceof WebGLQuery)) return;
    query._pendingDelete = true;
    query._checkDelete();
  }
  isQuery(query) {
    if (!query || !(query instanceof WebGLQuery)) return false;
    return this._native2.isQuery(query._);
  }
  beginQuery(target, query) {
    if (!(query instanceof WebGLQuery)) return;
    this._native2.beginQuery(target, query._);
  }
  endQuery(target) {
    this._native2.endQuery(target);
  }
  getQuery(_target, _pname) {
    warnNotImplemented("WebGL2RenderingContext.getQuery");
    return null;
  }
  getQueryParameter(query, pname) {
    if (!(query instanceof WebGLQuery)) return null;
    return this._native2.getQueryParameter(query._, pname);
  }
  // ─── Sampler Objects ──────────────────────────────────────────────────
  createSampler() {
    const id = this._native2.createSampler();
    if (!id) return null;
    const sampler = new WebGLSampler(id, this);
    this._samplers[id] = sampler;
    return sampler;
  }
  deleteSampler(sampler) {
    if (!sampler || !(sampler instanceof WebGLSampler)) return;
    sampler._pendingDelete = true;
    sampler._checkDelete();
  }
  isSampler(sampler) {
    if (!sampler || !(sampler instanceof WebGLSampler)) return false;
    return this._native2.isSampler(sampler._);
  }
  bindSampler(unit, sampler) {
    this._native2.bindSampler(unit, sampler ? sampler._ : 0);
  }
  samplerParameteri(sampler, pname, param) {
    if (!(sampler instanceof WebGLSampler)) return;
    this._native2.samplerParameteri(sampler._, pname, param);
  }
  samplerParameterf(sampler, pname, param) {
    if (!(sampler instanceof WebGLSampler)) return;
    this._native2.samplerParameterf(sampler._, pname, param);
  }
  getSamplerParameter(sampler, pname) {
    if (!(sampler instanceof WebGLSampler)) return null;
    if (pname === 33082 || pname === 33083) {
      return this._native2.getSamplerParameterf(sampler._, pname);
    }
    return this._native2.getSamplerParameteri(sampler._, pname);
  }
  // ─── Sync Objects ─────────────────────────────────────────────────────
  fenceSync(condition, flags) {
    const id = this._native2.fenceSync(condition, flags);
    if (!id) return null;
    const sync = new WebGLSync(id, this);
    this._syncs[id] = sync;
    return sync;
  }
  isSync(sync) {
    if (!sync || !(sync instanceof WebGLSync)) return false;
    return this._native2.isSync(sync._);
  }
  deleteSync(sync) {
    if (!sync || !(sync instanceof WebGLSync)) return;
    sync._pendingDelete = true;
    sync._checkDelete();
  }
  clientWaitSync(sync, flags, timeout) {
    if (!(sync instanceof WebGLSync)) return 37148;
    return this._native2.clientWaitSync(sync._, flags, timeout);
  }
  waitSync(sync, flags, timeout) {
    if (!(sync instanceof WebGLSync)) return;
    this._native2.waitSync(sync._, flags, timeout);
  }
  getSyncParameter(sync, pname) {
    if (!(sync instanceof WebGLSync)) return null;
    return this._native2.getSyncParameter(sync._, pname);
  }
  // ─── Transform Feedback ───────────────────────────────────────────────
  createTransformFeedback() {
    const id = this._native2.createTransformFeedback();
    if (!id) return null;
    const tf = new WebGLTransformFeedback(id, this);
    this._transformFeedbacks[id] = tf;
    return tf;
  }
  deleteTransformFeedback(tf) {
    if (!tf || !(tf instanceof WebGLTransformFeedback)) return;
    tf._pendingDelete = true;
    tf._checkDelete();
  }
  isTransformFeedback(tf) {
    if (!tf || !(tf instanceof WebGLTransformFeedback)) return false;
    return this._native2.isTransformFeedback(tf._);
  }
  bindTransformFeedback(target, tf) {
    this._native2.bindTransformFeedback(target, tf ? tf._ : 0);
  }
  beginTransformFeedback(primitiveMode) {
    this._native2.beginTransformFeedback(primitiveMode);
  }
  endTransformFeedback() {
    this._native2.endTransformFeedback();
  }
  pauseTransformFeedback() {
    this._native2.pauseTransformFeedback();
  }
  resumeTransformFeedback() {
    this._native2.resumeTransformFeedback();
  }
  transformFeedbackVaryings(program, varyings, bufferMode) {
    this._native2.transformFeedbackVaryings(program._, varyings, bufferMode);
  }
  getTransformFeedbackVarying(program, index) {
    const result = this._native2.getTransformFeedbackVarying(program._, index).deepUnpack();
    return new WebGLActiveInfo({ size: result.size, type: result.type, name: result.name });
  }
  // ─── Indexed Buffer Binding ───────────────────────────────────────────
  bindBufferBase(target, index, buffer) {
    this._native2.bindBufferBase(target, index, buffer ? buffer._ : 0);
  }
  bindBufferRange(target, index, buffer, offset, size) {
    this._native2.bindBufferRange(target, index, buffer ? buffer._ : 0, offset, size);
  }
  copyBufferSubData(readTarget, writeTarget, readOffset, writeOffset, size) {
    this._native2.copyBufferSubData(readTarget, writeTarget, readOffset, writeOffset, size);
  }
  getBufferSubData(target, srcByteOffset, dstBuffer, dstOffset, length) {
    const byteLength = length !== void 0 ? length : dstBuffer.byteLength - (dstOffset ?? 0);
    const data = this._native2.getBufferSubData(target, srcByteOffset, byteLength);
    const dst = new Uint8Array(dstBuffer.buffer, dstBuffer.byteOffset + (dstOffset ?? 0) * (dstBuffer instanceof Uint8Array ? 1 : dstBuffer.BYTES_PER_ELEMENT ?? 1));
    dst.set(data.subarray(0, dst.byteLength));
  }
  // ─── 3D Textures ──────────────────────────────────────────────────────
  texImage3D(target, level, internalformat, width, height, depth, border, format, type, pixels) {
    if (pixels === null) {
      this._native2.texImage3DNull(target, level, internalformat, width, height, depth, border, format, type);
    } else {
      this._native2.texImage3D(target, level, internalformat, width, height, depth, border, format, type, Uint8ArrayToVariant(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)));
    }
  }
  texSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, type, pixels) {
    if (pixels === null) return;
    this._native2.texSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, type, Uint8ArrayToVariant(new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)));
  }
  compressedTexImage3D(target, level, internalformat, width, height, depth, border, _imageSize, data) {
    this._native2.compressedTexImage3D(target, level, internalformat, width, height, depth, border, Uint8ArrayToVariant(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
  }
  compressedTexSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, _imageSize, data) {
    this._native2.compressedTexSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, Uint8ArrayToVariant(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)));
  }
  copyTexSubImage3D(target, level, xoffset, yoffset, zoffset, x, y, width, height) {
    this._native2.copyTexSubImage3D(target, level, xoffset, yoffset, zoffset, x, y, width, height);
  }
  texStorage2D(target, levels, internalformat, width, height) {
    this._native2.texStorage2D(target, levels, internalformat, width, height);
    const texture = this._getTexImage(target);
    if (texture) {
      for (let lvl = 0; lvl < levels; lvl++) {
        texture._levelWidth[lvl] = Math.max(1, width >> lvl);
        texture._levelHeight[lvl] = Math.max(1, height >> lvl);
      }
      texture._format = this.RGBA;
      texture._type = this.UNSIGNED_BYTE;
    }
  }
  texStorage3D(target, levels, internalformat, width, height, depth) {
    this._native2.texStorage3D(target, levels, internalformat, width, height, depth);
  }
  texImage2D(target = 0, level = 0, internalFormat = 0, formatOrWidth = 0, typeOrHeight = 0, sourceOrBorder = 0, _format = 0, type = 0, pixels) {
    let width = 0;
    let height = 0;
    let format = 0;
    let border = 0;
    if (arguments.length === 6) {
      type = typeOrHeight;
      format = formatOrWidth;
      if (sourceOrBorder instanceof GdkPixbuf3.Pixbuf) {
        const pixbuf = sourceOrBorder;
        width = pixbuf.get_width();
        height = pixbuf.get_height();
        pixels = pixbuf.get_pixels();
      } else {
        const imageData = extractImageData(sourceOrBorder);
        if (imageData == null) {
          throw new TypeError("texImage2D(GLenum, GLint, GLenum, GLint, GLenum, GLenum, ImageData | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement)");
        }
        width = imageData.width;
        height = imageData.height;
        pixels = imageData.data;
      }
    } else if (arguments.length >= 9) {
      width = formatOrWidth;
      height = typeOrHeight;
      border = sourceOrBorder;
      format = _format;
    }
    const texture = this._getTexImage(target);
    if (!texture) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    const data = convertPixels(pixels);
    this._saveError();
    this._gl.texImage2D(target, level, internalFormat, width, height, border, format, type, Uint8ArrayToVariant(data));
    const error2 = this.getError();
    this._restoreError(error2);
    if (error2 !== this.NO_ERROR) return;
    texture._levelWidth[level] = width;
    texture._levelHeight[level] = height;
    texture._format = format;
    texture._type = type;
    const activeFramebuffer = this._activeFramebuffer;
    if (activeFramebuffer) {
      let needsUpdate = false;
      const attachments = this._getAttachments();
      for (let i = 0; i < attachments.length; ++i) {
        if (activeFramebuffer._attachments[attachments[i]] === texture) {
          needsUpdate = true;
          break;
        }
      }
      if (needsUpdate && this._activeFramebuffer) {
        this._updateFramebufferAttachments(this._activeFramebuffer);
      }
    }
  }
  texSubImage2D(target = 0, level = 0, xoffset = 0, yoffset = 0, formatOrWidth = 0, typeOrHeight = 0, sourceOrFormat = 0, type = 0, pixels) {
    let width = 0;
    let height = 0;
    let format = 0;
    if (arguments.length === 7) {
      type = typeOrHeight;
      format = formatOrWidth;
      if (sourceOrFormat instanceof GdkPixbuf3.Pixbuf) {
        const pixbuf = sourceOrFormat;
        width = pixbuf.get_width();
        height = pixbuf.get_height();
        pixels = pixbuf.get_pixels();
      } else {
        const imageData = extractImageData(sourceOrFormat);
        if (imageData == null) {
          throw new TypeError("texSubImage2D(GLenum, GLint, GLint, GLint, GLenum, GLenum, ImageData | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement)");
        }
        width = imageData.width;
        height = imageData.height;
        pixels = imageData.data;
      }
    } else {
      width = formatOrWidth;
      height = typeOrHeight;
      format = sourceOrFormat;
    }
    const texture = this._getTexImage(target);
    if (!texture) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    const data = convertPixels(pixels);
    if (!data) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    this._gl.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, Uint8ArrayToVariant(data));
  }
  framebufferTextureLayer(target, attachment, texture, level, layer) {
    this._native2.framebufferTextureLayer(target, attachment, texture ? texture._ : 0, level, layer);
  }
  // ─── Instancing & Advanced Draw ───────────────────────────────────────
  drawArraysInstanced(mode, first, count2, instanceCount) {
    if (first < 0 || count2 < 0 || instanceCount < 0) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    if (!this._checkStencilState()) return;
    const rc = vertexCount(this, mode, count2);
    if (rc < 0) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    if (!this._framebufferOk()) return;
    if (count2 === 0 || instanceCount === 0) return;
    if (!this._checkVertexAttribState(count2 + first - 1 >>> 0)) return;
    this._native2.drawArraysInstanced(mode, first, rc, instanceCount);
  }
  drawElementsInstanced(mode, count2, type, offset, instanceCount) {
    if (count2 < 0 || offset < 0 || instanceCount < 0) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    if (!this._checkStencilState()) return;
    const elementBuffer = this._vertexObjectState._elementArrayBufferBinding;
    if (!elementBuffer) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    let elementData = null;
    let adjustedOffset = offset;
    if (type === this.UNSIGNED_SHORT) {
      if (adjustedOffset % 2) {
        this.setError(this.INVALID_OPERATION);
        return;
      }
      adjustedOffset >>= 1;
      elementData = new Uint16Array(elementBuffer._elements.buffer);
    } else if (type === this.UNSIGNED_INT) {
      if (adjustedOffset % 4) {
        this.setError(this.INVALID_OPERATION);
        return;
      }
      adjustedOffset >>= 2;
      elementData = new Uint32Array(elementBuffer._elements.buffer);
    } else if (type === this.UNSIGNED_BYTE) {
      elementData = elementBuffer._elements;
    } else {
      this.setError(this.INVALID_ENUM);
      return;
    }
    let reducedCount = count2;
    switch (mode) {
      case this.TRIANGLES:
        if (count2 % 3) reducedCount -= count2 % 3;
        break;
      case this.LINES:
        if (count2 % 2) reducedCount -= count2 % 2;
        break;
      case this.POINTS:
        break;
      case this.LINE_LOOP:
      case this.LINE_STRIP:
        if (count2 < 2) {
          this.setError(this.INVALID_OPERATION);
          return;
        }
        break;
      case this.TRIANGLE_FAN:
      case this.TRIANGLE_STRIP:
        if (count2 < 3) {
          this.setError(this.INVALID_OPERATION);
          return;
        }
        break;
      default:
        this.setError(this.INVALID_ENUM);
        return;
    }
    if (!this._framebufferOk()) return;
    if (reducedCount === 0 || instanceCount === 0) {
      this._checkVertexAttribState(0);
      return;
    }
    if (reducedCount + adjustedOffset >>> 0 > elementData.length) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    let maxIndex = 0;
    for (let i = adjustedOffset; i < adjustedOffset + reducedCount; ++i) {
      if (elementData[i] > maxIndex) maxIndex = elementData[i];
    }
    if (this._checkVertexAttribState(maxIndex)) {
      this._native2.drawElementsInstanced(mode, reducedCount, type, offset, instanceCount);
    }
  }
  vertexAttribDivisor(index, divisor) {
    this._native2.vertexAttribDivisor(index, divisor);
  }
  vertexAttribIPointer(index, size, type, stride, offset) {
    this._native2.vertexAttribIPointer(index, size, type, stride, offset);
  }
  drawBuffers(buffers) {
    const mapped = buffers.map((b) => b === 1029 ? this.COLOR_ATTACHMENT0 : b);
    this._native2.drawBuffers(Array.from(mapped));
  }
  drawRangeElements(mode, start, end, count2, type, offset) {
    if (count2 < 0 || offset < 0) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    if (end < start) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    this.drawElements(mode, count2, type, offset);
  }
  blitFramebuffer(srcX0, srcY0, srcX1, srcY1, dstX0, dstY0, dstX1, dstY1, mask, filter) {
    this._native2.blitFramebuffer(srcX0, srcY0, srcX1, srcY1, dstX0, dstY0, dstX1, dstY1, mask, filter);
  }
  invalidateFramebuffer(target, attachments) {
    this._native2.invalidateFramebuffer(target, Array.from(attachments));
  }
  invalidateSubFramebuffer(target, attachments, x, y, width, height) {
    this._native2.invalidateSubFramebuffer(target, Array.from(attachments), x, y, width, height);
  }
  readBuffer(src) {
    this._native2.readBuffer(src);
  }
  renderbufferStorageMultisample(target, samples, internalFormat, width, height) {
    if (target !== this.RENDERBUFFER) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    const renderbuffer = this._activeRenderbuffer;
    if (!renderbuffer) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    this._saveError();
    this._native2.renderbufferStorageMultisample(target, samples, internalFormat, width, height);
    const error2 = this.getError();
    this._restoreError(error2);
    if (error2 !== this.NO_ERROR) return;
    renderbuffer._width = width;
    renderbuffer._height = height;
    renderbuffer._format = internalFormat;
  }
  // ─── Unsigned Integer Uniforms ────────────────────────────────────────
  uniform1ui(location, v0) {
    if (!location) return;
    this._native2.uniform1ui(location._, v0);
  }
  uniform2ui(location, v0, v1) {
    if (!location) return;
    this._native2.uniform2ui(location._, v0, v1);
  }
  uniform3ui(location, v0, v1, v2) {
    if (!location) return;
    this._native2.uniform3ui(location._, v0, v1, v2);
  }
  uniform4ui(location, v0, v1, v2, v3) {
    if (!location) return;
    this._native2.uniform4ui(location._, v0, v1, v2, v3);
  }
  uniform1uiv(location, data, _srcOffset, _srcLength) {
    if (!location) return;
    const arr = data instanceof Uint32Array ? data : new Uint32Array(data);
    this._native2.uniform1uiv(location._, arr.length, Array.from(arr));
  }
  uniform2uiv(location, data, _srcOffset, _srcLength) {
    if (!location) return;
    const arr = data instanceof Uint32Array ? data : new Uint32Array(data);
    this._native2.uniform2uiv(location._, arr.length / 2, Array.from(arr));
  }
  uniform3uiv(location, data, _srcOffset, _srcLength) {
    if (!location) return;
    const arr = data instanceof Uint32Array ? data : new Uint32Array(data);
    this._native2.uniform3uiv(location._, arr.length / 3, Array.from(arr));
  }
  uniform4uiv(location, data, _srcOffset, _srcLength) {
    if (!location) return;
    const arr = data instanceof Uint32Array ? data : new Uint32Array(data);
    this._native2.uniform4uiv(location._, arr.length / 4, Array.from(arr));
  }
  // ─── Non-square Matrix Uniforms ───────────────────────────────────────
  uniformMatrix2x3fv(location, transpose, data, _srcOffset, _srcLength) {
    if (!location) return;
    const arr = data instanceof Float32Array ? data : new Float32Array(data);
    this._native2.uniformMatrix2x3fv(location._, transpose, Array.from(arr));
  }
  uniformMatrix3x2fv(location, transpose, data, _srcOffset, _srcLength) {
    if (!location) return;
    const arr = data instanceof Float32Array ? data : new Float32Array(data);
    this._native2.uniformMatrix3x2fv(location._, transpose, Array.from(arr));
  }
  uniformMatrix2x4fv(location, transpose, data, _srcOffset, _srcLength) {
    if (!location) return;
    const arr = data instanceof Float32Array ? data : new Float32Array(data);
    this._native2.uniformMatrix2x4fv(location._, transpose, Array.from(arr));
  }
  uniformMatrix4x2fv(location, transpose, data, _srcOffset, _srcLength) {
    if (!location) return;
    const arr = data instanceof Float32Array ? data : new Float32Array(data);
    this._native2.uniformMatrix4x2fv(location._, transpose, Array.from(arr));
  }
  uniformMatrix3x4fv(location, transpose, data, _srcOffset, _srcLength) {
    if (!location) return;
    const arr = data instanceof Float32Array ? data : new Float32Array(data);
    this._native2.uniformMatrix3x4fv(location._, transpose, Array.from(arr));
  }
  uniformMatrix4x3fv(location, transpose, data, _srcOffset, _srcLength) {
    if (!location) return;
    const arr = data instanceof Float32Array ? data : new Float32Array(data);
    this._native2.uniformMatrix4x3fv(location._, transpose, Array.from(arr));
  }
  // ─── getUniform — WebGL2 uint type support ────────────────────────────
  /** WebGL1 getUniform falls to default:null for UNSIGNED_INT types. Handle them here. */
  getUniform(program, location) {
    const type = location?._activeInfo?.type;
    const UINT = 5125, UVEC2 = 36294, UVEC3 = 36295, UVEC4 = 36296;
    const isUintType = type === UINT || type === UVEC2 || type === UVEC3 || type === UVEC4;
    if (!isUintType) return super.getUniform(program, location);
    if (!program || !location) return null;
    const data = this._gl.getUniformi(program._ | 0, location._ | 0);
    if (!data) return null;
    if (type === UINT) return data[0] >>> 0;
    if (type === UVEC2) return new Uint32Array([data[0] >>> 0, data[1] >>> 0]);
    if (type === UVEC3) return new Uint32Array([data[0] >>> 0, data[1] >>> 0, data[2] >>> 0]);
    return new Uint32Array([data[0] >>> 0, data[1] >>> 0, data[2] >>> 0, data[3] >>> 0]);
  }
  // ─── Uniform Blocks ───────────────────────────────────────────────────
  getUniformBlockIndex(program, uniformBlockName) {
    return this._native2.getUniformBlockIndex(program._, uniformBlockName);
  }
  uniformBlockBinding(program, uniformBlockIndex, uniformBlockBinding) {
    this._native2.uniformBlockBinding(program._, uniformBlockIndex, uniformBlockBinding);
  }
  getActiveUniformBlockName(program, uniformBlockIndex) {
    const name2 = this._native2.getActiveUniformBlockName(program._, uniformBlockIndex);
    return name2.length > 0 ? name2 : null;
  }
  getActiveUniformBlockParameter(program, uniformBlockIndex, pname) {
    return this._native2.getActiveUniformBlockParameter(program._, uniformBlockIndex, pname);
  }
  getActiveUniforms(program, uniformIndices, pname) {
    const result = this._native2.getActiveUniforms(program._, uniformIndices, pname);
    return result;
  }
  // ─── Program Queries ──────────────────────────────────────────────────
  getFragDataLocation(program, name2) {
    return this._native2.getFragDataLocation(program._, name2);
  }
  // ─── Indexed Parameter Queries ────────────────────────────────────────
  getIndexedParameter(target, index) {
    return this._native2.getIndexedParameteri(target, index);
  }
  getInternalformatParameter(target, internalformat, pname) {
    return this._native2.getInternalformatParameter(target, internalformat, pname);
  }
  getParameter(pname) {
    if (pname === 7938) return "WebGL 2.0";
    if (pname === 35724) return "WebGL GLSL ES 3.00";
    if (pname === 7939) {
      warnNotImplemented("WebGL2RenderingContext.getParameter(GL_EXTENSIONS)");
      return "";
    }
    if (pname === 36006) return this._activeDrawFramebuffer;
    if (pname === 36010) return this._activeReadFramebuffer;
    switch (pname) {
      case 36183:
      // MAX_SAMPLES
      case 35071:
      // MAX_ARRAY_TEXTURE_LAYERS
      case 32883:
      // MAX_3D_TEXTURE_SIZE
      case 36063:
      // MAX_COLOR_ATTACHMENTS
      case 34852:
      // MAX_DRAW_BUFFERS
      case 36203:
      // MAX_ELEMENT_INDEX
      case 33001:
      // MAX_ELEMENTS_INDICES
      case 33e3:
      // MAX_ELEMENTS_VERTICES
      case 37157:
      // MAX_FRAGMENT_INPUT_COMPONENTS
      case 35373:
      // MAX_FRAGMENT_UNIFORM_BLOCKS
      case 35657:
      // MAX_FRAGMENT_UNIFORM_COMPONENTS
      case 35077:
      // MAX_PROGRAM_TEXEL_OFFSET
      case 35978:
      // MAX_TRANSFORM_FEEDBACK_INTERLEAVED_COMPONENTS
      case 35979:
      // MAX_TRANSFORM_FEEDBACK_SEPARATE_ATTRIBS
      case 35968:
      // MAX_TRANSFORM_FEEDBACK_SEPARATE_COMPONENTS
      case 35376:
      // MAX_UNIFORM_BLOCK_SIZE
      case 35375:
      // MAX_UNIFORM_BUFFER_BINDINGS
      case 35659:
      // MAX_VARYING_COMPONENTS
      case 37154:
      // MAX_VERTEX_OUTPUT_COMPONENTS
      case 35371:
      // MAX_VERTEX_UNIFORM_BLOCKS
      case 35658:
      // MAX_VERTEX_UNIFORM_COMPONENTS
      case 35379:
      // MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS
      case 35374:
      // MAX_COMBINED_UNIFORM_BLOCKS
      case 35377:
      // MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS
      case 35076:
      // MIN_PROGRAM_TEXEL_OFFSET
      case 3330:
      // PACK_ROW_LENGTH
      case 3332:
      // PACK_SKIP_PIXELS
      case 3331:
      // PACK_SKIP_ROWS
      case 35053:
      // PIXEL_PACK_BUFFER_BINDING
      case 35055:
      // PIXEL_UNPACK_BUFFER_BINDING
      case 3074:
      // READ_BUFFER
      case 32874:
      // TEXTURE_BINDING_3D
      case 35869:
      // TEXTURE_BINDING_2D_ARRAY
      case 36389:
      // TRANSFORM_FEEDBACK_BINDING
      case 35983:
      // TRANSFORM_FEEDBACK_BUFFER_BINDING
      case 35368:
      // UNIFORM_BUFFER_BINDING
      case 35380:
      // UNIFORM_BUFFER_OFFSET_ALIGNMENT
      case 32878:
      // UNPACK_IMAGE_HEIGHT
      case 3314:
      // UNPACK_ROW_LENGTH
      case 32877:
      // UNPACK_SKIP_IMAGES
      case 3316:
      // UNPACK_SKIP_PIXELS
      case 3315:
      // UNPACK_SKIP_ROWS
      case 34045:
        return this._native2.getParameterx(pname)?.deepUnpack() | 0;
      case 35977:
      // RASTERIZER_DISCARD
      case 36388:
      // TRANSFORM_FEEDBACK_ACTIVE
      case 36387:
        return !!this._native2.getParameterx(pname)?.deepUnpack();
    }
    return super.getParameter(pname);
  }
  // ─── Misc ─────────────────────────────────────────────────────────────
  getStringi(name2, index) {
    const s = this._native2.getStringi(name2, index);
    return s.length > 0 ? s : null;
  }
  // ─── WebGL2 overrides for format validation ────────────────────────────
  /**
   * WebGL2 supports ~30+ renderbuffer formats (R8, RG8, RGBA8, RGBA16F,
   * DEPTH_COMPONENT24, DEPTH32F_STENCIL8, etc.). The WebGL1 base class
   * only allows 7 formats. Delegate format validation to native GL.
   */
  renderbufferStorage(target, internalFormat, width, height) {
    if (target !== this.RENDERBUFFER) {
      this.setError(this.INVALID_ENUM);
      return;
    }
    const renderbuffer = this._activeRenderbuffer;
    if (!renderbuffer) {
      this.setError(this.INVALID_OPERATION);
      return;
    }
    if (width < 0 || height < 0) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    while (this._gl.getError() !== this.NO_ERROR) {
    }
    this._gl.renderbufferStorage(target, internalFormat, width, height);
    if (this._gl.getError() !== this.NO_ERROR) return;
    renderbuffer._width = width;
    renderbuffer._height = height;
    renderbuffer._format = internalFormat;
    const activeFramebuffer = this._activeFramebuffer;
    if (activeFramebuffer) {
      const attachments = this._getAttachments();
      let needsUpdate = false;
      for (let i = 0; i < attachments.length; ++i) {
        if (activeFramebuffer._attachments[attachments[i]] === renderbuffer) {
          needsUpdate = true;
          break;
        }
      }
      if (needsUpdate) this._updateFramebufferAttachments(activeFramebuffer);
    }
  }
  /**
   * WebGL2 makes several WebGL1 extensions part of the core spec.
   * EXT_color_buffer_float and EXT_color_buffer_half_float are always
   * available in WebGL2 contexts. Append them if the base class didn't.
   */
  getSupportedExtensions() {
    const exts = super.getSupportedExtensions();
    const ensure = ["EXT_color_buffer_float", "EXT_color_buffer_half_float", "OES_texture_half_float"];
    for (const ext of ensure) {
      if (exts.indexOf(ext) === -1) exts.push(ext);
    }
    return exts;
  }
  /**
   * WebGL2 allows reading pixels in many more format/type combinations
   * than WebGL1's strict RGBA/UNSIGNED_BYTE. Delegate validation to native.
   */
  readPixels(x, y, width, height, format, type, pixels) {
    if (!pixels) return;
    if (width < 0 || height < 0) {
      this.setError(this.INVALID_VALUE);
      return;
    }
    if (!this._framebufferOk()) return;
    const componentCount = format === 6408 || format === 32856 ? 4 : format === 6407 ? 3 : format === 33319 ? 2 : 1;
    const bytesPerComponent = type === 5126 ? 4 : type === 5131 || type === 36193 ? 2 : type === 5125 || type === 5124 ? 4 : type === 5123 || type === 5122 ? 2 : 1;
    const byteCount = width * height * componentCount * bytesPerComponent;
    const pixelData = new Uint8Array(byteCount);
    this._saveError();
    const result = this._gl.readPixels(x, y, width, height, format, type, Uint8ArrayToVariant(pixelData));
    const error2 = this.getError();
    this._restoreError(error2);
    if (error2 !== this.NO_ERROR) return;
    const src = result && result.length > 0 ? result : pixelData;
    if (pixels instanceof Uint8Array) {
      pixels.set(src);
    } else if (pixels instanceof Float32Array) {
      const floatView = new Float32Array(src.buffer, 0, pixels.length);
      pixels.set(floatView);
    }
  }
  // framebufferTexture2D: inherits from base class. WebGL2 allows level>0 for
  // mipmap attachments, but Three.js only uses level=0. The base class level===0
  // check is acceptable for now. If needed, override to skip level validation.
  /**
   * WebGL2 never blocks draw calls on JS-side framebuffer format checks.
   * The native GL (Mesa/libepoxy) handles completeness and generates
   * INVALID_FRAMEBUFFER_OPERATION for truly incomplete FBOs at draw time.
   * This matches headless-gl's approach: _framebufferOk() always returns true.
   *
   * The base class rejects valid WebGL2 formats (RGBA16F/HALF_FLOAT, depth
   * textures, WebGL2 renderbuffer formats) causing silent rendering failures
   * for postprocessing effects and environment maps.
   */
  _framebufferOk() {
    return true;
  }
};

// lib/esm/html-canvas-element.js
var HTMLCanvasElement2 = class extends HTMLCanvasElement {
  constructor(gtkGlArea) {
    super();
    this.gtkGlArea = gtkGlArea;
  }
  /** Width from the GTK GLArea allocated size (overrides DOM attr-backed getter). */
  get width() {
    return this.gtkGlArea.get_allocated_width();
  }
  set width(_width) {
  }
  /** Height from the GTK GLArea allocated size (overrides DOM attr-backed getter). */
  get height() {
    return this.gtkGlArea.get_allocated_height();
  }
  set height(_height) {
  }
  get clientWidth() {
    return this.width;
  }
  get clientHeight() {
    return this.height;
  }
  /** Returns the underlying Gtk.GLArea. Used by WebGLRenderingContext for GLSL version detection. */
  getGlArea() {
    return this.gtkGlArea;
  }
  /**
   * Returns a WebGL rendering context backed by the underlying Gtk.GLArea.
   * 'webgl' and 'experimental-webgl' return a WebGLRenderingContext (WebGL 1.0).
   * 'webgl2' returns a WebGL2RenderingContext (WebGL 2.0).
   * Other context types emit a warning and return null.
   */
  getContext(contextId, options) {
    if (contextId === "webgl" || contextId === "experimental-webgl") {
      this._webgl ??= new WebGLRenderingContext(this, options);
      return this._webgl;
    }
    if (contextId === "webgl2") {
      this._webgl2 ??= new WebGL2RenderingContext(this, options);
      return this._webgl2;
    }
    return super.getContext(contextId, options);
  }
};

// lib/esm/canvas-webgl-widget.js
init_console_gjs();
import GObject from "gi://GObject";
import GLib2 from "gi://GLib?version=2.0";
import Gtk3 from "gi://Gtk?version=4.0";

// ../event-bridge/lib/esm/index.js
init_console_gjs();

// ../event-bridge/lib/esm/event-bridge.js
init_console_gjs();
import Gtk2 from "gi://Gtk?version=4.0";
import Gdk2 from "gi://Gdk?version=4.0";

// ../event-bridge/lib/esm/key-map.js
init_console_gjs();
import Gdk from "gi://Gdk?version=4.0";
var SPECIAL_KEYS = {
  Return: "Enter",
  KP_Enter: "Enter",
  Tab: "Tab",
  ISO_Left_Tab: "Tab",
  BackSpace: "Backspace",
  Escape: "Escape",
  Delete: "Delete",
  KP_Delete: "Delete",
  Insert: "Insert",
  KP_Insert: "Insert",
  Home: "Home",
  KP_Home: "Home",
  End: "End",
  KP_End: "End",
  Page_Up: "PageUp",
  KP_Page_Up: "PageUp",
  Page_Down: "PageDown",
  KP_Page_Down: "PageDown",
  Left: "ArrowLeft",
  KP_Left: "ArrowLeft",
  Up: "ArrowUp",
  KP_Up: "ArrowUp",
  Right: "ArrowRight",
  KP_Right: "ArrowRight",
  Down: "ArrowDown",
  KP_Down: "ArrowDown",
  Shift_L: "Shift",
  Shift_R: "Shift",
  Control_L: "Control",
  Control_R: "Control",
  Alt_L: "Alt",
  Alt_R: "Alt",
  Super_L: "Meta",
  Super_R: "Meta",
  Meta_L: "Meta",
  Meta_R: "Meta",
  Caps_Lock: "CapsLock",
  Num_Lock: "NumLock",
  Scroll_Lock: "ScrollLock",
  Print: "PrintScreen",
  Pause: "Pause",
  Menu: "ContextMenu",
  space: " ",
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",
  KP_Add: "+",
  KP_Subtract: "-",
  KP_Multiply: "*",
  KP_Divide: "/",
  KP_Decimal: ".",
  KP_Separator: ",",
  KP_0: "0",
  KP_1: "1",
  KP_2: "2",
  KP_3: "3",
  KP_4: "4",
  KP_5: "5",
  KP_6: "6",
  KP_7: "7",
  KP_8: "8",
  KP_9: "9"
};
var SPECIAL_CODES = {
  Return: "Enter",
  KP_Enter: "NumpadEnter",
  Tab: "Tab",
  ISO_Left_Tab: "Tab",
  BackSpace: "Backspace",
  Escape: "Escape",
  Delete: "Delete",
  KP_Delete: "NumpadDecimal",
  Insert: "Insert",
  KP_Insert: "Numpad0",
  Home: "Home",
  KP_Home: "Numpad7",
  End: "End",
  KP_End: "Numpad1",
  Page_Up: "PageUp",
  KP_Page_Up: "Numpad9",
  Page_Down: "PageDown",
  KP_Page_Down: "Numpad3",
  Left: "ArrowLeft",
  KP_Left: "Numpad4",
  Up: "ArrowUp",
  KP_Up: "Numpad8",
  Right: "ArrowRight",
  KP_Right: "Numpad6",
  Down: "ArrowDown",
  KP_Down: "Numpad2",
  Shift_L: "ShiftLeft",
  Shift_R: "ShiftRight",
  Control_L: "ControlLeft",
  Control_R: "ControlRight",
  Alt_L: "AltLeft",
  Alt_R: "AltRight",
  Super_L: "MetaLeft",
  Super_R: "MetaRight",
  Meta_L: "MetaLeft",
  Meta_R: "MetaRight",
  Caps_Lock: "CapsLock",
  Num_Lock: "NumLock",
  Scroll_Lock: "ScrollLock",
  Print: "PrintScreen",
  Pause: "Pause",
  Menu: "ContextMenu",
  space: "Space",
  F1: "F1",
  F2: "F2",
  F3: "F3",
  F4: "F4",
  F5: "F5",
  F6: "F6",
  F7: "F7",
  F8: "F8",
  F9: "F9",
  F10: "F10",
  F11: "F11",
  F12: "F12",
  KP_Add: "NumpadAdd",
  KP_Subtract: "NumpadSubtract",
  KP_Multiply: "NumpadMultiply",
  KP_Divide: "NumpadDivide",
  KP_Decimal: "NumpadDecimal",
  KP_Separator: "NumpadComma",
  KP_0: "Numpad0",
  KP_1: "Numpad1",
  KP_2: "Numpad2",
  KP_3: "Numpad3",
  KP_4: "Numpad4",
  KP_5: "Numpad5",
  KP_6: "Numpad6",
  KP_7: "Numpad7",
  KP_8: "Numpad8",
  KP_9: "Numpad9"
};
function gdkKeyvalToKey(keyval) {
  const name2 = Gdk.keyval_name(keyval);
  if (name2 && SPECIAL_KEYS[name2]) return SPECIAL_KEYS[name2];
  const unicode = Gdk.keyval_to_unicode(keyval);
  if (unicode > 0) return String.fromCodePoint(unicode);
  return name2 ?? "Unidentified";
}
function gdkKeyvalToCode(keyval) {
  const name2 = Gdk.keyval_name(keyval);
  if (name2 && SPECIAL_CODES[name2]) return SPECIAL_CODES[name2];
  const unicode = Gdk.keyval_to_unicode(keyval);
  if (unicode >= 97 && unicode <= 122) return "Key" + String.fromCodePoint(unicode - 32);
  if (unicode >= 65 && unicode <= 90) return "Key" + String.fromCodePoint(unicode);
  if (unicode >= 48 && unicode <= 57) return "Digit" + String.fromCodePoint(unicode);
  if (name2) {
    const punct = {
      minus: "Minus",
      equal: "Equal",
      bracketleft: "BracketLeft",
      bracketright: "BracketRight",
      backslash: "Backslash",
      semicolon: "Semicolon",
      apostrophe: "Quote",
      grave: "Backquote",
      comma: "Comma",
      period: "Period",
      slash: "Slash"
    };
    if (punct[name2]) return punct[name2];
  }
  return name2 ?? "Unidentified";
}
function gdkKeyvalToLocation(keyval) {
  const name2 = Gdk.keyval_name(keyval);
  if (!name2) return 0;
  if (name2.startsWith("KP_")) return 3;
  if (name2.endsWith("_L")) return 1;
  if (name2.endsWith("_R")) return 2;
  return 0;
}

// ../event-bridge/lib/esm/event-bridge.js
function extractModifiers(controller) {
  const mods = controller.get_current_event_state();
  return {
    shiftKey: !!(mods & Gdk2.ModifierType.SHIFT_MASK),
    ctrlKey: !!(mods & Gdk2.ModifierType.CONTROL_MASK),
    altKey: !!(mods & Gdk2.ModifierType.ALT_MASK),
    metaKey: !!(mods & Gdk2.ModifierType.SUPER_MASK)
  };
}
function gtkButtonToDom(gtkButton) {
  if (gtkButton === 1) return 0;
  if (gtkButton === 2) return 1;
  if (gtkButton === 3) return 2;
  return gtkButton - 1;
}
function buttonsFromModifiers(controller) {
  const mods = controller.get_current_event_state();
  let buttons = 0;
  if (mods & Gdk2.ModifierType.BUTTON1_MASK) buttons |= 1;
  if (mods & Gdk2.ModifierType.BUTTON3_MASK) buttons |= 2;
  if (mods & Gdk2.ModifierType.BUTTON2_MASK) buttons |= 4;
  return buttons;
}
function attachEventControllers(widget, getElement) {
  widget.set_focusable(true);
  widget.set_can_focus(true);
  const state = { lastX: 0, lastY: 0, buttonsPressed: 0, pressedKeys: /* @__PURE__ */ new Set() };
  const motionCtrl = new Gtk2.EventControllerMotion();
  motionCtrl.connect("motion", () => {
    const el = getElement();
    if (!el) return;
    const event = motionCtrl.get_current_event();
    if (!event) return;
    const [, x, y] = event.get_position?.() ?? [false, state.lastX, state.lastY];
    const allocW = widget.get_allocated_width();
    const allocH = widget.get_allocated_height();
    const cx = Math.max(0, Math.min(x, allocW));
    const cy = Math.max(0, Math.min(y, allocH));
    const movementX = cx - state.lastX;
    const movementY = cy - state.lastY;
    const mods = extractModifiers(motionCtrl);
    const buttons = buttonsFromModifiers(motionCtrl);
    const init = { ...mods, clientX: cx, clientY: cy, offsetX: cx, offsetY: cy, screenX: cx, screenY: cy, movementX, movementY, buttons, button: 0, bubbles: true, cancelable: true };
    el.dispatchEvent(new PointerEvent("pointermove", { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mousemove", init));
    state.lastX = cx;
    state.lastY = cy;
  });
  motionCtrl.connect("enter", (_ctrl, x, y) => {
    const el = getElement();
    if (!el) return;
    state.lastX = x;
    state.lastY = y;
    const mods = extractModifiers(motionCtrl);
    const init = { ...mods, clientX: x, clientY: y, offsetX: x, offsetY: y, screenX: x, screenY: y, bubbles: false, cancelable: false };
    el.dispatchEvent(new PointerEvent("pointerenter", { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mouseenter", init));
    el.dispatchEvent(new MouseEvent("mouseover", { ...init, bubbles: true }));
  });
  motionCtrl.connect("leave", () => {
    const el = getElement();
    if (!el) return;
    const mods = extractModifiers(motionCtrl);
    const init = { ...mods, clientX: state.lastX, clientY: state.lastY, bubbles: false, cancelable: false };
    el.dispatchEvent(new PointerEvent("pointerleave", { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mouseleave", init));
    el.dispatchEvent(new MouseEvent("mouseout", { ...init, bubbles: true }));
  });
  widget.add_controller(motionCtrl);
  const clickCtrl = new Gtk2.GestureClick();
  clickCtrl.set_button(0);
  clickCtrl.connect("pressed", (_ctrl, nPress, x, y) => {
    const el = getElement();
    if (!el) return;
    const gtkButton = clickCtrl.get_current_button();
    const domButton = gtkButtonToDom(gtkButton);
    const mods = extractModifiers(clickCtrl);
    state.buttonsPressed |= 1 << domButton;
    const init = { ...mods, clientX: x, clientY: y, offsetX: x, offsetY: y, screenX: x, screenY: y, button: domButton, buttons: state.buttonsPressed, detail: nPress, bubbles: true, cancelable: true };
    el.dispatchEvent(new PointerEvent("pointerdown", { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mousedown", init));
    widget.grab_focus();
  });
  clickCtrl.connect("released", (_ctrl, nPress, x, y) => {
    const el = getElement();
    if (!el) return;
    const gtkButton = clickCtrl.get_current_button();
    const domButton = gtkButtonToDom(gtkButton);
    const mods = extractModifiers(clickCtrl);
    state.buttonsPressed &= ~(1 << domButton);
    const init = { ...mods, clientX: x, clientY: y, offsetX: x, offsetY: y, screenX: x, screenY: y, button: domButton, buttons: state.buttonsPressed, detail: nPress, bubbles: true, cancelable: true };
    el.dispatchEvent(new PointerEvent("pointerup", { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true }));
    el.dispatchEvent(new MouseEvent("mouseup", init));
    if (domButton === 0) {
      el.dispatchEvent(new MouseEvent("click", init));
      if (nPress === 2) {
        el.dispatchEvent(new MouseEvent("dblclick", init));
      }
    }
    if (domButton === 2) {
      el.dispatchEvent(new MouseEvent("contextmenu", { ...init, cancelable: true }));
    }
  });
  widget.add_controller(clickCtrl);
  const scrollCtrl = new Gtk2.EventControllerScroll({
    flags: Gtk2.EventControllerScrollFlags.BOTH_AXES
  });
  scrollCtrl.connect("scroll", (_ctrl, dx, dy) => {
    const el = getElement();
    if (!el) return;
    const mods = extractModifiers(scrollCtrl);
    const scale = 100;
    const init = { ...mods, clientX: state.lastX, clientY: state.lastY, offsetX: state.lastX, offsetY: state.lastY, screenX: state.lastX, screenY: state.lastY, deltaX: dx * scale, deltaY: dy * scale, deltaZ: 0, deltaMode: 0, bubbles: true, cancelable: true };
    el.dispatchEvent(new WheelEvent("wheel", init));
    return false;
  });
  widget.add_controller(scrollCtrl);
  const keyCtrl = new Gtk2.EventControllerKey();
  keyCtrl.connect("key-pressed", (_ctrl, keyval, _keycode, modifiers) => {
    const el = getElement();
    if (!el) return false;
    const repeat = state.pressedKeys.has(keyval);
    state.pressedKeys.add(keyval);
    const key = gdkKeyvalToKey(keyval);
    const code = gdkKeyvalToCode(keyval);
    const location = gdkKeyvalToLocation(keyval);
    const init = {
      key,
      code,
      location,
      repeat,
      altKey: !!(modifiers & Gdk2.ModifierType.ALT_MASK),
      ctrlKey: !!(modifiers & Gdk2.ModifierType.CONTROL_MASK),
      metaKey: !!(modifiers & Gdk2.ModifierType.SUPER_MASK),
      shiftKey: !!(modifiers & Gdk2.ModifierType.SHIFT_MASK),
      keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
      which: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
      bubbles: true,
      cancelable: true
    };
    el.dispatchEvent(new KeyboardEvent("keydown", init));
    return false;
  });
  keyCtrl.connect("key-released", (_ctrl, keyval, _keycode, modifiers) => {
    const el = getElement();
    if (!el) return;
    state.pressedKeys.delete(keyval);
    const key = gdkKeyvalToKey(keyval);
    const code = gdkKeyvalToCode(keyval);
    const location = gdkKeyvalToLocation(keyval);
    const init = {
      key,
      code,
      location,
      repeat: false,
      altKey: !!(modifiers & Gdk2.ModifierType.ALT_MASK),
      ctrlKey: !!(modifiers & Gdk2.ModifierType.CONTROL_MASK),
      metaKey: !!(modifiers & Gdk2.ModifierType.SUPER_MASK),
      shiftKey: !!(modifiers & Gdk2.ModifierType.SHIFT_MASK),
      keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
      which: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
      bubbles: true,
      cancelable: true
    };
    el.dispatchEvent(new KeyboardEvent("keyup", init));
  });
  widget.add_controller(keyCtrl);
  const focusCtrl = new Gtk2.EventControllerFocus();
  focusCtrl.connect("enter", () => {
    const el = getElement();
    if (!el) return;
    el.dispatchEvent(new FocusEvent("focus", { bubbles: false, cancelable: false }));
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true, cancelable: false }));
  });
  focusCtrl.connect("leave", () => {
    const el = getElement();
    if (!el) return;
    state.pressedKeys.clear();
    el.dispatchEvent(new FocusEvent("blur", { bubbles: false, cancelable: false }));
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, cancelable: false }));
  });
  widget.add_controller(focusCtrl);
}

// lib/esm/canvas-webgl-widget.js
var CanvasWebGLWidget = GObject.registerClass(
  { GTypeName: "GjsifyCanvasWebGLWidget" },
  class CanvasWebGLWidget2 extends Gtk3.GLArea {
    constructor(params) {
      super(params);
      this._canvas = null;
      this._readyCallbacks = [];
      this._renderTag = null;
      this._tickCallbackId = null;
      this._frameCallback = null;
      this._timeOrigin = GLib2.get_monotonic_time();
      this.set_use_es(true);
      this.set_required_version(3, 2);
      this.set_has_depth_buffer(true);
      this.set_has_stencil_buffer(true);
      attachEventControllers(this, () => this._canvas);
      const initId = this.connect("render", () => {
        this.disconnect(initId);
        this.make_current();
        this._canvas = new HTMLCanvasElement2(this);
        if (globalThis.document?.body) {
          globalThis.document.body.appendChild(this._canvas);
        }
        const gl = this._canvas.getContext("webgl");
        if (gl) {
          for (const cb of this._readyCallbacks) {
            cb(this._canvas, gl);
          }
          this._readyCallbacks = [];
        }
        return true;
      });
      this.connect("resize", () => {
        if (this._canvas) {
          this._canvas.dispatchEvent(new Event("resize"));
        }
        if (this._frameCallback) {
          this.requestAnimationFrame(this._frameCallback);
        }
      });
      this.connect("unrealize", () => {
        if (this._renderTag !== null) {
          this.disconnect(this._renderTag);
          this._renderTag = null;
        }
        if (this._tickCallbackId !== null) {
          this.remove_tick_callback(this._tickCallbackId);
          this._tickCallbackId = null;
        }
        this._canvas = null;
      });
    }
    /** The HTMLCanvasElement wrapping this GLArea. Available after the first render. */
    get canvas() {
      return this._canvas;
    }
    /**
     * Registers a callback to be called once the WebGL context is ready.
     * If the context is already available, the callback fires synchronously.
     */
    onReady(cb) {
      if (this._canvas) {
        const gl = this._canvas.getContext("webgl");
        if (gl) {
          cb(this._canvas, gl);
          return;
        }
      }
      this._readyCallbacks.push(cb);
    }
    /**
     * @deprecated Use `onReady()` instead.
     */
    onWebGLReady(cb) {
      this.onReady(cb);
    }
    /**
     * Schedules a single animation frame callback, matching the browser `requestAnimationFrame` API.
     * Backed by GTK frame clock (vsync-synced) + the GLArea render signal.
     * Returns 0 (handle — cancel not yet implemented).
     */
    requestAnimationFrame(cb) {
      this._frameCallback = cb;
      if (this._tickCallbackId === null) {
        this._tickCallbackId = this.add_tick_callback((_widget, _frameClock) => {
          this._tickCallbackId = null;
          if (this._renderTag === null) {
            this._renderTag = this.connect("render", () => {
              this.disconnect(this._renderTag);
              this._renderTag = null;
              const time2 = (GLib2.get_monotonic_time() - this._timeOrigin) / 1e3;
              this._frameCallback?.(time2);
              return true;
            });
          }
          this.queue_render();
          return GLib2.SOURCE_REMOVE;
        });
      }
      this.queue_render();
      return 0;
    }
    /**
     * Sets browser globals (`requestAnimationFrame`, `performance`) so that
     * browser-targeted code (e.g. Three.js) works unchanged on GJS.
     */
    installGlobals() {
      globalThis.requestAnimationFrame = (cb) => this.requestAnimationFrame(cb);
      const timeOrigin = this._timeOrigin;
      globalThis.performance = {
        now: () => (GLib2.get_monotonic_time() - timeOrigin) / 1e3,
        timeOrigin: Date.now()
      };
    }
  }
);

// src/ts/conformance/setup.ts
init_glib_2();
function createGLSetup() {
  gtk_4_default.init();
  let result = null;
  const readyLoop = new glib_2_default.MainLoop(null, false);
  const win = new gtk_4_default.Window({});
  win.set_default_size(1, 1);
  const glArea = new CanvasWebGLWidget();
  glArea.onReady((canvas, g) => {
    const gl = g;
    const gl2 = canvas.getContext("webgl2");
    result = { gl, gl2, glArea, win };
    readyLoop.quit();
  });
  win.set_child(glArea);
  win.present();
  const giveUpId = glib_2_default.timeout_add(glib_2_default.PRIORITY_DEFAULT, 1e4, () => {
    readyLoop.quit();
    return glib_2_default.SOURCE_REMOVE;
  });
  readyLoop.run();
  glib_2_default.source_remove(giveUpId);
  return result;
}

// src/ts/conformance/buffers.spec.ts
var buffers_spec_default = async () => {
  await on2("Display", async () => {
    const setup = createGLSetup();
    if (!setup) {
      console.warn("WebGL context not available \u2014 skipping conformance/buffers tests");
      return;
    }
    const { gl, glArea, win } = setup;
    glArea.make_current();
    await describe("conformance/buffers/buffer-bind-test", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("should be able to bind and unbind an ARRAY_BUFFER", async () => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        expect(gl.getError()).toBe(gl.NO_ERROR);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        expect(gl.getError()).toBe(gl.NO_ERROR);
        gl.deleteBuffer(buf);
      });
      await it("should be able to bind and unbind an ELEMENT_ARRAY_BUFFER", async () => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
        expect(gl.getError()).toBe(gl.NO_ERROR);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
        expect(gl.getError()).toBe(gl.NO_ERROR);
        gl.deleteBuffer(buf);
      });
      await it("binding ARRAY_BUFFER to ELEMENT_ARRAY_BUFFER target should generate INVALID_OPERATION", async () => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
        expect(gl.getError()).toBe(gl.INVALID_OPERATION);
        gl.deleteBuffer(buf);
      });
      await it("binding ELEMENT_ARRAY_BUFFER to ARRAY_BUFFER target should generate INVALID_OPERATION", async () => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        expect(gl.getError()).toBe(gl.INVALID_OPERATION);
        gl.deleteBuffer(buf);
      });
    });
    await describe("conformance/buffers/buffer-data-and-buffer-sub-data", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("bufferData with no buffer bound generates INVALID_OPERATION", async () => {
        gl.bufferData(gl.ARRAY_BUFFER, 4, gl.STATIC_DRAW);
        expect(gl.getError()).toBe(gl.INVALID_OPERATION);
      });
      await it("bufferData with negative size generates INVALID_VALUE", async () => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.getError();
        gl.bufferData(gl.ARRAY_BUFFER, -4, gl.STATIC_DRAW);
        expect(gl.getError()).toBe(gl.INVALID_VALUE);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.deleteBuffer(buf);
      });
      await it("bufferData with null data generates INVALID_VALUE", async () => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.getError();
        gl.bufferData(gl.ARRAY_BUFFER, null, gl.STATIC_DRAW);
        expect(gl.getError()).toBe(gl.INVALID_VALUE);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.deleteBuffer(buf);
      });
      await it("bufferData with size 0 succeeds and sets buffer size to 0", async () => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, 0, gl.STATIC_DRAW);
        expect(gl.getError()).toBe(gl.NO_ERROR);
        expect(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE)).toBe(0);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.deleteBuffer(buf);
      });
      await it("bufferData with ArrayBuffer sets correct buffer size", async () => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new ArrayBuffer(4), gl.STATIC_DRAW);
        expect(gl.getError()).toBe(gl.NO_ERROR);
        expect(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE)).toBe(4);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.deleteBuffer(buf);
      });
      await it("bufferData with numeric size 4 sets buffer size to 4", async () => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, 4, gl.STATIC_DRAW);
        expect(gl.getError()).toBe(gl.NO_ERROR);
        expect(gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE)).toBe(4);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.deleteBuffer(buf);
      });
      await it("bufferSubData before bufferData generates INVALID_VALUE", async () => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, new ArrayBuffer(1));
        expect(gl.getError()).toBe(gl.INVALID_VALUE);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.deleteBuffer(buf);
      });
      await it("bufferSubData with negative offset generates INVALID_VALUE", async () => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, 128, gl.STATIC_DRAW);
        gl.getError();
        gl.bufferSubData(gl.ARRAY_BUFFER, -10, new ArrayBuffer(64));
        expect(gl.getError()).toBe(gl.INVALID_VALUE);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.deleteBuffer(buf);
      });
      await it("bufferSubData that overflows buffer generates INVALID_VALUE", async () => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, 128, gl.STATIC_DRAW);
        gl.getError();
        gl.bufferSubData(gl.ARRAY_BUFFER, 65, new ArrayBuffer(64));
        expect(gl.getError()).toBe(gl.INVALID_VALUE);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.deleteBuffer(buf);
      });
      await it("bufferSubData within bounds succeeds", async () => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, 128, gl.STATIC_DRAW);
        gl.getError();
        gl.bufferSubData(gl.ARRAY_BUFFER, 10, new ArrayBuffer(64));
        expect(gl.getError()).toBe(gl.NO_ERROR);
        gl.bufferSubData(gl.ARRAY_BUFFER, 10, new Float32Array(0));
        expect(gl.getError()).toBe(gl.NO_ERROR);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.deleteBuffer(buf);
      });
      await it("bufferSubData with non-ArrayBuffer throws TypeError", async () => {
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, 128, gl.STATIC_DRAW);
        gl.getError();
        expect(() => gl.bufferSubData(gl.ARRAY_BUFFER, 0, 42)).toThrow();
        expect(() => gl.bufferSubData(gl.ARRAY_BUFFER, 0, "5.5")).toThrow();
        expect(() => gl.bufferSubData(gl.ARRAY_BUFFER, 10, null)).toThrow();
        expect(gl.getError()).toBe(gl.NO_ERROR);
        gl.bindBuffer(gl.ARRAY_BUFFER, null);
        gl.deleteBuffer(buf);
      });
    });
    await describe("conformance/buffers/element-array-buffer-delete-recreate", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("drawElements succeeds after deleting and recreating the element array buffer", async () => {
        const vsSrc = `attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
        const fsSrc = `precision mediump float; void main() { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); }`;
        const prog = makeProgram(gl, vsSrc, fsSrc);
        gl.useProgram(prog);
        const fbo = makeTestFBO(gl, 2, 2);
        const vertexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
          -1,
          -1,
          1,
          -1,
          -1,
          1,
          1,
          1
        ]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        let indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array([0, 1, 2, 3]), gl.STATIC_DRAW);
        gl.deleteBuffer(indexBuffer);
        indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array([0, 1, 2, 3]), gl.STATIC_DRAW);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawElements(gl.TRIANGLE_STRIP, 4, gl.UNSIGNED_BYTE, 0);
        expect(gl.getError()).toBe(gl.NO_ERROR);
        const pixel = readPixel(gl, 1, 1);
        expect(pixelClose(pixel, [0, 255, 0, 255])).toBeTruthy();
        destroyTestFBO(gl, fbo);
        gl.deleteBuffer(vertexBuffer);
        gl.deleteBuffer(indexBuffer);
        gl.deleteProgram(prog);
      });
    });
    win.destroy();
  });
};

// src/ts/conformance/programs.spec.ts
init_console_gjs();
var VS_POSITION = `attribute vec4 a_position; void main() { gl_Position = a_position; }`;
var VS_COLOR_ATTRIB = `attribute vec4 aVertex; attribute vec4 aColor; varying vec4 vColor; void main() { vColor = aColor; gl_Position = aVertex; }`;
var FS_VARYING_COLOR = `precision mediump float; varying vec4 vColor; void main() { gl_FragColor = vColor; }`;
var FS_RED = `void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }`;
var FS_GREEN = `void main() { gl_FragColor = vec4(0.0, 1.0, 0.0, 1.0); }`;
var FS_SETTABLE = `precision mediump float; uniform vec4 u_color; void main() { gl_FragColor = u_color; }`;
var VS_STANDARD = `
    attribute vec4 a_vertex;
    attribute vec3 a_normal;
    uniform mat4 u_modelViewProjMatrix;
    void main() { gl_Position = u_modelViewProjMatrix * a_vertex; }`;
var FS_STANDARD = `
    precision mediump float;
    void main() { gl_FragColor = vec4(1.0); }`;
function compileShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return s;
}
function linkProgram(gl, vsSrc, fsSrc, attribBindings) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  if (attribBindings) {
    for (const [name2, loc] of attribBindings) gl.bindAttribLocation(prog, loc, name2);
  }
  gl.linkProgram(prog);
  return prog;
}
function drawFullscreenAndRead(gl, prog, posAttrib = "a_position") {
  const loc = typeof posAttrib === "string" ? gl.getAttribLocation(prog, posAttrib) : posAttrib;
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-4, -4, 4, -4, 0, 4]), gl.STREAM_DRAW);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.disableVertexAttribArray(loc);
  gl.deleteBuffer(buf);
  return readPixel(gl, 0, 0);
}
var programs_spec_default = async () => {
  await on2("Display", async () => {
    const setup = createGLSetup();
    if (!setup) {
      console.warn("WebGL context not available \u2014 skipping conformance/programs tests");
      return;
    }
    const { gl, glArea, win } = setup;
    glArea.make_current();
    await describe("conformance/programs/program-test: compileShader", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("good vertex shader should compile", async () => {
        const vs = compileShader(
          gl,
          gl.VERTEX_SHADER,
          "attribute vec4 aVertex; void main() { gl_Position = aVertex; }"
        );
        expect(gl.getShaderParameter(vs, gl.COMPILE_STATUS)).toBeTruthy();
        gl.deleteShader(vs);
      });
      await it("good fragment shader should compile", async () => {
        const fs = compileShader(
          gl,
          gl.FRAGMENT_SHADER,
          "precision mediump float; void main() { gl_FragColor = vec4(1.0); }"
        );
        expect(gl.getShaderParameter(fs, gl.COMPILE_STATUS)).toBeTruthy();
        gl.deleteShader(fs);
      });
      await it("getShaderParameter with desktop-only INFO_LOG_LENGTH returns null and INVALID_ENUM", async () => {
        const vs = compileShader(
          gl,
          gl.VERTEX_SHADER,
          "attribute vec4 v; void main() { gl_Position = v; }"
        );
        const INFO_LOG_LENGTH = 35716;
        const result = gl.getShaderParameter(vs, INFO_LOG_LENGTH);
        expect(result).toBeNull();
        expect(gl.getError()).toBe(gl.INVALID_ENUM);
        gl.deleteShader(vs);
      });
    });
    await describe("conformance/programs/program-test: attachShader / detachShader", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("attaching a vertex shader succeeds", async () => {
        const vs = compileShader(gl, gl.VERTEX_SHADER, VS_COLOR_ATTRIB);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        expect(gl.getError()).toBe(gl.NO_ERROR);
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
      });
      await it("attaching the same shader twice generates INVALID_OPERATION", async () => {
        const vs = compileShader(gl, gl.VERTEX_SHADER, VS_COLOR_ATTRIB);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.getError();
        gl.attachShader(prog, vs);
        expect(gl.getError()).toBe(gl.INVALID_OPERATION);
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
      });
      await it("attaching two vertex shaders to same program generates INVALID_OPERATION", async () => {
        const vs1 = compileShader(gl, gl.VERTEX_SHADER, VS_COLOR_ATTRIB);
        const vs2 = compileShader(
          gl,
          gl.VERTEX_SHADER,
          "attribute vec4 v; void main() { gl_Position = v * 0.5; }"
        );
        const prog = gl.createProgram();
        gl.attachShader(prog, vs1);
        gl.getError();
        gl.attachShader(prog, vs2);
        expect(gl.getError()).toBe(gl.INVALID_OPERATION);
        gl.deleteProgram(prog);
        gl.deleteShader(vs1);
        gl.deleteShader(vs2);
      });
      await it("detaching an attached shader succeeds", async () => {
        const vs = compileShader(gl, gl.VERTEX_SHADER, VS_COLOR_ATTRIB);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.detachShader(prog, vs);
        expect(gl.getError()).toBe(gl.NO_ERROR);
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
      });
      await it("detaching a non-attached shader generates INVALID_OPERATION", async () => {
        const vs = compileShader(gl, gl.VERTEX_SHADER, VS_COLOR_ATTRIB);
        const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_VARYING_COLOR);
        const prog = gl.createProgram();
        gl.attachShader(prog, fs);
        gl.getError();
        gl.detachShader(prog, vs);
        expect(gl.getError()).toBe(gl.INVALID_OPERATION);
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      });
    });
    await describe("conformance/programs/program-test: getAttachedShaders", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("empty program returns empty list", async () => {
        const prog = gl.createProgram();
        const shaders = gl.getAttachedShaders(prog);
        expect(shaders?.length).toBe(0);
        gl.deleteProgram(prog);
      });
      await it("attached shaders appear in getAttachedShaders", async () => {
        const vs = compileShader(gl, gl.VERTEX_SHADER, VS_COLOR_ATTRIB);
        const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_VARYING_COLOR);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        const shaders = gl.getAttachedShaders(prog);
        expect(shaders.length).toBe(2);
        expect(shaders.includes(vs)).toBeTruthy();
        expect(shaders.includes(fs)).toBeTruthy();
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      });
      await it("detached shaders are removed from getAttachedShaders", async () => {
        const vs = compileShader(gl, gl.VERTEX_SHADER, VS_COLOR_ATTRIB);
        const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_VARYING_COLOR);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.detachShader(prog, vs);
        const shaders = gl.getAttachedShaders(prog);
        expect(shaders.length).toBe(1);
        expect(shaders.includes(fs)).toBeTruthy();
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      });
    });
    await describe("conformance/programs/program-test: linkProgram / useProgram", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("valid program should link", async () => {
        const prog = linkProgram(
          gl,
          VS_COLOR_ATTRIB,
          FS_VARYING_COLOR,
          [["aVertex", 0], ["aColor", 1]]
        );
        expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBeTruthy();
        expect(typeof gl.getProgramInfoLog(prog)).toBe("string");
        gl.deleteProgram(prog);
      });
      await it("program with no fragment shader should fail to link", async () => {
        const vs = compileShader(gl, gl.VERTEX_SHADER, VS_COLOR_ATTRIB);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.linkProgram(prog);
        expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBeFalsy();
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
      });
      await it("program with no vertex shader should fail to link", async () => {
        const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_VARYING_COLOR);
        const prog = gl.createProgram();
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);
        expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBeFalsy();
        gl.deleteProgram(prog);
        gl.deleteShader(fs);
      });
      await it("using a valid program should succeed", async () => {
        const prog = linkProgram(
          gl,
          VS_COLOR_ATTRIB,
          FS_VARYING_COLOR,
          [["aVertex", 0], ["aColor", 1]]
        );
        gl.useProgram(prog);
        expect(gl.getError()).toBe(gl.NO_ERROR);
        gl.useProgram(null);
        gl.deleteProgram(prog);
      });
      await it("using an invalid (unlinked) program should generate INVALID_OPERATION", async () => {
        const vs = compileShader(gl, gl.VERTEX_SHADER, VS_COLOR_ATTRIB);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.linkProgram(prog);
        gl.useProgram(prog);
        expect(gl.getError()).toBe(gl.INVALID_OPERATION);
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
      });
      await it("drawing with null program generates INVALID_OPERATION", async () => {
        const prog = linkProgram(gl, VS_POSITION, FS_RED, [["a_position", 0]]);
        const fbo = makeTestFBO(gl, 2, 2);
        const buf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([0, 0, 1, 0, 0, 1]),
          gl.STATIC_DRAW
        );
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);
        gl.useProgram(null);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        expect(gl.getError()).toBe(gl.INVALID_OPERATION);
        gl.disableVertexAttribArray(0);
        gl.deleteBuffer(buf);
        destroyTestFBO(gl, fbo);
        gl.deleteProgram(prog);
      });
    });
    await describe("conformance/programs/program-test: deleteProgram / deleteShader", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("deleting the current program does not affect the current rendering state", async () => {
        const prog = linkProgram(gl, VS_POSITION, FS_RED, [["a_position", 0]]);
        gl.useProgram(prog);
        gl.deleteProgram(prog);
        const fbo = makeTestFBO(gl, 2, 2);
        const pixel = drawFullscreenAndRead(gl, prog, 0);
        expect(gl.getError()).toBe(gl.NO_ERROR);
        expect(pixelClose(pixel, [255, 0, 0, 255])).toBeTruthy();
        destroyTestFBO(gl, fbo);
        gl.useProgram(null);
      });
      await it("unattached deleted shader is invalid immediately", async () => {
        const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_RED);
        gl.deleteShader(fs);
        gl.compileShader(fs);
        expect(gl.getError()).toBe(gl.INVALID_VALUE);
      });
      await it("attached deleted shader is still valid while attached", async () => {
        const vs = compileShader(gl, gl.VERTEX_SHADER, VS_POSITION);
        const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_RED);
        const prog = linkProgram(gl, VS_POSITION, FS_RED, [["a_position", 0]]);
        gl.attachShader(prog, vs);
        gl.getError();
        const fs3 = compileShader(gl, gl.FRAGMENT_SHADER, FS_GREEN);
        const prog2 = gl.createProgram();
        gl.attachShader(prog2, vs);
        gl.attachShader(prog2, fs3);
        gl.deleteShader(fs3);
        gl.compileShader(fs3);
        expect(gl.getShaderParameter(fs3, gl.COMPILE_STATUS)).toBeTruthy();
        gl.deleteProgram(prog);
        gl.deleteProgram(prog2);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      });
    });
    await describe("conformance/programs/program-test: relink updates rendering", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("relinking with a new fragment shader updates the program output", async () => {
        const fbo = makeTestFBO(gl, 2, 2);
        const vs = compileShader(gl, gl.VERTEX_SHADER, VS_POSITION);
        const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_RED);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.bindAttribLocation(prog, 0, "a_position");
        gl.linkProgram(prog);
        gl.useProgram(prog);
        expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBeTruthy();
        gl.clear(gl.COLOR_BUFFER_BIT);
        let pixel = drawFullscreenAndRead(gl, prog, 0);
        expect(pixelClose(pixel, [255, 0, 0, 255])).toBeTruthy();
        gl.shaderSource(fs, FS_GREEN);
        gl.compileShader(fs);
        gl.linkProgram(prog);
        expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBeTruthy();
        gl.clear(gl.COLOR_BUFFER_BIT);
        pixel = drawFullscreenAndRead(gl, prog, 0);
        expect(pixelClose(pixel, [0, 255, 0, 255])).toBeTruthy();
        destroyTestFBO(gl, fbo);
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      });
      await it("relinking clears uniforms \u2014 output should be transparent black", async () => {
        const fbo = makeTestFBO(gl, 2, 2);
        const vs = compileShader(gl, gl.VERTEX_SHADER, VS_POSITION);
        const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_SETTABLE);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.bindAttribLocation(prog, 0, "a_position");
        gl.linkProgram(prog);
        gl.useProgram(prog);
        const colorLoc = gl.getUniformLocation(prog, "u_color");
        gl.uniform4f(colorLoc, 1, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        let pixel = drawFullscreenAndRead(gl, prog, 0);
        expect(pixelClose(pixel, [255, 0, 0, 255])).toBeTruthy();
        gl.linkProgram(prog);
        gl.clear(gl.COLOR_BUFFER_BIT);
        pixel = drawFullscreenAndRead(gl, prog, 0);
        expect(pixelClose(pixel, [0, 0, 0, 0])).toBeTruthy();
        destroyTestFBO(gl, fbo);
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      });
    });
    await describe("conformance/programs/gl-shader-test", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("creating a GEOMETRY shader should return null", async () => {
        const GEOMETRY_SHADER_ARB = 36313;
        const shader = gl.createShader(GEOMETRY_SHADER_ARB);
        expect(shader).toBeNull();
      });
      await it("deferred compilation: shader linked with source set after first compile", async () => {
        const fbo = makeTestFBO(gl, 2, 2);
        const vs = compileShader(
          gl,
          gl.VERTEX_SHADER,
          "attribute vec4 vPosition; void main() { gl_Position = vPosition; }"
        );
        const fs = compileShader(gl, gl.FRAGMENT_SHADER, FS_GREEN);
        gl.shaderSource(fs, FS_RED);
        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.bindAttribLocation(prog, 0, "vPosition");
        gl.linkProgram(prog);
        gl.useProgram(prog);
        gl.clear(gl.COLOR_BUFFER_BIT);
        const pixel = drawFullscreenAndRead(gl, prog, 0);
        expect(pixelClose(pixel, [255, 0, 0, 255])).toBeTruthy();
        destroyTestFBO(gl, fbo);
        gl.deleteProgram(prog);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      });
    });
    await describe("conformance/programs/get-active-test: getActiveAttrib", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("getActiveAttrib returns correct info for standard attribs", async () => {
        const prog = linkProgram(gl, VS_STANDARD, FS_STANDARD);
        expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBeTruthy();
        const count2 = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES);
        expect(count2).toBe(2);
        const infos = [];
        for (let i = 0; i < count2; i++) {
          const info2 = gl.getActiveAttrib(prog, i);
          expect(info2).not.toBeNull();
          infos.push(info2);
        }
        const names = infos.map((i) => i.name).sort();
        expect(names).toContain("a_vertex");
        expect(names).toContain("a_normal");
        const vertexInfo = infos.find((i) => i.name === "a_vertex");
        expect(vertexInfo.type).toBe(gl.FLOAT_VEC4);
        expect(vertexInfo.size).toBe(1);
        const normalInfo = infos.find((i) => i.name === "a_normal");
        expect(normalInfo.type).toBe(gl.FLOAT_VEC3);
        expect(normalInfo.size).toBe(1);
        gl.deleteProgram(prog);
      });
      await it("getActiveAttrib with out-of-range index returns null and INVALID_VALUE", async () => {
        const prog = linkProgram(gl, VS_STANDARD, FS_STANDARD);
        const count2 = gl.getProgramParameter(prog, gl.ACTIVE_ATTRIBUTES);
        const result = gl.getActiveAttrib(prog, count2);
        expect(result).toBeNull();
        expect(gl.getError()).toBe(gl.INVALID_VALUE);
        gl.deleteProgram(prog);
      });
      await it("getActiveAttrib with null program throws", async () => {
        expect(() => gl.getActiveAttrib(null, 0)).toThrow();
      });
    });
    await describe("conformance/programs/get-active-test: getActiveUniform", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("getActiveUniform returns correct info for u_modelViewProjMatrix", async () => {
        const prog = linkProgram(gl, VS_STANDARD, FS_STANDARD);
        const count2 = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
        expect(count2).toBeGreaterThan(0);
        let found = null;
        for (let i = 0; i < count2; i++) {
          const info2 = gl.getActiveUniform(prog, i);
          if (info2?.name === "u_modelViewProjMatrix") found = info2;
        }
        expect(found).not.toBeNull();
        expect(found.type).toBe(gl.FLOAT_MAT4);
        expect(found.size).toBe(1);
        gl.deleteProgram(prog);
      });
      await it("getActiveUniform with out-of-range index returns null and INVALID_VALUE", async () => {
        const prog = linkProgram(gl, VS_STANDARD, FS_STANDARD);
        const count2 = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
        const result = gl.getActiveUniform(prog, count2);
        expect(result).toBeNull();
        expect(gl.getError()).toBe(gl.INVALID_VALUE);
        gl.deleteProgram(prog);
      });
      await it("getActiveUniform with null program throws", async () => {
        expect(() => gl.getActiveUniform(null, 0)).toThrow();
      });
    });
    win.destroy();
  });
};

// src/ts/conformance/attribs.spec.ts
init_console_gjs();
var attribs_spec_default = async () => {
  await on2("Display", async () => {
    const setup = createGLSetup();
    if (!setup) {
      console.warn("WebGL context not available \u2014 skipping conformance/attribs tests");
      return;
    }
    const { gl, glArea, win } = setup;
    glArea.make_current();
    await describe("conformance/attribs/gl-vertex-attrib: vertexAttrib round-trip", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("vertexAttrib1f stores value in slot 0 and defaults to [x,0,0,1]", async () => {
        gl.vertexAttrib1f(0, 5);
        const v = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB);
        expect(v instanceof Float32Array).toBeTruthy();
        expect(v[0]).toBe(5);
        expect(v[1]).toBe(0);
        expect(v[2]).toBe(0);
        expect(v[3]).toBe(1);
      });
      await it("vertexAttrib2f stores two values and defaults the rest to [_,_,0,1]", async () => {
        gl.vertexAttrib2f(0, 6, 7);
        const v = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB);
        expect(v[0]).toBe(6);
        expect(v[1]).toBe(7);
        expect(v[2]).toBe(0);
        expect(v[3]).toBe(1);
      });
      await it("vertexAttrib3f stores three values and defaults last to 1", async () => {
        gl.vertexAttrib3f(0, 7, 8, 9);
        const v = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB);
        expect(v[0]).toBe(7);
        expect(v[1]).toBe(8);
        expect(v[2]).toBe(9);
        expect(v[3]).toBe(1);
      });
      await it("vertexAttrib4f stores all four values", async () => {
        gl.vertexAttrib4f(0, 6, 7, 8, 9);
        const v = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB);
        expect(v[0]).toBe(6);
        expect(v[1]).toBe(7);
        expect(v[2]).toBe(8);
        expect(v[3]).toBe(9);
      });
      await it("vertexAttrib1fv with array round-trips correctly", async () => {
        gl.vertexAttrib1fv(0, [1]);
        const v = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB);
        expect(v[0]).toBe(1);
        expect(v[1]).toBe(0);
        expect(v[2]).toBe(0);
        expect(v[3]).toBe(1);
      });
      await it("vertexAttrib1fv with Float32Array round-trips correctly", async () => {
        gl.vertexAttrib1fv(0, new Float32Array([-1]));
        const v = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB);
        expect(v[0]).toBe(-1);
        expect(v[3]).toBe(1);
      });
      await it("vertexAttrib2fv with array round-trips correctly", async () => {
        gl.vertexAttrib2fv(0, [1, 2]);
        const v = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB);
        expect(v[0]).toBe(1);
        expect(v[1]).toBe(2);
        expect(v[2]).toBe(0);
        expect(v[3]).toBe(1);
      });
      await it("vertexAttrib3fv with Float32Array round-trips correctly", async () => {
        gl.vertexAttrib3fv(0, new Float32Array([1, -2, 3]));
        const v = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB);
        expect(v[0]).toBe(1);
        expect(v[1]).toBe(-2);
        expect(v[2]).toBe(3);
        expect(v[3]).toBe(1);
      });
      await it("vertexAttrib4fv with Float32Array round-trips correctly", async () => {
        gl.vertexAttrib4fv(0, new Float32Array([1, 2, -3, 4]));
        const v = gl.getVertexAttrib(0, gl.CURRENT_VERTEX_ATTRIB);
        expect(v[0]).toBe(1);
        expect(v[1]).toBe(2);
        expect(v[2]).toBe(-3);
        expect(v[3]).toBe(4);
      });
      await it("setting attrib values generates no GL error", async () => {
        const numAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
        for (let i = 0; i < numAttribs; i++) {
          gl.vertexAttrib4f(i, i * 0.1, i * 0.2, i * 0.3, i * 0.4);
        }
        expect(gl.getError()).toBe(gl.NO_ERROR);
      });
    });
    await describe("conformance/attribs/gl-vertex-attrib: out-of-range index", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("getVertexAttrib with out-of-range index generates INVALID_VALUE", async () => {
        const numAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
        gl.getVertexAttrib(numAttribs, gl.CURRENT_VERTEX_ATTRIB);
        expect(gl.getError()).toBe(gl.INVALID_VALUE);
      });
      await it("vertexAttrib1fv with out-of-range index generates INVALID_VALUE", async () => {
        const numAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
        gl.vertexAttrib1fv(numAttribs, [1]);
        expect(gl.getError()).toBe(gl.INVALID_VALUE);
      });
      await it("vertexAttrib4fv with out-of-range index generates INVALID_VALUE", async () => {
        const numAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
        gl.vertexAttrib4fv(numAttribs, new Float32Array([1, 2, 3, 4]));
        expect(gl.getError()).toBe(gl.INVALID_VALUE);
      });
      await it("vertexAttrib4f with out-of-range index generates INVALID_VALUE", async () => {
        const numAttribs = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);
        gl.vertexAttrib4f(numAttribs, 1, 2, 3, 4);
        expect(gl.getError()).toBe(gl.INVALID_VALUE);
      });
    });
    await describe("conformance/attribs/gl-enable-vertex-attrib", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("drawArrays with enabled attrib that has no buffer bound generates INVALID_OPERATION", async () => {
        const vsSrc = `attribute vec4 vPosition; void main() { gl_Position = vPosition; }`;
        const fsSrc = `void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }`;
        const prog = makeProgram(gl, vsSrc, fsSrc);
        gl.useProgram(prog);
        const vertexObject = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexObject);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([0, 0.5, 0, -0.5, -0.5, 0, 0.5, -0.5, 0]),
          gl.STATIC_DRAW
        );
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(3);
        expect(gl.getError()).toBe(gl.NO_ERROR);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        expect(gl.getError()).toBe(gl.INVALID_OPERATION);
        gl.disableVertexAttribArray(0);
        gl.disableVertexAttribArray(3);
        gl.deleteBuffer(vertexObject);
        gl.deleteProgram(prog);
      });
    });
    await describe("conformance/attribs/gl-bindAttribLocation-repeated", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("getAttribLocation returns the bound location after linkProgram", async () => {
        const vsSrc = `attribute vec4 vPosition; void main() { gl_Position = vPosition; }`;
        const fsSrc = `void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }`;
        function setup2(attribIndex) {
          const vs = gl.createShader(gl.VERTEX_SHADER);
          gl.shaderSource(vs, vsSrc);
          gl.compileShader(vs);
          const fs = gl.createShader(gl.FRAGMENT_SHADER);
          gl.shaderSource(fs, fsSrc);
          gl.compileShader(fs);
          const prog = gl.createProgram();
          gl.attachShader(prog, vs);
          gl.attachShader(prog, fs);
          gl.bindAttribLocation(prog, attribIndex, "vPosition");
          gl.linkProgram(prog);
          expect(gl.getProgramParameter(prog, gl.LINK_STATUS)).toBeTruthy();
          expect(gl.getAttribLocation(prog, "vPosition")).toBe(attribIndex);
          gl.deleteShader(vs);
          gl.deleteShader(fs);
          return prog;
        }
        const p0 = setup2(0);
        const p3 = setup2(3);
        const p1 = setup2(1);
        const p3b = setup2(3);
        gl.deleteProgram(p0);
        gl.deleteProgram(p3);
        gl.deleteProgram(p1);
        gl.deleteProgram(p3b);
      });
    });
    win.destroy();
  });
};

// src/ts/conformance/context.spec.ts
init_console_gjs();
var WEBGL_METHODS = [
  "getContextAttributes",
  "activeTexture",
  "attachShader",
  "bindAttribLocation",
  "bindBuffer",
  "bindFramebuffer",
  "bindRenderbuffer",
  "bindTexture",
  "blendColor",
  "blendEquation",
  "blendEquationSeparate",
  "blendFunc",
  "blendFuncSeparate",
  "bufferData",
  "bufferSubData",
  "checkFramebufferStatus",
  "clear",
  "clearColor",
  "clearDepth",
  "clearStencil",
  "colorMask",
  "compileShader",
  "compressedTexImage2D",
  "compressedTexSubImage2D",
  "copyTexImage2D",
  "copyTexSubImage2D",
  "createBuffer",
  "createFramebuffer",
  "createProgram",
  "createRenderbuffer",
  "createShader",
  "createTexture",
  "cullFace",
  "deleteBuffer",
  "deleteFramebuffer",
  "deleteProgram",
  "deleteRenderbuffer",
  "deleteShader",
  "deleteTexture",
  "depthFunc",
  "depthMask",
  "depthRange",
  "detachShader",
  "disable",
  "disableVertexAttribArray",
  "drawArrays",
  "drawElements",
  "enable",
  "enableVertexAttribArray",
  "finish",
  "flush",
  "framebufferRenderbuffer",
  "framebufferTexture2D",
  "frontFace",
  "generateMipmap",
  "getActiveAttrib",
  "getActiveUniform",
  "getAttachedShaders",
  "getAttribLocation",
  "getParameter",
  "getBufferParameter",
  "getError",
  "getExtension",
  "getFramebufferAttachmentParameter",
  "getProgramParameter",
  "getProgramInfoLog",
  "getRenderbufferParameter",
  "getShaderParameter",
  "getShaderInfoLog",
  "getShaderPrecisionFormat",
  "getShaderSource",
  "getSupportedExtensions",
  "getTexParameter",
  "getUniform",
  "getUniformLocation",
  "getVertexAttrib",
  "getVertexAttribOffset",
  "hint",
  "isBuffer",
  "isContextLost",
  "isEnabled",
  "isFramebuffer",
  "isProgram",
  "isRenderbuffer",
  "isShader",
  "isTexture",
  "lineWidth",
  "linkProgram",
  "pixelStorei",
  "polygonOffset",
  "readPixels",
  "renderbufferStorage",
  "sampleCoverage",
  "scissor",
  "shaderSource",
  "stencilFunc",
  "stencilFuncSeparate",
  "stencilMask",
  "stencilMaskSeparate",
  "stencilOp",
  "stencilOpSeparate",
  "texImage2D",
  "texParameterf",
  "texParameteri",
  "texSubImage2D",
  "uniform1f",
  "uniform1fv",
  "uniform1i",
  "uniform1iv",
  "uniform2f",
  "uniform2fv",
  "uniform2i",
  "uniform2iv",
  "uniform3f",
  "uniform3fv",
  "uniform3i",
  "uniform3iv",
  "uniform4f",
  "uniform4fv",
  "uniform4i",
  "uniform4iv",
  "uniformMatrix2fv",
  "uniformMatrix3fv",
  "uniformMatrix4fv",
  "useProgram",
  "validateProgram",
  "vertexAttrib1f",
  "vertexAttrib1fv",
  "vertexAttrib2f",
  "vertexAttrib2fv",
  "vertexAttrib3f",
  "vertexAttrib3fv",
  "vertexAttrib4f",
  "vertexAttrib4fv",
  "vertexAttribPointer",
  "viewport"
];
var WEBGL_CONSTANTS = [
  ["DEPTH_BUFFER_BIT", 256],
  ["STENCIL_BUFFER_BIT", 1024],
  ["COLOR_BUFFER_BIT", 16384],
  ["POINTS", 0],
  ["LINES", 1],
  ["LINE_LOOP", 2],
  ["LINE_STRIP", 3],
  ["TRIANGLES", 4],
  ["TRIANGLE_STRIP", 5],
  ["TRIANGLE_FAN", 6],
  ["ZERO", 0],
  ["ONE", 1],
  ["SRC_COLOR", 768],
  ["SRC_ALPHA", 770],
  ["FUNC_ADD", 32774],
  ["ARRAY_BUFFER", 34962],
  ["ELEMENT_ARRAY_BUFFER", 34963],
  ["STREAM_DRAW", 35040],
  ["STATIC_DRAW", 35044],
  ["DYNAMIC_DRAW", 35048],
  ["FRAGMENT_SHADER", 35632],
  ["VERTEX_SHADER", 35633],
  ["COMPILE_STATUS", 35713],
  ["LINK_STATUS", 35714],
  ["VALIDATE_STATUS", 35715],
  ["FLOAT", 5126],
  ["FLOAT_VEC2", 35664],
  ["FLOAT_VEC3", 35665],
  ["FLOAT_VEC4", 35666],
  ["FLOAT_MAT2", 35674],
  ["FLOAT_MAT3", 35675],
  ["FLOAT_MAT4", 35676],
  ["INT", 5124],
  ["TEXTURE_2D", 3553],
  ["TEXTURE_CUBE_MAP", 34067],
  ["RGBA", 6408],
  ["RGB", 6407],
  ["UNSIGNED_BYTE", 5121],
  ["UNSIGNED_SHORT", 5123],
  ["UNSIGNED_INT", 5125],
  ["FRAMEBUFFER", 36160],
  ["RENDERBUFFER", 36161],
  ["DEPTH_COMPONENT16", 33189],
  ["DEPTH_ATTACHMENT", 36096],
  ["COLOR_ATTACHMENT0", 36064],
  ["FRAMEBUFFER_COMPLETE", 36053],
  ["NO_ERROR", 0],
  ["INVALID_ENUM", 1280],
  ["INVALID_VALUE", 1281],
  ["INVALID_OPERATION", 1282],
  ["OUT_OF_MEMORY", 1285]
];
var context_spec_default = async () => {
  await on2("Display", async () => {
    const setup = createGLSetup();
    if (!setup) {
      console.warn("WebGL context not available \u2014 skipping conformance/context tests");
      return;
    }
    const { gl, glArea, win } = setup;
    glArea.make_current();
    await describe("conformance/context/methods: all WebGL methods present", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("all standard WebGL methods are functions on the context", async () => {
        const missing = [];
        for (const method of WEBGL_METHODS) {
          if (typeof gl[method] !== "function") {
            missing.push(method);
          }
        }
        if (missing.length > 0) {
          throw new Error(`Missing WebGL methods: ${missing.join(", ")}`);
        }
      });
    });
    await describe("conformance/context/constants-and-properties: constant values", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("all sampled WebGL constants have the correct numeric value", async () => {
        const wrong = [];
        for (const [name2, expected] of WEBGL_CONSTANTS) {
          const actual = gl[name2];
          if (actual !== expected) {
            wrong.push(`${name2}: expected ${expected}, got ${actual}`);
          }
        }
        if (wrong.length > 0) {
          throw new Error(`Wrong constant values:
${wrong.join("\n")}`);
        }
      });
      await it("WebGLRenderingContext class constant values match instance constants", async () => {
        const wrong = [];
        for (const [name2, expected] of WEBGL_CONSTANTS) {
          const classVal = WebGLRenderingContext[name2];
          if (classVal !== void 0 && classVal !== expected) {
            wrong.push(`${name2}: expected ${expected}, got ${classVal}`);
          }
        }
        if (wrong.length > 0) {
          throw new Error(`Wrong class constant values:
${wrong.join("\n")}`);
        }
      });
    });
    await describe("conformance/context/context-type-test", async () => {
      beforeEach(async () => {
        glArea.make_current();
      });
      await it("WebGLRenderingContext should exist in globalThis", async () => {
        expect(typeof globalThis.WebGLRenderingContext !== "undefined").toBeTruthy();
      });
      await it("gl should be an instance of WebGLRenderingContext", async () => {
        expect(gl instanceof WebGLRenderingContext).toBeTruthy();
      });
      await it("getContextAttributes returns an object", async () => {
        const attrs = gl.getContextAttributes();
        expect(attrs).not.toBeNull();
        expect(typeof attrs).toBe("object");
      });
      await it("isContextLost returns false initially", async () => {
        expect(gl.isContextLost()).toBe(false);
      });
      await it("canvas property points to the HTMLCanvasElement", async () => {
        expect(gl.canvas).not.toBeNull();
        expect(typeof gl.canvas.getContext).toBe("function");
      });
      await it("drawingBufferWidth and drawingBufferHeight are positive integers", async () => {
        expect(gl.drawingBufferWidth).toBeGreaterThan(0);
        expect(gl.drawingBufferHeight).toBeGreaterThan(0);
        expect(Number.isInteger(gl.drawingBufferWidth)).toBeTruthy();
        expect(Number.isInteger(gl.drawingBufferHeight)).toBeTruthy();
      });
      await it("getSupportedExtensions returns an array of strings", async () => {
        const exts = gl.getSupportedExtensions();
        expect(Array.isArray(exts)).toBeTruthy();
        for (const ext of exts) {
          expect(typeof ext).toBe("string");
        }
      });
      await it("getParameter(VENDOR) and getParameter(RENDERER) return strings", async () => {
        const vendor = gl.getParameter(gl.VENDOR);
        const renderer = gl.getParameter(gl.RENDERER);
        const version2 = gl.getParameter(gl.VERSION);
        const shadingLang = gl.getParameter(gl.SHADING_LANGUAGE_VERSION);
        expect(typeof vendor).toBe("string");
        expect(typeof renderer).toBe("string");
        expect(typeof version2).toBe("string");
        expect(typeof shadingLang).toBe("string");
      });
    });
    win.destroy();
  });
};

// src/ts/conformance-test.ts
run({
  testSuite: async () => {
    await buffers_spec_default();
    await programs_spec_default();
    await attribs_spec_default();
    await context_spec_default();
  }
});
