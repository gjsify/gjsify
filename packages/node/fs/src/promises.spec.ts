import { describe, it, expect } from '@gjsify/unit';
import { promises } from 'fs';

export default async () => {
	await describe('fsPromises.readFile', async () => {

		await it('should be a function', async () => {
			expect(typeof promises.readFile).toBe("function");
		});

		await it('should be a promise', async () => {
			expect(promises.readFile('./test/file.txt', 'utf-8') instanceof Promise).toBeTruthy();
		});

		await it('should return a Buffer if no encoding was specified', async () => {
			const bufferData = await promises.readFile('package.json');
			expect(bufferData instanceof Buffer).toBeTruthy();
		});

		await it('should return a string when encoding is utf-8', async () => {
			const utf8Data = await promises.readFile('./test/file.txt', 'utf-8');
			expect(typeof utf8Data === 'string').toBeTruthy();
		});

		await it('should return a string with "Hello World"', async () => {
			const utf8Data = await promises.readFile('./test/file.txt', 'utf-8');
			expect(utf8Data).toBe('Hello World');
		});
	});
}
