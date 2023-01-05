import { describe, it, expect } from '@gjsify/unit';
import { open, write, close, rm } from 'fs';
import { Buffer } from 'buffer';

export default async () => {
	await describe('fs.open', async () => {
		await it(`should open a file for writing`, () => {
			const path = './test/open.txt';
			open(path, 'w+', 0o666, (err, fd) => {

				expect(err).toBeNull();

				console.log('fs.open: file open');

				let buffWrite = Buffer.from('Hello World', 'utf8'),
				buffStart = 0,
				buffLength = buffWrite.length,
				filePos = 0;
				write(fd, buffWrite, buffStart, buffLength, filePos, (err, written, buffer) => {
					expect(err).toBeNull();

					console.log('fs.open: file written');

					expect(written).toBe(buffWrite.length);

					expect(buffer).toBe(buffWrite);

					close(fd, (err) => {
						expect(err).toBeNull();

						console.log('fs.open: file closed');

						rm(path, (err) => {
							expect(err).toBeNull();
							console.log('fs.open: file removed');
						});
					});
				});
			});
		});
	});
}
