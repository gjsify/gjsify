import { describe, it, expect } from '@gjsify/unit';
import { isatty, ReadStream, WriteStream } from 'tty';

// Ported from refs/node/test/parallel/test-tty*.js

export default async () => {
	await describe('tty: isatty', async () => {
		await it('should be a function', async () => {
			expect(typeof isatty).toBe('function');
		});

		await it('should return boolean', async () => {
			expect(typeof isatty(0)).toBe('boolean');
		});

		await it('should return false for invalid fd', async () => {
			expect(isatty(-1)).toBeFalsy();
			expect(isatty(999999)).toBeFalsy();
		});
	});

	await describe('tty: ReadStream', async () => {
		await it('should be a constructor', async () => {
			expect(typeof ReadStream).toBe('function');
		});

		await it('should have setRawMode method', async () => {
			expect(typeof ReadStream.prototype.setRawMode).toBe('function');
		});
	});

	await describe('tty: WriteStream', async () => {
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
	});
};
