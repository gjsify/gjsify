// src/esm/vite-compatible-readable-stream.js
import require$$0 from "events";
import buffer from "buffer";
var commonjsGlobal = typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : {};
function createCommonjsModule(fn, basedir, module) {
  return module = {
    path: basedir,
    exports: {},
    require: function(path, base) {
      return commonjsRequire(path, base === void 0 || base === null ? module.path : base);
    }
  }, fn(module, module.exports), module.exports;
}
function getDefaultExportFromNamespaceIfNotNamed(n) {
  return n && Object.prototype.hasOwnProperty.call(n, "default") && Object.keys(n).length === 1 ? n["default"] : n;
}
function commonjsRequire() {
  throw new Error("Dynamic requires are not currently supported by @rollup/plugin-commonjs");
}
var _registry = {};
function defaultSetTimout() {
  throw new Error("setTimeout has not been defined");
}
function defaultClearTimeout() {
  throw new Error("clearTimeout has not been defined");
}
var cachedSetTimeout = defaultSetTimout;
var cachedClearTimeout = defaultClearTimeout;
var globalContext;
if (typeof window !== "undefined") {
  globalContext = window;
} else if (typeof self !== "undefined") {
  globalContext = self;
} else {
  globalContext = {};
}
if (typeof globalContext.setTimeout === "function") {
  cachedSetTimeout = setTimeout;
}
if (typeof globalContext.clearTimeout === "function") {
  cachedClearTimeout = clearTimeout;
}
function runTimeout(fun) {
  if (cachedSetTimeout === setTimeout) {
    return setTimeout(fun, 0);
  }
  if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
    cachedSetTimeout = setTimeout;
    return setTimeout(fun, 0);
  }
  try {
    return cachedSetTimeout(fun, 0);
  } catch (e) {
    try {
      return cachedSetTimeout.call(null, fun, 0);
    } catch (e2) {
      return cachedSetTimeout.call(this, fun, 0);
    }
  }
}
function runClearTimeout(marker) {
  if (cachedClearTimeout === clearTimeout) {
    return clearTimeout(marker);
  }
  if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
    cachedClearTimeout = clearTimeout;
    return clearTimeout(marker);
  }
  try {
    return cachedClearTimeout(marker);
  } catch (e) {
    try {
      return cachedClearTimeout.call(null, marker);
    } catch (e2) {
      return cachedClearTimeout.call(this, marker);
    }
  }
}
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;
function cleanUpNextTick() {
  if (!draining || !currentQueue) {
    return;
  }
  draining = false;
  if (currentQueue.length) {
    queue = currentQueue.concat(queue);
  } else {
    queueIndex = -1;
  }
  if (queue.length) {
    drainQueue();
  }
}
function drainQueue() {
  if (draining) {
    return;
  }
  var timeout = runTimeout(cleanUpNextTick);
  draining = true;
  var len = queue.length;
  while (len) {
    currentQueue = queue;
    queue = [];
    while (++queueIndex < len) {
      if (currentQueue) {
        currentQueue[queueIndex].run();
      }
    }
    queueIndex = -1;
    len = queue.length;
  }
  currentQueue = null;
  draining = false;
  runClearTimeout(timeout);
}
function nextTick(fun) {
  var args = new Array(arguments.length - 1);
  if (arguments.length > 1) {
    for (var i = 1; i < arguments.length; i++) {
      args[i - 1] = arguments[i];
    }
  }
  queue.push(new Item(fun, args));
  if (queue.length === 1 && !draining) {
    runTimeout(drainQueue);
  }
}
function Item(fun, array) {
  this.fun = fun;
  this.array = array;
}
Item.prototype.run = function() {
  this.fun.apply(null, this.array);
};
var title = "browser";
var platform = "browser";
var browser = true;
var argv = [];
var version = "";
var versions = {};
var release = {};
var config = {};
function noop() {
}
var on = noop;
var addListener = noop;
var once = noop;
var off = noop;
var removeListener = noop;
var removeAllListeners = noop;
var emit = noop;
function binding(name) {
  throw new Error("process.binding is not supported");
}
function cwd() {
  return "/";
}
function chdir(dir) {
  throw new Error("process.chdir is not supported");
}
function umask() {
  return 0;
}
var performance = globalContext.performance || {};
var performanceNow = performance.now || performance.mozNow || performance.msNow || performance.oNow || performance.webkitNow || function() {
  return new Date().getTime();
};
function hrtime(previousTimestamp) {
  var clocktime = performanceNow.call(performance) * 1e-3;
  var seconds = Math.floor(clocktime);
  var nanoseconds = Math.floor(clocktime % 1 * 1e9);
  if (previousTimestamp) {
    seconds = seconds - previousTimestamp[0];
    nanoseconds = nanoseconds - previousTimestamp[1];
    if (nanoseconds < 0) {
      seconds--;
      nanoseconds += 1e9;
    }
  }
  return [seconds, nanoseconds];
}
var startTime = new Date();
function uptime() {
  var currentTime = new Date();
  var dif = currentTime - startTime;
  return dif / 1e3;
}
var process = {
  nextTick,
  title,
  browser,
  env: { "NODE_ENV": "production" },
  argv,
  version,
  versions,
  on,
  addListener,
  once,
  off,
  removeListener,
  removeAllListeners,
  emit,
  binding,
  cwd,
  chdir,
  umask,
  hrtime,
  platform,
  release,
  config,
  uptime
};
var streamBrowser = require$$0.EventEmitter;
var _nodeResolve_empty = {};
var _nodeResolve_empty$1 = /* @__PURE__ */ Object.freeze({
  __proto__: null,
  "default": _nodeResolve_empty
});
var debugUtil = /* @__PURE__ */ getDefaultExportFromNamespaceIfNotNamed(_nodeResolve_empty$1);
function ownKeys(object, enumerableOnly) {
  var keys = Object.keys(object);
  if (Object.getOwnPropertySymbols) {
    var symbols = Object.getOwnPropertySymbols(object);
    if (enumerableOnly)
      symbols = symbols.filter(function(sym) {
        return Object.getOwnPropertyDescriptor(object, sym).enumerable;
      });
    keys.push.apply(keys, symbols);
  }
  return keys;
}
function _objectSpread(target) {
  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i] != null ? arguments[i] : {};
    if (i % 2) {
      ownKeys(Object(source), true).forEach(function(key) {
        _defineProperty(target, key, source[key]);
      });
    } else if (Object.getOwnPropertyDescriptors) {
      Object.defineProperties(target, Object.getOwnPropertyDescriptors(source));
    } else {
      ownKeys(Object(source)).forEach(function(key) {
        Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(source, key));
      });
    }
  }
  return target;
}
function _defineProperty(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
  } else {
    obj[key] = value;
  }
  return obj;
}
function _classCallCheck(instance, Constructor) {
  if (!(instance instanceof Constructor)) {
    throw new TypeError("Cannot call a class as a function");
  }
}
function _defineProperties(target, props) {
  for (var i = 0; i < props.length; i++) {
    var descriptor = props[i];
    descriptor.enumerable = descriptor.enumerable || false;
    descriptor.configurable = true;
    if ("value" in descriptor)
      descriptor.writable = true;
    Object.defineProperty(target, descriptor.key, descriptor);
  }
}
function _createClass(Constructor, protoProps, staticProps) {
  if (protoProps)
    _defineProperties(Constructor.prototype, protoProps);
  if (staticProps)
    _defineProperties(Constructor, staticProps);
  return Constructor;
}
var Buffer = buffer.Buffer;
var inspect = debugUtil.inspect;
var custom = inspect && inspect.custom || "inspect";
function copyBuffer(src, target, offset) {
  Buffer.prototype.copy.call(src, target, offset);
}
var buffer_list = /* @__PURE__ */ function() {
  function BufferList() {
    _classCallCheck(this, BufferList);
    this.head = null;
    this.tail = null;
    this.length = 0;
  }
  _createClass(BufferList, [{
    key: "push",
    value: function push(v) {
      var entry = {
        data: v,
        next: null
      };
      if (this.length > 0)
        this.tail.next = entry;
      else
        this.head = entry;
      this.tail = entry;
      ++this.length;
    }
  }, {
    key: "unshift",
    value: function unshift(v) {
      var entry = {
        data: v,
        next: this.head
      };
      if (this.length === 0)
        this.tail = entry;
      this.head = entry;
      ++this.length;
    }
  }, {
    key: "shift",
    value: function shift() {
      if (this.length === 0)
        return;
      var ret = this.head.data;
      if (this.length === 1)
        this.head = this.tail = null;
      else
        this.head = this.head.next;
      --this.length;
      return ret;
    }
  }, {
    key: "clear",
    value: function clear() {
      this.head = this.tail = null;
      this.length = 0;
    }
  }, {
    key: "join",
    value: function join(s) {
      if (this.length === 0)
        return "";
      var p = this.head;
      var ret = "" + p.data;
      while (p = p.next) {
        ret += s + p.data;
      }
      return ret;
    }
  }, {
    key: "concat",
    value: function concat(n) {
      if (this.length === 0)
        return Buffer.alloc(0);
      var ret = Buffer.allocUnsafe(n >>> 0);
      var p = this.head;
      var i = 0;
      while (p) {
        copyBuffer(p.data, ret, i);
        i += p.data.length;
        p = p.next;
      }
      return ret;
    }
  }, {
    key: "consume",
    value: function consume(n, hasStrings) {
      var ret;
      if (n < this.head.data.length) {
        ret = this.head.data.slice(0, n);
        this.head.data = this.head.data.slice(n);
      } else if (n === this.head.data.length) {
        ret = this.shift();
      } else {
        ret = hasStrings ? this._getString(n) : this._getBuffer(n);
      }
      return ret;
    }
  }, {
    key: "first",
    value: function first() {
      return this.head.data;
    }
  }, {
    key: "_getString",
    value: function _getString(n) {
      var p = this.head;
      var c = 1;
      var ret = p.data;
      n -= ret.length;
      while (p = p.next) {
        var str = p.data;
        var nb = n > str.length ? str.length : n;
        if (nb === str.length)
          ret += str;
        else
          ret += str.slice(0, n);
        n -= nb;
        if (n === 0) {
          if (nb === str.length) {
            ++c;
            if (p.next)
              this.head = p.next;
            else
              this.head = this.tail = null;
          } else {
            this.head = p;
            p.data = str.slice(nb);
          }
          break;
        }
        ++c;
      }
      this.length -= c;
      return ret;
    }
  }, {
    key: "_getBuffer",
    value: function _getBuffer(n) {
      var ret = Buffer.allocUnsafe(n);
      var p = this.head;
      var c = 1;
      p.data.copy(ret);
      n -= p.data.length;
      while (p = p.next) {
        var buf = p.data;
        var nb = n > buf.length ? buf.length : n;
        buf.copy(ret, ret.length - n, 0, nb);
        n -= nb;
        if (n === 0) {
          if (nb === buf.length) {
            ++c;
            if (p.next)
              this.head = p.next;
            else
              this.head = this.tail = null;
          } else {
            this.head = p;
            p.data = buf.slice(nb);
          }
          break;
        }
        ++c;
      }
      this.length -= c;
      return ret;
    }
  }, {
    key: custom,
    value: function value(_, options) {
      return inspect(this, _objectSpread({}, options, {
        depth: 0,
        customInspect: false
      }));
    }
  }]);
  return BufferList;
}();
function destroy(err, cb) {
  var _this = this;
  var readableDestroyed = this._readableState && this._readableState.destroyed;
  var writableDestroyed = this._writableState && this._writableState.destroyed;
  if (readableDestroyed || writableDestroyed) {
    if (cb) {
      cb(err);
    } else if (err) {
      if (!this._writableState) {
        process.nextTick(emitErrorNT, this, err);
      } else if (!this._writableState.errorEmitted) {
        this._writableState.errorEmitted = true;
        process.nextTick(emitErrorNT, this, err);
      }
    }
    return this;
  }
  if (this._readableState) {
    this._readableState.destroyed = true;
  }
  if (this._writableState) {
    this._writableState.destroyed = true;
  }
  this._destroy(err || null, function(err2) {
    if (!cb && err2) {
      if (!_this._writableState) {
        process.nextTick(emitErrorAndCloseNT, _this, err2);
      } else if (!_this._writableState.errorEmitted) {
        _this._writableState.errorEmitted = true;
        process.nextTick(emitErrorAndCloseNT, _this, err2);
      } else {
        process.nextTick(emitCloseNT, _this);
      }
    } else if (cb) {
      process.nextTick(emitCloseNT, _this);
      cb(err2);
    } else {
      process.nextTick(emitCloseNT, _this);
    }
  });
  return this;
}
function emitErrorAndCloseNT(self2, err) {
  emitErrorNT(self2, err);
  emitCloseNT(self2);
}
function emitCloseNT(self2) {
  if (self2._writableState && !self2._writableState.emitClose)
    return;
  if (self2._readableState && !self2._readableState.emitClose)
    return;
  self2.emit("close");
}
function undestroy() {
  if (this._readableState) {
    this._readableState.destroyed = false;
    this._readableState.reading = false;
    this._readableState.ended = false;
    this._readableState.endEmitted = false;
  }
  if (this._writableState) {
    this._writableState.destroyed = false;
    this._writableState.ended = false;
    this._writableState.ending = false;
    this._writableState.finalCalled = false;
    this._writableState.prefinished = false;
    this._writableState.finished = false;
    this._writableState.errorEmitted = false;
  }
}
function emitErrorNT(self2, err) {
  self2.emit("error", err);
}
function errorOrDestroy(stream, err) {
  var rState = stream._readableState;
  var wState = stream._writableState;
  if (rState && rState.autoDestroy || wState && wState.autoDestroy)
    stream.destroy(err);
  else
    stream.emit("error", err);
}
var destroy_1 = {
  destroy,
  undestroy,
  errorOrDestroy
};
function _inheritsLoose(subClass, superClass) {
  subClass.prototype = Object.create(superClass.prototype);
  subClass.prototype.constructor = subClass;
  subClass.__proto__ = superClass;
}
var codes = {};
function createErrorType(code, message, Base) {
  if (!Base) {
    Base = Error;
  }
  function getMessage(arg1, arg2, arg3) {
    if (typeof message === "string") {
      return message;
    } else {
      return message(arg1, arg2, arg3);
    }
  }
  var NodeError = /* @__PURE__ */ function(_Base) {
    _inheritsLoose(NodeError2, _Base);
    function NodeError2(arg1, arg2, arg3) {
      return _Base.call(this, getMessage(arg1, arg2, arg3)) || this;
    }
    return NodeError2;
  }(Base);
  NodeError.prototype.name = Base.name;
  NodeError.prototype.code = code;
  codes[code] = NodeError;
}
function oneOf(expected, thing) {
  if (Array.isArray(expected)) {
    var len = expected.length;
    expected = expected.map(function(i) {
      return String(i);
    });
    if (len > 2) {
      return "one of ".concat(thing, " ").concat(expected.slice(0, len - 1).join(", "), ", or ") + expected[len - 1];
    } else if (len === 2) {
      return "one of ".concat(thing, " ").concat(expected[0], " or ").concat(expected[1]);
    } else {
      return "of ".concat(thing, " ").concat(expected[0]);
    }
  } else {
    return "of ".concat(thing, " ").concat(String(expected));
  }
}
function startsWith(str, search, pos) {
  return str.substr(!pos || pos < 0 ? 0 : +pos, search.length) === search;
}
function endsWith(str, search, this_len) {
  if (this_len === void 0 || this_len > str.length) {
    this_len = str.length;
  }
  return str.substring(this_len - search.length, this_len) === search;
}
function includes(str, search, start) {
  if (typeof start !== "number") {
    start = 0;
  }
  if (start + search.length > str.length) {
    return false;
  } else {
    return str.indexOf(search, start) !== -1;
  }
}
createErrorType("ERR_INVALID_OPT_VALUE", function(name, value) {
  return 'The value "' + value + '" is invalid for option "' + name + '"';
}, TypeError);
createErrorType("ERR_INVALID_ARG_TYPE", function(name, expected, actual) {
  var determiner;
  if (typeof expected === "string" && startsWith(expected, "not ")) {
    determiner = "must not be";
    expected = expected.replace(/^not /, "");
  } else {
    determiner = "must be";
  }
  var msg;
  if (endsWith(name, " argument")) {
    msg = "The ".concat(name, " ").concat(determiner, " ").concat(oneOf(expected, "type"));
  } else {
    var type = includes(name, ".") ? "property" : "argument";
    msg = 'The "'.concat(name, '" ').concat(type, " ").concat(determiner, " ").concat(oneOf(expected, "type"));
  }
  msg += ". Received type ".concat(typeof actual);
  return msg;
}, TypeError);
createErrorType("ERR_STREAM_PUSH_AFTER_EOF", "stream.push() after EOF");
createErrorType("ERR_METHOD_NOT_IMPLEMENTED", function(name) {
  return "The " + name + " method is not implemented";
});
createErrorType("ERR_STREAM_PREMATURE_CLOSE", "Premature close");
createErrorType("ERR_STREAM_DESTROYED", function(name) {
  return "Cannot call " + name + " after a stream was destroyed";
});
createErrorType("ERR_MULTIPLE_CALLBACK", "Callback called multiple times");
createErrorType("ERR_STREAM_CANNOT_PIPE", "Cannot pipe, not readable");
createErrorType("ERR_STREAM_WRITE_AFTER_END", "write after end");
createErrorType("ERR_STREAM_NULL_VALUES", "May not write null values to stream", TypeError);
createErrorType("ERR_UNKNOWN_ENCODING", function(arg) {
  return "Unknown encoding: " + arg;
}, TypeError);
createErrorType("ERR_STREAM_UNSHIFT_AFTER_END_EVENT", "stream.unshift() after end event");
var codes_1 = codes;
var errorsBrowser = {
  codes: codes_1
};
var ERR_INVALID_OPT_VALUE = errorsBrowser.codes.ERR_INVALID_OPT_VALUE;
function highWaterMarkFrom(options, isDuplex, duplexKey) {
  return options.highWaterMark != null ? options.highWaterMark : isDuplex ? options[duplexKey] : null;
}
function getHighWaterMark(state2, options, duplexKey, isDuplex) {
  var hwm = highWaterMarkFrom(options, isDuplex, duplexKey);
  if (hwm != null) {
    if (!(isFinite(hwm) && Math.floor(hwm) === hwm) || hwm < 0) {
      var name = isDuplex ? duplexKey : "highWaterMark";
      throw new ERR_INVALID_OPT_VALUE(name, hwm);
    }
    return Math.floor(hwm);
  }
  return state2.objectMode ? 16 : 16 * 1024;
}
var state = {
  getHighWaterMark
};
var inherits_browser = createCommonjsModule(function(module) {
  if (typeof Object.create === "function") {
    module.exports = function inherits(ctor, superCtor) {
      if (superCtor) {
        ctor.super_ = superCtor;
        ctor.prototype = Object.create(superCtor.prototype, {
          constructor: {
            value: ctor,
            enumerable: false,
            writable: true,
            configurable: true
          }
        });
      }
    };
  } else {
    module.exports = function inherits(ctor, superCtor) {
      if (superCtor) {
        ctor.super_ = superCtor;
        var TempCtor = function() {
        };
        TempCtor.prototype = superCtor.prototype;
        ctor.prototype = new TempCtor();
        ctor.prototype.constructor = ctor;
      }
    };
  }
});
var safeBuffer = createCommonjsModule(function(module, exports) {
  var Buffer2 = buffer.Buffer;
  function copyProps(src, dst) {
    for (var key in src) {
      dst[key] = src[key];
    }
  }
  if (Buffer2.from && Buffer2.alloc && Buffer2.allocUnsafe && Buffer2.allocUnsafeSlow) {
    module.exports = buffer;
  } else {
    copyProps(buffer, exports);
    exports.Buffer = SafeBuffer;
  }
  function SafeBuffer(arg, encodingOrOffset, length) {
    return Buffer2(arg, encodingOrOffset, length);
  }
  SafeBuffer.prototype = Object.create(Buffer2.prototype);
  copyProps(Buffer2, SafeBuffer);
  SafeBuffer.from = function(arg, encodingOrOffset, length) {
    if (typeof arg === "number") {
      throw new TypeError("Argument must not be a number");
    }
    return Buffer2(arg, encodingOrOffset, length);
  };
  SafeBuffer.alloc = function(size, fill, encoding) {
    if (typeof size !== "number") {
      throw new TypeError("Argument must be a number");
    }
    var buf = Buffer2(size);
    if (fill !== void 0) {
      if (typeof encoding === "string") {
        buf.fill(fill, encoding);
      } else {
        buf.fill(fill);
      }
    } else {
      buf.fill(0);
    }
    return buf;
  };
  SafeBuffer.allocUnsafe = function(size) {
    if (typeof size !== "number") {
      throw new TypeError("Argument must be a number");
    }
    return Buffer2(size);
  };
  SafeBuffer.allocUnsafeSlow = function(size) {
    if (typeof size !== "number") {
      throw new TypeError("Argument must be a number");
    }
    return buffer.SlowBuffer(size);
  };
});
var Buffer$1 = safeBuffer.Buffer;
var isEncoding = Buffer$1.isEncoding || function(encoding) {
  encoding = "" + encoding;
  switch (encoding && encoding.toLowerCase()) {
    case "hex":
    case "utf8":
    case "utf-8":
    case "ascii":
    case "binary":
    case "base64":
    case "ucs2":
    case "ucs-2":
    case "utf16le":
    case "utf-16le":
    case "raw":
      return true;
    default:
      return false;
  }
};
function _normalizeEncoding(enc) {
  if (!enc)
    return "utf8";
  var retried;
  while (true) {
    switch (enc) {
      case "utf8":
      case "utf-8":
        return "utf8";
      case "ucs2":
      case "ucs-2":
      case "utf16le":
      case "utf-16le":
        return "utf16le";
      case "latin1":
      case "binary":
        return "latin1";
      case "base64":
      case "ascii":
      case "hex":
        return enc;
      default:
        if (retried)
          return;
        enc = ("" + enc).toLowerCase();
        retried = true;
    }
  }
}
function normalizeEncoding(enc) {
  var nenc = _normalizeEncoding(enc);
  if (typeof nenc !== "string" && (Buffer$1.isEncoding === isEncoding || !isEncoding(enc)))
    throw new Error("Unknown encoding: " + enc);
  return nenc || enc;
}
var StringDecoder_1 = StringDecoder;
function StringDecoder(encoding) {
  this.encoding = normalizeEncoding(encoding);
  var nb;
  switch (this.encoding) {
    case "utf16le":
      this.text = utf16Text;
      this.end = utf16End;
      nb = 4;
      break;
    case "utf8":
      this.fillLast = utf8FillLast;
      nb = 4;
      break;
    case "base64":
      this.text = base64Text;
      this.end = base64End;
      nb = 3;
      break;
    default:
      this.write = simpleWrite;
      this.end = simpleEnd;
      return;
  }
  this.lastNeed = 0;
  this.lastTotal = 0;
  this.lastChar = Buffer$1.allocUnsafe(nb);
}
StringDecoder.prototype.write = function(buf) {
  if (buf.length === 0)
    return "";
  var r;
  var i;
  if (this.lastNeed) {
    r = this.fillLast(buf);
    if (r === void 0)
      return "";
    i = this.lastNeed;
    this.lastNeed = 0;
  } else {
    i = 0;
  }
  if (i < buf.length)
    return r ? r + this.text(buf, i) : this.text(buf, i);
  return r || "";
};
StringDecoder.prototype.end = utf8End;
StringDecoder.prototype.text = utf8Text;
StringDecoder.prototype.fillLast = function(buf) {
  if (this.lastNeed <= buf.length) {
    buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, this.lastNeed);
    return this.lastChar.toString(this.encoding, 0, this.lastTotal);
  }
  buf.copy(this.lastChar, this.lastTotal - this.lastNeed, 0, buf.length);
  this.lastNeed -= buf.length;
};
function utf8CheckByte(byte) {
  if (byte <= 127)
    return 0;
  else if (byte >> 5 === 6)
    return 2;
  else if (byte >> 4 === 14)
    return 3;
  else if (byte >> 3 === 30)
    return 4;
  return byte >> 6 === 2 ? -1 : -2;
}
function utf8CheckIncomplete(self2, buf, i) {
  var j = buf.length - 1;
  if (j < i)
    return 0;
  var nb = utf8CheckByte(buf[j]);
  if (nb >= 0) {
    if (nb > 0)
      self2.lastNeed = nb - 1;
    return nb;
  }
  if (--j < i || nb === -2)
    return 0;
  nb = utf8CheckByte(buf[j]);
  if (nb >= 0) {
    if (nb > 0)
      self2.lastNeed = nb - 2;
    return nb;
  }
  if (--j < i || nb === -2)
    return 0;
  nb = utf8CheckByte(buf[j]);
  if (nb >= 0) {
    if (nb > 0) {
      if (nb === 2)
        nb = 0;
      else
        self2.lastNeed = nb - 3;
    }
    return nb;
  }
  return 0;
}
function utf8CheckExtraBytes(self2, buf, p) {
  if ((buf[0] & 192) !== 128) {
    self2.lastNeed = 0;
    return "\uFFFD";
  }
  if (self2.lastNeed > 1 && buf.length > 1) {
    if ((buf[1] & 192) !== 128) {
      self2.lastNeed = 1;
      return "\uFFFD";
    }
    if (self2.lastNeed > 2 && buf.length > 2) {
      if ((buf[2] & 192) !== 128) {
        self2.lastNeed = 2;
        return "\uFFFD";
      }
    }
  }
}
function utf8FillLast(buf) {
  var p = this.lastTotal - this.lastNeed;
  var r = utf8CheckExtraBytes(this, buf);
  if (r !== void 0)
    return r;
  if (this.lastNeed <= buf.length) {
    buf.copy(this.lastChar, p, 0, this.lastNeed);
    return this.lastChar.toString(this.encoding, 0, this.lastTotal);
  }
  buf.copy(this.lastChar, p, 0, buf.length);
  this.lastNeed -= buf.length;
}
function utf8Text(buf, i) {
  var total = utf8CheckIncomplete(this, buf, i);
  if (!this.lastNeed)
    return buf.toString("utf8", i);
  this.lastTotal = total;
  var end = buf.length - (total - this.lastNeed);
  buf.copy(this.lastChar, 0, end);
  return buf.toString("utf8", i, end);
}
function utf8End(buf) {
  var r = buf && buf.length ? this.write(buf) : "";
  if (this.lastNeed)
    return r + "\uFFFD";
  return r;
}
function utf16Text(buf, i) {
  if ((buf.length - i) % 2 === 0) {
    var r = buf.toString("utf16le", i);
    if (r) {
      var c = r.charCodeAt(r.length - 1);
      if (c >= 55296 && c <= 56319) {
        this.lastNeed = 2;
        this.lastTotal = 4;
        this.lastChar[0] = buf[buf.length - 2];
        this.lastChar[1] = buf[buf.length - 1];
        return r.slice(0, -1);
      }
    }
    return r;
  }
  this.lastNeed = 1;
  this.lastTotal = 2;
  this.lastChar[0] = buf[buf.length - 1];
  return buf.toString("utf16le", i, buf.length - 1);
}
function utf16End(buf) {
  var r = buf && buf.length ? this.write(buf) : "";
  if (this.lastNeed) {
    var end = this.lastTotal - this.lastNeed;
    return r + this.lastChar.toString("utf16le", 0, end);
  }
  return r;
}
function base64Text(buf, i) {
  var n = (buf.length - i) % 3;
  if (n === 0)
    return buf.toString("base64", i);
  this.lastNeed = 3 - n;
  this.lastTotal = 3;
  if (n === 1) {
    this.lastChar[0] = buf[buf.length - 1];
  } else {
    this.lastChar[0] = buf[buf.length - 2];
    this.lastChar[1] = buf[buf.length - 1];
  }
  return buf.toString("base64", i, buf.length - n);
}
function base64End(buf) {
  var r = buf && buf.length ? this.write(buf) : "";
  if (this.lastNeed)
    return r + this.lastChar.toString("base64", 0, 3 - this.lastNeed);
  return r;
}
function simpleWrite(buf) {
  return buf.toString(this.encoding);
}
function simpleEnd(buf) {
  return buf && buf.length ? this.write(buf) : "";
}
var string_decoder = {
  StringDecoder: StringDecoder_1
};
var ERR_STREAM_PREMATURE_CLOSE = errorsBrowser.codes.ERR_STREAM_PREMATURE_CLOSE;
function once$1(callback) {
  var called = false;
  return function() {
    if (called)
      return;
    called = true;
    for (var _len = arguments.length, args = new Array(_len), _key = 0; _key < _len; _key++) {
      args[_key] = arguments[_key];
    }
    callback.apply(this, args);
  };
}
function noop$1() {
}
function isRequest(stream) {
  return stream.setHeader && typeof stream.abort === "function";
}
function eos(stream, opts, callback) {
  if (typeof opts === "function")
    return eos(stream, null, opts);
  if (!opts)
    opts = {};
  callback = once$1(callback || noop$1);
  var readable = opts.readable || opts.readable !== false && stream.readable;
  var writable = opts.writable || opts.writable !== false && stream.writable;
  var onlegacyfinish = function onlegacyfinish2() {
    if (!stream.writable)
      onfinish();
  };
  var writableEnded = stream._writableState && stream._writableState.finished;
  var onfinish = function onfinish2() {
    writable = false;
    writableEnded = true;
    if (!readable)
      callback.call(stream);
  };
  var readableEnded = stream._readableState && stream._readableState.endEmitted;
  var onend2 = function onend3() {
    readable = false;
    readableEnded = true;
    if (!writable)
      callback.call(stream);
  };
  var onerror = function onerror2(err) {
    callback.call(stream, err);
  };
  var onclose = function onclose2() {
    var err;
    if (readable && !readableEnded) {
      if (!stream._readableState || !stream._readableState.ended)
        err = new ERR_STREAM_PREMATURE_CLOSE();
      return callback.call(stream, err);
    }
    if (writable && !writableEnded) {
      if (!stream._writableState || !stream._writableState.ended)
        err = new ERR_STREAM_PREMATURE_CLOSE();
      return callback.call(stream, err);
    }
  };
  var onrequest = function onrequest2() {
    stream.req.on("finish", onfinish);
  };
  if (isRequest(stream)) {
    stream.on("complete", onfinish);
    stream.on("abort", onclose);
    if (stream.req)
      onrequest();
    else
      stream.on("request", onrequest);
  } else if (writable && !stream._writableState) {
    stream.on("end", onlegacyfinish);
    stream.on("close", onlegacyfinish);
  }
  stream.on("end", onend2);
  stream.on("finish", onfinish);
  if (opts.error !== false)
    stream.on("error", onerror);
  stream.on("close", onclose);
  return function() {
    stream.removeListener("complete", onfinish);
    stream.removeListener("abort", onclose);
    stream.removeListener("request", onrequest);
    if (stream.req)
      stream.req.removeListener("finish", onfinish);
    stream.removeListener("end", onlegacyfinish);
    stream.removeListener("close", onlegacyfinish);
    stream.removeListener("finish", onfinish);
    stream.removeListener("end", onend2);
    stream.removeListener("error", onerror);
    stream.removeListener("close", onclose);
  };
}
var endOfStream = eos;
var _Object$setPrototypeO;
function _defineProperty$1(obj, key, value) {
  if (key in obj) {
    Object.defineProperty(obj, key, { value, enumerable: true, configurable: true, writable: true });
  } else {
    obj[key] = value;
  }
  return obj;
}
var kLastResolve = Symbol("lastResolve");
var kLastReject = Symbol("lastReject");
var kError = Symbol("error");
var kEnded = Symbol("ended");
var kLastPromise = Symbol("lastPromise");
var kHandlePromise = Symbol("handlePromise");
var kStream = Symbol("stream");
function createIterResult(value, done2) {
  return {
    value,
    done: done2
  };
}
function readAndResolve(iter) {
  var resolve = iter[kLastResolve];
  if (resolve !== null) {
    var data = iter[kStream].read();
    if (data !== null) {
      iter[kLastPromise] = null;
      iter[kLastResolve] = null;
      iter[kLastReject] = null;
      resolve(createIterResult(data, false));
    }
  }
}
function onReadable(iter) {
  process.nextTick(readAndResolve, iter);
}
function wrapForNext(lastPromise, iter) {
  return function(resolve, reject) {
    lastPromise.then(function() {
      if (iter[kEnded]) {
        resolve(createIterResult(void 0, true));
        return;
      }
      iter[kHandlePromise](resolve, reject);
    }, reject);
  };
}
var AsyncIteratorPrototype = Object.getPrototypeOf(function() {
});
var ReadableStreamAsyncIteratorPrototype = Object.setPrototypeOf((_Object$setPrototypeO = {
  get stream() {
    return this[kStream];
  },
  next: function next() {
    var _this = this;
    var error = this[kError];
    if (error !== null) {
      return Promise.reject(error);
    }
    if (this[kEnded]) {
      return Promise.resolve(createIterResult(void 0, true));
    }
    if (this[kStream].destroyed) {
      return new Promise(function(resolve, reject) {
        process.nextTick(function() {
          if (_this[kError]) {
            reject(_this[kError]);
          } else {
            resolve(createIterResult(void 0, true));
          }
        });
      });
    }
    var lastPromise = this[kLastPromise];
    var promise;
    if (lastPromise) {
      promise = new Promise(wrapForNext(lastPromise, this));
    } else {
      var data = this[kStream].read();
      if (data !== null) {
        return Promise.resolve(createIterResult(data, false));
      }
      promise = new Promise(this[kHandlePromise]);
    }
    this[kLastPromise] = promise;
    return promise;
  }
}, _defineProperty$1(_Object$setPrototypeO, Symbol.asyncIterator, function() {
  return this;
}), _defineProperty$1(_Object$setPrototypeO, "return", function _return() {
  var _this2 = this;
  return new Promise(function(resolve, reject) {
    _this2[kStream].destroy(null, function(err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(createIterResult(void 0, true));
    });
  });
}), _Object$setPrototypeO), AsyncIteratorPrototype);
var createReadableStreamAsyncIterator = function createReadableStreamAsyncIterator2(stream) {
  var _Object$create;
  var iterator = Object.create(ReadableStreamAsyncIteratorPrototype, (_Object$create = {}, _defineProperty$1(_Object$create, kStream, {
    value: stream,
    writable: true
  }), _defineProperty$1(_Object$create, kLastResolve, {
    value: null,
    writable: true
  }), _defineProperty$1(_Object$create, kLastReject, {
    value: null,
    writable: true
  }), _defineProperty$1(_Object$create, kError, {
    value: null,
    writable: true
  }), _defineProperty$1(_Object$create, kEnded, {
    value: stream._readableState.endEmitted,
    writable: true
  }), _defineProperty$1(_Object$create, kHandlePromise, {
    value: function value(resolve, reject) {
      var data = iterator[kStream].read();
      if (data) {
        iterator[kLastPromise] = null;
        iterator[kLastResolve] = null;
        iterator[kLastReject] = null;
        resolve(createIterResult(data, false));
      } else {
        iterator[kLastResolve] = resolve;
        iterator[kLastReject] = reject;
      }
    },
    writable: true
  }), _Object$create));
  iterator[kLastPromise] = null;
  endOfStream(stream, function(err) {
    if (err && err.code !== "ERR_STREAM_PREMATURE_CLOSE") {
      var reject = iterator[kLastReject];
      if (reject !== null) {
        iterator[kLastPromise] = null;
        iterator[kLastResolve] = null;
        iterator[kLastReject] = null;
        reject(err);
      }
      iterator[kError] = err;
      return;
    }
    var resolve = iterator[kLastResolve];
    if (resolve !== null) {
      iterator[kLastPromise] = null;
      iterator[kLastResolve] = null;
      iterator[kLastReject] = null;
      resolve(createIterResult(void 0, true));
    }
    iterator[kEnded] = true;
  });
  stream.on("readable", onReadable.bind(null, iterator));
  return iterator;
};
var async_iterator = createReadableStreamAsyncIterator;
var fromBrowser = function() {
  throw new Error("Readable.from is not available in the browser");
};
_registry.Readable = Readable;
Readable.ReadableState = ReadableState;
var EE = require$$0.EventEmitter;
var EElistenerCount = function EElistenerCount2(emitter, type) {
  return emitter.listeners(type).length;
};
var Buffer$2 = buffer.Buffer;
var OurUint8Array = commonjsGlobal.Uint8Array || function() {
};
function _uint8ArrayToBuffer(chunk) {
  return Buffer$2.from(chunk);
}
function _isUint8Array(obj) {
  return Buffer$2.isBuffer(obj) || obj instanceof OurUint8Array;
}
var debug;
if (debugUtil && debugUtil.debuglog) {
  debug = debugUtil.debuglog("stream");
} else {
  debug = function debug2() {
  };
}
var getHighWaterMark$1 = state.getHighWaterMark;
var _require$codes = errorsBrowser.codes;
var ERR_INVALID_ARG_TYPE = _require$codes.ERR_INVALID_ARG_TYPE;
var ERR_STREAM_PUSH_AFTER_EOF = _require$codes.ERR_STREAM_PUSH_AFTER_EOF;
var ERR_METHOD_NOT_IMPLEMENTED = _require$codes.ERR_METHOD_NOT_IMPLEMENTED;
var ERR_STREAM_UNSHIFT_AFTER_END_EVENT = _require$codes.ERR_STREAM_UNSHIFT_AFTER_END_EVENT;
var StringDecoder$1;
var createReadableStreamAsyncIterator$1;
var from;
inherits_browser(Readable, streamBrowser);
var errorOrDestroy$1 = destroy_1.errorOrDestroy;
var kProxyEvents = ["error", "close", "destroy", "pause", "resume"];
function prependListener(emitter, event, fn) {
  if (typeof emitter.prependListener === "function")
    return emitter.prependListener(event, fn);
  if (!emitter._events || !emitter._events[event])
    emitter.on(event, fn);
  else if (Array.isArray(emitter._events[event]))
    emitter._events[event].unshift(fn);
  else
    emitter._events[event] = [fn, emitter._events[event]];
}
function ReadableState(options, stream, isDuplex) {
  options = options || {};
  if (typeof isDuplex !== "boolean")
    isDuplex = stream instanceof _registry.Duplex;
  this.objectMode = !!options.objectMode;
  if (isDuplex)
    this.objectMode = this.objectMode || !!options.readableObjectMode;
  this.highWaterMark = getHighWaterMark$1(this, options, "readableHighWaterMark", isDuplex);
  this.buffer = new buffer_list();
  this.length = 0;
  this.pipes = null;
  this.pipesCount = 0;
  this.flowing = null;
  this.ended = false;
  this.endEmitted = false;
  this.reading = false;
  this.sync = true;
  this.needReadable = false;
  this.emittedReadable = false;
  this.readableListening = false;
  this.resumeScheduled = false;
  this.paused = true;
  this.emitClose = options.emitClose !== false;
  this.autoDestroy = !!options.autoDestroy;
  this.destroyed = false;
  this.defaultEncoding = options.defaultEncoding || "utf8";
  this.awaitDrain = 0;
  this.readingMore = false;
  this.decoder = null;
  this.encoding = null;
  if (options.encoding) {
    if (!StringDecoder$1)
      StringDecoder$1 = string_decoder.StringDecoder;
    this.decoder = new StringDecoder$1(options.encoding);
    this.encoding = options.encoding;
  }
}
function Readable(options) {
  if (!(this instanceof Readable))
    return new Readable(options);
  var isDuplex = this instanceof _registry.Duplex;
  this._readableState = new ReadableState(options, this, isDuplex);
  this.readable = true;
  if (options) {
    if (typeof options.read === "function")
      this._read = options.read;
    if (typeof options.destroy === "function")
      this._destroy = options.destroy;
  }
  streamBrowser.call(this);
}
Object.defineProperty(Readable.prototype, "destroyed", {
  enumerable: false,
  get: function get() {
    if (this._readableState === void 0) {
      return false;
    }
    return this._readableState.destroyed;
  },
  set: function set(value) {
    if (!this._readableState) {
      return;
    }
    this._readableState.destroyed = value;
  }
});
Readable.prototype.destroy = destroy_1.destroy;
Readable.prototype._undestroy = destroy_1.undestroy;
Readable.prototype._destroy = function(err, cb) {
  cb(err);
};
Readable.prototype.push = function(chunk, encoding) {
  var state2 = this._readableState;
  var skipChunkCheck;
  if (!state2.objectMode) {
    if (typeof chunk === "string") {
      encoding = encoding || state2.defaultEncoding;
      if (encoding !== state2.encoding) {
        chunk = Buffer$2.from(chunk, encoding);
        encoding = "";
      }
      skipChunkCheck = true;
    }
  } else {
    skipChunkCheck = true;
  }
  return readableAddChunk(this, chunk, encoding, false, skipChunkCheck);
};
Readable.prototype.unshift = function(chunk) {
  return readableAddChunk(this, chunk, null, true, false);
};
function readableAddChunk(stream, chunk, encoding, addToFront, skipChunkCheck) {
  debug("readableAddChunk", chunk);
  var state2 = stream._readableState;
  if (chunk === null) {
    state2.reading = false;
    onEofChunk(stream, state2);
  } else {
    var er;
    if (!skipChunkCheck)
      er = chunkInvalid(state2, chunk);
    if (er) {
      errorOrDestroy$1(stream, er);
    } else if (state2.objectMode || chunk && chunk.length > 0) {
      if (typeof chunk !== "string" && !state2.objectMode && Object.getPrototypeOf(chunk) !== Buffer$2.prototype) {
        chunk = _uint8ArrayToBuffer(chunk);
      }
      if (addToFront) {
        if (state2.endEmitted)
          errorOrDestroy$1(stream, new ERR_STREAM_UNSHIFT_AFTER_END_EVENT());
        else
          addChunk(stream, state2, chunk, true);
      } else if (state2.ended) {
        errorOrDestroy$1(stream, new ERR_STREAM_PUSH_AFTER_EOF());
      } else if (state2.destroyed) {
        return false;
      } else {
        state2.reading = false;
        if (state2.decoder && !encoding) {
          chunk = state2.decoder.write(chunk);
          if (state2.objectMode || chunk.length !== 0)
            addChunk(stream, state2, chunk, false);
          else
            maybeReadMore(stream, state2);
        } else {
          addChunk(stream, state2, chunk, false);
        }
      }
    } else if (!addToFront) {
      state2.reading = false;
      maybeReadMore(stream, state2);
    }
  }
  return !state2.ended && (state2.length < state2.highWaterMark || state2.length === 0);
}
function addChunk(stream, state2, chunk, addToFront) {
  if (state2.flowing && state2.length === 0 && !state2.sync) {
    state2.awaitDrain = 0;
    stream.emit("data", chunk);
  } else {
    state2.length += state2.objectMode ? 1 : chunk.length;
    if (addToFront)
      state2.buffer.unshift(chunk);
    else
      state2.buffer.push(chunk);
    if (state2.needReadable)
      emitReadable(stream);
  }
  maybeReadMore(stream, state2);
}
function chunkInvalid(state2, chunk) {
  var er;
  if (!_isUint8Array(chunk) && typeof chunk !== "string" && chunk !== void 0 && !state2.objectMode) {
    er = new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "Uint8Array"], chunk);
  }
  return er;
}
Readable.prototype.isPaused = function() {
  return this._readableState.flowing === false;
};
Readable.prototype.setEncoding = function(enc) {
  if (!StringDecoder$1)
    StringDecoder$1 = string_decoder.StringDecoder;
  var decoder = new StringDecoder$1(enc);
  this._readableState.decoder = decoder;
  this._readableState.encoding = this._readableState.decoder.encoding;
  var p = this._readableState.buffer.head;
  var content = "";
  while (p !== null) {
    content += decoder.write(p.data);
    p = p.next;
  }
  this._readableState.buffer.clear();
  if (content !== "")
    this._readableState.buffer.push(content);
  this._readableState.length = content.length;
  return this;
};
var MAX_HWM = 1073741824;
function computeNewHighWaterMark(n) {
  if (n >= MAX_HWM) {
    n = MAX_HWM;
  } else {
    n--;
    n |= n >>> 1;
    n |= n >>> 2;
    n |= n >>> 4;
    n |= n >>> 8;
    n |= n >>> 16;
    n++;
  }
  return n;
}
function howMuchToRead(n, state2) {
  if (n <= 0 || state2.length === 0 && state2.ended)
    return 0;
  if (state2.objectMode)
    return 1;
  if (n !== n) {
    if (state2.flowing && state2.length)
      return state2.buffer.head.data.length;
    else
      return state2.length;
  }
  if (n > state2.highWaterMark)
    state2.highWaterMark = computeNewHighWaterMark(n);
  if (n <= state2.length)
    return n;
  if (!state2.ended) {
    state2.needReadable = true;
    return 0;
  }
  return state2.length;
}
Readable.prototype.read = function(n) {
  debug("read", n);
  n = parseInt(n, 10);
  var state2 = this._readableState;
  var nOrig = n;
  if (n !== 0)
    state2.emittedReadable = false;
  if (n === 0 && state2.needReadable && ((state2.highWaterMark !== 0 ? state2.length >= state2.highWaterMark : state2.length > 0) || state2.ended)) {
    debug("read: emitReadable", state2.length, state2.ended);
    if (state2.length === 0 && state2.ended)
      endReadable(this);
    else
      emitReadable(this);
    return null;
  }
  n = howMuchToRead(n, state2);
  if (n === 0 && state2.ended) {
    if (state2.length === 0)
      endReadable(this);
    return null;
  }
  var doRead = state2.needReadable;
  debug("need readable", doRead);
  if (state2.length === 0 || state2.length - n < state2.highWaterMark) {
    doRead = true;
    debug("length less than watermark", doRead);
  }
  if (state2.ended || state2.reading) {
    doRead = false;
    debug("reading or ended", doRead);
  } else if (doRead) {
    debug("do read");
    state2.reading = true;
    state2.sync = true;
    if (state2.length === 0)
      state2.needReadable = true;
    this._read(state2.highWaterMark);
    state2.sync = false;
    if (!state2.reading)
      n = howMuchToRead(nOrig, state2);
  }
  var ret;
  if (n > 0)
    ret = fromList(n, state2);
  else
    ret = null;
  if (ret === null) {
    state2.needReadable = state2.length <= state2.highWaterMark;
    n = 0;
  } else {
    state2.length -= n;
    state2.awaitDrain = 0;
  }
  if (state2.length === 0) {
    if (!state2.ended)
      state2.needReadable = true;
    if (nOrig !== n && state2.ended)
      endReadable(this);
  }
  if (ret !== null)
    this.emit("data", ret);
  return ret;
};
function onEofChunk(stream, state2) {
  debug("onEofChunk");
  if (state2.ended)
    return;
  if (state2.decoder) {
    var chunk = state2.decoder.end();
    if (chunk && chunk.length) {
      state2.buffer.push(chunk);
      state2.length += state2.objectMode ? 1 : chunk.length;
    }
  }
  state2.ended = true;
  if (state2.sync) {
    emitReadable(stream);
  } else {
    state2.needReadable = false;
    if (!state2.emittedReadable) {
      state2.emittedReadable = true;
      emitReadable_(stream);
    }
  }
}
function emitReadable(stream) {
  var state2 = stream._readableState;
  debug("emitReadable", state2.needReadable, state2.emittedReadable);
  state2.needReadable = false;
  if (!state2.emittedReadable) {
    debug("emitReadable", state2.flowing);
    state2.emittedReadable = true;
    process.nextTick(emitReadable_, stream);
  }
}
function emitReadable_(stream) {
  var state2 = stream._readableState;
  debug("emitReadable_", state2.destroyed, state2.length, state2.ended);
  if (!state2.destroyed && (state2.length || state2.ended)) {
    stream.emit("readable");
    state2.emittedReadable = false;
  }
  state2.needReadable = !state2.flowing && !state2.ended && state2.length <= state2.highWaterMark;
  flow(stream);
}
function maybeReadMore(stream, state2) {
  if (!state2.readingMore) {
    state2.readingMore = true;
    process.nextTick(maybeReadMore_, stream, state2);
  }
}
function maybeReadMore_(stream, state2) {
  while (!state2.reading && !state2.ended && (state2.length < state2.highWaterMark || state2.flowing && state2.length === 0)) {
    var len = state2.length;
    debug("maybeReadMore read 0");
    stream.read(0);
    if (len === state2.length)
      break;
  }
  state2.readingMore = false;
}
Readable.prototype._read = function(n) {
  errorOrDestroy$1(this, new ERR_METHOD_NOT_IMPLEMENTED("_read()"));
};
Readable.prototype.pipe = function(dest, pipeOpts) {
  var src = this;
  var state2 = this._readableState;
  switch (state2.pipesCount) {
    case 0:
      state2.pipes = dest;
      break;
    case 1:
      state2.pipes = [state2.pipes, dest];
      break;
    default:
      state2.pipes.push(dest);
      break;
  }
  state2.pipesCount += 1;
  debug("pipe count=%d opts=%j", state2.pipesCount, pipeOpts);
  var doEnd = (!pipeOpts || pipeOpts.end !== false) && dest !== process.stdout && dest !== process.stderr;
  var endFn = doEnd ? onend2 : unpipe;
  if (state2.endEmitted)
    process.nextTick(endFn);
  else
    src.once("end", endFn);
  dest.on("unpipe", onunpipe);
  function onunpipe(readable, unpipeInfo) {
    debug("onunpipe");
    if (readable === src) {
      if (unpipeInfo && unpipeInfo.hasUnpiped === false) {
        unpipeInfo.hasUnpiped = true;
        cleanup();
      }
    }
  }
  function onend2() {
    debug("onend");
    dest.end();
  }
  var ondrain = pipeOnDrain(src);
  dest.on("drain", ondrain);
  var cleanedUp = false;
  function cleanup() {
    debug("cleanup");
    dest.removeListener("close", onclose);
    dest.removeListener("finish", onfinish);
    dest.removeListener("drain", ondrain);
    dest.removeListener("error", onerror);
    dest.removeListener("unpipe", onunpipe);
    src.removeListener("end", onend2);
    src.removeListener("end", unpipe);
    src.removeListener("data", ondata);
    cleanedUp = true;
    if (state2.awaitDrain && (!dest._writableState || dest._writableState.needDrain))
      ondrain();
  }
  src.on("data", ondata);
  function ondata(chunk) {
    debug("ondata");
    var ret = dest.write(chunk);
    debug("dest.write", ret);
    if (ret === false) {
      if ((state2.pipesCount === 1 && state2.pipes === dest || state2.pipesCount > 1 && indexOf(state2.pipes, dest) !== -1) && !cleanedUp) {
        debug("false write response, pause", state2.awaitDrain);
        state2.awaitDrain++;
      }
      src.pause();
    }
  }
  function onerror(er) {
    debug("onerror", er);
    unpipe();
    dest.removeListener("error", onerror);
    if (EElistenerCount(dest, "error") === 0)
      errorOrDestroy$1(dest, er);
  }
  prependListener(dest, "error", onerror);
  function onclose() {
    dest.removeListener("finish", onfinish);
    unpipe();
  }
  dest.once("close", onclose);
  function onfinish() {
    debug("onfinish");
    dest.removeListener("close", onclose);
    unpipe();
  }
  dest.once("finish", onfinish);
  function unpipe() {
    debug("unpipe");
    src.unpipe(dest);
  }
  dest.emit("pipe", src);
  if (!state2.flowing) {
    debug("pipe resume");
    src.resume();
  }
  return dest;
};
function pipeOnDrain(src) {
  return function pipeOnDrainFunctionResult() {
    var state2 = src._readableState;
    debug("pipeOnDrain", state2.awaitDrain);
    if (state2.awaitDrain)
      state2.awaitDrain--;
    if (state2.awaitDrain === 0 && EElistenerCount(src, "data")) {
      state2.flowing = true;
      flow(src);
    }
  };
}
Readable.prototype.unpipe = function(dest) {
  var state2 = this._readableState;
  var unpipeInfo = {
    hasUnpiped: false
  };
  if (state2.pipesCount === 0)
    return this;
  if (state2.pipesCount === 1) {
    if (dest && dest !== state2.pipes)
      return this;
    if (!dest)
      dest = state2.pipes;
    state2.pipes = null;
    state2.pipesCount = 0;
    state2.flowing = false;
    if (dest)
      dest.emit("unpipe", this, unpipeInfo);
    return this;
  }
  if (!dest) {
    var dests = state2.pipes;
    var len = state2.pipesCount;
    state2.pipes = null;
    state2.pipesCount = 0;
    state2.flowing = false;
    for (var i = 0; i < len; i++) {
      dests[i].emit("unpipe", this, {
        hasUnpiped: false
      });
    }
    return this;
  }
  var index = indexOf(state2.pipes, dest);
  if (index === -1)
    return this;
  state2.pipes.splice(index, 1);
  state2.pipesCount -= 1;
  if (state2.pipesCount === 1)
    state2.pipes = state2.pipes[0];
  dest.emit("unpipe", this, unpipeInfo);
  return this;
};
Readable.prototype.on = function(ev, fn) {
  var res = streamBrowser.prototype.on.call(this, ev, fn);
  var state2 = this._readableState;
  if (ev === "data") {
    state2.readableListening = this.listenerCount("readable") > 0;
    if (state2.flowing !== false)
      this.resume();
  } else if (ev === "readable") {
    if (!state2.endEmitted && !state2.readableListening) {
      state2.readableListening = state2.needReadable = true;
      state2.flowing = false;
      state2.emittedReadable = false;
      debug("on readable", state2.length, state2.reading);
      if (state2.length) {
        emitReadable(this);
      } else if (!state2.reading) {
        process.nextTick(nReadingNextTick, this);
      }
    }
  }
  return res;
};
Readable.prototype.addListener = Readable.prototype.on;
Readable.prototype.removeListener = function(ev, fn) {
  var res = streamBrowser.prototype.removeListener.call(this, ev, fn);
  if (ev === "readable") {
    process.nextTick(updateReadableListening, this);
  }
  return res;
};
Readable.prototype.removeAllListeners = function(ev) {
  var res = streamBrowser.prototype.removeAllListeners.apply(this, arguments);
  if (ev === "readable" || ev === void 0) {
    process.nextTick(updateReadableListening, this);
  }
  return res;
};
function updateReadableListening(self2) {
  var state2 = self2._readableState;
  state2.readableListening = self2.listenerCount("readable") > 0;
  if (state2.resumeScheduled && !state2.paused) {
    state2.flowing = true;
  } else if (self2.listenerCount("data") > 0) {
    self2.resume();
  }
}
function nReadingNextTick(self2) {
  debug("readable nexttick read 0");
  self2.read(0);
}
Readable.prototype.resume = function() {
  var state2 = this._readableState;
  if (!state2.flowing) {
    debug("resume");
    state2.flowing = !state2.readableListening;
    resume(this, state2);
  }
  state2.paused = false;
  return this;
};
function resume(stream, state2) {
  if (!state2.resumeScheduled) {
    state2.resumeScheduled = true;
    process.nextTick(resume_, stream, state2);
  }
}
function resume_(stream, state2) {
  debug("resume", state2.reading);
  if (!state2.reading) {
    stream.read(0);
  }
  state2.resumeScheduled = false;
  stream.emit("resume");
  flow(stream);
  if (state2.flowing && !state2.reading)
    stream.read(0);
}
Readable.prototype.pause = function() {
  debug("call pause flowing=%j", this._readableState.flowing);
  if (this._readableState.flowing !== false) {
    debug("pause");
    this._readableState.flowing = false;
    this.emit("pause");
  }
  this._readableState.paused = true;
  return this;
};
function flow(stream) {
  var state2 = stream._readableState;
  debug("flow", state2.flowing);
  while (state2.flowing && stream.read() !== null) {
  }
}
Readable.prototype.wrap = function(stream) {
  var _this = this;
  var state2 = this._readableState;
  var paused = false;
  stream.on("end", function() {
    debug("wrapped end");
    if (state2.decoder && !state2.ended) {
      var chunk = state2.decoder.end();
      if (chunk && chunk.length)
        _this.push(chunk);
    }
    _this.push(null);
  });
  stream.on("data", function(chunk) {
    debug("wrapped data");
    if (state2.decoder)
      chunk = state2.decoder.write(chunk);
    if (state2.objectMode && (chunk === null || chunk === void 0))
      return;
    else if (!state2.objectMode && (!chunk || !chunk.length))
      return;
    var ret = _this.push(chunk);
    if (!ret) {
      paused = true;
      stream.pause();
    }
  });
  for (var i in stream) {
    if (this[i] === void 0 && typeof stream[i] === "function") {
      this[i] = function methodWrap(method) {
        return function methodWrapReturnFunction() {
          return stream[method].apply(stream, arguments);
        };
      }(i);
    }
  }
  for (var n = 0; n < kProxyEvents.length; n++) {
    stream.on(kProxyEvents[n], this.emit.bind(this, kProxyEvents[n]));
  }
  this._read = function(n2) {
    debug("wrapped _read", n2);
    if (paused) {
      paused = false;
      stream.resume();
    }
  };
  return this;
};
if (typeof Symbol === "function") {
  Readable.prototype[Symbol.asyncIterator] = function() {
    if (createReadableStreamAsyncIterator$1 === void 0) {
      createReadableStreamAsyncIterator$1 = async_iterator;
    }
    return createReadableStreamAsyncIterator$1(this);
  };
}
Object.defineProperty(Readable.prototype, "readableHighWaterMark", {
  enumerable: false,
  get: function get2() {
    return this._readableState.highWaterMark;
  }
});
Object.defineProperty(Readable.prototype, "readableBuffer", {
  enumerable: false,
  get: function get3() {
    return this._readableState && this._readableState.buffer;
  }
});
Object.defineProperty(Readable.prototype, "readableFlowing", {
  enumerable: false,
  get: function get4() {
    return this._readableState.flowing;
  },
  set: function set2(state2) {
    if (this._readableState) {
      this._readableState.flowing = state2;
    }
  }
});
Readable._fromList = fromList;
Object.defineProperty(Readable.prototype, "readableLength", {
  enumerable: false,
  get: function get5() {
    return this._readableState.length;
  }
});
function fromList(n, state2) {
  if (state2.length === 0)
    return null;
  var ret;
  if (state2.objectMode)
    ret = state2.buffer.shift();
  else if (!n || n >= state2.length) {
    if (state2.decoder)
      ret = state2.buffer.join("");
    else if (state2.buffer.length === 1)
      ret = state2.buffer.first();
    else
      ret = state2.buffer.concat(state2.length);
    state2.buffer.clear();
  } else {
    ret = state2.buffer.consume(n, state2.decoder);
  }
  return ret;
}
function endReadable(stream) {
  var state2 = stream._readableState;
  debug("endReadable", state2.endEmitted);
  if (!state2.endEmitted) {
    state2.ended = true;
    process.nextTick(endReadableNT, state2, stream);
  }
}
function endReadableNT(state2, stream) {
  debug("endReadableNT", state2.endEmitted, state2.length);
  if (!state2.endEmitted && state2.length === 0) {
    state2.endEmitted = true;
    stream.readable = false;
    stream.emit("end");
    if (state2.autoDestroy) {
      var wState = stream._writableState;
      if (!wState || wState.autoDestroy && wState.finished) {
        stream.destroy();
      }
    }
  }
}
if (typeof Symbol === "function") {
  Readable.from = function(iterable, opts) {
    if (from === void 0) {
      from = fromBrowser;
    }
    return from(Readable, iterable, opts);
  };
}
function indexOf(xs, x) {
  for (var i = 0, l = xs.length; i < l; i++) {
    if (xs[i] === x)
      return i;
  }
  return -1;
}
var browser$1 = deprecate;
function deprecate(fn, msg) {
  if (config$1("noDeprecation")) {
    return fn;
  }
  var warned = false;
  function deprecated() {
    if (!warned) {
      if (config$1("throwDeprecation")) {
        throw new Error(msg);
      } else if (config$1("traceDeprecation")) {
        console.trace(msg);
      } else {
        console.warn(msg);
      }
      warned = true;
    }
    return fn.apply(this, arguments);
  }
  return deprecated;
}
function config$1(name) {
  try {
    if (!commonjsGlobal.localStorage)
      return false;
  } catch (_) {
    return false;
  }
  var val = commonjsGlobal.localStorage[name];
  if (null == val)
    return false;
  return String(val).toLowerCase() === "true";
}
_registry.Writable = Writable;
function CorkedRequest(state2) {
  var _this = this;
  this.next = null;
  this.entry = null;
  this.finish = function() {
    onCorkedFinish(_this, state2);
  };
}
Writable.WritableState = WritableState;
var internalUtil = {
  deprecate: browser$1
};
var Buffer$3 = buffer.Buffer;
var OurUint8Array$1 = commonjsGlobal.Uint8Array || function() {
};
function _uint8ArrayToBuffer$1(chunk) {
  return Buffer$3.from(chunk);
}
function _isUint8Array$1(obj) {
  return Buffer$3.isBuffer(obj) || obj instanceof OurUint8Array$1;
}
var getHighWaterMark$2 = state.getHighWaterMark;
var _require$codes$1 = errorsBrowser.codes;
var ERR_INVALID_ARG_TYPE$1 = _require$codes$1.ERR_INVALID_ARG_TYPE;
var ERR_METHOD_NOT_IMPLEMENTED$1 = _require$codes$1.ERR_METHOD_NOT_IMPLEMENTED;
var ERR_MULTIPLE_CALLBACK = _require$codes$1.ERR_MULTIPLE_CALLBACK;
var ERR_STREAM_CANNOT_PIPE = _require$codes$1.ERR_STREAM_CANNOT_PIPE;
var ERR_STREAM_DESTROYED = _require$codes$1.ERR_STREAM_DESTROYED;
var ERR_STREAM_NULL_VALUES = _require$codes$1.ERR_STREAM_NULL_VALUES;
var ERR_STREAM_WRITE_AFTER_END = _require$codes$1.ERR_STREAM_WRITE_AFTER_END;
var ERR_UNKNOWN_ENCODING = _require$codes$1.ERR_UNKNOWN_ENCODING;
var errorOrDestroy$2 = destroy_1.errorOrDestroy;
inherits_browser(Writable, streamBrowser);
function nop() {
}
function WritableState(options, stream, isDuplex) {
  options = options || {};
  if (typeof isDuplex !== "boolean")
    isDuplex = stream instanceof _registry.Duplex;
  this.objectMode = !!options.objectMode;
  if (isDuplex)
    this.objectMode = this.objectMode || !!options.writableObjectMode;
  this.highWaterMark = getHighWaterMark$2(this, options, "writableHighWaterMark", isDuplex);
  this.finalCalled = false;
  this.needDrain = false;
  this.ending = false;
  this.ended = false;
  this.finished = false;
  this.destroyed = false;
  var noDecode = options.decodeStrings === false;
  this.decodeStrings = !noDecode;
  this.defaultEncoding = options.defaultEncoding || "utf8";
  this.length = 0;
  this.writing = false;
  this.corked = 0;
  this.sync = true;
  this.bufferProcessing = false;
  this.onwrite = function(er) {
    onwrite(stream, er);
  };
  this.writecb = null;
  this.writelen = 0;
  this.bufferedRequest = null;
  this.lastBufferedRequest = null;
  this.pendingcb = 0;
  this.prefinished = false;
  this.errorEmitted = false;
  this.emitClose = options.emitClose !== false;
  this.autoDestroy = !!options.autoDestroy;
  this.bufferedRequestCount = 0;
  this.corkedRequestsFree = new CorkedRequest(this);
}
WritableState.prototype.getBuffer = function getBuffer() {
  var current = this.bufferedRequest;
  var out = [];
  while (current) {
    out.push(current);
    current = current.next;
  }
  return out;
};
(function() {
  try {
    Object.defineProperty(WritableState.prototype, "buffer", {
      get: internalUtil.deprecate(function writableStateBufferGetter() {
        return this.getBuffer();
      }, "_writableState.buffer is deprecated. Use _writableState.getBuffer instead.", "DEP0003")
    });
  } catch (_) {
  }
})();
var realHasInstance;
if (typeof Symbol === "function" && Symbol.hasInstance && typeof Function.prototype[Symbol.hasInstance] === "function") {
  realHasInstance = Function.prototype[Symbol.hasInstance];
  Object.defineProperty(Writable, Symbol.hasInstance, {
    value: function value(object) {
      if (realHasInstance.call(this, object))
        return true;
      if (this !== Writable)
        return false;
      return object && object._writableState instanceof WritableState;
    }
  });
} else {
  realHasInstance = function realHasInstance2(object) {
    return object instanceof this;
  };
}
function Writable(options) {
  var isDuplex = this instanceof _registry.Duplex;
  if (!isDuplex && !realHasInstance.call(Writable, this))
    return new Writable(options);
  this._writableState = new WritableState(options, this, isDuplex);
  this.writable = true;
  if (options) {
    if (typeof options.write === "function")
      this._write = options.write;
    if (typeof options.writev === "function")
      this._writev = options.writev;
    if (typeof options.destroy === "function")
      this._destroy = options.destroy;
    if (typeof options.final === "function")
      this._final = options.final;
  }
  streamBrowser.call(this);
}
Writable.prototype.pipe = function() {
  errorOrDestroy$2(this, new ERR_STREAM_CANNOT_PIPE());
};
function writeAfterEnd(stream, cb) {
  var er = new ERR_STREAM_WRITE_AFTER_END();
  errorOrDestroy$2(stream, er);
  process.nextTick(cb, er);
}
function validChunk(stream, state2, chunk, cb) {
  var er;
  if (chunk === null) {
    er = new ERR_STREAM_NULL_VALUES();
  } else if (typeof chunk !== "string" && !state2.objectMode) {
    er = new ERR_INVALID_ARG_TYPE$1("chunk", ["string", "Buffer"], chunk);
  }
  if (er) {
    errorOrDestroy$2(stream, er);
    process.nextTick(cb, er);
    return false;
  }
  return true;
}
Writable.prototype.write = function(chunk, encoding, cb) {
  var state2 = this._writableState;
  var ret = false;
  var isBuf = !state2.objectMode && _isUint8Array$1(chunk);
  if (isBuf && !Buffer$3.isBuffer(chunk)) {
    chunk = _uint8ArrayToBuffer$1(chunk);
  }
  if (typeof encoding === "function") {
    cb = encoding;
    encoding = null;
  }
  if (isBuf)
    encoding = "buffer";
  else if (!encoding)
    encoding = state2.defaultEncoding;
  if (typeof cb !== "function")
    cb = nop;
  if (state2.ending)
    writeAfterEnd(this, cb);
  else if (isBuf || validChunk(this, state2, chunk, cb)) {
    state2.pendingcb++;
    ret = writeOrBuffer(this, state2, isBuf, chunk, encoding, cb);
  }
  return ret;
};
Writable.prototype.cork = function() {
  this._writableState.corked++;
};
Writable.prototype.uncork = function() {
  var state2 = this._writableState;
  if (state2.corked) {
    state2.corked--;
    if (!state2.writing && !state2.corked && !state2.bufferProcessing && state2.bufferedRequest)
      clearBuffer(this, state2);
  }
};
Writable.prototype.setDefaultEncoding = function setDefaultEncoding(encoding) {
  if (typeof encoding === "string")
    encoding = encoding.toLowerCase();
  if (!(["hex", "utf8", "utf-8", "ascii", "binary", "base64", "ucs2", "ucs-2", "utf16le", "utf-16le", "raw"].indexOf((encoding + "").toLowerCase()) > -1))
    throw new ERR_UNKNOWN_ENCODING(encoding);
  this._writableState.defaultEncoding = encoding;
  return this;
};
Object.defineProperty(Writable.prototype, "writableBuffer", {
  enumerable: false,
  get: function get6() {
    return this._writableState && this._writableState.getBuffer();
  }
});
function decodeChunk(state2, chunk, encoding) {
  if (!state2.objectMode && state2.decodeStrings !== false && typeof chunk === "string") {
    chunk = Buffer$3.from(chunk, encoding);
  }
  return chunk;
}
Object.defineProperty(Writable.prototype, "writableHighWaterMark", {
  enumerable: false,
  get: function get7() {
    return this._writableState.highWaterMark;
  }
});
function writeOrBuffer(stream, state2, isBuf, chunk, encoding, cb) {
  if (!isBuf) {
    var newChunk = decodeChunk(state2, chunk, encoding);
    if (chunk !== newChunk) {
      isBuf = true;
      encoding = "buffer";
      chunk = newChunk;
    }
  }
  var len = state2.objectMode ? 1 : chunk.length;
  state2.length += len;
  var ret = state2.length < state2.highWaterMark;
  if (!ret)
    state2.needDrain = true;
  if (state2.writing || state2.corked) {
    var last = state2.lastBufferedRequest;
    state2.lastBufferedRequest = {
      chunk,
      encoding,
      isBuf,
      callback: cb,
      next: null
    };
    if (last) {
      last.next = state2.lastBufferedRequest;
    } else {
      state2.bufferedRequest = state2.lastBufferedRequest;
    }
    state2.bufferedRequestCount += 1;
  } else {
    doWrite(stream, state2, false, len, chunk, encoding, cb);
  }
  return ret;
}
function doWrite(stream, state2, writev, len, chunk, encoding, cb) {
  state2.writelen = len;
  state2.writecb = cb;
  state2.writing = true;
  state2.sync = true;
  if (state2.destroyed)
    state2.onwrite(new ERR_STREAM_DESTROYED("write"));
  else if (writev)
    stream._writev(chunk, state2.onwrite);
  else
    stream._write(chunk, encoding, state2.onwrite);
  state2.sync = false;
}
function onwriteError(stream, state2, sync, er, cb) {
  --state2.pendingcb;
  if (sync) {
    process.nextTick(cb, er);
    process.nextTick(finishMaybe, stream, state2);
    stream._writableState.errorEmitted = true;
    errorOrDestroy$2(stream, er);
  } else {
    cb(er);
    stream._writableState.errorEmitted = true;
    errorOrDestroy$2(stream, er);
    finishMaybe(stream, state2);
  }
}
function onwriteStateUpdate(state2) {
  state2.writing = false;
  state2.writecb = null;
  state2.length -= state2.writelen;
  state2.writelen = 0;
}
function onwrite(stream, er) {
  var state2 = stream._writableState;
  var sync = state2.sync;
  var cb = state2.writecb;
  if (typeof cb !== "function")
    throw new ERR_MULTIPLE_CALLBACK();
  onwriteStateUpdate(state2);
  if (er)
    onwriteError(stream, state2, sync, er, cb);
  else {
    var finished2 = needFinish(state2) || stream.destroyed;
    if (!finished2 && !state2.corked && !state2.bufferProcessing && state2.bufferedRequest) {
      clearBuffer(stream, state2);
    }
    if (sync) {
      process.nextTick(afterWrite, stream, state2, finished2, cb);
    } else {
      afterWrite(stream, state2, finished2, cb);
    }
  }
}
function afterWrite(stream, state2, finished2, cb) {
  if (!finished2)
    onwriteDrain(stream, state2);
  state2.pendingcb--;
  cb();
  finishMaybe(stream, state2);
}
function onwriteDrain(stream, state2) {
  if (state2.length === 0 && state2.needDrain) {
    state2.needDrain = false;
    stream.emit("drain");
  }
}
function clearBuffer(stream, state2) {
  state2.bufferProcessing = true;
  var entry = state2.bufferedRequest;
  if (stream._writev && entry && entry.next) {
    var l = state2.bufferedRequestCount;
    var buffer2 = new Array(l);
    var holder = state2.corkedRequestsFree;
    holder.entry = entry;
    var count = 0;
    var allBuffers = true;
    while (entry) {
      buffer2[count] = entry;
      if (!entry.isBuf)
        allBuffers = false;
      entry = entry.next;
      count += 1;
    }
    buffer2.allBuffers = allBuffers;
    doWrite(stream, state2, true, state2.length, buffer2, "", holder.finish);
    state2.pendingcb++;
    state2.lastBufferedRequest = null;
    if (holder.next) {
      state2.corkedRequestsFree = holder.next;
      holder.next = null;
    } else {
      state2.corkedRequestsFree = new CorkedRequest(state2);
    }
    state2.bufferedRequestCount = 0;
  } else {
    while (entry) {
      var chunk = entry.chunk;
      var encoding = entry.encoding;
      var cb = entry.callback;
      var len = state2.objectMode ? 1 : chunk.length;
      doWrite(stream, state2, false, len, chunk, encoding, cb);
      entry = entry.next;
      state2.bufferedRequestCount--;
      if (state2.writing) {
        break;
      }
    }
    if (entry === null)
      state2.lastBufferedRequest = null;
  }
  state2.bufferedRequest = entry;
  state2.bufferProcessing = false;
}
Writable.prototype._write = function(chunk, encoding, cb) {
  cb(new ERR_METHOD_NOT_IMPLEMENTED$1("_write()"));
};
Writable.prototype._writev = null;
Writable.prototype.end = function(chunk, encoding, cb) {
  var state2 = this._writableState;
  if (typeof chunk === "function") {
    cb = chunk;
    chunk = null;
    encoding = null;
  } else if (typeof encoding === "function") {
    cb = encoding;
    encoding = null;
  }
  if (chunk !== null && chunk !== void 0)
    this.write(chunk, encoding);
  if (state2.corked) {
    state2.corked = 1;
    this.uncork();
  }
  if (!state2.ending)
    endWritable(this, state2, cb);
  return this;
};
Object.defineProperty(Writable.prototype, "writableLength", {
  enumerable: false,
  get: function get8() {
    return this._writableState.length;
  }
});
function needFinish(state2) {
  return state2.ending && state2.length === 0 && state2.bufferedRequest === null && !state2.finished && !state2.writing;
}
function callFinal(stream, state2) {
  stream._final(function(err) {
    state2.pendingcb--;
    if (err) {
      errorOrDestroy$2(stream, err);
    }
    state2.prefinished = true;
    stream.emit("prefinish");
    finishMaybe(stream, state2);
  });
}
function prefinish(stream, state2) {
  if (!state2.prefinished && !state2.finalCalled) {
    if (typeof stream._final === "function" && !state2.destroyed) {
      state2.pendingcb++;
      state2.finalCalled = true;
      process.nextTick(callFinal, stream, state2);
    } else {
      state2.prefinished = true;
      stream.emit("prefinish");
    }
  }
}
function finishMaybe(stream, state2) {
  var need = needFinish(state2);
  if (need) {
    prefinish(stream, state2);
    if (state2.pendingcb === 0) {
      state2.finished = true;
      stream.emit("finish");
      if (state2.autoDestroy) {
        var rState = stream._readableState;
        if (!rState || rState.autoDestroy && rState.endEmitted) {
          stream.destroy();
        }
      }
    }
  }
  return need;
}
function endWritable(stream, state2, cb) {
  state2.ending = true;
  finishMaybe(stream, state2);
  if (cb) {
    if (state2.finished)
      process.nextTick(cb);
    else
      stream.once("finish", cb);
  }
  state2.ended = true;
  stream.writable = false;
}
function onCorkedFinish(corkReq, state2, err) {
  var entry = corkReq.entry;
  corkReq.entry = null;
  while (entry) {
    var cb = entry.callback;
    state2.pendingcb--;
    cb(err);
    entry = entry.next;
  }
  state2.corkedRequestsFree.next = corkReq;
}
Object.defineProperty(Writable.prototype, "destroyed", {
  enumerable: false,
  get: function get9() {
    if (this._writableState === void 0) {
      return false;
    }
    return this._writableState.destroyed;
  },
  set: function set3(value) {
    if (!this._writableState) {
      return;
    }
    this._writableState.destroyed = value;
  }
});
Writable.prototype.destroy = destroy_1.destroy;
Writable.prototype._undestroy = destroy_1.undestroy;
Writable.prototype._destroy = function(err, cb) {
  cb(err);
};
var objectKeys = Object.keys || function(obj) {
  var keys = [];
  for (var key in obj) {
    keys.push(key);
  }
  return keys;
};
_registry.Duplex = Duplex;
inherits_browser(Duplex, _registry.Readable);
{
  keys = objectKeys(_registry.Writable.prototype);
  for (v = 0; v < keys.length; v++) {
    method = keys[v];
    if (!Duplex.prototype[method])
      Duplex.prototype[method] = _registry.Writable.prototype[method];
  }
}
var keys;
var method;
var v;
function Duplex(options) {
  if (!(this instanceof Duplex))
    return new Duplex(options);
  _registry.Readable.call(this, options);
  _registry.Writable.call(this, options);
  this.allowHalfOpen = true;
  if (options) {
    if (options.readable === false)
      this.readable = false;
    if (options.writable === false)
      this.writable = false;
    if (options.allowHalfOpen === false) {
      this.allowHalfOpen = false;
      this.once("end", onend);
    }
  }
}
Object.defineProperty(Duplex.prototype, "writableHighWaterMark", {
  enumerable: false,
  get: function get10() {
    return this._writableState.highWaterMark;
  }
});
Object.defineProperty(Duplex.prototype, "writableBuffer", {
  enumerable: false,
  get: function get11() {
    return this._writableState && this._writableState.getBuffer();
  }
});
Object.defineProperty(Duplex.prototype, "writableLength", {
  enumerable: false,
  get: function get12() {
    return this._writableState.length;
  }
});
function onend() {
  if (this._writableState.ended)
    return;
  process.nextTick(onEndNT, this);
}
function onEndNT(self2) {
  self2.end();
}
Object.defineProperty(Duplex.prototype, "destroyed", {
  enumerable: false,
  get: function get13() {
    if (this._readableState === void 0 || this._writableState === void 0) {
      return false;
    }
    return this._readableState.destroyed && this._writableState.destroyed;
  },
  set: function set4(value) {
    if (this._readableState === void 0 || this._writableState === void 0) {
      return;
    }
    this._readableState.destroyed = value;
    this._writableState.destroyed = value;
  }
});
_registry.Transform = Transform$1;
var _require$codes$2 = errorsBrowser.codes;
var ERR_METHOD_NOT_IMPLEMENTED$2 = _require$codes$2.ERR_METHOD_NOT_IMPLEMENTED;
var ERR_MULTIPLE_CALLBACK$1 = _require$codes$2.ERR_MULTIPLE_CALLBACK;
var ERR_TRANSFORM_ALREADY_TRANSFORMING = _require$codes$2.ERR_TRANSFORM_ALREADY_TRANSFORMING;
var ERR_TRANSFORM_WITH_LENGTH_0 = _require$codes$2.ERR_TRANSFORM_WITH_LENGTH_0;
inherits_browser(Transform$1, _registry.Duplex);
function afterTransform(er, data) {
  var ts = this._transformState;
  ts.transforming = false;
  var cb = ts.writecb;
  if (cb === null) {
    return this.emit("error", new ERR_MULTIPLE_CALLBACK$1());
  }
  ts.writechunk = null;
  ts.writecb = null;
  if (data != null)
    this.push(data);
  cb(er);
  var rs = this._readableState;
  rs.reading = false;
  if (rs.needReadable || rs.length < rs.highWaterMark) {
    this._read(rs.highWaterMark);
  }
}
function Transform$1(options) {
  if (!(this instanceof Transform$1))
    return new Transform$1(options);
  _registry.Duplex.call(this, options);
  this._transformState = {
    afterTransform: afterTransform.bind(this),
    needTransform: false,
    transforming: false,
    writecb: null,
    writechunk: null,
    writeencoding: null
  };
  this._readableState.needReadable = true;
  this._readableState.sync = false;
  if (options) {
    if (typeof options.transform === "function")
      this._transform = options.transform;
    if (typeof options.flush === "function")
      this._flush = options.flush;
  }
  this.on("prefinish", prefinish$1);
}
function prefinish$1() {
  var _this = this;
  if (typeof this._flush === "function" && !this._readableState.destroyed) {
    this._flush(function(er, data) {
      done(_this, er, data);
    });
  } else {
    done(this, null, null);
  }
}
Transform$1.prototype.push = function(chunk, encoding) {
  this._transformState.needTransform = false;
  return _registry.Duplex.prototype.push.call(this, chunk, encoding);
};
Transform$1.prototype._transform = function(chunk, encoding, cb) {
  cb(new ERR_METHOD_NOT_IMPLEMENTED$2("_transform()"));
};
Transform$1.prototype._write = function(chunk, encoding, cb) {
  var ts = this._transformState;
  ts.writecb = cb;
  ts.writechunk = chunk;
  ts.writeencoding = encoding;
  if (!ts.transforming) {
    var rs = this._readableState;
    if (ts.needTransform || rs.needReadable || rs.length < rs.highWaterMark)
      this._read(rs.highWaterMark);
  }
};
Transform$1.prototype._read = function(n) {
  var ts = this._transformState;
  if (ts.writechunk !== null && !ts.transforming) {
    ts.transforming = true;
    this._transform(ts.writechunk, ts.writeencoding, ts.afterTransform);
  } else {
    ts.needTransform = true;
  }
};
Transform$1.prototype._destroy = function(err, cb) {
  _registry.Duplex.prototype._destroy.call(this, err, function(err2) {
    cb(err2);
  });
};
function done(stream, er, data) {
  if (er)
    return stream.emit("error", er);
  if (data != null)
    stream.push(data);
  if (stream._writableState.length)
    throw new ERR_TRANSFORM_WITH_LENGTH_0();
  if (stream._transformState.transforming)
    throw new ERR_TRANSFORM_ALREADY_TRANSFORMING();
  return stream.push(null);
}
_registry.PassThrough = PassThrough;
inherits_browser(PassThrough, _registry.Transform);
function PassThrough(options) {
  if (!(this instanceof PassThrough))
    return new PassThrough(options);
  Transform.call(this, options);
}
PassThrough.prototype._transform = function(chunk, encoding, cb) {
  cb(null, chunk);
};
var eos$1;
function once$2(callback) {
  var called = false;
  return function() {
    if (called)
      return;
    called = true;
    callback.apply(void 0, arguments);
  };
}
var _require$codes$3 = errorsBrowser.codes;
var ERR_MISSING_ARGS = _require$codes$3.ERR_MISSING_ARGS;
var ERR_STREAM_DESTROYED$1 = _require$codes$3.ERR_STREAM_DESTROYED;
function noop$2(err) {
  if (err)
    throw err;
}
function isRequest$1(stream) {
  return stream.setHeader && typeof stream.abort === "function";
}
function destroyer(stream, reading, writing, callback) {
  callback = once$2(callback);
  var closed = false;
  stream.on("close", function() {
    closed = true;
  });
  if (eos$1 === void 0)
    eos$1 = endOfStream;
  eos$1(stream, {
    readable: reading,
    writable: writing
  }, function(err) {
    if (err)
      return callback(err);
    closed = true;
    callback();
  });
  var destroyed = false;
  return function(err) {
    if (closed)
      return;
    if (destroyed)
      return;
    destroyed = true;
    if (isRequest$1(stream))
      return stream.abort();
    if (typeof stream.destroy === "function")
      return stream.destroy();
    callback(err || new ERR_STREAM_DESTROYED$1("pipe"));
  };
}
function call(fn) {
  fn();
}
function pipe(from2, to) {
  return from2.pipe(to);
}
function popCallback(streams) {
  if (!streams.length)
    return noop$2;
  if (typeof streams[streams.length - 1] !== "function")
    return noop$2;
  return streams.pop();
}
function pipeline() {
  for (var _len = arguments.length, streams = new Array(_len), _key = 0; _key < _len; _key++) {
    streams[_key] = arguments[_key];
  }
  var callback = popCallback(streams);
  if (Array.isArray(streams[0]))
    streams = streams[0];
  if (streams.length < 2) {
    throw new ERR_MISSING_ARGS("streams");
  }
  var error;
  var destroys = streams.map(function(stream, i) {
    var reading = i < streams.length - 1;
    var writing = i > 0;
    return destroyer(stream, reading, writing, function(err) {
      if (!error)
        error = err;
      if (err)
        destroys.forEach(call);
      if (reading)
        return;
      destroys.forEach(call);
      callback(error);
    });
  });
  return streams.reduce(pipe);
}
var pipeline_1 = pipeline;
var readableBrowser = createCommonjsModule(function(module, exports) {
  exports = module.exports = _registry.Readable;
  exports.Stream = _registry.Readable;
  exports.Readable = _registry.Readable;
  exports.Writable = _registry.Writable;
  exports.Duplex = _registry.Duplex;
  exports.Transform = _registry.Transform;
  exports.PassThrough = _registry.PassThrough;
  exports.finished = endOfStream;
  exports.pipeline = pipeline_1;
});
var Duplex$1 = readableBrowser.Duplex;
var PassThrough$1 = readableBrowser.PassThrough;
var Readable$1 = readableBrowser.Readable;
var Stream = readableBrowser.Stream;
var Transform$2 = readableBrowser.Transform;
var Writable$1 = readableBrowser.Writable;
var finished = readableBrowser.finished;
var pipeline$1 = readableBrowser.pipeline;

// src/index.ts
var src_default = { Readable: Readable$1, Writable: Writable$1, Duplex: Duplex$1, Transform: Transform$2, PassThrough: PassThrough$1, finished, pipeline: pipeline$1, Stream };
export {
  Duplex$1 as Duplex,
  PassThrough$1 as PassThrough,
  Readable$1 as Readable,
  Stream,
  Transform$2 as Transform,
  Writable$1 as Writable,
  src_default as default,
  finished,
  pipeline$1 as pipeline
};
/*! safe-buffer. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
//# sourceMappingURL=index.mjs.map
