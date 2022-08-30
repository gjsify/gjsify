import { describe, it, expect } from '@gjsify/unit';
import Gio from '@gjsify/types/Gio-2.0';
import GObject from '@gjsify/types/GObject-2.0';
import { Readable } from 'stream';
import GLib from '@gjsify/types/GLib-2.0';

// TODO @gjsify/unit need to better handle async tests

export async function testSuiteStreams() {

	const dataTextFile = "test-data/data.txt";

	const lines1: string[] = [];
	const lines2: string[] = [];
	const lines3: string[] = [];

	await describe('Gio.DataInputStream.read_line', async () => {
		await it('should also be usable without iterable implementation', () => {
			// A reference to our file
			var file = Gio.File.new_for_path (dataTextFile);
			// File should exists
			expect(file.query_exists(null)).toBeTruthy();
			
			var dataInputStream = new Gio.DataInputStream({ base_stream: file.read(null) });

			let chunk: Uint8Array | null;

			// Read lines until end of file (null) is reached
			while ((chunk = dataInputStream.read_line(null)[0]) !== null) {
				const decoder = new TextDecoder("utf8");
				const str = decoder.decode(chunk);
				expect(typeof str).toBe("string");

				lines1.push(str)
			}

			// expect(lines1.length).toBe(5);
		});

		await it('should also be usable with Iterable implementation', () => {
			// A reference to our file
			var file = Gio.File.new_for_path (dataTextFile);
			// File should exists
			expect(file.query_exists(null)).toBeTruthy();

			// Extend from Gio.DataInputStream and implement Iterable
			class ADataInputStream extends Gio.DataInputStream implements Iterable<Uint8Array> {
				* [Symbol.iterator]() {
					let chunk: Uint8Array;
					while ((chunk = this.read_line(null)[0]) !== null) {
						yield chunk
					}
				}
			}

			// Get GObject compatible version of the new class
			const DataInputStream = GObject.registerClass({
				GTypeName: 'ADataInputStream',
			}, ADataInputStream);


			const dataInputStream = new DataInputStream({ base_stream: file.read(null) });

			const readable = Readable.from(dataInputStream, { objectMode: false, encoding: 'utf8' });
			
			readable.on('readable', () => {

				console.log("readable called (Iterable)");

				// let chunk: string | null;
				// Read lines until end of file (null) is reached
				// while ((chunk = readable.read()) !== null) {			
				// 	// Displaying the chunk
				// 	expect(typeof chunk).toBe("string");
				// 	lines2.push(chunk);
				// }

				const chunk = readable.read();
				if(chunk !== null) {
					expect(typeof chunk).toBe("string");
					lines2.push(chunk);
				}
			});

			readable.on('data', () => {
				console.log("data called (Iterable)");
			});

			readable.on('end', () => {
				console.log('end called (Iterable)');
				// expect(lines2.length).toBe(5);
			});

		});

		await it('should also be usable with AsyncIterable implementation', async () => {

			// A reference to our file
			var file = Gio.File.new_for_path (dataTextFile);
			// File should exists
			expect(file.query_exists(null)).toBeTruthy();

			// Extend from Gio.DataInputStream and implement AsyncIterable
			class BDataInputStream extends Gio.DataInputStream implements AsyncIterable<Uint8Array> {

				/** Promise version of read_line_async */
				async read_line_promise() {
					return new Promise<[Uint8Array, number]>((resolve, reject) => {
						this.read_line_async(GLib.PRIORITY_DEFAULT, null, (self, res) => {
							try {
								resolve(this.read_line_finish(res));
							} catch (error) {
								reject(error);
							}
						});
					});
				}

				async *[Symbol.asyncIterator]() {
					let chunk: Uint8Array;
					while ((chunk = (await this.read_line_promise())[0]) !== null) {
						yield chunk;
					}
				}
			}

			// Get GObject compatible version of the new class
			const DataInputStream = GObject.registerClass({
				GTypeName: 'BDataInputStream',
			}, BDataInputStream);


			const dataInputStream = new DataInputStream({ base_stream: file.read(null) });

			const readable = Readable.from(dataInputStream, { objectMode: false, encoding: 'utf8' });
			
			readable.on('readable', () => {

				console.log("readable called (AsyncIterable)");

				// let chunk: string | null;
				// // Read lines until end of file (null) is reached
				// while ((chunk = readable.read()) !== null) {			
				// 	// Displaying the chunk
				// 	expect(typeof chunk).toBe("string");
				// 	lines3.push(chunk);
				// }

				const chunk = readable.read();

				if(chunk !== null) {
					expect(typeof chunk).toBe("string");
					lines3.push(chunk);		
				}
	
			});

			readable.on('data', () => {
				console.log("data called (AsyncIterable)");
			});

			readable.on('end', () => {
				console.log('end called (AsyncIterable)');
				// expect(lines3.length).toBe(5);
			});
			
		});

	});
}
