import { describe, it, expect } from '@gjsify/unit';
import { promises, rm } from 'fs';

export default async () => {
	await describe('FileHandle', async () => {
		await it(`should open a file for writing`, async () => {
			const path = './test/openP.txt';
			const fileHandle = await promises.open(path, 'w+', 0o666);

			console.log('FileHandle: file open');

			let buffWrite = Buffer.from('Hello World', 'utf8'),
			buffStart = 0,
			buffLength = buffWrite.length,
			filePos = 0;
			const res = await fileHandle.write(buffWrite, buffStart, buffLength, filePos);
			console.log('FileHandle: file written');

			// console.log('written', res.bytesWritten);

			expect(res.bytesWritten).toBe(buffWrite.length);

			expect(res.buffer).toBe(buffWrite);

			await fileHandle.close();
			console.log('FileHandle: file closed');

			await promises.rm(path);
			console.log('FileHandle: file removed');	

		});
	});
}
