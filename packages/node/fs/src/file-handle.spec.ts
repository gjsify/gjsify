import { describe, it, expect } from '@gjsify/unit';
import { promises, rm } from 'fs';

export default async () => {
	await describe('fsPromises.open', async () => {
		await it(`should open a file for writing`, async () => {
			const fileHandle = await promises.open('./test/openP.txt', 'w+', 0o666);

			console.log('file open');

			let buffWrite = Buffer.from('Hello World', 'utf8'),
			buffStart = 0,
			buffLength = buffWrite.length,
			filePos = 0;
			const res = await fileHandle.write(buffWrite, buffStart, buffLength, filePos);
			console.log('file written');

			console.log('written', res.bytesWritten);

			expect(res.bytesWritten).toBe(buffWrite.length);

			expect(res.buffer).toBe(buffWrite);

			await fileHandle.close();
			console.log('file closed');

			await promises.rm('./test/open.txt');
			console.log('file removed');
		});
	});
}
