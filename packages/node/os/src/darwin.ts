import { createSubnet } from './createSubnet.js';
import { cli } from '@gjsify/utils';

const EOL = /\r\n|\n/;
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

// PORTED TO deno runtime
export const freemem = () =>  parseFloat(cli('sysctl -n hw.memsize')) -
                      parseFloat(cli('sysctl -n hw.physmem'));

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
  const lines = cli('ifconfig').split(EOL);
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
    groups.push(group.join(EOL as any)); // TODO check this
  }
  groups.forEach(parseInterfaces, ifaces);
  return ifaces;
};

// PORTED TO deno runtime
export const totalmem = () => {
  let I: number, mem = cli('free -b').split(EOL);
  mem[0].split(/\s+/).some((info, i) => info === 'total' && (I = i));
  return parseFloat(mem[1].split(/\s+/)[I + 1]);
};

// PORTED TO deno runtime
export const uptime = () => {
  const uptime = cli('uptime');
  const up = /up\s+([^,]+)?,/.test(uptime) && RegExp.$1;
  switch (true) {
    case /^(\d+):(\d+)$/.test(up):
      return ((parseInt(RegExp.$1, 10) * 60) + parseInt(RegExp.$2, 10)) * 60;
    case /^(\d+)\s+mins?$/.test(up):
      return parseInt(RegExp.$1, 10) * 60;
    case /^(\d+)\s+days?$/.test(up):
      return (parseInt(RegExp.$1, 10) * 86400) + (
        /days?,\s+^(\d+):(\d+)$/.test(uptime) && (
          ((parseInt(RegExp.$1, 10) * 60) +
          parseInt(RegExp.$2, 10)) * 60
        )
      );
  }
  return up;
};
