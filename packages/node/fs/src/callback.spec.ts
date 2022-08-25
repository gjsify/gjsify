import { describe, it, expect } from '@gjsify/unit';
import { open, write, close, rm } from 'fs';

export default () => {
	describe('fs.open', () => {
		it(`should open a file for writing`, () => {
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

					console.log('written', written);

					expect(written).toBe(buffWrite.length);

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
