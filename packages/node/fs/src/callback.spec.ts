import { describe, it, expect } from '@gjsify/unit';
import { open, write, close, rm } from 'fs';

export default async () => {
	await describe('fs.open', () => {
		it(`should open a file for write`, () => {
			open('./test/open.txt', 'w+', 0o666, (err, fd) => {

				expect(err).toBeNull();

				console.log('file open');

				let buffWrite = Buffer.from('Hello World', 'utf8'),
				buffStart = 0,
				buffLength = buffWrite.length,
				filePos = 0;
				write(fd, buffWrite, buffStart, buffLength, filePos, (err, written, buffer) => {
					expect(err).toBeNull();

					console.log('file written');

					expect(written).toBe(written);

					expect(buffer).toBe(buffWrite);

					close(fd, (err) => {
						expect(err).toBeNull();

						console.log('file closed');

						rm('./test/open.txt', (err) => {
							expect(err).toBeNull();
							console.log('file removed');
						});
					});
				});
			});
		});
	});
}
