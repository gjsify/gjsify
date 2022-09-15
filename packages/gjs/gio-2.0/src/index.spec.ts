import { describe, it, expect } from '@gjsify/unit';

import { DataInputStream } from './index.js';

import { byteArray } from '@gjsify/types/Gjs';
import Gio from '@gjsify/types/Gio-2.0';
import { Readable } from 'stream';


// TODO @gjsify/unit need to better handle async tests

export default async () => {

	const dataTextFile = "test-data/data.txt";

	await describe('DataInputStream.read_line', async () => {

		const lines: string[] = [];

		await it('should also be usable without iterable implementation', () => {
			// A reference to our file
			var file = Gio.File.new_for_path (dataTextFile);
			// File should exists
			expect(file.query_exists(null)).toBeTruthy();
			
			var dataInputStream = new DataInputStream({ base_stream: file.read(null) });

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

	await describe('DataInputStream.iterable', async () => {
		await it('should be iterable', () => {

			// A reference to our file
			var file = Gio.File.new_for_path (dataTextFile);

			// File should exists
			expect(file.query_exists(null)).toBeTruthy();

			const dataInputStream = new DataInputStream({ base_stream: file.read(null) });

			dataInputStream.defaultCount = 512;

			for(let data of dataInputStream){
				const str = byteArray.toString(data);
				expect(typeof str).toBe('string');
			}
		});
	});

	await describe('DataInputStream to Readable Stream', async () => {

		let data: string = '';

		await it('should also be usable with AsyncIterable implementation', async () => {

			return new Promise((resolve, reject) => {
				// A reference to our file
				var file = Gio.File.new_for_path (dataTextFile);

				// File should exists
				expect(file.query_exists(null)).toBeTruthy();

				const dataInputStream = new DataInputStream({ base_stream: file.read(null) });

				const readable = Readable.from(dataInputStream, { objectMode: false, encoding: 'utf8' });
				
				readable.on('readable', () => {
					const chunk = readable.read();

					if(chunk !== null) {
						expect(typeof chunk).toBe("string");
						data += chunk		
					}
		
				});

				readable.on('data', () => {
					// console.log("data called (AsyncIterable)");
				});

				readable.on('end', () => {
					// console.log('end called (AsyncIterable)', data);
					resolve();
				});
			});
			
		});

	});
}
