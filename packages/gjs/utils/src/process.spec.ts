import { describe, it, expect } from '@gjsify/unit';
import { getPid, getPpid } from './process.js';

export default async () => {
	await describe('getPid', async () => {
		const pid = getPid();
		await it('should be a number', async () => {
			expect(typeof pid).toBe("number");
		});
		await it('should be greater than 0', async () => {
			expect(pid).toBeGreaterThan(0);
		});
	});

	await describe('getPpid', async () => {
		const ppid = getPpid();
		await it('should be a number', async () => {
			expect(typeof ppid).toBe("number");
		});
		await it('should be greater than 0', async () => {
			expect(ppid).toBeGreaterThan(0);
		});
	});
}
