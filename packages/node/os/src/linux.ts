// Reference: Node.js lib/os.js — Linux-specific os module helpers
// Reimplemented for GJS using GLib

import GLib from '@girs/glib-2.0';
import { createSubnet } from './createSubnet.js';
import { cli } from '@gjsify/utils';

const byteArray = imports.byteArray;
const EOL = /\r\n|\n/;

/**
 * Read a text file directly via GLib (no subprocess).
 */
function readTextFile(path: string): string {
    const [ok, contents] = GLib.file_get_contents(path);
    if (!ok || !contents) return '';
    return byteArray.toString(contents);
}

const getIPv4Subnet = createSubnet(32, 8, 10, '.');
const getIPv6Subnet = createSubnet(128, 16, 16, ':');

function parseInterfaces(info) {
  info = info.trim();
  if (info.length < 1) return;
  let iface = [], mac;
  for (let
    line,
    lines = info.split(EOL),
    i = 0; i < lines.length; i++
  ) {
    line = lines[i];
    switch (true) {
      case /link\/\S+\s+((?:\S{2}:)+\S{2})/.test(line):
        mac = RegExp.$1;
        break;
      case /inet(\d*)\s+(\S+)/.test(line):
        let
          ip = RegExp.$2.split('/'),
          v = RegExp.$1 || '4'
        ;
        iface.push({
          address: ip[0],
          netmask: (v === '4' ? getIPv4Subnet : getIPv6Subnet)(ip[1]),
          family: 'IPv' + v,
          mac: mac,
          internal: ip[0] === '127.0.0.1'
        });
        break;
    }
  }
  if (mac) this[info.slice(0, info.indexOf(':'))] = iface;
};

// CPU info from /proc/cpuinfo (model, speed) and /proc/stat (times)
export const cpus = () => {
  const PROCESSOR = /^processor\s*:\s*(\d+)/i;
  const NAME = /^model[\s_]+name\s*:([^\r\n]+)/i;
  const FREQ = /^cpu[\s_]+MHz\s*:\s*(\d+)/i;
  type CpuInfo = { model: string; speed: number; times: { user: number; nice: number; sys: number; idle: number; irq: number } };
  const result: CpuInfo[] = [];
  let cpu: CpuInfo;

  // Parse model and speed from /proc/cpuinfo
  cli('cat /proc/cpuinfo').split(EOL).forEach(line => {
    switch (true) {
      case PROCESSOR.test(line):
        result[RegExp.$1.trim() as unknown as number] = (cpu = {
          model: '', speed: 0,
          times: { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 },
        });
        break;
      case NAME.test(line):
        cpu.model = RegExp.$1.trim();
        break;
      case FREQ.test(line):
        cpu.speed = parseFloat(RegExp.$1.trim());
        break;
    }
  });

  // Parse CPU times from /proc/stat (jiffies to ms: 1 jiffy = 10ms)
  try {
    const statLines = cli('cat /proc/stat').split(EOL);
    for (const line of statLines) {
      const m = /^cpu(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+\s+(\d+)/.exec(line);
      if (m && result[parseInt(m[1], 10)]) {
        result[parseInt(m[1], 10)].times = {
          user: parseInt(m[2], 10) * 10,
          nice: parseInt(m[3], 10) * 10,
          sys:  parseInt(m[4], 10) * 10,
          idle: parseInt(m[5], 10) * 10,
          irq:  parseInt(m[6], 10) * 10,
        };
      }
    }
  } catch { /* /proc/stat unavailable */ }

  return result;
};

export const endianness = () => 'LE';

// Read /proc/meminfo directly (no dependency on `free` command)
export const freemem = () => {
  const content = readTextFile('/proc/meminfo');
  // Node.js (libuv) uses MemAvailable, falls back to MemFree
  let memFree = 0;
  for (const line of content.split('\n')) {
    const available = /^MemAvailable:\s+(\d+)\s+kB/.exec(line);
    if (available) return parseInt(available[1], 10) * 1024;
    const free = /^MemFree:\s+(\d+)\s+kB/.exec(line);
    if (free) memFree = parseInt(free[1], 10) * 1024;
  }
  return memFree;
};

// PORTED TO deno runtime
export const loadavg = () =>
  /(\d+(?:\.\d+))\s+(\d+(?:\.\d+))\s+(\d+(?:\.\d+))/.test(
    cli('cat /proc/loadavg')
  ) && [
    parseFloat(RegExp.$1),
    parseFloat(RegExp.$2),
    parseFloat(RegExp.$3)
  ];

export const networkInterfaces = () => {
  // Try `ip addr` first, fall back to procfs/sysfs if not available
  try {
    const ifaces = {};
    cli('ip addr').split(/^\d+:\s+/m).forEach(parseInterfaces, ifaces);
    return ifaces;
  } catch {
    return readNetworkInterfacesFromProc();
  }
};

/**
 * Fallback: read network interface data from procfs/sysfs when `ip` is unavailable.
 * Provides interface names + MACs from sysfs, IPv6 from /proc/net/if_inet6,
 * and loopback IPv4 (127.0.0.1). Other IPv4 addresses require `ip` or `ifconfig`.
 */
function readNetworkInterfacesFromProc(): Record<string, unknown[]> {
  const ifaces: Record<string, unknown[]> = {};
  const macs: Record<string, string> = {};

  // Read interface names from /proc/net/dev (always available)
  try {
    const netDev = readTextFile('/proc/net/dev');
    for (const line of netDev.split('\n').slice(2)) {
      const name = line.split(':')[0]?.trim();
      if (!name) continue;
      ifaces[name] = [];
      try {
        macs[name] = readTextFile(`/sys/class/net/${name}/address`).trim();
      } catch {
        macs[name] = '00:00:00:00:00:00';
      }
    }
  } catch { return ifaces; }

  // Read IPv6 addresses from /proc/net/if_inet6 (includes interface name)
  try {
    const inet6 = readTextFile('/proc/net/if_inet6');
    for (const line of inet6.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 6) continue;
      const [addrHex, , prefixLen, , , devName] = parts;
      const groups = addrHex.match(/.{4}/g);
      if (!groups || !ifaces[devName]) continue;
      ifaces[devName].push({
        address: groups.join(':'),
        netmask: getIPv6Subnet(prefixLen),
        family: 'IPv6',
        mac: macs[devName] || '00:00:00:00:00:00',
        internal: devName === 'lo',
      });
    }
  } catch { /* /proc/net/if_inet6 unavailable */ }

  // Loopback always has 127.0.0.1
  if (ifaces['lo']) {
    ifaces['lo'].unshift({
      address: '127.0.0.1',
      netmask: '255.0.0.0',
      family: 'IPv4',
      mac: macs['lo'] || '00:00:00:00:00:00',
      internal: true,
    });
  }

  // Remove interfaces with no addresses
  for (const name of Object.keys(ifaces)) {
    if (ifaces[name].length === 0) delete ifaces[name];
  }

  return ifaces;
}

// Read /proc/meminfo directly (no dependency on `free` command)
export const totalmem = () => {
  const content = readTextFile('/proc/meminfo');
  for (const line of content.split('\n')) {
    const match = /^MemTotal:\s+(\d+)\s+kB/.exec(line);
    if (match) return parseInt(match[1], 10) * 1024;
  }
  return 0;
};

export const uptime = () => {
  const content = cli('cat /proc/uptime').trim();
  return parseFloat(content.split(' ')[0]) || 0;
};

