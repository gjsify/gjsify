// ../../node/console/src/index.ts
var _isGJS = typeof print === "function" && typeof printerr === "function";
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
var Console = class {
  _stdout;
  _stderr;
  _groupDepth = 0;
  _groupIndentation;
  _timers = /* @__PURE__ */ new Map();
  _counters = /* @__PURE__ */ new Map();
  constructor(stdoutOrOptions, stderr) {
    if (stdoutOrOptions && typeof stdoutOrOptions.write === "function") {
      this._stdout = stdoutOrOptions;
      this._stderr = stderr || this._stdout;
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
  assert(value, ...args) {
    if (!value) {
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
var _default = new Console();
var log = (...args) => _default.log(...args);
var info = (...args) => _default.info(...args);
var debug = (...args) => _default.debug(...args);
var warn = (...args) => _default.warn(...args);
var error = (...args) => _default.error(...args);
var dir = (obj, options) => _default.dir(obj, options);
var dirxml = (...args) => _default.dirxml(...args);
var table = (data, properties) => _default.table(data, properties);
var clear = () => _default.clear();
var assert = (value, ...args) => _default.assert(value, ...args);
var trace = (...args) => _default.trace(...args);
var time = (label) => _default.time(label);
var timeEnd = (label) => _default.timeEnd(label);
var timeLog = (label, ...args) => _default.timeLog(label, ...args);
var count = (label) => _default.count(label);
var countReset = (label) => _default.countReset(label);
var group = (...args) => _default.group(...args);
var groupCollapsed = (...args) => _default.groupCollapsed(...args);
var groupEnd = () => _default.groupEnd();
var profile = (_label) => {
};
var profileEnd = (_label) => {
};
var timeStamp = (_label) => {
};

// src/shims/console-gjs.ts
var console = {
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
export {
  console
};
