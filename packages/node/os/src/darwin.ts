// Reference: Node.js lib/os.js — macOS-specific os module helpers
// Reimplemented for GJS using GLib

import { createSubnet } from './createSubnet.js';
import { cli } from '@gjsify/utils';

const NOMAC = '00:00:00:00:00:00';

const getIPv6Subnet = createSubnet(128, 16, 16, ':');

const parseInterfaces = function(info) {
  info = info.trim();
  if (info.length < 1 || !/\binet\b/.test(info)) return;
  const lines = info.split('\n');
  const iface = [];
  const length = lines.length;
  let mac = NOMAC;
  for (let line, i = 0; i < length; i++) {
    line = lines[i];
    switch (true) {
      case /ether\s+((?:\S{2}:)+\S{2})/.test(line):
        mac = RegExp.$1;
        break;
      case /inet\s+(\d+\.\d+\.\d+\.\d+)\s+netmask\s+0x(.{2})(.{2})(.{2})(.{2})/.test(line):
        iface.push({
          address: RegExp.$1,
          netmask: [
            parseInt(RegExp.$2, 16),
            parseInt(RegExp.$3, 16),
            parseInt(RegExp.$4, 16),
            parseInt(RegExp.$5, 16)
          ].join('.'),
          family: 'IPv4',
          mac: mac,
          internal: RegExp.$1 === '127.0.0.1'
        });
        break;
      case /inet6\s+((?:\S{0,4}:)+\S{1,4}).+?prefixlen\s+(\d+)/.test(line):
        iface.push({
          address: RegExp.$1,
          netmask: getIPv6Subnet(RegExp.$2),
          family: 'IPv6',
          mac: mac,
          internal: mac !== NOMAC
        });
        break;
    }
  }
  this[info.slice(0, info.indexOf(':'))] = iface;
};

// PORTED TO deno runtime
export const cpus = () => {
  let cores = parseFloat(cli('sysctl -n hw.ncpu'));
  const cpus = [];
  while (cores--) {
    cpus.push({
      model: cli('sysctl -n machdep.cpu.brand_string').replace(/\s+/g, ' '),
      speed: parseFloat(cli('sysctl -n hw.cpufrequency')) / 1000 / 1000,
      get times() {
        console.warn('cpus.times is not supported');
        return {};
      }
    });
  }
  return cpus;
};

export const endianness = () => 'LE';

/**
 * Get free memory on macOS using vm_stat.
 * vm_stat reports memory pages; multiply by page size to get bytes.
 * "free" pages + "speculative" pages approximate available memory.
 * Falls back to (hw.memsize - hw.physmem) if vm_stat is unavailable.
 */
export const freemem = () => {
  try {
    const vmstat = cli('vm_stat');
    // Parse page size from first line: "Mach Virtual Memory Statistics: (page size of 16384 bytes)"
    const pageSizeMatch = /page size of (\d+) bytes/.exec(vmstat);
    const pageSize = pageSizeMatch ? parseInt(pageSizeMatch[1], 10) : 16384;

    // Parse "Pages free" and "Pages speculative" (inactive can be reclaimed too)
    let freePages = 0;
    const freeMatch = /Pages free:\s+(\d+)/.exec(vmstat);
    if (freeMatch) freePages += parseInt(freeMatch[1], 10);

    // "Pages speculative" are also considered free/available
    const specMatch = /Pages speculative:\s+(\d+)/.exec(vmstat);
    if (specMatch) freePages += parseInt(specMatch[1], 10);

    // Include purgeable pages as available (can be reclaimed)
    const purgeMatch = /Pages purgeable:\s+(\d+)/.exec(vmstat);
    if (purgeMatch) freePages += parseInt(purgeMatch[1], 10);

    if (freePages > 0) return freePages * pageSize;
  } catch {
    // vm_stat not available, fall back
  }

  // Fallback: difference between hw.memsize and hw.physmem
  // (not accurate but better than 0)
  try {
    return parseFloat(cli('sysctl -n hw.memsize')) -
           parseFloat(cli('sysctl -n hw.physmem'));
  } catch {
    return 0;
  }
};

// PORTED TO deno runtime
export const loadavg = () => /load\s+averages:\s+(\d+(?:\.\d+))\s+(\d+(?:\.\d+))\s+(\d+(?:\.\d+))/.test(
    cli('uptime')
  ) && [
    parseFloat(RegExp.$1),
    parseFloat(RegExp.$2),
    parseFloat(RegExp.$3)
  ];

export const networkInterfaces = () => {
  const ifaces = {};
  const groups = [];
  const lines = cli('ifconfig').split(/\r\n|\n/);
  const length = lines.length;
  for (let
    group = [],
    re = /^\S+?:/,
    i = 0;
    i < length; i++
  ) {
    if (re.test(lines[i])) {
      group = [lines[i]];
      while (++i < length && !re.test(lines[i])) {
        group.push(lines[i]);
      }
      --i;
    }
    groups.push(group.join('\n'));
  }
  groups.forEach(parseInterfaces, ifaces);
  return ifaces;
};

/**
 * Get total memory on macOS using sysctl hw.memsize.
 */
export const totalmem = () => {
  try {
    return parseFloat(cli('sysctl -n hw.memsize'));
  } catch {
    return 0;
  }
};

// PORTED TO deno runtime
export const uptime = () => {
  // Try sysctl kern.boottime first (most reliable)
  try {
    const boottime = cli('sysctl -n kern.boottime');
    // Format: "{ sec = 1711234567, usec = 123456 } Mon Mar 25 ..."
    const secMatch = /sec\s*=\s*(\d+)/.exec(boottime);
    if (secMatch) {
      const bootSec = parseInt(secMatch[1], 10);
      const nowSec = Math.floor(Date.now() / 1000);
      return nowSec - bootSec;
    }
  } catch {
    // fall through
  }

  // Fallback: parse uptime command output
  const output = cli('uptime');
  const up = /up\s+([^,]+)?,/.test(output) && RegExp.$1;
  switch (true) {
    case /^(\d+):(\d+)$/.test(up as string):
      return ((parseInt(RegExp.$1, 10) * 60) + parseInt(RegExp.$2, 10)) * 60;
    case /^(\d+)\s+mins?$/.test(up as string):
      return parseInt(RegExp.$1, 10) * 60;
    case /^(\d+)\s+days?$/.test(up as string): {
      const days = parseInt(RegExp.$1, 10) * 86400;
      // Check for "N days, HH:MM" format
      const timeMatch = /days?,\s+(\d+):(\d+)/.exec(output);
      if (timeMatch) {
        return days + ((parseInt(timeMatch[1], 10) * 60) + parseInt(timeMatch[2], 10)) * 60;
      }
      return days;
    }
  }
  return 0;
};
