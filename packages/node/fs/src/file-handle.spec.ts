import { describe, it, expect } from '@gjsify/unit';
import { promises, mkdtempSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

export default async () => {
	await describe('FileHandle', async () => {
		await it('should open a file for writing', async () => {
			const dir = mkdtempSync('fs-fh-');
			const path = join(dir, 'openP.txt');
			const fileHandle = await promises.open(path, 'w+', 0o666);

			const buffWrite = Buffer.from('Hello World', 'utf8');
			const res = await fileHandle.write(buffWrite, 0, buffWrite.length, 0);

			expect(res.bytesWritten).toBe(buffWrite.length);
			expect(res.buffer).toBe(buffWrite);

			await fileHandle.close();
			await promises.rm(path);
			rmdirSync(dir);
		});
	});
}
