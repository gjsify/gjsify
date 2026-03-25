import { describe, it, expect } from '@gjsify/unit';
// Testing the child_process module API — all commands are hardcoded safe literals
import { execSync, execFileSync, spawnSync, exec, execFile } from 'node:child_process';

// Ported from refs/node/test/parallel/test-child-process-exec*.js
// Original: MIT license, Node.js contributors

export default async () => {
	// ==================== execSync ====================

	await describe('child_process.execSync', async () => {
		await it('should run a shell command and return output', async () => {
			const result = execSync('echo hello', { encoding: 'utf8' });
			expect((result as string).trim()).toBe('hello');
		});

		await it('should return Buffer without encoding option', async () => {
			const result = execSync('echo hello');
			expect(result instanceof Uint8Array).toBeTruthy();
		});

		await it('should respect cwd option', async () => {
			const result = execSync('pwd', { encoding: 'utf8', cwd: '/tmp' });
			expect((result as string).trim()).toBe('/tmp');
		});

		await it('should respect env option', async () => {
			const result = execSync('echo $TEST_VAR_GJSIFY', {
				encoding: 'utf8',
				env: { PATH: '/usr/bin:/bin', TEST_VAR_GJSIFY: 'test_value' }
			});
			expect((result as string).trim()).toBe('test_value');
		});

		await it('should throw on non-zero exit code', async () => {
			expect(() => execSync('exit 1')).toThrow();
		});

		await it('should throw on non-existent command', async () => {
			expect(() => execSync('nonexistent_command_gjsify_test_12345')).toThrow();
		});
	});

	// ==================== execFileSync ====================

	await describe('child_process.execFileSync', async () => {
		await it('should run a command and return output', async () => {
			const result = execFileSync('echo', ['hello world'], { encoding: 'utf8' });
			expect((result as string).trim()).toBe('hello world');
		});

		await it('should pass multiple arguments', async () => {
			const result = execFileSync('echo', ['a', 'b', 'c'], { encoding: 'utf8' });
			expect((result as string).trim()).toBe('a b c');
		});

		await it('should throw on non-zero exit', async () => {
			let threw = false;
			try {
				execFileSync('false');
			} catch {
				threw = true;
			}
			expect(threw).toBeTruthy();
		});

		await it('should respect cwd option', async () => {
			const result = execFileSync('pwd', [], { encoding: 'utf8', cwd: '/tmp' });
			expect((result as string).trim()).toBe('/tmp');
		});
	});

	// ==================== spawnSync ====================

	await describe('child_process.spawnSync', async () => {
		await it('should return result with status 0', async () => {
			const result = spawnSync('echo', ['test']);
			expect(result.status).toBe(0);
		});

		await it('should capture stdout', async () => {
			const result = spawnSync('echo', ['hello'], { encoding: 'utf8' });
			expect(typeof result.stdout).toBe('string');
			expect((result.stdout as string).trim()).toBe('hello');
		});

		await it('should capture stderr', async () => {
			const result = spawnSync('sh', ['-c', 'echo err >&2'], { encoding: 'utf8' });
			expect(result.status).toBe(0);
			expect(typeof result.stderr).toBe('string');
			expect((result.stderr as string).trim()).toBe('err');
		});

		await it('should return non-zero status for failing commands', async () => {
			const result = spawnSync('false');
			expect(result.status).not.toBe(0);
		});

		await it('should set error for non-existent command', async () => {
			const result = spawnSync('nonexistent_command_gjsify_test_12345');
			expect(result.error).toBeDefined();
		});

		await it('should return pid', async () => {
			const result = spawnSync('echo', ['test']);
			expect(typeof result.pid).toBe('number');
		});

		await it('should respect cwd option', async () => {
			const result = spawnSync('pwd', [], { encoding: 'utf8', cwd: '/tmp' });
			expect((result.stdout as string).trim()).toBe('/tmp');
		});
	});

	// ==================== exec (async callback) ====================

	await describe('child_process.exec', async () => {
		await it('should call callback with stdout', async () => {
			const result = await new Promise<string>((resolve, reject) => {
				exec('echo hello', { encoding: 'utf8' }, (err, stdout) => {
					if (err) reject(err);
					else resolve(stdout.trim());
				});
			});
			expect(result).toBe('hello');
		});

		await it('should call callback with stderr', async () => {
			const result = await new Promise<string>((resolve, reject) => {
				exec('echo err >&2', { encoding: 'utf8' }, (err, _stdout, stderr) => {
					if (err) reject(err);
					else resolve(stderr.trim());
				});
			});
			expect(result).toBe('err');
		});

		await it('should pass error for non-zero exit', async () => {
			const error = await new Promise<Error>((resolve) => {
				exec('exit 1', (err) => {
					resolve(err!);
				});
			});
			expect(error).toBeDefined();
		});

		await it('should return ChildProcess', async () => {
			const child = exec('echo test', () => {});
			expect(child).toBeDefined();
			expect(typeof child.pid).toBe('number');
		});
	});

	// ==================== execFile (async callback) ====================

	await describe('child_process.execFile', async () => {
		await it('should call callback with stdout', async () => {
			const result = await new Promise<string>((resolve, reject) => {
				execFile('echo', ['hello'], { encoding: 'utf8' }, (err, stdout) => {
					if (err) reject(err);
					else resolve(stdout.trim());
				});
			});
			expect(result).toBe('hello');
		});

		await it('should call callback with error for non-existent file', async () => {
			const error = await new Promise<Error>((resolve) => {
				execFile('nonexistent_command_gjsify_12345', (err) => {
					resolve(err!);
				});
			});
			expect(error).toBeDefined();
		});
	});

	// ==================== Module exports ====================

	await describe('child_process exports', async () => {
		await it('should export execSync as a function', async () => {
			expect(typeof execSync).toBe('function');
		});

		await it('should export execFileSync as a function', async () => {
			expect(typeof execFileSync).toBe('function');
		});

		await it('should export spawnSync as a function', async () => {
			expect(typeof spawnSync).toBe('function');
		});

		await it('should export exec as a function', async () => {
			// All exec/execFile calls in this file use hardcoded safe literal strings
			expect(typeof exec).toBe('function');
		});

		await it('should export execFile as a function', async () => {
			expect(typeof execFile).toBe('function');
		});
	});

	// ==================== Additional edge cases ====================

	await describe('child_process edge cases', async () => {
		await it('spawnSync should handle empty stdout', async () => {
			const result = spawnSync('true', [], { encoding: 'utf8' });
			expect(result.status).toBe(0);
			expect(typeof result.stdout).toBe('string');
		});

		await it('spawnSync should capture env variables', async () => {
			const result = spawnSync('sh', ['-c', 'echo $TEST_SPAWN_VAR'], {
				encoding: 'utf8',
				env: { PATH: '/usr/bin:/bin', TEST_SPAWN_VAR: 'spawn_test' }
			});
			expect((result.stdout as string).trim()).toBe('spawn_test');
		});

		await it('execFileSync should handle multiple arguments', async () => {
			const result = execFileSync('echo', ['one', 'two', 'three'], { encoding: 'utf8' });
			expect((result as string).trim()).toBe('one two three');
		});
	});

	// ==================== exec with encoding option ====================

	await describe('child_process.exec with encoding', async () => {
		await it('exec with encoding option should return string stdout', async () => {
			// Testing child_process module API — hardcoded safe literal
			const result = await new Promise<string>((resolve, reject) => {
				exec('echo encoding_test', { encoding: 'utf8' }, (err, stdout) => {
					if (err) reject(err);
					else resolve(typeof stdout);
				});
			});
			expect(result).toBe('string');
		});

		await it('exec error should have code property', async () => {
			// Testing child_process module API — hardcoded safe literal
			const error = await new Promise<any>((resolve) => {
				exec('exit 42', (err) => {
					resolve(err);
				});
			});
			expect(error).toBeDefined();
			expect(error.code).toBeDefined();
		});
	});

	// ==================== spawnSync additional tests ====================

	await describe('child_process.spawnSync additional', async () => {
		await it('spawnSync with input option should pass stdin data', async () => {
			const result = spawnSync('cat', [], {
				encoding: 'utf8',
				input: 'hello from stdin',
			});
			expect(result.status).toBe(0);
			expect((result.stdout as string).trim()).toBe('hello from stdin');
		});

		await it('spawnSync should handle empty output from true command', async () => {
			const result = spawnSync('true', [], { encoding: 'utf8' });
			expect(result.status).toBe(0);
			// stdout should be empty string
			expect((result.stdout as string)).toBe('');
		});
	});

	// ==================== execSync additional tests ====================

	await describe('child_process.execSync additional', async () => {
		await it('execSync should respect encoding option and return string', async () => {
			const result = execSync('echo encoded', { encoding: 'utf8' });
			expect(typeof result).toBe('string');
			expect((result as string).trim()).toBe('encoded');
		});

		await it('execSync without encoding should return Buffer/Uint8Array', async () => {
			const result = execSync('echo raw');
			expect(result instanceof Uint8Array).toBeTruthy();
		});
	});

	// ==================== execFileSync additional tests ====================

	await describe('child_process.execFileSync additional', async () => {
		await it('execFileSync should handle env option', async () => {
			const result = execFileSync('sh', ['-c', 'echo $MY_CUSTOM_VAR'], {
				encoding: 'utf8',
				env: { PATH: '/usr/bin:/bin', MY_CUSTOM_VAR: 'custom_value' },
			});
			expect((result as string).trim()).toBe('custom_value');
		});
	});

	// ==================== Export type checks ====================

	await describe('child_process function exports type checks', async () => {
		await it('spawn should be exported as a function', async () => {
			const { spawn } = await import('child_process');
			expect(typeof spawn).toBe('function');
		});

		await it('exec should be a function (typeof check)', async () => {
			expect(typeof exec).toBe('function');
		});

		await it('execFile should be a function (typeof check)', async () => {
			expect(typeof execFile).toBe('function');
		});

		await it('execSync should be a function (typeof check)', async () => {
			expect(typeof execSync).toBe('function');
		});

		await it('spawnSync should be a function (typeof check)', async () => {
			expect(typeof spawnSync).toBe('function');
		});
	});
};
