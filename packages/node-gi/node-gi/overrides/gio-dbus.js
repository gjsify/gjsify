// SPDX-License-Identifier: MIT OR LGPL-2.0-or-later
// SPDX-FileCopyrightText: 2011 Giovanni Campagna
//
// Adapted from GJS (refs/gjs/modules/core/overrides/Gio.js). Copyright (c) 2011
// Giovanni Campagna and GJS contributors. MIT OR LGPL-2.0-or-later.
// Modifications: the DBus surface (Gio.DBus.session/system, own_name/watch_name,
// Gio.DBusProxy.makeProxyWrapper) ported to the @gjsify/node-gi L1 model.
//
// The upstream override patches `Gio.DBusProxy.prototype` and returns a class
// extending Gio.DBusProxy. node-gi instances are Proxies over a native GObject
// handle (no live prototype to patch, and an unknown property READ returns a GI
// method thunk rather than `undefined`), so this port instead:
//   • builds each proxy's convenience methods/properties as own expandos on the
//     instance (node-gi's set trap stores them; the get trap surfaces them),
//   • hosts the `_signals` mixin on a DEDICATED plain emitter object per proxy
//     (the mixin's `this._signalConnections === undefined` bootstrap can't run on
//     an instance wrapper — see above), exposed as `connectSignal`/`disconnectSignal`,
//   • drives name owning via org.freedesktop.DBus RequestName/ReleaseName and name
//     watching via NameOwnerChanged `signal_subscribe` — the node-gi engine can
//     marshal a GDBusSignalCallback and a GSourceFunc (idle), but NOT the
//     GBusAcquiredCallback/GBusNameAppearedCallback that g_bus_own_name/watch_name
//     take, so those namespace functions are re-implemented in JS here.
//
// Object export (Gio.DBusExportedObject.wrapJSObject): GJS builds it on
// GjsPrivate.DBusImplementation (a C type absent on a plain Node/GI host); node-gi
// drives the INTROSPECTABLE g_dbus_connection_register_object_with_closures2
// instead — three GClosures (method call / get property / set property) the engine
// now marshals from JS functions. See wrapJSObject at the bottom of this module.
import { addSignalMethods, _connect, _disconnect, _emit } from './_signals.js';

// The `_signals` mixin's error paths (a throwing handler / a method-name clash)
// reference the GJS ambient `log`/`logError`. Under a bare `@gjsify/node-gi/gi`
// consumer (no globals.js) those may be absent — install minimal fallbacks so the
// mixin never ReferenceErrors. Idempotent; globals.js's richer versions win if
// already present.
function ensureAmbientLog() {
  const g = globalThis;
  if (typeof g.log === 'undefined') g.log = (...args) => console.error(args.map((a) => String(a)).join(' '));
  if (typeof g.logError === 'undefined') {
    g.logError = (error, prefix) => {
      const head = prefix ? `${prefix}: ` : '';
      console.error(head + (error && error.stack ? error.stack : String(error)));
    };
  }
}

/**
 * Build the L1 DBus surface bound to a set of node-gi primitives.
 * @param {object} ctx
 * @param {Record<string, unknown>} ctx.Gio the INTROSPECTED Gio namespace (constructible classes + namespace functions)
 * @param {Record<string, unknown>} ctx.GLib the ergonomic GLib namespace (`new GLib.Variant(...)`, idle_add)
 * @param {(fn: Function, ...args: unknown[]) => void} ctx.unwrap gi.js's `unwrap` (wrapped instance → native handle)
 * @param {typeof import('../index.js')} ctx.native the native engine (isInstanceOf)
 * @returns {{ DBus: object, DBusProxy: object, DBusExportedObject: object }}
 */
export function createGioDBus(ctx) {
  const { Gio, GLib, unwrap, native } = ctx;
  // Scoped to actual DBus usage (first Gio.DBus* access), so a plain non-DBus
  // `import { requireGi }` adds no global side effects.
  ensureAmbientLog();

  // DBus RequestName reply codes (org.freedesktop.DBus).
  const REQUEST_NAME_PRIMARY_OWNER = 1;
  const REQUEST_NAME_ALREADY_OWNER = 4;
  const DBUS_NAME = 'org.freedesktop.DBus';
  const DBUS_PATH = '/org/freedesktop/DBus';

  function safeCallback(fn, ...args) {
    try {
      fn(...args);
    } catch (e) {
      logError(e, 'Exception in DBus name callback');
    }
  }

  // Is `value` a wrapped node-gi instance of Gio.<typeName>? Used to classify the
  // trailing flags/Cancellable/UnixFDList args a proxy method call may carry.
  function isGioInstance(value, typeName) {
    if (value === null || typeof value !== 'object') return false;
    const handle = unwrap(value);
    if (handle === value) return false; // not a wrapped instance
    try {
      return native.isInstanceOf(handle, 'Gio', typeName);
    } catch {
      return false;
    }
  }

  function _logReply(result, exc) {
    if (exc !== null && exc !== undefined) log(`Ignored exception from dbus method: ${exc}`);
  }

  // Ported from refs/gjs Gio.js `_proxyInvoker`. `wrappedProxy` is captured (GJS
  // uses `this`) because node-gi delivers a RAW source handle to the async ready
  // callback, so the wrapper must come from the closure to reach the L1 finish.
  function _proxyInvoker(wrappedProxy, methodName, sync, inSignature, args) {
    let replyFunc = _logReply;
    let flags = 0;
    let cancellable = null;
    let fdList = null;
    const argArray = Array.prototype.slice.call(args);

    const signatureLength = inSignature.length;
    const minNumberArgs = signatureLength;
    const maxNumberArgs = signatureLength + 4;
    if (argArray.length < minNumberArgs) {
      throw new Error(
        `Not enough arguments passed for method: ${methodName}. Expected ${minNumberArgs}, got ${argArray.length}`,
      );
    } else if (argArray.length > maxNumberArgs) {
      throw new Error(
        `Too many arguments passed for method ${methodName}. Maximum is ${maxNumberArgs} ` +
          'including one callback, Gio.Cancellable, Gio.UnixFDList, and/or flags',
      );
    }

    while (argArray.length > signatureLength) {
      const argNum = argArray.length - 1;
      const arg = argArray.pop();
      if (typeof arg === 'function' && !sync) replyFunc = arg;
      else if (typeof arg === 'number') flags = arg;
      else if (isGioInstance(arg, 'Cancellable')) cancellable = arg;
      else if (isGioInstance(arg, 'UnixFDList')) fdList = arg;
      else {
        throw new Error(
          `Argument ${argNum} of method ${methodName} is ${typeof arg}. It should be a callback, ` +
            'flags, Gio.UnixFDList, or a Gio.Cancellable',
        );
      }
    }

    const inTypeString = `(${inSignature.join('')})`;
    const inVariant = new GLib.Variant(inTypeString, argArray);

    if (sync) {
      const result = wrappedProxy.call_with_unix_fd_list_sync(methodName, inVariant, flags, -1, fdList, cancellable);
      const outVariant = Array.isArray(result) ? result[0] : result;
      const outFdList = Array.isArray(result) ? result[1] : null;
      if (fdList) return [outVariant.deepUnpack(), outFdList];
      return outVariant.deepUnpack();
    }

    const asyncCallback = (_rawSource, res) => {
      try {
        const result = wrappedProxy.call_with_unix_fd_list_finish(res);
        const outVariant = Array.isArray(result) ? result[0] : result;
        const outFdList = Array.isArray(result) ? result[1] : null;
        replyFunc(outVariant.deepUnpack(), null, outFdList);
      } catch (e) {
        replyFunc([], e, null);
      }
    };
    return wrappedProxy.call_with_unix_fd_list(methodName, inVariant, flags, -1, fdList, cancellable, asyncCallback);
  }

  function _makeProxyMethod(wrappedProxy, method, sync) {
    const name = method.name;
    const inArgs = method.in_args;
    const inSignature = [];
    for (let i = 0; i < inArgs.length; i++) inSignature.push(inArgs[i].signature);
    return function proxyMethod(...args) {
      return _proxyInvoker(wrappedProxy, name, sync, inSignature, args);
    };
  }

  function _propertyGetter(wrappedProxy, name) {
    const value = wrappedProxy.get_cached_property(name);
    return value ? value.deepUnpack() : null;
  }

  function _propertySetter(wrappedProxy, name, signature, value) {
    const variant = new GLib.Variant(signature, value);
    wrappedProxy.set_cached_property(name, variant);
    wrappedProxy.call(
      'org.freedesktop.DBus.Properties.Set',
      new GLib.Variant('(ssv)', [wrappedProxy.g_interface_name, name, variant]),
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      (_rawSource, res) => {
        try {
          wrappedProxy.call_finish(res);
        } catch (e) {
          log(`Could not set property ${name} on remote object ${wrappedProxy.g_object_path}: ${e.message}`);
        }
      },
    );
  }

  // Attach the method/property/signal convenience to a freshly-inited DBusProxy
  // instance wrapper. Ported from refs/gjs Gio.js `_addDBusConvenience`.
  function _addDBusConvenience(wrappedProxy, info) {
    // The `_signals` mixin bookkeeping lives on a dedicated plain emitter (see the
    // module header): connectSignal/disconnectSignal delegate to it.
    const emitter = {};
    addSignalMethods(emitter);
    wrappedProxy.connectSignal = (name, callback) => _connect.call(emitter, name, callback);
    wrappedProxy.disconnectSignal = (id) => _disconnect.call(emitter, id);

    const signals = info.signals;
    if (signals && signals.length > 0) {
      wrappedProxy.connect('g-signal', (_proxy, senderName, signalName, parameters) => {
        _emit.call(emitter, signalName, senderName, parameters.deepUnpack());
      });
    }

    const methods = info.methods;
    for (let i = 0; i < methods.length; i++) {
      const method = methods[i];
      const name = method.name;
      const remoteMethod = _makeProxyMethod(wrappedProxy, method, false);
      wrappedProxy[`${name}Remote`] = remoteMethod;
      wrappedProxy[`${name}Sync`] = _makeProxyMethod(wrappedProxy, method, true);
      wrappedProxy[`${name}Async`] = function proxyAsyncMethod(...args) {
        return new Promise((resolve, reject) => {
          args.push((result, error, fdList) => {
            if (error) reject(error);
            else if (fdList) resolve([result, fdList]);
            else resolve(result);
          });
          remoteMethod(...args);
        });
      };
    }

    const properties = info.properties;
    for (let i = 0; i < properties.length; i++) {
      const propInfo = properties[i];
      const name = propInfo.name;
      const signature = propInfo.signature;
      const propFlags = propInfo.flags;
      let getter = () => {
        throw new Error(`Property ${name} is not readable`);
      };
      let setter = () => {
        throw new Error(`Property ${name} is not writable`);
      };
      if (propFlags & Gio.DBusPropertyInfoFlags.READABLE) getter = () => _propertyGetter(wrappedProxy, name);
      if (propFlags & Gio.DBusPropertyInfoFlags.WRITABLE) {
        setter = (value) => _propertySetter(wrappedProxy, name, signature, value);
      }
      Object.defineProperty(wrappedProxy, name, {
        get: getter,
        set: setter,
        configurable: false,
        enumerable: true,
      });
    }
  }

  function _newInterfaceInfo(xml) {
    const nodeInfo = Gio.DBusNodeInfo.new_for_xml(xml);
    return nodeInfo.interfaces[0];
  }

  // Gio.DBusProxy.makeProxyWrapper(interfaceXml). Returns a constructor:
  //   new ProxyClass(bus, name, objectPath[, asyncCallback[, cancellable[, flags]]])
  // and a static `ProxyClass.newAsync(bus, name, objectPath[, cancellable[, flags]])`.
  function makeProxyWrapper(interfaceXml) {
    const info = _newInterfaceInfo(interfaceXml);
    const iname = info.name;

    function ProxyClass(bus, name, object, asyncCallback, cancellable = null, flags = Gio.DBusProxyFlags.NONE) {
      const obj = new Gio.DBusProxy({
        g_connection: bus,
        g_interface_name: iname,
        g_interface_info: info,
        g_name: name,
        g_flags: flags,
        g_object_path: object,
      });

      if (asyncCallback) {
        obj.init_async(GLib.PRIORITY_DEFAULT, cancellable, (_rawSource, res) => {
          try {
            obj.init_finish(res);
            _addDBusConvenience(obj, info);
            asyncCallback(obj, null);
          } catch (e) {
            asyncCallback(null, e);
          }
        });
      } else {
        obj.init(cancellable);
        _addDBusConvenience(obj, info);
      }
      return obj;
    }

    ProxyClass.newAsync = function newAsync(bus, name, object, cancellable = null, flags = Gio.DBusProxyFlags.NONE) {
      const obj = new Gio.DBusProxy({
        g_connection: bus,
        g_interface_name: info.name,
        g_interface_info: info,
        g_name: name,
        g_flags: flags,
        g_object_path: object,
      });
      return new Promise((resolve, reject) => {
        obj.init_async(GLib.PRIORITY_DEFAULT, cancellable, (_rawSource, res) => {
          try {
            obj.init_finish(res);
            _addDBusConvenience(obj, info);
            resolve(obj);
          } catch (e) {
            reject(e);
          }
        });
      });
    };

    return ProxyClass;
  }

  // ---- name owning ----
  const ownedNames = new Map();
  const watchedNames = new Map();
  let nextToken = 1;

  function busConnection(busType) {
    return Gio.bus_get_sync(busType, null);
  }

  function requestName(connection, name, flags) {
    const reply = connection.call_sync(
      DBUS_NAME,
      DBUS_PATH,
      DBUS_NAME,
      'RequestName',
      new GLib.Variant('(su)', [name, flags >>> 0]),
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null,
    );
    return reply.deepUnpack()[0];
  }

  function ownNameCore(connection, name, flags, onBusAcquired, onNameAcquired, onNameLost) {
    const token = nextToken++;
    ownedNames.set(token, { connection, name });
    let code;
    try {
      code = requestName(connection, name, flags);
    } catch (e) {
      ownedNames.delete(token);
      throw e;
    }
    // GJS fires the acquired/lost callbacks from the main loop, never synchronously.
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      if (typeof onBusAcquired === 'function') safeCallback(onBusAcquired, connection, name);
      const acquired = code === REQUEST_NAME_PRIMARY_OWNER || code === REQUEST_NAME_ALREADY_OWNER;
      if (acquired) {
        if (typeof onNameAcquired === 'function') safeCallback(onNameAcquired, connection, name);
      } else if (typeof onNameLost === 'function') {
        safeCallback(onNameLost, connection, name);
      }
      return false; // G_SOURCE_REMOVE
    });
    return token;
  }

  function own_name(busType, name, flags, onBusAcquired, onNameAcquired, onNameLost) {
    return ownNameCore(busConnection(busType), name, flags, onBusAcquired, onNameAcquired, onNameLost);
  }

  function own_name_on_connection(connection, name, flags, onNameAcquired, onNameLost) {
    return ownNameCore(connection, name, flags, undefined, onNameAcquired, onNameLost);
  }

  function unown_name(token) {
    const entry = ownedNames.get(token);
    if (!entry) return;
    ownedNames.delete(token);
    try {
      entry.connection.call_sync(
        DBUS_NAME,
        DBUS_PATH,
        DBUS_NAME,
        'ReleaseName',
        new GLib.Variant('(s)', [entry.name]),
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
      );
    } catch {
      /* connection already gone — nothing to release */
    }
  }

  // ---- name watching (NameOwnerChanged subscription + GetNameOwner probe) ----
  function getNameOwner(connection, name) {
    try {
      const reply = connection.call_sync(
        DBUS_NAME,
        DBUS_PATH,
        DBUS_NAME,
        'GetNameOwner',
        new GLib.Variant('(s)', [name]),
        null,
        Gio.DBusCallFlags.NONE,
        -1,
        null,
      );
      return reply.deepUnpack()[0];
    } catch {
      return null; // NameHasNoOwner
    }
  }

  function watchNameCore(connection, name, onNameAppeared, onNameVanished) {
    const token = nextToken++;
    let lastOwner = null;

    const dispatch = () => {
      const owner = getNameOwner(connection, name);
      if (owner && owner.length > 0) {
        if (owner !== lastOwner && typeof onNameAppeared === 'function') safeCallback(onNameAppeared, connection, name, owner);
        lastOwner = owner;
      } else {
        if (lastOwner !== null && typeof onNameVanished === 'function') safeCallback(onNameVanished, connection, name);
        lastOwner = null;
      }
    };

    // arg0-filtered subscription: NameOwnerChanged whose first arg is `name`.
    const subId = connection.signal_subscribe(
      DBUS_NAME,
      DBUS_NAME,
      'NameOwnerChanged',
      DBUS_PATH,
      name,
      Gio.DBusSignalFlags.NONE,
      () => dispatch(),
    );
    watchedNames.set(token, { connection, subId });

    // Initial state, delivered from the loop like g_bus_watch_name's GetNameOwner.
    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      const owner = getNameOwner(connection, name);
      if (owner && owner.length > 0) {
        lastOwner = owner;
        if (typeof onNameAppeared === 'function') safeCallback(onNameAppeared, connection, name, owner);
      } else if (typeof onNameVanished === 'function') {
        safeCallback(onNameVanished, connection, name);
      }
      return false; // G_SOURCE_REMOVE
    });
    return token;
  }

  function watch_name(busType, name, _flags, onNameAppeared, onNameVanished) {
    return watchNameCore(busConnection(busType), name, onNameAppeared, onNameVanished);
  }

  function watch_name_on_connection(connection, name, _flags, onNameAppeared, onNameVanished) {
    return watchNameCore(connection, name, onNameAppeared, onNameVanished);
  }

  function unwatch_name(token) {
    const entry = watchedNames.get(token);
    if (!entry) return;
    watchedNames.delete(token);
    try {
      entry.connection.signal_unsubscribe(entry.subId);
    } catch {
      /* connection already gone */
    }
  }

  // ---- Gio.DBus namespace ----
  const DBus = {
    get: Gio.bus_get,
    get_finish: Gio.bus_get_finish,
    get_sync: Gio.bus_get_sync,
    own_name,
    own_name_on_connection,
    unown_name,
    watch_name,
    watch_name_on_connection,
    unwatch_name,
  };
  Object.defineProperty(DBus, 'session', {
    get() {
      return Gio.bus_get_sync(Gio.BusType.SESSION, null);
    },
    enumerable: false,
  });
  Object.defineProperty(DBus, 'system', {
    get() {
      return Gio.bus_get_sync(Gio.BusType.SYSTEM, null);
    },
    enumerable: false,
  });

  // ---- Gio.DBusProxy (adds the static makeProxyWrapper to the introspected class) ----
  const DBusProxy = new Proxy(Gio.DBusProxy, {
    get(target, prop) {
      if (prop === 'makeProxyWrapper') return makeProxyWrapper;
      return target[prop];
    },
    has(target, prop) {
      return prop === 'makeProxyWrapper' || prop in target;
    },
  });

  // ---- Gio.DBusExportedObject (export side) ---------------------------------
  //
  // Ported from refs/gjs Gio.js (_wrapJSObject + _handleMethodCall /
  // _handlePropertyGet / _handlePropertySet). GJS builds this on the C type
  // GjsPrivate.DBusImplementation (a GObject with handle-method-call /
  // handle-property-get / handle-property-set signals); node-gi has no such type,
  // so it instead drives the INTROSPECTABLE
  // g_dbus_connection_register_object_with_closures2 — three GClosures whose
  // marshal the engine now supports. The closure param shapes match glib's
  // register_with_closures_on_* trampolines (gio/gdbusconnection.c):
  //   method_call: (conn, sender, path, iface, method, params:Variant, invocation)
  //   get_property: (conn, sender, path, iface, prop) -> Variant|null
  //   set_property: (conn, sender, path, iface, prop, value:Variant) -> boolean
  // Ownership: register_object_data_new refs+sinks its own copy of each closure
  // and frees them on unregister_object, so the JS handler (and everything it
  // captures) lives exactly as long as the registration. The closures2 variant
  // does NOT transfer the invocation ref to the closure — the engine's
  // transfer-full-instance handling refs the invocation before a return_* call,
  // matching gjs's introspection-annotation-driven behaviour.

  function _makeOutSignature(args) {
    let ret = '(';
    for (let i = 0; i < args.length; i++) ret += args[i].signature;
    return `${ret})`;
  }

  function _handleDBusReply(invocation, ret) {
    if (ret === undefined) ret = new GLib.Variant('()', []);
    try {
      if (!(ret instanceof GLib.Variant)) {
        const outArgs = invocation.get_method_info().out_args;
        const outSignature = _makeOutSignature(outArgs);
        if (outArgs.length === 1) ret = [ret];
        ret = new GLib.Variant(outSignature, ret);
      }
      invocation.return_value(ret);
    } catch (e) {
      logError(e, `Exception in method call: ${invocation.get_method_name()}`);
      invocation.return_dbus_error(
        'org.gnome.gjs.JSError.ValueError',
        'Service implementation returned an incorrect value type',
      );
    }
  }

  function _handleDBusError(invocation, e) {
    if (e instanceof GLib.Error) {
      invocation.return_gerror(e);
      return;
    }
    let name = e && e.name ? e.name : 'Error';
    if (!name.includes('.')) name = `org.gnome.gjs.JSError.${name}`;
    logError(e, `Exception in method call: ${invocation.get_method_name()}`);
    invocation.return_dbus_error(name, e && e.message ? e.message : String(e));
  }

  function _handleMethodCall(jsObj, methodName, parameters, invocation) {
    const method = jsObj[methodName];
    if (typeof method === 'function') {
      let retval;
      try {
        const args = parameters.deepUnpack();
        retval = method.apply(jsObj, args);
      } catch (e) {
        _handleDBusError(invocation, e);
        return;
      }
      // A Promise-returning (async) method resolves to the reply.
      if (retval && typeof retval.then === 'function') {
        retval.then(
          (r) => _handleDBusReply(invocation, r),
          (e) => _handleDBusError(invocation, e),
        );
        return;
      }
      _handleDBusReply(invocation, retval);
      return;
    }

    const asyncMethod = jsObj[`${methodName}Async`];
    if (typeof asyncMethod === 'function') {
      let ret;
      try {
        ret = asyncMethod.call(jsObj, parameters.deepUnpack(), invocation);
      } catch (e) {
        _handleDBusError(invocation, e);
        return;
      }
      if (ret && typeof ret.catch === 'function') ret.catch((e) => _handleDBusError(invocation, e));
      return;
    }

    logError(new Error(), `Missing handler for DBus method ${methodName}`);
    invocation.return_dbus_error(
      'org.freedesktop.DBus.Error.UnknownMethod',
      `Method ${methodName} is not implemented`,
    );
  }

  function _handlePropertyGet(jsObj, info, propertyName) {
    const propInfo = info.lookup_property(propertyName);
    const jsval = jsObj[propertyName];
    if (jsval === undefined || jsval === null) return null;
    if (jsval instanceof GLib.Variant) return jsval;
    return new GLib.Variant(propInfo.signature, jsval);
  }

  function _handlePropertySet(jsObj, propertyName, newValue) {
    jsObj[propertyName] = newValue.deepUnpack();
    return true;
  }

  function wrapJSObject(interfaceInfo, jsObj) {
    let info;
    if (isGioInstance(interfaceInfo, 'DBusInterfaceInfo')) info = interfaceInfo;
    else info = _newInterfaceInfo(interfaceInfo);
    // cache_build is required so lookup_property/method work off the info.
    info.cache_build();
    const ifaceName = info.name;

    // Every connection this object is exported on: { connection, registrationId }.
    const registrations = [];

    const impl = {
      get_info: () => info,
      get_object_path: () => impl._objectPath,
      get_connection: () => impl._connection,
      _objectPath: null,
      _connection: null,

      export(connection, path) {
        // register_object_with_closures2 (since 2.84): closures for method call /
        // get property / set property. Passing JS functions marshals each to a
        // real GClosure (the engine's GClosure IN-arg support). Returns the
        // registration id (throws on error).
        const id = connection.register_object_with_closures2(
          path,
          info,
          (_conn, _sender, _path, _iface, method, params, invocation) =>
            _handleMethodCall(jsObj, method, params, invocation),
          (_conn, _sender, _path, _iface, prop) => _handlePropertyGet(jsObj, info, prop),
          (_conn, _sender, _path, _iface, prop, value) => _handlePropertySet(jsObj, prop, value),
        );
        registrations.push({ connection, id });
        impl._connection = connection;
        impl._objectPath = path;
        return id;
      },

      unexport() {
        for (const { connection, id } of registrations.splice(0)) {
          connection.unregister_object(id);
        }
        impl._connection = null;
      },

      unexport_from_connection(connection) {
        const handle = unwrap(connection);
        for (let i = registrations.length - 1; i >= 0; i--) {
          if (unwrap(registrations[i].connection) === handle) {
            registrations[i].connection.unregister_object(registrations[i].id);
            registrations.splice(i, 1);
          }
        }
        if (registrations.length === 0) impl._connection = null;
      },

      emit_signal(name, parameters = null) {
        for (const { connection } of registrations) {
          connection.emit_signal(null, impl._objectPath, ifaceName, name, parameters);
        }
      },

      emit_property_changed(name, value) {
        const changed = {};
        changed[name] = value;
        const params = new GLib.Variant('(sa{sv}as)', [ifaceName, changed, []]);
        for (const { connection } of registrations) {
          connection.emit_signal(
            null,
            impl._objectPath,
            'org.freedesktop.DBus.Properties',
            'PropertiesChanged',
            params,
          );
        }
      },

      flush() {
        for (const { connection } of registrations) connection.flush(null);
      },
    };
    // camelCase aliases (GJS's DBusImplementation exposes snake_case; keep both
    // so either spelling works, matching the rest of the node-gi surface).
    impl.getInfo = impl.get_info;
    impl.getObjectPath = impl.get_object_path;
    impl.getConnection = impl.get_connection;
    impl.unexportFromConnection = impl.unexport_from_connection;
    impl.emitSignal = impl.emit_signal;
    impl.emitPropertyChanged = impl.emit_property_changed;
    return impl;
  }

  const DBusExportedObject = { wrapJSObject };

  return { DBus, DBusProxy, DBusExportedObject };
}

export default createGioDBus;
