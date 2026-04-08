// Ported from refs/node-test/parallel/test-readline-{interface,csi,async-iterators,line-separators}.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import { createInterface, clearLine, clearScreenDown, cursorTo, moveCursor, Interface } from 'node:readline';
import { Readable, Writable, PassThrough } from 'node:stream';

export default async () => {
  await describe('readline exports', async () => {
    await it('should export createInterface as a function', async () => {
      expect(typeof createInterface).toBe('function');
    });

    await it('should export Interface class', async () => {
      expect(typeof Interface).toBe('function');
    });

    await it('should export utility functions', async () => {
      expect(typeof clearLine).toBe('function');
      expect(typeof clearScreenDown).toBe('function');
      expect(typeof cursorTo).toBe('function');
      expect(typeof moveCursor).toBe('function');
    });
  });

  await describe('readline.Interface', async () => {
    await it('should create an interface with input stream', async () => {
      const input = new Readable({ read() {} });
      const rl = createInterface({ input });
      expect(rl).toBeDefined();
      expect(typeof rl.close).toBe('function');
      rl.close();
    });

    await it('should be instanceof Interface', async () => {
      const input = new Readable({ read() {} });
      const rl = createInterface({ input });
      expect(rl instanceof Interface).toBe(true);
      rl.close();
    });

    await it('should accept positional arguments (input, output)', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      const rl = createInterface(input, output);
      expect(rl).toBeDefined();
      rl.close();
    });

    await it('should use default prompt "> "', async () => {
      const input = new Readable({ read() {} });
      const rl = createInterface({ input });
      expect(rl.getPrompt()).toBe('> ');
      rl.close();
    });

    await it('should support set/getPrompt', async () => {
      const input = new Readable({ read() {} });
      const rl = createInterface({ input, prompt: '>> ' });
      expect(rl.getPrompt()).toBe('>> ');
      rl.setPrompt('$ ');
      expect(rl.getPrompt()).toBe('$ ');
      rl.close();
    });

    await it('should have write method', async () => {
      const input = new Readable({ read() {} });
      const rl = createInterface({ input });
      expect(typeof rl.write).toBe('function');
      rl.close();
    });

    await it('close should be safe to call twice', async () => {
      const input = new Readable({ read() {} });
      const rl = createInterface({ input });
      rl.close();
      rl.close(); // should not throw
      expect(true).toBeTruthy();
    });

    await it('should have getCursorPos method', async () => {
      const input = new Readable({ read() {} });
      const rl = createInterface({ input });
      const pos = rl.getCursorPos();
      expect(typeof pos.rows).toBe('number');
      expect(typeof pos.cols).toBe('number');
      rl.close();
    });
  });

  await describe('readline line events', async () => {
    await it('should emit line events from input stream', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });
      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      input.write('hello\n');
      input.write('world\n');
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

    await it('should handle mixed line endings', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });
      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      input.write('a\nb\rc\r\nd\n');
      await new Promise<void>((r) => setTimeout(r, 10));

      expect(lines.length).toBe(4);
      expect(lines[0]).toBe('a');
      expect(lines[1]).toBe('b');
      expect(lines[2]).toBe('c');
      expect(lines[3]).toBe('d');
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

    await it('should handle multiple lines sent at once', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });
      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      input.write('foo\nbar\nbaz\n');
      await new Promise<void>((r) => setTimeout(r, 10));

      expect(lines.length).toBe(3);
      expect(lines[0]).toBe('foo');
      expect(lines[1]).toBe('bar');
      expect(lines[2]).toBe('baz');
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

      expect(lines.length).toBe(1);
      expect(lines[0]).toBe('no newline');
      rl.close();
    });

    await it('should emit close after end with lines', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });
      const lines: string[] = [];
      let closed = false;
      rl.on('line', (line: string) => lines.push(line));
      rl.on('close', () => { closed = true; });

      input.write('line1\nline2\n');
      input.end();
      await new Promise<void>((r) => setTimeout(r, 50));

      expect(lines.length).toBe(2);
      expect(closed).toBe(true);
      rl.close();
    });

    await it('should handle long lines', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });
      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      const longLine = 'x'.repeat(10000);
      input.write(longLine + '\n');
      await new Promise<void>((r) => setTimeout(r, 10));

      expect(lines.length).toBe(1);
      expect(lines[0]).toBe(longLine);
      expect(lines[0].length).toBe(10000);
      rl.close();
    });

    await it('should handle Unicode content in lines', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });
      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      input.write('你好世界\n');
      input.write('café\n');
      input.write('🎉🎊\n');
      await new Promise<void>((r) => setTimeout(r, 10));

      expect(lines.length).toBe(3);
      expect(lines[0]).toBe('你好世界');
      expect(lines[1]).toBe('café');
      expect(lines[2]).toBe('🎉🎊');
      rl.close();
    });

    await it('should not emit line for data without newline before close', async () => {
      const input = new Readable({ read() {} });
      const rl = createInterface({ input });
      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      // Manually close without ending input — no pending line is flushed
      // (only input 'end' event flushes pending buffer)
      rl.close();
      expect(lines.length).toBe(0);
    });

    await it('should handle \\r\\n split across chunks', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });
      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      input.write('hello\r');
      await new Promise<void>((r) => setTimeout(r, 10));
      input.write('\nworld\n');
      await new Promise<void>((r) => setTimeout(r, 10));

      // \r alone is treated as line ending, then \n starts a new (empty) line
      // or \r\n is treated as single line ending depending on crlfDelay
      expect(lines.length).toBeGreaterThan(0);
      expect(lines[0]).toBe('hello');
      rl.close();
    });
  });

  await describe('readline close and lifecycle', async () => {
    await it('should emit close event', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });
      let closed = false;
      rl.on('close', () => { closed = true; });

      rl.close();
      expect(closed).toBe(true);
    });

    await it('should emit close only once on double close', async () => {
      const input = new Readable({ read() {} });
      const rl = createInterface({ input });
      let closeCount = 0;
      rl.on('close', () => { closeCount++; });

      rl.close();
      rl.close();
      expect(closeCount).toBe(1);
    });

    await it('should stop processing data after close', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });
      const lines: string[] = [];
      rl.on('line', (line: string) => lines.push(line));

      input.write('before\n');
      await new Promise<void>((r) => setTimeout(r, 10));
      rl.close();

      input.write('after\n');
      await new Promise<void>((r) => setTimeout(r, 10));

      expect(lines.length).toBe(1);
      expect(lines[0]).toBe('before');
    });
  });

  await describe('readline pause/resume', async () => {
    await it('should emit pause event', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });
      let paused = false;
      rl.on('pause', () => { paused = true; });

      rl.pause();
      expect(paused).toBe(true);
      rl.close();
    });

    await it('should emit resume event', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });
      let resumed = false;
      rl.on('resume', () => { resumed = true; });

      rl.pause();
      rl.resume();
      expect(resumed).toBe(true);
      rl.close();
    });

    await it('pause should not throw on repeated calls', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });
      rl.pause();
      rl.pause(); // should not throw
      expect(true).toBeTruthy();
      rl.close();
    });

    await it('resume after pause should work', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });
      let pauseCount = 0;
      let resumeCount = 0;
      rl.on('pause', () => { pauseCount++; });
      rl.on('resume', () => { resumeCount++; });

      rl.pause();
      rl.resume();
      expect(pauseCount).toBe(1);
      expect(resumeCount).toBe(1);
      rl.close();
    });
  });

  await describe('readline.question', async () => {
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

    await it('should write query to output', async () => {
      const input = new PassThrough();
      const chunks: string[] = [];
      const output = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      const rl = createInterface({ input, output });

      rl.question('Enter value: ', () => {});
      expect(chunks.some(c => c.includes('Enter value: '))).toBe(true);

      input.write('test\n');
      await new Promise<void>((r) => setTimeout(r, 10));
      rl.close();
    });

    await it('should handle multiple sequential questions', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      const rl = createInterface({ input, output });

      const answer1 = new Promise<string>((resolve) => {
        rl.question('Q1? ', resolve);
      });
      input.write('A1\n');
      expect(await answer1).toBe('A1');

      const answer2 = new Promise<string>((resolve) => {
        rl.question('Q2? ', resolve);
      });
      input.write('A2\n');
      expect(await answer2).toBe('A2');

      rl.close();
    });
  });

  await describe('readline.prompt', async () => {
    await it('should write prompt to output', async () => {
      const input = new Readable({ read() {} });
      const chunks: string[] = [];
      const output = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      const rl = createInterface({ input, output, prompt: '>> ' });

      rl.prompt();
      expect(chunks.some(c => c.includes('>> '))).toBe(true);
      rl.close();
    });

    await it('should use updated prompt after setPrompt', async () => {
      const input = new Readable({ read() {} });
      const chunks: string[] = [];
      const output = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      const rl = createInterface({ input, output, prompt: '> ' });

      rl.setPrompt('$ ');
      rl.prompt();
      expect(chunks.some(c => c.includes('$ '))).toBe(true);
      rl.close();
    });

    await it('prompt after close should throw', async () => {
      const input = new Readable({ read() {} });
      const output = new Writable({
        write(_chunk, _enc, cb) { cb(); }
      });
      const rl = createInterface({ input, output });

      rl.close();
      let threw = false;
      try {
        rl.prompt();
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  await describe('readline history', async () => {
    await it('should have a history array', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input, terminal: true });

      expect(Array.isArray((rl as unknown as { history: string[] }).history)).toBe(true);
      rl.close();
    });

    await it('should store lines in history (most recent first)', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      const rl = createInterface({ input, output, terminal: true });

      input.write('foo\n');
      input.write('bar\n');
      input.write('baz\n');
      await new Promise<void>((r) => setTimeout(r, 20));

      const history = (rl as unknown as { history: string[] }).history;
      expect(history.length).toBe(3);
      expect(history[0]).toBe('baz');
      expect(history[1]).toBe('bar');
      expect(history[2]).toBe('foo');
      rl.close();
    });

    await it('should not store empty lines in history', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      const rl = createInterface({ input, output, terminal: true });

      input.write('\n\n\n');
      await new Promise<void>((r) => setTimeout(r, 20));

      const history = (rl as unknown as { history: string[] }).history;
      expect(history.length).toBe(0);
      rl.close();
    });

    await it('should not store duplicate consecutive lines', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      const rl = createInterface({ input, output, terminal: true });

      input.write('same\nsame\nsame\n');
      await new Promise<void>((r) => setTimeout(r, 20));

      const history = (rl as unknown as { history: string[] }).history;
      expect(history.length).toBe(1);
      expect(history[0]).toBe('same');
      rl.close();
    });
  });

  await describe('readline async iterator', async () => {
    await it('should iterate over lines', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });
      const collected: string[] = [];

      const iterPromise = (async () => {
        for await (const line of rl) {
          collected.push(line);
        }
      })();

      input.write('a\nb\nc\n');
      input.end();
      await iterPromise;

      expect(collected.length).toBe(3);
      expect(collected[0]).toBe('a');
      expect(collected[1]).toBe('b');
      expect(collected[2]).toBe('c');
    });

    await it('should handle empty input', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });
      const collected: string[] = [];

      const iterPromise = (async () => {
        for await (const line of rl) {
          collected.push(line);
        }
      })();

      input.end();
      await iterPromise;

      expect(collected.length).toBe(0);
    });

    await it('should handle single line without trailing newline', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });
      const collected: string[] = [];

      const iterPromise = (async () => {
        for await (const line of rl) {
          collected.push(line);
        }
      })();

      input.write('trailing');
      input.end();
      await iterPromise;

      expect(collected.length).toBe(1);
      expect(collected[0]).toBe('trailing');
    });

    await it('should handle multiline with Unicode content', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input, crlfDelay: Infinity });
      const collected: string[] = [];

      const iterPromise = (async () => {
        for await (const line of rl) {
          collected.push(line);
        }
      })();

      input.write('line 1\nline 2 南越国\nline 3\ntrailing');
      input.end();
      await iterPromise;

      expect(collected.length).toBe(4);
      expect(collected[0]).toBe('line 1');
      expect(collected[1]).toBe('line 2 南越国');
      expect(collected[2]).toBe('line 3');
      expect(collected[3]).toBe('trailing');
    });

    await it('should handle lines ending with newline', async () => {
      const input = new PassThrough();
      const rl = createInterface({ input });
      const collected: string[] = [];

      const iterPromise = (async () => {
        for await (const line of rl) {
          collected.push(line);
        }
      })();

      input.write('line 1\nline 2\nline 3 ends with newline\n');
      input.end();
      await iterPromise;

      expect(collected.length).toBe(3);
      expect(collected[0]).toBe('line 1');
      expect(collected[1]).toBe('line 2');
      expect(collected[2]).toBe('line 3 ends with newline');
    });
  });

  await describe('readline.clearLine', async () => {
    await it('direction 0 should clear entire line', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      clearLine(stream, 0);
      expect(chunks[0]).toBe('\x1b[2K');
    });

    await it('direction -1 should clear to line beginning', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      clearLine(stream, -1);
      expect(chunks[0]).toBe('\x1b[1K');
    });

    await it('direction 1 should clear to line end', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      clearLine(stream, 1);
      expect(chunks[0]).toBe('\x1b[0K');
    });

    await it('should return true', async () => {
      const stream = new Writable({
        write(_chunk, _enc, cb) { cb(); }
      });
      const result = clearLine(stream, 0);
      expect(result).toBe(true);
    });

    await it('should handle null stream without throwing', async () => {
      const result = clearLine(null as unknown as Writable, 0);
      expect(result).toBe(true);
    });

    await it('should handle undefined stream without throwing', async () => {
      const result = clearLine(undefined as unknown as Writable, 0);
      expect(result).toBe(true);
    });

    await it('should invoke callback', async () => {
      const stream = new Writable({
        write(_chunk, _enc, cb) { cb(); }
      });
      let called = false;
      clearLine(stream, 0, () => { called = true; });
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(called).toBe(true);
    });
  });

  await describe('readline.clearScreenDown', async () => {
    await it('should write clear-screen-down escape', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      clearScreenDown(stream);
      expect(chunks[0]).toBe('\x1b[0J');
    });

    await it('should return true', async () => {
      const stream = new Writable({
        write(_chunk, _enc, cb) { cb(); }
      });
      expect(clearScreenDown(stream)).toBe(true);
    });

    await it('should handle null stream without throwing', async () => {
      expect(clearScreenDown(null as unknown as Writable)).toBe(true);
    });

    await it('should invoke callback', async () => {
      const stream = new Writable({
        write(_chunk, _enc, cb) { cb(); }
      });
      let called = false;
      clearScreenDown(stream, () => { called = true; });
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(called).toBe(true);
    });
  });

  await describe('readline.cursorTo', async () => {
    await it('should move cursor to x position', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      cursorTo(stream, 5);
      expect(chunks[0]).toBe('\x1b[6G'); // x+1
    });

    await it('should move cursor to x,y position', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      cursorTo(stream, 10, 5);
      expect(chunks[0]).toBe('\x1b[6;11H'); // row+1;col+1
    });

    await it('should move cursor to 0,0', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      cursorTo(stream, 0, 0);
      expect(chunks[0]).toBe('\x1b[1;1H');
    });

    await it('should move cursor to column 1', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      cursorTo(stream, 1);
      expect(chunks[0]).toBe('\x1b[2G');
    });

    await it('should return true', async () => {
      const stream = new Writable({
        write(_chunk, _enc, cb) { cb(); }
      });
      expect(cursorTo(stream, 1)).toBe(true);
    });

    await it('should handle null stream without throwing', async () => {
      expect(cursorTo(null as unknown as Writable, 1)).toBe(true);
    });

    await it('should accept callback as third argument', async () => {
      const stream = new Writable({
        write(_chunk, _enc, cb) { cb(); }
      });
      let called = false;
      // @types/node's cursorTo overload forces 4 args here; the 3-arg form is valid at runtime.
      (cursorTo as any)(stream, 1, () => { called = true; });
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(called).toBe(true);
    });

    await it('should accept callback as fourth argument', async () => {
      const stream = new Writable({
        write(_chunk, _enc, cb) { cb(); }
      });
      let called = false;
      cursorTo(stream, 1, 2, () => { called = true; });
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(called).toBe(true);
    });
  });

  await describe('readline.moveCursor', async () => {
    await it('should move right', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      moveCursor(stream, 1, 0);
      expect(chunks[0]).toBe('\x1b[1C');
    });

    await it('should move left', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      moveCursor(stream, -1, 0);
      expect(chunks[0]).toBe('\x1b[1D');
    });

    await it('should move down', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      moveCursor(stream, 0, 1);
      expect(chunks[0]).toBe('\x1b[1B');
    });

    await it('should move up', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      moveCursor(stream, 0, -1);
      expect(chunks[0]).toBe('\x1b[1A');
    });

    await it('should move right and down', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      moveCursor(stream, 1, 1);
      expect(chunks[0]).toBe('\x1b[1C\x1b[1B');
    });

    await it('should move left and up', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      moveCursor(stream, -1, -1);
      expect(chunks[0]).toBe('\x1b[1D\x1b[1A');
    });

    await it('should move right and up', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      moveCursor(stream, 1, -1);
      expect(chunks[0]).toBe('\x1b[1C\x1b[1A');
    });

    await it('should move left and down', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      moveCursor(stream, -1, 1);
      expect(chunks[0]).toBe('\x1b[1D\x1b[1B');
    });

    await it('should write nothing for 0,0', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      moveCursor(stream, 0, 0);
      expect(chunks.length).toBe(0);
    });

    await it('should handle larger dx/dy values', async () => {
      const chunks: string[] = [];
      const stream = new Writable({
        write(chunk, _enc, cb) { chunks.push(chunk.toString()); cb(); }
      });
      moveCursor(stream, 3, -2);
      expect(chunks[0]).toBe('\x1b[3C\x1b[2A');
    });

    await it('should return true', async () => {
      const stream = new Writable({
        write(_chunk, _enc, cb) { cb(); }
      });
      expect(moveCursor(stream, 1, 1)).toBe(true);
    });

    await it('should handle null stream without throwing', async () => {
      expect(moveCursor(null as unknown as Writable, 1, 1)).toBe(true);
    });

    await it('should handle undefined stream without throwing', async () => {
      expect(moveCursor(undefined as unknown as Writable, 1, 1)).toBe(true);
    });

    await it('should invoke callback', async () => {
      const stream = new Writable({
        write(_chunk, _enc, cb) { cb(); }
      });
      let called = false;
      moveCursor(stream, 1, 1, () => { called = true; });
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(called).toBe(true);
    });

    await it('should invoke callback for 0,0 move', async () => {
      let called = false;
      const stream = new Writable({
        write(_chunk, _enc, cb) { cb(); }
      });
      moveCursor(stream, 0, 0, () => { called = true; });
      // Callback may be called synchronously or asynchronously
      await new Promise<void>((r) => setTimeout(r, 10));
      expect(called).toBe(true);
    });
  });
};
