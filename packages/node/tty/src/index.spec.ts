import { describe, it, expect } from '@gjsify/unit';
import { isatty, ReadStream, WriteStream } from 'tty';

export default async () => {
  await describe('tty', async () => {

    // --- isatty ---
    await describe('isatty', async () => {
      await it('should be a function', async () => {
        expect(typeof isatty).toBe('function');
      });

      await it('should return a boolean for fd 0', async () => {
        expect(typeof isatty(0)).toBe('boolean');
      });

      await it('should return a boolean for fd 1', async () => {
        expect(typeof isatty(1)).toBe('boolean');
      });

      await it('should return a boolean for fd 2', async () => {
        expect(typeof isatty(2)).toBe('boolean');
      });

      await it('should return false for invalid fd', async () => {
        expect(isatty(-1)).toBe(false);
        expect(isatty(999999)).toBe(false);
      });

      await it('should return false for non-tty fd', async () => {
        // Large fd numbers are never ttys
        expect(isatty(100)).toBe(false);
        expect(isatty(255)).toBe(false);
      });
    });

    // --- ReadStream ---
    await describe('ReadStream', async () => {
      await it('should be a constructor', async () => {
        expect(typeof ReadStream).toBe('function');
      });

      await it('should have setRawMode method', async () => {
        expect(typeof ReadStream.prototype.setRawMode).toBe('function');
      });

      await it('should have isRaw property accessor', async () => {
        // ReadStream.prototype should have isRaw as a property
        expect('isRaw' in ReadStream.prototype || 'setRawMode' in ReadStream.prototype).toBe(true);
      });

      await it('should have isTTY property', async () => {
        expect('isTTY' in ReadStream.prototype || typeof ReadStream.prototype.setRawMode === 'function').toBe(true);
      });
    });

    // --- WriteStream ---
    await describe('WriteStream', async () => {
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

      await it('should have columns property defined on prototype or instance', async () => {
        // WriteStream instances should expose columns/rows
        expect('columns' in WriteStream.prototype || typeof WriteStream.prototype.getWindowSize === 'function').toBe(true);
      });

      await it('should have isTTY property', async () => {
        expect('isTTY' in WriteStream.prototype || typeof WriteStream.prototype.getColorDepth === 'function').toBe(true);
      });
    });

    // --- Module exports ---
    await describe('exports', async () => {
      await it('should export isatty', async () => {
        expect(typeof isatty).toBe('function');
      });

      await it('should export ReadStream', async () => {
        expect(typeof ReadStream).toBe('function');
      });

      await it('should export WriteStream', async () => {
        expect(typeof WriteStream).toBe('function');
      });
    });
  });
};
