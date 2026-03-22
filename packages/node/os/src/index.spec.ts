import { describe, it, expect } from '@gjsify/unit';
import * as os from 'os';

// Ported from refs/node/test/parallel/test-os.js

export default async () => {
	// ==================== basic return types ====================

	await describe('os: basic return types', async () => {
		await it('homedir() should return a non-empty string', async () => {
			const home = os.homedir();
			expect(typeof home).toBe('string');
			expect(home.length > 0).toBeTruthy();
		});

		await it('hostname() should return a non-empty string', async () => {
			const hostname = os.hostname();
			expect(typeof hostname).toBe('string');
			expect(hostname.length > 0).toBeTruthy();
		});

		await it('tmpdir() should return a non-empty string', async () => {
			const tmp = os.tmpdir();
			expect(typeof tmp).toBe('string');
			expect(tmp.length > 0).toBeTruthy();
		});

		await it('type() should return a non-empty string', async () => {
			const type = os.type();
			expect(typeof type).toBe('string');
			expect(type.length > 0).toBeTruthy();
		});

		await it('release() should return a non-empty string', async () => {
			const release = os.release();
			expect(typeof release).toBe('string');
			expect(release.length > 0).toBeTruthy();
		});

		await it('platform() should return a non-empty string', async () => {
			const platform = os.platform();
			expect(typeof platform).toBe('string');
			expect(platform.length > 0).toBeTruthy();
		});

		await it('arch() should return a non-empty string', async () => {
			const arch = os.arch();
			expect(typeof arch).toBe('string');
			expect(arch.length > 0).toBeTruthy();
		});
	});

	// ==================== endianness ====================

	await describe('os: endianness', async () => {
		await it('should return BE or LE', async () => {
			const endianness = os.endianness();
			expect(typeof endianness).toBe('string');
			expect(endianness === 'BE' || endianness === 'LE').toBeTruthy();
		});
	});

	// ==================== EOL ====================

	await describe('os: EOL', async () => {
		await it('should be \\n on non-Windows', async () => {
			expect(os.EOL).toBe('\n');
		});
	});

	// ==================== cpus ====================

	await describe('os: cpus', async () => {
		await it('should return a non-empty array', async () => {
			const cpus = os.cpus();
			expect(Array.isArray(cpus)).toBeTruthy();
			expect(cpus.length > 0).toBeTruthy();
		});

		await it('each cpu should have model, speed, and times', async () => {
			const cpus = os.cpus();
			for (const cpu of cpus) {
				expect(typeof cpu.model).toBe('string');
				expect(typeof cpu.speed).toBe('number');
				expect(typeof cpu.times).toBe('object');
				expect(typeof cpu.times.user).toBe('number');
				expect(typeof cpu.times.nice).toBe('number');
				expect(typeof cpu.times.sys).toBe('number');
				expect(typeof cpu.times.idle).toBe('number');
				expect(typeof cpu.times.irq).toBe('number');
			}
		});
	});

	// ==================== memory ====================

	await describe('os: memory', async () => {
		await it('freemem() should return a positive number', async () => {
			const free = os.freemem();
			expect(typeof free).toBe('number');
			expect(free > 0).toBeTruthy();
		});

		await it('totalmem() should return a positive number', async () => {
			const total = os.totalmem();
			expect(typeof total).toBe('number');
			expect(total > 0).toBeTruthy();
		});

		await it('freemem should be less than totalmem', async () => {
			expect(os.freemem() <= os.totalmem()).toBeTruthy();
		});
	});

	// ==================== loadavg ====================

	await describe('os: loadavg', async () => {
		await it('should return an array with 3 elements', async () => {
			const avg = os.loadavg();
			expect(Array.isArray(avg)).toBeTruthy();
			expect(avg.length).toBe(3);
		});

		await it('each element should be a number', async () => {
			const avg = os.loadavg();
			for (const v of avg) {
				expect(typeof v).toBe('number');
			}
		});
	});

	// ==================== uptime ====================

	await describe('os: uptime', async () => {
		await it('should return a positive number', async () => {
			const uptime = os.uptime();
			expect(typeof uptime).toBe('number');
			expect(uptime > 0).toBeTruthy();
		});
	});

	// ==================== version ====================

	await describe('os: version', async () => {
		await it('should return a non-empty string', async () => {
			const version = os.version();
			expect(typeof version).toBe('string');
			expect(version.length > 0).toBeTruthy();
		});
	});

	// ==================== machine ====================

	await describe('os: machine', async () => {
		await it('should return a non-empty string', async () => {
			const machine = os.machine();
			expect(typeof machine).toBe('string');
			expect(machine.length > 0).toBeTruthy();
		});
	});

	// ==================== devNull ====================

	await describe('os: devNull', async () => {
		await it('should be /dev/null on Linux', async () => {
			expect(os.devNull).toBe('/dev/null');
		});
	});

	// ==================== availableParallelism ====================

	await describe('os: availableParallelism', async () => {
		await it('should return a positive number', async () => {
			const n = os.availableParallelism();
			expect(typeof n).toBe('number');
			expect(n > 0).toBeTruthy();
		});
	});

	// ==================== userInfo ====================

	await describe('os: userInfo', async () => {
		await it('should return an object', async () => {
			const info = os.userInfo();
			expect(typeof info).toBe('object');
		});

		await it('should have uid as number', async () => {
			expect(typeof os.userInfo().uid).toBe('number');
		});

		await it('should have gid as number', async () => {
			expect(typeof os.userInfo().gid).toBe('number');
		});

		await it('should have username as string', async () => {
			expect(typeof os.userInfo().username).toBe('string');
			expect(os.userInfo().username.length > 0).toBeTruthy();
		});

		await it('should have homedir as string', async () => {
			expect(typeof os.userInfo().homedir).toBe('string');
			expect(os.userInfo().homedir.length > 0).toBeTruthy();
		});

		await it('should have shell as string', async () => {
			expect(typeof os.userInfo().shell).toBe('string');
		});
	});

	// ==================== networkInterfaces ====================

	await describe('os: networkInterfaces', async () => {
		await it('should return an object', async () => {
			const ifaces = os.networkInterfaces();
			expect(typeof ifaces).toBe('object');
		});

		await it('each interface entry should have required fields', async () => {
			const ifaces = os.networkInterfaces();
			for (const [, entries] of Object.entries(ifaces)) {
				for (const entry of entries as any[]) {
					expect(typeof entry.address).toBe('string');
					expect(typeof entry.netmask).toBe('string');
					expect(entry.family === 'IPv4' || entry.family === 'IPv6' ||
						entry.family === 4 || entry.family === 6).toBeTruthy();
					expect(typeof entry.mac).toBe('string');
					expect(typeof entry.internal).toBe('boolean');
				}
			}
		});
	});

	// ==================== constants ====================

	await describe('os: constants', async () => {
		await it('should have signals object', async () => {
			expect(typeof os.constants.signals).toBe('object');
		});

		await it('should have errno object', async () => {
			expect(typeof os.constants.errno).toBe('object');
		});
	});
};
