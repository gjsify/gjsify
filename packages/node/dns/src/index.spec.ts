import { describe, it, expect } from '@gjsify/unit';
import dns, {
  lookup,
  resolve4,
  resolve6,
  reverse,
  resolve,
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
} from 'dns';

export default async () => {
  await describe('dns', async () => {

    // --- Constants ---
    await describe('constants', async () => {
      await it('should export NOTFOUND as ENOTFOUND', async () => {
        expect(NOTFOUND).toBe('ENOTFOUND');
      });

      await it('should export NODATA as ENODATA', async () => {
        expect(NODATA).toBe('ENODATA');
      });

      await it('should export SERVFAIL as ESERVFAIL', async () => {
        expect(SERVFAIL).toBe('ESERVFAIL');
      });

      await it('should export FORMERR as EFORMERR', async () => {
        expect(FORMERR).toBe('EFORMERR');
      });

      await it('should export NOTIMP as ENOTIMP', async () => {
        expect(NOTIMP).toBe('ENOTIMP');
      });

      await it('should export REFUSED as EREFUSED', async () => {
        expect(REFUSED).toBe('EREFUSED');
      });

      await it('should export BADQUERY as EBADQUERY', async () => {
        expect(BADQUERY).toBe('EBADQUERY');
      });

      await it('should export CONNREFUSED as ECONNREFUSED', async () => {
        expect(CONNREFUSED).toBe('ECONNREFUSED');
      });

      await it('should export TIMEOUT as ETIMEOUT', async () => {
        expect(TIMEOUT).toBe('ETIMEOUT');
      });

      await it('should export remaining error codes', async () => {
        expect(BADNAME).toBe('EBADNAME');
        expect(BADFAMILY).toBe('EBADFAMILY');
        expect(BADRESP).toBe('EBADRESP');
        expect(EOF).toBe('EOF');
        expect(FILE).toBe('EFILE');
        expect(NOMEM).toBe('ENOMEM');
        expect(DESTRUCTION).toBe('EDESTRUCTION');
        expect(BADSTR).toBe('EBADSTR');
        expect(BADFLAGS).toBe('EBADFLAGS');
        expect(NONAME).toBe('ENONAME');
        expect(BADHINTS).toBe('EBADHINTS');
        expect(NOTINITIALIZED).toBe('ENOTINITIALIZED');
        expect(CANCELLED).toBe('ECANCELLED');
      });
    });

    // --- Module exports ---
    await describe('exports', async () => {
      await it('should export lookup as a function', async () => {
        expect(typeof lookup).toBe('function');
      });

      await it('should export resolve as a function', async () => {
        expect(typeof resolve).toBe('function');
      });

      await it('should export resolve4 as a function', async () => {
        expect(typeof resolve4).toBe('function');
      });

      await it('should export resolve6 as a function', async () => {
        expect(typeof resolve6).toBe('function');
      });

      await it('should export reverse as a function', async () => {
        expect(typeof reverse).toBe('function');
      });

      await it('should export setDefaultResultOrder and getDefaultResultOrder', async () => {
        expect(typeof setDefaultResultOrder).toBe('function');
        expect(typeof getDefaultResultOrder).toBe('function');
      });

      await it('should have all exports on the default export object', async () => {
        expect(typeof dns.lookup).toBe('function');
        expect(typeof dns.resolve).toBe('function');
        expect(typeof dns.resolve4).toBe('function');
        expect(typeof dns.resolve6).toBe('function');
        expect(typeof dns.reverse).toBe('function');
        expect(typeof dns.setDefaultResultOrder).toBe('function');
        expect(typeof dns.getDefaultResultOrder).toBe('function');
        expect(dns.NOTFOUND).toBe('ENOTFOUND');
      });
    });

    // --- lookup ---
    await describe('lookup', async () => {
      await it('should resolve localhost', async () => {
        await new Promise<void>((resolve, reject) => {
          lookup('localhost', (err, address, family) => {
            if (err) return reject(err);
            expect(address).toBeDefined();
            expect(typeof address).toBe('string');
            expect(family === 4 || family === 6).toBe(true);
            resolve();
          });
        });
      });

      await it('should return IPv4 address unchanged', async () => {
        await new Promise<void>((resolve) => {
          lookup('127.0.0.1', (err, address, family) => {
            expect(err).toBeNull();
            expect(address).toBe('127.0.0.1');
            expect(family).toBe(4);
            resolve();
          });
        });
      });

      await it('should return IPv6 address unchanged', async () => {
        await new Promise<void>((resolve) => {
          lookup('::1', (err, address, family) => {
            expect(err).toBeNull();
            expect(address).toBe('::1');
            expect(family).toBe(6);
            resolve();
          });
        });
      });

      await it('should accept family option as number', async () => {
        await new Promise<void>((resolve) => {
          lookup('127.0.0.1', 4, (err, address, family) => {
            expect(err).toBeNull();
            expect(address).toBe('127.0.0.1');
            expect(family).toBe(4);
            resolve();
          });
        });
      });

      await it('should accept family option in options object', async () => {
        await new Promise<void>((resolve) => {
          lookup('127.0.0.1', { family: 4 }, (err, address, family) => {
            expect(err).toBeNull();
            expect(address).toBe('127.0.0.1');
            expect(family).toBe(4);
            resolve();
          });
        });
      });

      await it('should return null for empty hostname', async () => {
        await new Promise<void>((resolve) => {
          lookup('', (err, address, family) => {
            expect(err).toBeNull();
            expect(address).toBeNull();
            expect(family).toBe(4);
            resolve();
          });
        });
      });

      await it('should return null for empty hostname with family 6', async () => {
        await new Promise<void>((resolve) => {
          lookup('', { family: 6 }, (err, address, family) => {
            expect(err).toBeNull();
            expect(address).toBeNull();
            expect(family).toBe(6);
            resolve();
          });
        });
      });

      await it('should return all addresses with all: true', async () => {
        await new Promise<void>((resolve) => {
          lookup('localhost', { all: true }, (err, addresses: any) => {
            expect(err).toBeNull();
            expect(Array.isArray(addresses)).toBe(true);
            expect(addresses.length).toBeGreaterThan(0);
            for (const entry of addresses) {
              expect(typeof entry.address).toBe('string');
              expect(entry.family === 4 || entry.family === 6).toBe(true);
            }
            resolve();
          });
        });
      });

      await it('should error on non-existent hostname', async () => {
        await new Promise<void>((resolve) => {
          lookup('this.hostname.does.not.exist.invalid', (err, address, family) => {
            expect(err).toBeDefined();
            expect((err as any).code).toBe('ENOTFOUND');
            resolve();
          });
        });
      });
    });

    // --- resolve4 / resolve6 ---
    await describe('resolve4', async () => {
      await it('should resolve localhost to IPv4 addresses', async () => {
        await new Promise<void>((resolve, reject) => {
          resolve4('localhost', (err, addresses) => {
            if (err) return reject(err);
            expect(Array.isArray(addresses)).toBe(true);
            expect(addresses.length).toBeGreaterThan(0);
            for (const addr of addresses) {
              expect(typeof addr).toBe('string');
            }
            resolve();
          });
        });
      });
    });

    await describe('resolve', async () => {
      await it('should resolve with default rrtype (A record)', async () => {
        await new Promise<void>((resolve, reject) => {
          resolve('localhost', (err, records) => {
            if (err) return reject(err);
            expect(Array.isArray(records)).toBe(true);
            resolve();
          });
        });
      });

      await it('should resolve with explicit A rrtype', async () => {
        await new Promise<void>((res, reject) => {
          resolve('localhost', 'A', (err, records) => {
            if (err) return reject(err);
            expect(Array.isArray(records)).toBe(true);
            res();
          });
        });
      });
    });

    // --- reverse ---
    await describe('reverse', async () => {
      await it('should reverse lookup 127.0.0.1', async () => {
        await new Promise<void>((resolve) => {
          reverse('127.0.0.1', (err, hostnames) => {
            // May succeed or fail depending on system config
            if (err) {
              expect(typeof (err as any).code).toBe('string');
            } else {
              expect(Array.isArray(hostnames)).toBe(true);
            }
            resolve();
          });
        });
      });
    });

    // --- setDefaultResultOrder / getDefaultResultOrder ---
    await describe('setDefaultResultOrder', async () => {
      await it('should return verbatim by default', async () => {
        expect(getDefaultResultOrder()).toBe('verbatim');
      });

      await it('should set to ipv4first', async () => {
        setDefaultResultOrder('ipv4first');
        expect(getDefaultResultOrder()).toBe('ipv4first');
      });

      await it('should set back to verbatim', async () => {
        setDefaultResultOrder('verbatim');
        expect(getDefaultResultOrder()).toBe('verbatim');
      });
    });

    // --- Additional export checks ---
    await describe('additional exports', async () => {
      await it('resolve6 should be a function', async () => {
        expect(typeof resolve6).toBe('function');
      });

      await it('resolve6 should resolve localhost', async () => {
        await new Promise<void>((resolve) => {
          resolve6('localhost', (err, addresses) => {
            // May fail if no IPv6 configured, but should not crash
            if (err) {
              expect(typeof (err as any).code).toBe('string');
            } else {
              expect(Array.isArray(addresses)).toBe(true);
              expect(addresses.length).toBeGreaterThan(0);
              for (const addr of addresses) {
                expect(typeof addr).toBe('string');
              }
            }
            resolve();
          });
        });
      });

      await it('dns.getServers should be a function if exported', async () => {
        // getServers may or may not be implemented
        expect(typeof dns.getServers === 'function' || typeof dns.getServers === 'undefined').toBe(true);
      });

      await it('dns.setServers should be a function if exported', async () => {
        // setServers may or may not be implemented
        expect(typeof dns.setServers === 'function' || typeof dns.setServers === 'undefined').toBe(true);
      });

      await it('dns.Resolver should be a constructor if exported', async () => {
        // Resolver class may or may not be implemented
        expect(typeof dns.Resolver === 'function' || typeof dns.Resolver === 'undefined').toBe(true);
      });
    });

    // --- lookup with hints option ---
    await describe('lookup with hints', async () => {
      await it('lookup with hints option should not throw', async () => {
        await new Promise<void>((resolve) => {
          lookup('127.0.0.1', { hints: 0 }, (err, address, family) => {
            expect(err).toBeNull();
            expect(address).toBe('127.0.0.1');
            expect(family).toBe(4);
            resolve();
          });
        });
      });
    });

    // --- resolve with different rrtypes ---
    await describe('resolve with rrtypes', async () => {
      await it('resolve with MX rrtype should be supported', async () => {
        // We just verify the function accepts the rrtype without crashing
        await new Promise<void>((resolve) => {
          dns.resolve('localhost', 'MX', (err: any, records: any) => {
            // MX for localhost may return error (no MX records), that's fine
            if (err) {
              expect(typeof err.code === 'string' || typeof err.message === 'string').toBe(true);
            } else {
              expect(Array.isArray(records)).toBe(true);
            }
            resolve();
          });
        });
      });

      await it('resolve with TXT rrtype should be supported', async () => {
        await new Promise<void>((resolve) => {
          dns.resolve('localhost', 'TXT', (err: any, records: any) => {
            // TXT for localhost may return error (no TXT records), that's fine
            if (err) {
              expect(typeof err.code === 'string' || typeof err.message === 'string').toBe(true);
            } else {
              expect(Array.isArray(records)).toBe(true);
            }
            resolve();
          });
        });
      });
    });
  });
};
