import { describe, it, expect } from '@gjsify/unit';

import { isIP, isIPv4, isIPv6 } from 'net';

export default async () => {

	const v6AddrArr = ['::1'];
	const v4AddrArr = ['127.0.0.1'];
	const invalidAddrArr = ['127.000.000.001', '127.0.0.1/24', 'fhqwhgads'];

	await describe('net.isIP', async () => {
		await it('should be a function', async () => {
			expect(typeof isIP).toBe("function");
		});

		for (const v6 of v6AddrArr) {
			await it(`should return 6 for "${v6}"`, async () => {
				expect(isIP(v6)).toBe(6);
			});
		}

		for (const v4 of v4AddrArr) {
			await it(`should return 4 for "${v4}"`, async () => {
				expect(isIP(v4)).toBe(4);
			});
		}

		for (const invalid of invalidAddrArr) {
			await it(`should return 0 for "${invalid}"`, async () => {
				expect(isIP(invalid)).toBe(0);
			});
		}

	});

	await describe('net.isIPv4', async () => {
		await it('should be a function', async () => {
			expect(typeof isIPv4).toBe("function");
		});

		for (const v6 of v6AddrArr) {
			await it(`should return false for "${v6}"`, async () => {
				expect(isIPv4(v6)).toBeFalsy();
			});
		}

		for (const v4 of v4AddrArr) {
			await it(`should return true for "${v4}"`, async () => {
				expect(isIPv4(v4)).toBeTruthy();
			});
		}

		for (const invalid of invalidAddrArr) {
			await it(`should return false for "${invalid}"`, async () => {
				expect(isIPv4(invalid)).toBeFalsy();
			});
		}
	});

	await describe('net.isIPv6', async () => {
		await it('should be a function', async () => {
			expect(typeof isIPv6).toBe("function");
		});

		for (const v6 of v6AddrArr) {
			await it(`should return true for "${v6}"`, async () => {
				expect(isIPv6(v6)).toBeTruthy();
			});
		}

		for (const v4 of v4AddrArr) {
			await it(`should return false for "${v4}"`, async () => {
				expect(isIPv6(v4)).toBeFalsy();
			});
		}

		for (const invalid of invalidAddrArr) {
			await it(`should return false for "${invalid}"`, async () => {
				expect(isIPv6(invalid)).toBeFalsy();
			});
		}
	});

}
