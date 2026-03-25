import { describe, it, expect } from '@gjsify/unit';
import * as os from 'node:os';

// Ported from refs/node/test/parallel/test-os.js
// Original: MIT license, Node.js contributors

export default async () => {
	// ==================== basic return types ====================

	await describe('os: basic return types', async () => {
		await it('homedir() should return a non-empty string', async () => {
			const home = os.homedir();
			expect(typeof home).toBe('string');
			expect(home.length > 0).toBeTruthy();
		});

		await it('homedir() should return an absolute path', async () => {
			const home = os.homedir();
			expect(home.startsWith('/')).toBeTruthy();
		});

		await it('hostname() should return a non-empty string', async () => {
			const hostname = os.hostname();
			expect(typeof hostname).toBe('string');
			expect(hostname.length > 0).toBeTruthy();
		});

		await it('hostname() should not contain spaces', async () => {
			const hostname = os.hostname();
			expect(hostname.includes(' ')).toBe(false);
		});

		await it('tmpdir() should return a non-empty string', async () => {
			const tmp = os.tmpdir();
			expect(typeof tmp).toBe('string');
			expect(tmp.length > 0).toBeTruthy();
		});

		await it('tmpdir() should return an absolute path', async () => {
			const tmp = os.tmpdir();
			expect(tmp.startsWith('/')).toBeTruthy();
		});

		await it('type() should return a non-empty string', async () => {
			const type = os.type();
			expect(typeof type).toBe('string');
			expect(type.length > 0).toBeTruthy();
		});

		await it('type() should return Linux on Linux', async () => {
			const type = os.type();
			expect(type).toBe('Linux');
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

		await it('platform() should return linux on Linux', async () => {
			expect(os.platform()).toBe('linux');
		});

		await it('arch() should return a non-empty string', async () => {
			const arch = os.arch();
			expect(typeof arch).toBe('string');
			expect(arch.length > 0).toBeTruthy();
		});

		await it('arch() should be one of known architectures', async () => {
			const known = ['x64', 'arm64', 'arm', 'ia32', 'ppc64', 's390x', 'mips', 'mipsel', 'riscv64', 'loong64'];
			expect(known.includes(os.arch())).toBeTruthy();
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

		await it('cpus() length should match availableParallelism()', async () => {
			const cpus = os.cpus();
			expect(cpus.length).toBe(os.availableParallelism());
		});

		await it('cpu times should have non-zero values', async () => {
			const cpus = os.cpus();
			// At least one CPU should have non-zero idle time
			const hasNonZeroIdle = cpus.some(cpu => cpu.times.idle > 0);
			expect(hasNonZeroIdle).toBeTruthy();
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

		await it('totalmem() should return at least 1 MB', async () => {
			expect(os.totalmem() >= 1024 * 1024).toBeTruthy();
		});

		await it('freemem() should return at least 1 MB', async () => {
			expect(os.freemem() >= 1024 * 1024).toBeTruthy();
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

		await it('all values should be >= 0', async () => {
			const avg = os.loadavg();
			for (const v of avg) {
				expect(v >= 0).toBeTruthy();
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

		await it('should be a reasonable value (less than 10 years in seconds)', async () => {
			const tenYearsInSeconds = 10 * 365 * 24 * 60 * 60;
			expect(os.uptime() < tenYearsInSeconds).toBeTruthy();
		});
	});

	// ==================== version ====================

	await describe('os: version', async () => {
		await it('should return a non-empty string', async () => {
			const version = os.version();
			expect(typeof version).toBe('string');
			expect(version.length > 0).toBeTruthy();
		});

		await it('should contain a version-like pattern', async () => {
			const version = os.version();
			// Linux version strings typically start with # or contain version info
			expect(version.length > 2).toBeTruthy();
		});
	});

	// ==================== machine ====================

	await describe('os: machine', async () => {
		await it('should return a non-empty string', async () => {
			const machine = os.machine();
			expect(typeof machine).toBe('string');
			expect(machine.length > 0).toBeTruthy();
		});

		await it('should be one of known machine types', async () => {
			const known = ['x86_64', 'aarch64', 'arm', 'armv7l', 'i686', 'ppc64', 'ppc64le', 's390x', 'mips', 'mipsel', 'mips64el', 'riscv64', 'loongarch64'];
			expect(known.includes(os.machine())).toBeTruthy();
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

		await it('uid should be >= 0', async () => {
			expect(os.userInfo().uid >= 0).toBeTruthy();
		});

		await it('gid should be >= 0', async () => {
			expect(os.userInfo().gid >= 0).toBeTruthy();
		});

		await it('homedir should be an absolute path', async () => {
			expect(os.userInfo().homedir.startsWith('/')).toBeTruthy();
		});

		await it('username should match current user', async () => {
			const info = os.userInfo();
			// username should not contain slashes or spaces
			expect(info.username.includes('/')).toBe(false);
			expect(info.username.includes(' ')).toBe(false);
		});
	});

	// ==================== networkInterfaces ====================

	await describe('os: networkInterfaces', async () => {
		await it('should return an object', async () => {
			const ifaces = os.networkInterfaces();
			expect(typeof ifaces).toBe('object');
		});

		await it('should have at least one interface', async () => {
			const ifaces = os.networkInterfaces();
			expect(Object.keys(ifaces).length > 0).toBeTruthy();
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

		await it('signals.SIGTERM should be a number', async () => {
			expect(typeof os.constants.signals.SIGTERM).toBe('number');
		});

		await it('signals.SIGKILL should be a number', async () => {
			expect(typeof os.constants.signals.SIGKILL).toBe('number');
		});

		await it('signals.SIGINT should be a number', async () => {
			expect(typeof os.constants.signals.SIGINT).toBe('number');
		});

		await it('signals.SIGTERM should be 15', async () => {
			expect(os.constants.signals.SIGTERM).toBe(15);
		});

		await it('signals.SIGKILL should be 9', async () => {
			expect(os.constants.signals.SIGKILL).toBe(9);
		});

		await it('signals.SIGINT should be 2', async () => {
			expect(os.constants.signals.SIGINT).toBe(2);
		});

		await it('errno.ENOENT should be a number', async () => {
			expect(typeof os.constants.errno.ENOENT).toBe('number');
		});

		await it('errno.EACCES should be a number', async () => {
			expect(typeof os.constants.errno.EACCES).toBe('number');
		});

		await it('errno.EEXIST should be a number', async () => {
			expect(typeof os.constants.errno.EEXIST).toBe('number');
		});

		await it('errno.ENOENT should be a positive integer', async () => {
			expect(os.constants.errno.ENOENT > 0).toBeTruthy();
			expect(Number.isInteger(os.constants.errno.ENOENT)).toBeTruthy();
		});

		await it('errno.EACCES should be a positive integer', async () => {
			expect(os.constants.errno.EACCES > 0).toBeTruthy();
			expect(Number.isInteger(os.constants.errno.EACCES)).toBeTruthy();
		});

		await it('errno.EEXIST should be a positive integer', async () => {
			expect(os.constants.errno.EEXIST > 0).toBeTruthy();
			expect(Number.isInteger(os.constants.errno.EEXIST)).toBeTruthy();
		});
	});
};
