import { describe, it, expect } from '@gjsify/unit';
import { Stream, Readable } from 'stream';

export default async () => {

	await describe('stream.Stream', async () => {
		await it('should be able to create an instance of Stream', async () => {
			const stream = new Stream();
			expect(stream).toBeDefined();
		});
	});

	await describe('stream.Readable', async () => {
		await it('should be able to create an instance of Readable', async () => {
			const readable = new Readable();
			expect(readable).toBeDefined();
		});
	});

}
