import { createSubnet } from './createSubnet.js';
import { cli } from '@gjsify/utils';

const EOL = /\r\n|\n/;

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

// PORTED TO deno runtime
export const freemem = () => {
  let I, mem = cli('free -b').split(EOL);
  mem[0].split(/\s+/).some((info, i) => info === 'free' && (I = i));
  return parseFloat(mem[1].split(/\s+/)[I + 1]);
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
  const ifaces = {};
  cli('ip addr').split(/^\d+:\s+/m).forEach(parseInterfaces, ifaces);
  return ifaces;
};

// PORTED TO deno runtime
export const totalmem = () => {
  let I, mem = cli('free -b').split(EOL);
  mem[0].split(/\s+/).some((info, i) => info === 'total' && (I = i));
  return parseFloat(mem[1].split(/\s+/)[I + 1]);
};

export const uptime = () => {
  const content = cli('cat /proc/uptime').trim();
  return parseFloat(content.split(' ')[0]) || 0;
};

