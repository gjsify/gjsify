// Reference: Node.js lib/dns.js
// Reimplemented for GJS using Gio.Resolver

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { createNodeError } from '@gjsify/utils';
import type { ErrnoException } from '@gjsify/utils';
import { isIP } from 'net';

// Error codes
export const NODATA = 'ENODATA';
export const FORMERR = 'EFORMERR';
export const SERVFAIL = 'ESERVFAIL';
export const NOTFOUND = 'ENOTFOUND';
export const NOTIMP = 'ENOTIMP';
export const REFUSED = 'EREFUSED';
export const BADQUERY = 'EBADQUERY';
export const BADNAME = 'EBADNAME';
export const BADFAMILY = 'EBADFAMILY';
export const BADRESP = 'EBADRESP';
export const CONNREFUSED = 'ECONNREFUSED';
export const TIMEOUT = 'ETIMEOUT';
export const EOF = 'EOF';
export const FILE = 'EFILE';
export const NOMEM = 'ENOMEM';
export const DESTRUCTION = 'EDESTRUCTION';
export const BADSTR = 'EBADSTR';
export const BADFLAGS = 'EBADFLAGS';
export const NONAME = 'ENONAME';
export const BADHINTS = 'EBADHINTS';
export const NOTINITIALIZED = 'ENOTINITIALIZED';
export const LOADIPHLPAPI = 'ELOADIPHLPAPI';
export const ADDRGETNETWORKPARAMS = 'EADDRGETNETWORKPARAMS';
export const CANCELLED = 'ECANCELLED';

export interface LookupOptions {
  family?: 0 | 4 | 6;
  hints?: number;
  all?: boolean;
  verbatim?: boolean;
}

export interface LookupAddress {
  address: string;
  family: 4 | 6;
}

function createDnsError(hostname: string, syscall: string, _err?: unknown): ErrnoException {
  const code = NOTFOUND;
  const message = `${syscall} ${code} ${hostname}`;
  const error = new Error(message) as ErrnoException;
  error.code = code;
  error.syscall = syscall;
  error.hostname = hostname;
  error.errno = undefined;
  return error;
}

/**
 * Resolve a hostname to an IP address using the system DNS resolver.
 */
export function lookup(
  hostname: string,
  options: LookupOptions | number | null | undefined,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
): void;
export function lookup(
  hostname: string,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
): void;
export function lookup(
  hostname: string,
  ...args: [LookupOptions | number | null | undefined, Function] | [Function]
): void {
  let options: LookupOptions = {};
  let callback: Function;

  if (typeof args[0] === 'function') {
    callback = args[0];
  } else {
    if (typeof args[0] === 'number') {
      options = { family: args[0] as 0 | 4 | 6 };
    } else if (args[0]) {
      options = args[0];
    }
    callback = args[1];
  }

  // Handle empty hostname — Node.js returns null for address
  if (!hostname) {
    const family = options.family || 4;
    callback(null, null as unknown as string, family);
    return;
  }

  // Handle IP addresses directly (no DNS needed)
  const ipVersion = isIP(hostname);
  if (ipVersion) {
    callback(null, hostname, ipVersion);
    return;
  }

  const resolver = Gio.Resolver.get_default();

  resolver.lookup_by_name_async(
    hostname,
    null, // cancellable
    (_source: Gio.Resolver | null, asyncResult: Gio.AsyncResult) => {
      try {
        const addresses = resolver.lookup_by_name_finish(asyncResult);

        if (!addresses || addresses.length === 0) {
          callback(createDnsError(hostname, 'getaddrinfo'), '', 0);
          return;
        }

        // Filter by family if requested
        const family = options.family || 0;
        let results: Gio.InetAddress[] = [];

        for (const addr of addresses) {
          const addrFamily = addr.get_family();
          if (family === 0 ||
              (family === 4 && addrFamily === Gio.SocketFamily.IPV4) ||
              (family === 6 && addrFamily === Gio.SocketFamily.IPV6)) {
            results.push(addr);
          }
        }

        if (results.length === 0) {
          // Fall back to any available if no match for requested family
          results = Array.from(addresses);
        }

        if (options.all) {
          const allAddresses: LookupAddress[] = results.map((addr) => ({
            address: addr.to_string(),
            family: addr.get_family() === Gio.SocketFamily.IPV6 ? 6 as const : 4 as const,
          }));
          (callback as any)(null, allAddresses);
        } else {
          const first = results[0];
          const addrStr = first.to_string();
          const addrFamily = first.get_family() === Gio.SocketFamily.IPV6 ? 6 : 4;
          callback(null, addrStr, addrFamily);
        }
      } catch (_err: unknown) {
        callback(createDnsError(hostname, 'getaddrinfo'), '', 0);
      }
    },
  );
}

/**
 * Resolve a hostname to an array of IPv4 addresses.
 */
export function resolve4(hostname: string, callback: (err: NodeJS.ErrnoException | null, addresses: string[]) => void): void {
  lookup(hostname, { family: 4, all: true }, (err, addresses) => {
    if (err) {
      callback(err, []);
      return;
    }
    callback(null, (addresses as unknown as LookupAddress[]).map((a) => a.address));
  });
}

/**
 * Resolve a hostname to an array of IPv6 addresses.
 */
export function resolve6(hostname: string, callback: (err: NodeJS.ErrnoException | null, addresses: string[]) => void): void {
  lookup(hostname, { family: 6, all: true }, (err, addresses) => {
    if (err) {
      callback(err, []);
      return;
    }
    callback(null, (addresses as unknown as LookupAddress[]).map((a) => a.address));
  });
}

/**
 * Reverse DNS lookup.
 */
export function reverse(ip: string, callback: (err: NodeJS.ErrnoException | null, hostnames: string[]) => void): void {
  const resolver = Gio.Resolver.get_default();
  const addr = Gio.InetAddress.new_from_string(ip);

  if (!addr) {
    const err = new Error(`Invalid IP address: ${ip}`) as NodeJS.ErrnoException;
    err.code = 'ERR_INVALID_ARG_VALUE';
    callback(err, []);
    return;
  }

  resolver.lookup_by_address_async(
    addr,
    null,
    (_source: Gio.Resolver | null, asyncResult: Gio.AsyncResult) => {
      try {
        const hostname = resolver.lookup_by_address_finish(asyncResult);
        callback(null, hostname ? [hostname] : []);
      } catch (_err: unknown) {
        callback(createDnsError(ip, 'getnameinfo'), []);
      }
    },
  );
}

/**
 * Resolve hostname using specified record type.
 */
export function resolve(hostname: string, rrtype: string, callback: (err: NodeJS.ErrnoException | null, records: unknown[]) => void): void;
export function resolve(hostname: string, callback: (err: NodeJS.ErrnoException | null, records: string[]) => void): void;
export function resolve(hostname: string, ...args: [string, Function] | [Function]): void {
  let rrtype = 'A';
  let callback: Function;

  if (typeof args[0] === 'function') {
    callback = args[0];
  } else {
    rrtype = args[0];
    callback = args[1];
  }

  switch (rrtype.toUpperCase()) {
    case 'A':
      resolve4(hostname, callback as (err: NodeJS.ErrnoException | null, addresses: string[]) => void);
      break;
    case 'AAAA':
      resolve6(hostname, callback as (err: NodeJS.ErrnoException | null, addresses: string[]) => void);
      break;
    default:
      // For other record types (MX, TXT, SRV, etc.), use Gio.Resolver.lookup_records
      _resolveRecords(hostname, rrtype, callback);
  }
}

function _resolveRecords(hostname: string, rrtype: string, callback: Function): void {
  const resolver = Gio.Resolver.get_default();

  const recordTypeMap: Record<string, Gio.ResolverRecordType> = {
    SRV: Gio.ResolverRecordType.SRV,
    MX: Gio.ResolverRecordType.MX,
    TXT: Gio.ResolverRecordType.TXT,
    SOA: Gio.ResolverRecordType.SOA,
    NS: Gio.ResolverRecordType.NS,
  };

  const gioType = recordTypeMap[rrtype.toUpperCase()];
  if (!gioType) {
    const err = new Error(`Unknown record type: ${rrtype}`) as NodeJS.ErrnoException;
    err.code = 'ERR_INVALID_ARG_VALUE';
    callback(err, []);
    return;
  }

  resolver.lookup_records_async(
    hostname,
    gioType,
    null,
    (_source: Gio.Resolver | null, asyncResult: Gio.AsyncResult) => {
      try {
        const records = resolver.lookup_records_finish(asyncResult);
        // Records are GLib.Variant arrays — convert to JS
        const results = records.map((r: GLib.Variant) => r.deep_unpack());
        callback(null, results as unknown[]);
      } catch (_err: unknown) {
        callback(createDnsError(hostname, 'queryDns'), []);
      }
    },
  );
}

// Default result order
let _defaultResultOrder: 'ipv4first' | 'verbatim' = 'verbatim';

export function setDefaultResultOrder(order: 'ipv4first' | 'verbatim'): void {
  _defaultResultOrder = order;
}

export function getDefaultResultOrder(): string {
  return _defaultResultOrder;
}

export default {
  lookup,
  resolve,
  resolve4,
  resolve6,
  reverse,
  setDefaultResultOrder,
  getDefaultResultOrder,
  NODATA,
  FORMERR,
  SERVFAIL,
  NOTFOUND,
  NOTIMP,
  REFUSED,
  BADQUERY,
  BADNAME,
  BADFAMILY,
  BADRESP,
  CONNREFUSED,
  TIMEOUT,
  EOF,
  FILE,
  NOMEM,
  DESTRUCTION,
  BADSTR,
  BADFLAGS,
  NONAME,
  BADHINTS,
  NOTINITIALIZED,
  CANCELLED,
};
