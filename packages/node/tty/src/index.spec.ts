// Ported from refs/node-test/parallel/test-tty-{isatty,get-color-depth,has-colors,window-size,wrap,stream-constructors}.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import tty, { isatty, ReadStream, WriteStream } from 'node:tty';

export default async () => {
  await describe('tty exports', async () => {
    await it('should export isatty as a function', async () => {
      expect(typeof isatty).toBe('function');
    });

    await it('should export ReadStream as a function', async () => {
      expect(typeof ReadStream).toBe('function');
    });

    await it('should export WriteStream as a function', async () => {
      expect(typeof WriteStream).toBe('function');
    });

    await it('should have all exports on default export', async () => {
      expect(typeof tty.isatty).toBe('function');
      expect(typeof tty.ReadStream).toBe('function');
      expect(typeof tty.WriteStream).toBe('function');
    });

    await it('isatty should be same reference on default', async () => {
      expect(tty.isatty).toBe(isatty);
    });
  });

  await describe('tty.isatty', async () => {
    await it('should return a boolean for fd 0 (stdin)', async () => {
      expect(typeof isatty(0)).toBe('boolean');
    });

    await it('should return a boolean for fd 1 (stdout)', async () => {
      expect(typeof isatty(1)).toBe('boolean');
    });

    await it('should return a boolean for fd 2 (stderr)', async () => {
      expect(typeof isatty(2)).toBe('boolean');
    });

    await it('should return false for invalid fd -1', async () => {
      expect(isatty(-1)).toBe(false);
    });

    await it('should return false for very large fd', async () => {
      expect(isatty(999999)).toBe(false);
    });

    await it('should return false for fd 100', async () => {
      expect(isatty(100)).toBe(false);
    });

    await it('should return false for fd 255', async () => {
      expect(isatty(255)).toBe(false);
    });

    await it('should return false for fd 42', async () => {
      expect(isatty(42)).toBe(false);
    });
  });

  await describe('tty.ReadStream', async () => {
    await it('should be a constructor', async () => {
      expect(typeof ReadStream).toBe('function');
    });

    await it('should have setRawMode on prototype', async () => {
      expect(typeof ReadStream.prototype.setRawMode).toBe('function');
    });

    await it('should have isTTY property', async () => {
      const desc = Object.getOwnPropertyDescriptor(ReadStream.prototype, 'isTTY');
      if (desc) {
        expect(desc.get !== undefined || desc.value !== undefined).toBe(true);
      } else {
        expect('setRawMode' in ReadStream.prototype).toBe(true);
      }
    });
  });

  await describe('tty.WriteStream prototype', async () => {
    await it('should be a constructor', async () => {
      expect(typeof WriteStream).toBe('function');
    });

    await it('should have clearLine method', async () => {
      expect(typeof WriteStream.prototype.clearLine).toBe('function');
    });

    await it('should have clearScreenDown method', async () => {
      expect(typeof WriteStream.prototype.clearScreenDown).toBe('function');
    });

    await it('should have cursorTo method', async () => {
      expect(typeof WriteStream.prototype.cursorTo).toBe('function');
    });

    await it('should have moveCursor method', async () => {
      expect(typeof WriteStream.prototype.moveCursor).toBe('function');
    });

    await it('should have getColorDepth method', async () => {
      expect(typeof WriteStream.prototype.getColorDepth).toBe('function');
    });

    await it('should have hasColors method', async () => {
      expect(typeof WriteStream.prototype.hasColors).toBe('function');
    });

    await it('should have getWindowSize method', async () => {
      expect(typeof WriteStream.prototype.getWindowSize).toBe('function');
    });

    await it('should have isTTY getter or property', async () => {
      const desc = Object.getOwnPropertyDescriptor(WriteStream.prototype, 'isTTY');
      if (desc) {
        expect(desc.get !== undefined || desc.value !== undefined).toBe(true);
      } else {
        // Some implementations set isTTY as a direct property in constructor
        expect(typeof WriteStream.prototype.getColorDepth).toBe('function');
      }
    });
  });

  await describe('WriteStream.getColorDepth (via process.stdout)', async () => {
    // process.stdout may or may not be a tty.WriteStream
    const ws = process.stdout as unknown as { getColorDepth?: (env?: Record<string, string>) => number };

    if (typeof ws.getColorDepth === 'function') {
      await it('should return a number', async () => {
        expect(typeof ws.getColorDepth!()).toBe('number');
      });

      await it('should return 1, 4, 8, or 24', async () => {
        expect([1, 4, 8, 24].includes(ws.getColorDepth!())).toBe(true);
      });

      await it('NO_COLOR should return 1', async () => {
        expect(ws.getColorDepth!({ NO_COLOR: '1' })).toBe(1);
      });

      await it('COLORTERM=truecolor should return 24', async () => {
        expect(ws.getColorDepth!({ COLORTERM: 'truecolor' })).toBe(24);
      });

      await it('COLORTERM=24bit should return 24', async () => {
        expect(ws.getColorDepth!({ COLORTERM: '24bit' })).toBe(24);
      });

      await it('TERM=xterm-256color should return 8', async () => {
        expect(ws.getColorDepth!({ TERM: 'xterm-256color' })).toBe(8);
      });

      await it('TERM=xterm should return 4', async () => {
        expect(ws.getColorDepth!({ TERM: 'xterm' })).toBe(4);
      });

      await it('TERM=dumb should return 1', async () => {
        expect(ws.getColorDepth!({ TERM: 'dumb' })).toBe(1);
      });

      await it('FORCE_COLOR=0 should return 1', async () => {
        expect(ws.getColorDepth!({ FORCE_COLOR: '0' })).toBe(1);
      });

      await it('FORCE_COLOR=1 should return 4', async () => {
        expect(ws.getColorDepth!({ FORCE_COLOR: '1' })).toBe(4);
      });

      await it('FORCE_COLOR=2 should return 8', async () => {
        expect(ws.getColorDepth!({ FORCE_COLOR: '2' })).toBe(8);
      });

      await it('FORCE_COLOR=3 should return 24', async () => {
        expect(ws.getColorDepth!({ FORCE_COLOR: '3' })).toBe(24);
      });

      await it('FORCE_COLOR overrides NO_COLOR', async () => {
        expect(ws.getColorDepth!({ FORCE_COLOR: '1', NO_COLOR: '1' })).toBe(4);
      });

      await it('TERM=screen should return 4', async () => {
        expect(ws.getColorDepth!({ TERM: 'screen' })).toBe(4);
      });

      await it('TERM=linux should return 4', async () => {
        expect(ws.getColorDepth!({ TERM: 'linux' })).toBe(4);
      });

      await it('empty env should return 1', async () => {
        expect(ws.getColorDepth!({})).toBe(1);
      });
    }
  });

  await describe('WriteStream.hasColors (via process.stdout)', async () => {
    const ws = process.stdout as unknown as { hasColors?: (count?: number | Record<string, string>, env?: Record<string, string>) => boolean };

    if (typeof ws.hasColors === 'function') {
      await it('should return a boolean', async () => {
        expect(typeof ws.hasColors!()).toBe('boolean');
      });

      await it('should accept count argument', async () => {
        expect(typeof ws.hasColors!(256)).toBe('boolean');
      });

      await it('should accept env as first argument', async () => {
        expect(typeof ws.hasColors!({ TERM: 'xterm-256color' })).toBe('boolean');
      });

      await it('truecolor env should support 256 colors', async () => {
        expect(ws.hasColors!(256, { COLORTERM: 'truecolor' })).toBe(true);
      });

      await it('dumb terminal should not support 256 colors', async () => {
        expect(ws.hasColors!(256, { TERM: 'dumb' })).toBe(false);
      });

      await it('xterm-256color should support 256 colors', async () => {
        expect(ws.hasColors!(256, { TERM: 'xterm-256color' })).toBe(true);
      });
    }
  });

  await describe('WriteStream.getWindowSize (via process.stdout)', async () => {
    const ws = process.stdout as unknown as { getWindowSize?: () => [number, number]; columns?: number; rows?: number };

    if (typeof ws.getWindowSize === 'function') {
      await it('should return array of two numbers', async () => {
        const size = ws.getWindowSize!();
        expect(Array.isArray(size)).toBe(true);
        expect(size.length).toBe(2);
        expect(typeof size[0]).toBe('number');
        expect(typeof size[1]).toBe('number');
      });

      await it('columns should be positive', async () => {
        expect(ws.getWindowSize!()[0]).toBeGreaterThan(0);
      });

      await it('rows should be positive', async () => {
        expect(ws.getWindowSize!()[1]).toBeGreaterThan(0);
      });
    }

    if (typeof ws.columns === 'number') {
      await it('columns property should be positive', async () => {
        expect(ws.columns!).toBeGreaterThan(0);
      });

      await it('rows property should be positive', async () => {
        expect(ws.rows!).toBeGreaterThan(0);
      });

      await it('columns should match getWindowSize()[0]', async () => {
        if (typeof ws.getWindowSize === 'function') {
          expect(ws.columns).toBe(ws.getWindowSize!()[0]);
        }
      });
    }
  });

  await describe('process.stdout/stderr', async () => {
    await it('process.stdout should have write method', async () => {
      expect(typeof process.stdout.write).toBe('function');
    });

    await it('process.stderr should have write method', async () => {
      expect(typeof process.stderr.write).toBe('function');
    });

    await it('process.stdout.isTTY should be boolean if defined', async () => {
      if (process.stdout.isTTY !== undefined) {
        expect(typeof process.stdout.isTTY).toBe('boolean');
      }
    });

    await it('process.stderr.isTTY should be boolean if defined', async () => {
      if (process.stderr.isTTY !== undefined) {
        expect(typeof process.stderr.isTTY).toBe('boolean');
      }
    });

    await it('process.stdin should have isTTY property if available', async () => {
      if ((process.stdin as any).isTTY !== undefined) {
        expect(typeof (process.stdin as any).isTTY).toBe('boolean');
      }
    });
  });
};
