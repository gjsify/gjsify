// Node.js dns/promises module for GJS
// Promise-based versions of dns functions

import { lookup as _lookup, resolve4 as _resolve4, resolve6 as _resolve6, reverse as _reverse, resolve as _resolve } from './index.js';
import type { LookupOptions, LookupAddress } from './index.js';

export function lookup(hostname: string, options?: LookupOptions | number): Promise<LookupAddress | LookupAddress[]> {
  return new Promise((resolve, reject) => {
    _lookup(hostname, options as any, (err: any, address: any, family: any) => {
      if (err) return reject(err);
      if (Array.isArray(address)) {
        resolve(address);
      } else {
        resolve({ address, family: family as 4 | 6 });
      }
    });
  });
}

export function resolve4(hostname: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    _resolve4(hostname, (err, addresses) => {
      if (err) return reject(err);
      resolve(addresses);
    });
  });
}

export function resolve6(hostname: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    _resolve6(hostname, (err, addresses) => {
      if (err) return reject(err);
      resolve(addresses);
    });
  });
}

export function reverse(ip: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    _reverse(ip, (err, hostnames) => {
      if (err) return reject(err);
      resolve(hostnames);
    });
  });
}

export function resolve(hostname: string, rrtype?: string): Promise<any[]> {
  return new Promise((res, reject) => {
    if (rrtype) {
      _resolve(hostname, rrtype, (err: any, records: any) => {
        if (err) return reject(err);
        res(records);
      });
    } else {
      _resolve(hostname, (err: any, records: any) => {
        if (err) return reject(err);
        res(records);
      });
    }
  });
}

export default { lookup, resolve, resolve4, resolve6, reverse };
