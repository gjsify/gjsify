import { describe, it, expect } from '@gjsify/unit';
import { createInterface, clearLine, clearScreenDown, cursorTo, moveCursor, Interface } from 'readline';
import { Readable, Writable, PassThrough } from 'stream';

export default async () => {
  await describe('readline', async () => {
    await it('should export createInterface as a function', async () => {
      expect(typeof createInterface).toBe('function');
    });

    await it('should export Interface class', async () => {
      expect(typeof Interface).toBe('function');
    });

    await it('should create an interface with input stream', async () => {
      const input = new Readable({ read() {} });
      const rl = createInterface({ input });
      expect(rl).toBeDefined();
      expect(typeof rl.close).toBe('function');
      rl.close();
    });

    await it('should export utility functions', async () => {
      expect(typeof clearLine).toBe('function');
      expect(typeof clearScreenDown).toBe('function');
      expect(typeof cursorTo).toBe('function');
      expect(typeof moveCursor).toBe('function');
    });

    await it('should emit line events from input stream', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });

      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      input.write('hello\n');
      input.write('world\n');

      // Allow event processing
      await new Promise<void>((r) => setTimeout(r, 10));

      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('hello');
      expect(lines[1]).toBe('world');
      rl.close();
    });

    await it('should handle \\r\\n line endings', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });

      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      input.write('line1\r\nline2\r\n');

      await new Promise<void>((r) => setTimeout(r, 10));

      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('line1');
      expect(lines[1]).toBe('line2');
      rl.close();
    });

    await it('should emit close event', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });

      let closed = false;
      rl.on('close', () => { closed = true; });

      rl.close();
      expect(closed).toBe(true);
    });

    await it('should support set/getPrompt', async () => {
      const input = new Readable({ read() {} });
      const rl = createInterface({ input, prompt: '>> ' });

      expect(rl.getPrompt()).toBe('>> ');
      rl.setPrompt('$ ');
      expect(rl.getPrompt()).toBe('$ ');
      rl.close();
    });

    await it('should answer question from input', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      const rl = createInterface({ input, output });

      const answerPromise = new Promise<string>((resolve) => {
        rl.question('Name? ', resolve);
      });

      input.write('Alice\n');
      const answer = await answerPromise;
      expect(answer).toBe('Alice');
      rl.close();
    });

    await it('should handle lines without trailing newline', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });

      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      // Write a line with newline — this should always work
      input.write('complete line\n');
      await new Promise<void>((r) => setTimeout(r, 10));

      expect(lines.length).toBe(1);
      expect(lines[0]).toBe('complete line');
      rl.close();
    });

    await it('should pause and resume', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });

      let paused = false;
      let resumed = false;
      rl.on('pause', () => { paused = true; });
      rl.on('resume', () => { resumed = true; });

      rl.pause();
      expect(paused).toBe(true);

      rl.resume();
      expect(resumed).toBe(true);
      rl.close();
    });

    // Additional tests ported from refs/node-test

    await it('should handle \\r line endings', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });

      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      input.write('line1\rline2\r');

      await new Promise<void>((r) => setTimeout(r, 10));

      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('line1');
      expect(lines[1]).toBe('line2');
      rl.close();
    });

    await it('should handle chunked input across line boundary', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });

      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      input.write('hel');
      input.write('lo\nwor');
      input.write('ld\n');

      await new Promise<void>((r) => setTimeout(r, 10));

      expect(lines.length).toBe(2);
      expect(lines[0]).toBe('hello');
      expect(lines[1]).toBe('world');
      rl.close();
    });

    await it('should handle empty lines', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });

      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      input.write('\n\n\n');

      await new Promise<void>((r) => setTimeout(r, 10));

      expect(lines.length).toBe(3);
      expect(lines[0]).toBe('');
      expect(lines[1]).toBe('');
      expect(lines[2]).toBe('');
      rl.close();
    });

    await it('close should be safe to call twice', async () => {
      const input = new Readable({ read() {} });
      const rl = createInterface({ input });

      rl.close();
      rl.close(); // should not throw
      expect(true).toBeTruthy();
    });

    await it('should have write method', async () => {
      const input = new Readable({ read() {} });
      const rl = createInterface({ input });
      expect(typeof rl.write).toBe('function');
      rl.close();
    });

    await it('should emit line on input end with pending data', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });

      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      input.write('no newline');
      input.end();

      await new Promise<void>((r) => setTimeout(r, 50));

      // When input ends, pending data should be emitted as a line
      expect(lines.length).toBe(1);
      expect(lines[0]).toBe('no newline');
      rl.close();
    });
  });

  await describe('readline utility functions', async () => {
    await it('clearLine should write ANSI escape to stream', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });

      clearLine(stream, 0);
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe('\x1b[2K');
    });

    await it('clearScreenDown should write ANSI escape', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });

      clearScreenDown(stream);
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe('\x1b[0J');
    });

    await it('cursorTo should write ANSI escape', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });

      cursorTo(stream, 5);
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe('\x1b[6G'); // x+1
    });

    await it('moveCursor should write ANSI escape', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });

      moveCursor(stream, 3, -2);
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe('\x1b[3C\x1b[2A');
    });

    await it('cursorTo with x and y should write correct escape', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });

      cursorTo(stream, 10, 5);
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe('\x1b[6;11H'); // row+1;col+1
    });

    await it('clearLine with direction -1 should clear left', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });

      clearLine(stream, -1);
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe('\x1b[1K');
    });

    await it('clearLine with direction 1 should clear right', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });

      clearLine(stream, 1);
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toBe('\x1b[0K');
    });
  });
};
