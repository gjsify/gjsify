// Copyright 2018-2022 the Deno authors. All rights reserved. MIT license.
// Based on https://raw.githubusercontent.com/denoland/deno/main/runtime/js/10_permissions.js
"use strict";

import { primordials } from '../../core/00_primordials.js';
import * as ops from '../../ops/index.js';
import { illegalConstructorKey } from './01_web_util.js';
import { pathFromURL } from './06_util.js';
import { Event, EventTarget } from '../../ext/web/02_event.js';

import type { PermissionDescriptor, PermissionState, PermissionOptions } from '../../types/index.js';

const {
  ArrayIsArray,
  ArrayPrototypeIncludes,
  ArrayPrototypeMap,
  ArrayPrototypeSlice,
  Map,
  MapPrototypeGet,
  MapPrototypeHas,
  MapPrototypeSet,
  FunctionPrototypeCall,
  PromiseResolve,
  PromiseReject,
  ReflectHas,
  SymbolFor,
  TypeError,
} = primordials;

interface StatusCacheValue {
  state: PermissionState;
  status: PermissionStatus;
}

/** @type {ReadonlyArray<"read" | "write" | "net" | "env" | "sys" | "run" | "ffi" | "hrtime">} */
const permissionNames = [
  "read",
  "write",
  "net",
  "env",
  "sys",
  "run",
  "ffi",
  "hrtime",
];

function opQuery(desc: PermissionDescriptor): PermissionState {
  return ops.op_query_permission(desc);
}

function opRevoke(desc: PermissionDescriptor): PermissionState {
  return ops.op_revoke_permission(desc);
}

function opRequest(desc: PermissionDescriptor): PermissionState {
  return ops.op_request_permission(desc);
}

export class PermissionStatus extends EventTarget {
  #state: { state: PermissionState };

  onchange: ((this: PermissionStatus, event: Event) => any) | null = null;

  get state(): PermissionState {
    return this.#state.state;
  }

  constructor(state: { state: PermissionState } | null = null, key: unknown | null = null) {
    if (key != illegalConstructorKey) {
      throw new TypeError("Illegal constructor.");
    }
    super();
    this.#state = state;
  }

  dispatchEvent(event: Event): boolean {
    let dispatched = super.dispatchEvent(event);
    if (dispatched && this.onchange) {
      FunctionPrototypeCall(this.onchange, this, event);
      dispatched = !event.defaultPrevented;
    }
    return dispatched;
  }

  [SymbolFor("Deno.privateCustomInspect")](inspect) {
    return `${this.constructor.name} ${
      inspect({ state: this.state, onchange: this.onchange })
    }`;
  }
}

const statusCache: Map<string, StatusCacheValue> = new Map();

function cache(desc: PermissionDescriptor, state: PermissionState): PermissionStatus {
  let { name: key } = desc;
  if (
    (desc.name === "read" || desc.name === "write" || desc.name === "ffi") &&
    ReflectHas(desc, "path")
  ) {
    key += `-${desc.path}&`;
  } else if (desc.name === "net" && desc.host) {
    key += `-${desc.host}&`;
  } else if (desc.name === "run" && desc.command) {
    key += `-${desc.command}&`;
  } else if (desc.name === "env" && desc.variable) {
    key += `-${desc.variable}&`;
  } else if (desc.name === "sys" && desc.kind) {
    key += `-${desc.kind}&`;
  } else {
    key += "$";
  }
  if (MapPrototypeHas(statusCache, key)) {
    const status = MapPrototypeGet(statusCache, key);
    if (status.state !== state) {
      status.state = state;
      status.status.dispatchEvent(new Event("change", { cancelable: false }));
    }
    return status.status;
  }
  const status: { state: PermissionState; status?: PermissionStatus } = { state };
  status.status = new PermissionStatus(status, illegalConstructorKey);
  MapPrototypeSet(statusCache, key, status);
  return status.status;
}

function isValidDescriptor(desc: unknown): desc is PermissionDescriptor {
  return typeof desc === "object" && desc !== null &&
    ArrayPrototypeIncludes(permissionNames, (desc as any).name);
}

export class Permissions {
  constructor(key = null) {
    if (key != illegalConstructorKey) {
      throw new TypeError("Illegal constructor.");
    }
  }

  query(desc: { name: string}) {
    if (!isValidDescriptor(desc)) {
      return PromiseReject(
        new TypeError(
          `The provided value "${desc?.name}" is not a valid permission name.`,
        ),
      );
    }

    if (
      desc.name === "read" || desc.name === "write" || desc.name === "ffi"
    ) {
      desc.path = pathFromURL(desc.path);
    } else if (desc.name === "run") {
      desc.command = pathFromURL(desc.command);
    }

    const state = opQuery(desc);
    return PromiseResolve(cache(desc, state));
  }

  revoke(desc) {
    if (!isValidDescriptor(desc)) {
      return PromiseReject(
        new TypeError(
          `The provided value "${desc?.name}" is not a valid permission name.`,
        ),
      );
    }

    if (desc.name === "read" || desc.name === "write") {
      desc.path = pathFromURL(desc.path);
    } else if (desc.name === "run") {
      desc.command = pathFromURL(desc.command);
    }

    const state = opRevoke(desc);
    return PromiseResolve(cache(desc, state));
  }

  request(desc) {
    if (!isValidDescriptor(desc)) {
      return PromiseReject(
        new TypeError(
          `The provided value "${desc?.name}" is not a valid permission name.`,
        ),
      );
    }

    if (desc.name === "read" || desc.name === "write") {
      desc.path = pathFromURL(desc.path);
    } else if (desc.name === "run") {
      desc.command = pathFromURL(desc.command);
    }

    const state = opRequest(desc);
    return PromiseResolve(cache(desc, state));
  }
}

export const permissions = new Permissions(illegalConstructorKey);

/** Converts all file URLs in FS allowlists to paths. */
export function serializePermissions(permissions: PermissionOptions) {
  if (typeof permissions == "object" && permissions != null) {
    const serializedPermissions = {};
    for (const key of ["read", "write", "run", "ffi"]) {
      if (ArrayIsArray(permissions[key])) {
        serializedPermissions[key] = ArrayPrototypeMap(
          permissions[key],
          (path) => pathFromURL(path),
        );
      } else {
        serializedPermissions[key] = permissions[key];
      }
    }
    for (const key of ["env", "hrtime", "net", "sys"]) {
      if (ArrayIsArray(permissions[key])) {
        serializedPermissions[key] = ArrayPrototypeSlice(permissions[key]);
      } else {
        serializedPermissions[key] = permissions[key];
      }
    }
    return serializedPermissions;
  }
  return permissions;
}


