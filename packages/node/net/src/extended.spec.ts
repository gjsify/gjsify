// Extended net tests — isIP edge cases, Socket/Server properties, createConnection
// Ported from refs/node-test/parallel/test-net-*.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import * as net from 'node:net';

export default async () => {

  // ===================== isIP comprehensive =====================
  await describe('net.isIP comprehensive', async () => {
    // Valid IPv4
    await it('should return 4 for 0.0.0.0', async () => {
      expect(net.isIP('0.0.0.0')).toBe(4);
    });
    await it('should return 4 for 255.255.255.255', async () => {
      expect(net.isIP('255.255.255.255')).toBe(4);
    });
    await it('should return 4 for 192.168.1.1', async () => {
      expect(net.isIP('192.168.1.1')).toBe(4);
    });
    await it('should return 4 for 10.0.0.1', async () => {
      expect(net.isIP('10.0.0.1')).toBe(4);
    });
    await it('should return 4 for 1.1.1.1', async () => {
      expect(net.isIP('1.1.1.1')).toBe(4);
    });

    // Invalid IPv4
    await it('should return 0 for 256.0.0.1', async () => {
      expect(net.isIP('256.0.0.1')).toBe(0);
    });
    await it('should return 0 for 1.2.3', async () => {
      expect(net.isIP('1.2.3')).toBe(0);
    });
    await it('should return 0 for 1.2.3.4.5', async () => {
      expect(net.isIP('1.2.3.4.5')).toBe(0);
    });
    await it('should return 0 for leading zeros in IPv4', async () => {
      expect(net.isIP('01.02.03.04')).toBe(0);
    });
    await it('should return 0 for negative octets', async () => {
      expect(net.isIP('-1.0.0.0')).toBe(0);
    });
    await it('should return 0 for empty octets', async () => {
      expect(net.isIP('1..3.4')).toBe(0);
    });

    // Valid IPv6
    await it('should return 6 for ::1', async () => {
      expect(net.isIP('::1')).toBe(6);
    });
    await it('should return 6 for ::', async () => {
      expect(net.isIP('::')).toBe(6);
    });
    await it('should return 6 for full IPv6', async () => {
      expect(net.isIP('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(6);
    });
    await it('should return 6 for compressed IPv6', async () => {
      expect(net.isIP('2001:db8::1')).toBe(6);
    });
    await it('should return 6 for fe80::1', async () => {
      expect(net.isIP('fe80::1')).toBe(6);
    });
    await it('should return 6 for IPv4-mapped IPv6', async () => {
      expect(net.isIP('::ffff:192.168.1.1')).toBe(6);
    });
    await it('should return 6 for loopback full', async () => {
      expect(net.isIP('0000:0000:0000:0000:0000:0000:0000:0001')).toBe(6);
    });

    // Invalid IPv6
    await it('should return 0 for triple colon', async () => {
      expect(net.isIP(':::1')).toBe(0);
    });
    await it('should return 0 for too many groups', async () => {
      expect(net.isIP('1:2:3:4:5:6:7:8:9')).toBe(0);
    });

    // Non-IP strings
    await it('should return 0 for empty string', async () => {
      expect(net.isIP('')).toBe(0);
    });
    await it('should return 0 for hostname', async () => {
      expect(net.isIP('example.com')).toBe(0);
    });
    await it('should return 0 for random text', async () => {
      expect(net.isIP('not an ip')).toBe(0);
    });
    await it('should return 0 for number input', async () => {
      expect(net.isIP(123 as any)).toBe(0);
    });
    await it('should return 0 for null', async () => {
      expect(net.isIP(null as any)).toBe(0);
    });
    await it('should return 0 for undefined', async () => {
      expect(net.isIP(undefined as any)).toBe(0);
    });
    await it('should return 0 for boolean', async () => {
      expect(net.isIP(true as any)).toBe(0);
    });
  });

  // ===================== isIPv4 comprehensive =====================
  await describe('net.isIPv4 comprehensive', async () => {
    await it('should return true for valid IPv4', async () => {
      expect(net.isIPv4('127.0.0.1')).toBe(true);
      expect(net.isIPv4('0.0.0.0')).toBe(true);
      expect(net.isIPv4('255.255.255.255')).toBe(true);
    });
    await it('should return false for IPv6', async () => {
      expect(net.isIPv4('::1')).toBe(false);
      expect(net.isIPv4('::')).toBe(false);
    });
    await it('should return false for invalid', async () => {
      expect(net.isIPv4('256.0.0.1')).toBe(false);
      expect(net.isIPv4('')).toBe(false);
      expect(net.isIPv4('hello')).toBe(false);
    });
    await it('should return false for non-string', async () => {
      expect(net.isIPv4(null as any)).toBe(false);
      expect(net.isIPv4(undefined as any)).toBe(false);
      expect(net.isIPv4(42 as any)).toBe(false);
    });
  });

  // ===================== isIPv6 comprehensive =====================
  await describe('net.isIPv6 comprehensive', async () => {
    await it('should return true for valid IPv6', async () => {
      expect(net.isIPv6('::1')).toBe(true);
      expect(net.isIPv6('::')).toBe(true);
      expect(net.isIPv6('fe80::1')).toBe(true);
      expect(net.isIPv6('2001:db8::1')).toBe(true);
    });
    await it('should return false for IPv4', async () => {
      expect(net.isIPv6('127.0.0.1')).toBe(false);
      expect(net.isIPv6('0.0.0.0')).toBe(false);
    });
    await it('should return false for invalid', async () => {
      expect(net.isIPv6(':::1')).toBe(false);
      expect(net.isIPv6('')).toBe(false);
      expect(net.isIPv6('hello')).toBe(false);
    });
    await it('should return false for non-string', async () => {
      expect(net.isIPv6(null as any)).toBe(false);
      expect(net.isIPv6(undefined as any)).toBe(false);
    });
  });

  // ===================== Socket extended =====================
  await describe('net.Socket extended', async () => {
    await it('should be constructable without args', async () => {
      const socket = new net.Socket();
      expect(socket).toBeDefined();
    });

    await it('should have Duplex stream methods', async () => {
      const socket = new net.Socket();
      expect(typeof socket.write).toBe('function');
      expect(typeof socket.end).toBe('function');
      expect(typeof socket.destroy).toBe('function');
      expect(typeof socket.pipe).toBe('function');
    });

    await it('should have EventEmitter methods', async () => {
      const socket = new net.Socket();
      expect(typeof socket.on).toBe('function');
      expect(typeof socket.emit).toBe('function');
      expect(typeof socket.once).toBe('function');
      expect(typeof socket.removeListener).toBe('function');
      expect(typeof socket.removeAllListeners).toBe('function');
    });

    await it('bytesRead should default to 0', async () => {
      const socket = new net.Socket();
      expect(socket.bytesRead).toBe(0);
    });

    await it('bytesWritten should default to 0', async () => {
      const socket = new net.Socket();
      expect(socket.bytesWritten).toBe(0);
    });

    await it('connecting should be false initially', async () => {
      const socket = new net.Socket();
      expect(socket.connecting).toBe(false);
    });

    await it('pending should be true initially', async () => {
      const socket = new net.Socket();
      expect(socket.pending).toBe(true);
    });

    await it('destroyed should be false initially', async () => {
      const socket = new net.Socket();
      expect(socket.destroyed).toBe(false);
    });

    await it('should have setTimeout method', async () => {
      const socket = new net.Socket();
      expect(typeof socket.setTimeout).toBe('function');
    });

    await it('should have setKeepAlive method', async () => {
      const socket = new net.Socket();
      expect(typeof socket.setKeepAlive).toBe('function');
    });

    await it('should have setNoDelay method', async () => {
      const socket = new net.Socket();
      expect(typeof socket.setNoDelay).toBe('function');
    });

    await it('should have ref/unref methods', async () => {
      const socket = new net.Socket();
      expect(typeof socket.ref).toBe('function');
      expect(typeof socket.unref).toBe('function');
    });

    await it('should have connect method', async () => {
      const socket = new net.Socket();
      expect(typeof socket.connect).toBe('function');
    });

    await it('should have address method', async () => {
      const socket = new net.Socket();
      expect(typeof socket.address).toBe('function');
    });

    await it('remoteAddress should be undefined when not connected', async () => {
      const socket = new net.Socket();
      expect(socket.remoteAddress).toBeUndefined();
    });

    await it('remotePort should be undefined when not connected', async () => {
      const socket = new net.Socket();
      expect(socket.remotePort).toBeUndefined();
    });

    await it('remoteFamily should be undefined when not connected', async () => {
      const socket = new net.Socket();
      expect(socket.remoteFamily).toBeUndefined();
    });

    await it('localAddress should be undefined when not connected', async () => {
      const socket = new net.Socket();
      expect(socket.localAddress).toBeUndefined();
    });

    await it('localPort should be undefined when not connected', async () => {
      const socket = new net.Socket();
      expect(socket.localPort).toBeUndefined();
    });

    await it('setTimeout should not throw', async () => {
      const socket = new net.Socket();
      expect(() => socket.setTimeout(1000)).not.toThrow();
    });

    await it('setKeepAlive should not throw', async () => {
      const socket = new net.Socket();
      expect(() => socket.setKeepAlive(true)).not.toThrow();
    });

    await it('setNoDelay should not throw', async () => {
      const socket = new net.Socket();
      expect(() => socket.setNoDelay(true)).not.toThrow();
    });

    await it('ref should return socket (chainable)', async () => {
      const socket = new net.Socket();
      expect(socket.ref()).toBe(socket);
    });

    await it('unref should return socket (chainable)', async () => {
      const socket = new net.Socket();
      expect(socket.unref()).toBe(socket);
    });

    await it('should accept options with fd', async () => {
      const socket = new net.Socket({ fd: undefined });
      expect(socket).toBeDefined();
    });

    await it('should accept allowHalfOpen option', async () => {
      const socket = new net.Socket({ allowHalfOpen: true });
      expect(socket).toBeDefined();
    });

    await it('should accept readable/writable options', async () => {
      const socket = new net.Socket({ readable: true, writable: true });
      expect(socket).toBeDefined();
    });
  });

  // ===================== Server extended =====================
  await describe('net.Server extended', async () => {
    await it('should be constructable', async () => {
      const server = new net.Server();
      expect(server).toBeDefined();
    });

    await it('should accept connectionListener', async () => {
      const server = new net.Server((_socket) => {});
      expect(server).toBeDefined();
    });

    await it('should accept options', async () => {
      const server = new net.Server({ allowHalfOpen: true });
      expect(server).toBeDefined();
    });

    await it('should have listen method', async () => {
      const server = new net.Server();
      expect(typeof server.listen).toBe('function');
    });

    await it('should have close method', async () => {
      const server = new net.Server();
      expect(typeof server.close).toBe('function');
    });

    await it('should have address method', async () => {
      const server = new net.Server();
      expect(typeof server.address).toBe('function');
    });

    await it('should have getConnections method', async () => {
      const server = new net.Server();
      expect(typeof server.getConnections).toBe('function');
    });

    await it('should have ref/unref methods', async () => {
      const server = new net.Server();
      expect(typeof server.ref).toBe('function');
      expect(typeof server.unref).toBe('function');
    });

    await it('listening should be false initially', async () => {
      const server = new net.Server();
      expect(server.listening).toBe(false);
    });

    await it('should have maxConnections property', async () => {
      const server = new net.Server();
      expect(typeof server.maxConnections === 'number' || server.maxConnections === undefined).toBe(true);
    });

    await it('should be an EventEmitter', async () => {
      const server = new net.Server();
      expect(typeof server.on).toBe('function');
      expect(typeof server.emit).toBe('function');
      expect(typeof server.once).toBe('function');
    });

    await it('address should return null when not listening', async () => {
      const server = new net.Server();
      expect(server.address()).toBeNull();
    });
  });

  // ===================== Module exports =====================
  await describe('net module exports', async () => {
    await it('should export Socket', async () => {
      expect(typeof net.Socket).toBe('function');
    });
    await it('should export Server', async () => {
      expect(typeof net.Server).toBe('function');
    });
    await it('should export createServer', async () => {
      expect(typeof net.createServer).toBe('function');
    });
    await it('should export createConnection', async () => {
      expect(typeof net.createConnection).toBe('function');
    });
    await it('should export connect', async () => {
      expect(typeof net.connect).toBe('function');
    });
    await it('should export isIP', async () => {
      expect(typeof net.isIP).toBe('function');
    });
    await it('should export isIPv4', async () => {
      expect(typeof net.isIPv4).toBe('function');
    });
    await it('should export isIPv6', async () => {
      expect(typeof net.isIPv6).toBe('function');
    });
  });

  // ===================== createServer =====================
  await describe('net.createServer', async () => {
    await it('should return a Server', async () => {
      const server = net.createServer();
      expect(server).toBeDefined();
      expect(server instanceof net.Server).toBe(true);
    });

    await it('should accept options', async () => {
      const server = net.createServer({ allowHalfOpen: true });
      expect(server).toBeDefined();
    });

    await it('should accept connectionListener', async () => {
      const server = net.createServer((_socket) => {});
      expect(server).toBeDefined();
    });

    await it('should accept options and connectionListener', async () => {
      const server = net.createServer({ allowHalfOpen: false }, (_socket) => {});
      expect(server).toBeDefined();
    });
  });
};
