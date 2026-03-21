import { describe, it, expect } from '@gjsify/unit';

import { ExtInputStream } from './index.js';
import Gio from '@girs/gio-2.0';

const byteArray = imports.byteArray;

// TODO @gjsify/unit need to better handle async tests

export default async () => {

	const dataTextFile = "test-data/data.txt";

	await describe('DataInputStream.read_line', async () => {

		const lines: string[] = [];

		await it('should also be usable without iterable implementation', () => {
			// A reference to our file
			const file = Gio.File.new_for_path (dataTextFile);
			// File should exists
			expect(file.query_exists(null)).toBeTruthy();

			const dataInputStream = new Gio.DataInputStream({ base_stream: file.read(null) });

			let chunk: Uint8Array | null;

			// Read lines until end of file (null) is reached
			while ((chunk = dataInputStream.read_line(null)[0]) !== null) {
				const decoder = new TextDecoder("utf8");
				const str = decoder.decode(chunk);
				expect(typeof str).toBe("string");

				lines.push(str)
			}

			expect(lines.length).toBe(5);
		});
	});

	await describe('DataInputStream.iterator', async () => {

		const bytesSize = 512;
		const chunks: string[] = [];

		await it('should be iterable', () => {
			const dataInputStream = ExtInputStream.newForFilePath(dataTextFile);
			dataInputStream.defaultBytesSize = bytesSize;
			expect(dataInputStream.defaultBytesSize).toBe(bytesSize);

			for(let data of dataInputStream) {
				expect(data instanceof Uint8Array).toBeTruthy();

				const str = byteArray.toString(data);
				expect(typeof str).toBe('string');
				expect(str.length <= bytesSize).toBeTruthy();

				chunks.push(str);
			}
		});


		await it(`should only have chunks loaded with a maximum byte number of ${bytesSize}`, () => {
			for (let i = 0; i < chunks.length; i++) {
				const chunk = chunks[i];
				const moreToFollow = i + 1 < chunks.length;
				if(moreToFollow) {
					expect(chunk.length).toBe(bytesSize);
				} else {
					expect(chunk.length <= bytesSize).toBeTruthy();
				}
			}
		});
	});

	await describe('DataInputStream.asyncIterator', async () => {

		const bytesSize = 256;
		const chunks: string[] = [];

		await it('should be asynchronously iterable', async () => {
			const dataInputStream = ExtInputStream.newForFilePath(dataTextFile);

			dataInputStream.defaultBytesSize = bytesSize;
			expect(dataInputStream.defaultBytesSize).toBe(bytesSize);

			for await (let data of dataInputStream) {
				expect(data instanceof Uint8Array).toBeTruthy();

				const str = byteArray.toString(data);
				expect(typeof str).toBe('string');
				expect(str.length <= bytesSize).toBeTruthy();

				chunks.push(str);
			}

		})

		// TODO: Readable.from() with GLib async iterators hangs the GJS mainloop.
		// These tests need to be re-enabled once the Readable/GLib integration is fixed.
		// See: packages/gjs/gio-2.0/src/input-stream.ts

	});
}
