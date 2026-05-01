import { describe, it, expect, on } from '@gjsify/unit';
// Testing the child_process module API — all commands are hardcoded safe literals
import { execSync, execFileSync, spawnSync, exec, execFile, spawn } from 'node:child_process';

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
			const { spawn } = await import('node:child_process');
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

	// ==================== spawn (async event-based) ====================
	// Ported from refs/node-test/parallel/test-child-process-spawn*.js
	// Original: MIT license, Node.js contributors

	await describe('child_process.spawn', async () => {
		await it('should return a ChildProcess with pid', async () => {
			const { spawn } = await import('node:child_process');
			const child = spawn('echo', ['test']);
			expect(child).toBeDefined();
			expect(typeof child.pid).toBe('number');
			expect(child.pid! > 0).toBeTruthy();
			await new Promise<void>((resolve) => child.on('close', () => resolve()));
		});

		await it('should emit spawn event', async () => {
			const { spawn } = await import('node:child_process');
			const child = spawn('echo', ['test']);
			const spawned = await new Promise<boolean>((resolve) => {
				child.on('spawn', () => resolve(true));
				setTimeout(() => resolve(false), 5000);
			});
			expect(spawned).toBeTruthy();
			await new Promise<void>((resolve) => child.on('close', () => resolve()));
		});

		await it('should emit exit event with exit code', async () => {
			const { spawn } = await import('node:child_process');
			const child = spawn('echo', ['hello']);
			const code = await new Promise<number | null>((resolve) => {
				child.on('exit', (exitCode) => resolve(exitCode));
			});
			expect(code).toBe(0);
		});

		await it('should emit close event after exit', async () => {
			const { spawn } = await import('node:child_process');
			const child = spawn('echo', ['hello']);
			const events: string[] = [];
			child.on('exit', () => events.push('exit'));
			child.on('close', () => events.push('close'));
			await new Promise<void>((resolve) => child.on('close', () => resolve()));
			expect(events.length).toBe(2);
			expect(events[0]).toBe('exit');
			expect(events[1]).toBe('close');
		});

		await it('should emit non-zero exit code for failing command', async () => {
			const { spawn } = await import('node:child_process');
			const child = spawn('false');
			const code = await new Promise<number | null>((resolve) => {
				child.on('exit', (exitCode) => resolve(exitCode));
			});
			expect(code).not.toBe(0);
		});

		await it('should emit error for non-existent command', async () => {
			const { spawn } = await import('node:child_process');
			const child = spawn('nonexistent_command_gjsify_test_12345');
			const err = await new Promise<Error>((resolve) => {
				child.on('error', (e) => resolve(e));
			});
			expect(err).toBeDefined();
		});

		await it('should support shell option', async () => {
			const { spawn } = await import('node:child_process');
			// Testing child_process API — hardcoded safe shell expression
			const child = spawn('echo $((1+2))', [], { shell: true });
			const code = await new Promise<number | null>((resolve) => {
				child.on('exit', (exitCode) => resolve(exitCode));
			});
			expect(code).toBe(0);
		});

		await it('should support cwd option', async () => {
			const { spawn } = await import('node:child_process');
			const child = spawn('pwd', [], { cwd: '/tmp' });
			const code = await new Promise<number | null>((resolve) => {
				child.on('exit', (exitCode) => resolve(exitCode));
			});
			expect(code).toBe(0);
		});

		await it('should support env option', async () => {
			const { spawn } = await import('node:child_process');
			const child = spawn('sh', ['-c', 'echo $MY_SPAWN_VAR'], {
				env: { PATH: '/usr/bin:/bin', MY_SPAWN_VAR: 'spawn_val' }
			});
			const code = await new Promise<number | null>((resolve) => {
				child.on('exit', (exitCode) => resolve(exitCode));
			});
			expect(code).toBe(0);
		});
	});

	// ==================== ChildProcess kill ====================
	// Ported from refs/node-test/parallel/test-child-process-kill.js
	// Original: MIT license, Node.js contributors

	await describe('ChildProcess.kill', async () => {
		await it('should kill a running process', async () => {
			const { spawn } = await import('node:child_process');
			const child = spawn('sleep', ['10']);
			expect(child.killed).toBeFalsy();

			const killed = child.kill();
			expect(killed).toBeTruthy();
			expect(child.killed).toBeTruthy();

			await new Promise<void>((resolve) => child.on('close', () => resolve()));
		});

		await it('should kill with SIGKILL', async () => {
			const { spawn } = await import('node:child_process');
			const child = spawn('sleep', ['10']);

			child.kill('SIGKILL');
			expect(child.killed).toBeTruthy();

			await new Promise<void>((resolve) => child.on('close', () => resolve()));
		});

		await it('should set exitCode after process exits', async () => {
			const { spawn } = await import('node:child_process');
			const child = spawn('echo', ['test']);

			await new Promise<void>((resolve) => child.on('close', () => resolve()));
			expect(child.exitCode).toBe(0);
		});
	});

	// ==================== exec edge cases ====================
	// Ported from refs/node-test/parallel/test-child-process-exec-*.js
	// Original: MIT license, Node.js contributors

	await describe('child_process.exec edge cases', async () => {
		await it('should handle multi-line output', async () => {
			// Testing child_process API — hardcoded safe shell command
			const result = await new Promise<string>((resolve, reject) => {
				exec('echo line1 && echo line2', { encoding: 'utf8' }, (err, stdout) => {
					if (err) reject(err);
					else resolve(stdout);
				});
			});
			const lines = result.trim().split('\n');
			expect(lines.length).toBe(2);
			expect(lines[0]).toBe('line1');
			expect(lines[1]).toBe('line2');
		});

		await it('should return ChildProcess with pid', async () => {
			// Testing child_process API — hardcoded safe literal
			const child = exec('echo test', () => {});
			expect(typeof child.pid).toBe('number');
			expect(child.pid! > 0).toBeTruthy();
			await new Promise<void>((resolve) => child.on('close', () => resolve()));
		});

		await it('should call callback with error for syntax error', async () => {
			// Testing child_process error handling — hardcoded safe literal
			const error = await new Promise<Error>((resolve) => {
				exec('if', (err) => {
					resolve(err!);
				});
			});
			expect(error).toBeDefined();
		});

		await it('exec with custom env should override process env', async () => {
			// Testing child_process API — hardcoded safe env variable
			const result = await new Promise<string>((resolve, reject) => {
				exec('echo $EXEC_TEST_CUSTOM', {
					encoding: 'utf8',
					env: { PATH: '/usr/bin:/bin', EXEC_TEST_CUSTOM: 'custom_val' }
				}, (err, stdout) => {
					if (err) reject(err);
					else resolve(stdout.trim());
				});
			});
			expect(result).toBe('custom_val');
		});

		await it('exec with cwd should change working directory', async () => {
			// Testing child_process API — hardcoded safe literal
			const result = await new Promise<string>((resolve, reject) => {
				exec('pwd', { encoding: 'utf8', cwd: '/tmp' }, (err, stdout) => {
					if (err) reject(err);
					else resolve(stdout.trim());
				});
			});
			expect(result).toBe('/tmp');
		});
	});

	// ==================== execFile edge cases ====================

	await describe('child_process.execFile edge cases', async () => {
		await it('should pass arguments correctly', async () => {
			const result = await new Promise<string>((resolve, reject) => {
				execFile('echo', ['arg1', 'arg2', 'arg3'], { encoding: 'utf8' }, (err, stdout) => {
					if (err) reject(err);
					else resolve(stdout.trim());
				});
			});
			expect(result).toBe('arg1 arg2 arg3');
		});

		await it('should handle empty args', async () => {
			const result = await new Promise<string>((resolve, reject) => {
				execFile('echo', [], { encoding: 'utf8' }, (err, stdout) => {
					if (err) reject(err);
					else resolve(stdout);
				});
			});
			expect(typeof result).toBe('string');
		});

		await it('execFile should set exitCode on ChildProcess', async () => {
			const child = execFile('echo', ['test'], { encoding: 'utf8' }, () => {});
			await new Promise<void>((resolve) => child.on('close', () => resolve()));
			expect(child.exitCode).toBe(0);
		});
	});

	// ==================== spawnSync extended ====================
	// Ported from refs/node-test/parallel/test-child-process-spawnsync*.js
	// Original: MIT license, Node.js contributors

	await describe('child_process.spawnSync extended', async () => {
		await it('should return output array with stdout and stderr', async () => {
			const result = spawnSync('echo', ['out'], { encoding: 'utf8' });
			expect(result.output).toBeDefined();
			expect(Array.isArray(result.output)).toBeTruthy();
			// output[0] is stdin (null), output[1] is stdout, output[2] is stderr
			expect(result.output.length).toBeGreaterThanOrEqual(3);
		});

		await it('should handle shell option', async () => {
			const result = spawnSync('echo', ['$((2+3))'], { encoding: 'utf8', shell: true });
			expect(result.status).toBe(0);
			expect((result.stdout as string).trim()).toBe('5');
		});

		await it('should handle large output', async () => {
			const result = spawnSync('seq', ['1', '1000'], { encoding: 'utf8' });
			expect(result.status).toBe(0);
			const lines = (result.stdout as string).trim().split('\n');
			expect(lines.length).toBe(1000);
			expect(lines[0]).toBe('1');
			expect(lines[999]).toBe('1000');
		});

		await it('should handle process that outputs nothing to stderr', async () => {
			const result = spawnSync('echo', ['clean'], { encoding: 'utf8' });
			expect(result.status).toBe(0);
			expect(result.stderr).toBe('');
		});

		await it('signal should be null for normal exit', async () => {
			const result = spawnSync('true');
			expect(result.signal).toBeNull();
		});

		await it('should handle input with special characters', async () => {
			const input = 'hello\nworld\ttab "quotes" \'single\'';
			const result = spawnSync('cat', [], {
				encoding: 'utf8',
				input,
			});
			expect(result.status).toBe(0);
			expect(result.stdout).toBe(input);
		});
	});

	// ==================== execSync extended ====================
	// Ported from refs/node-test/parallel/test-child-process-execsync*.js
	// Original: MIT license, Node.js contributors

	await describe('child_process.execSync extended', async () => {
		await it('should handle multi-line command output', async () => {
			const result = execSync('echo line1 && echo line2', { encoding: 'utf8' });
			const lines = (result as string).trim().split('\n');
			expect(lines.length).toBe(2);
		});

		await it('error should have status property', async () => {
			let error: any = null;
			try {
				execSync('exit 42');
			} catch (e) {
				error = e;
			}
			expect(error).toBeDefined();
			expect(error.status).toBe(42);
		});

		await it('error should have stderr property', async () => {
			let error: any = null;
			try {
				execSync('echo err_msg >&2; exit 1');
			} catch (e) {
				error = e;
			}
			expect(error).toBeDefined();
			expect(error.stderr).toBeDefined();
			expect(error.stderr.includes('err_msg')).toBeTruthy();
		});

		await it('should handle shell that outputs to both stdout and stderr', async () => {
			const result = execSync('echo out && echo err >&2', { encoding: 'utf8' });
			expect((result as string).trim()).toBe('out');
		});

		await it('should handle input option', async () => {
			const result = execSync('cat', { encoding: 'utf8', input: 'piped_input' });
			expect((result as string).trim()).toBe('piped_input');
		});

		await it('should handle command with pipe', async () => {
			const result = execSync('echo hello world | tr a-z A-Z', { encoding: 'utf8' });
			expect((result as string).trim()).toBe('HELLO WORLD');
		});
	});

	// ==================== execFileSync extended ====================

	await describe('child_process.execFileSync extended', async () => {
		await it('should return Buffer without encoding', async () => {
			const result = execFileSync('echo', ['raw']);
			expect(result instanceof Uint8Array).toBeTruthy();
		});

		await it('error should have status and stderr', async () => {
			let error: any = null;
			try {
				execFileSync('sh', ['-c', 'echo err >&2; exit 3']);
			} catch (e) {
				error = e;
			}
			expect(error).toBeDefined();
			expect(error.status).toBe(3);
		});

		await it('should handle empty arguments', async () => {
			const result = execFileSync('true');
			// true produces no output
			expect(result instanceof Uint8Array).toBeTruthy();
		});

		await it('should handle cwd and env together', async () => {
			const result = execFileSync('sh', ['-c', 'echo $COMBO_VAR && pwd'], {
				encoding: 'utf8',
				cwd: '/tmp',
				env: { PATH: '/usr/bin:/bin', COMBO_VAR: 'combined' },
			});
			const lines = (result as string).trim().split('\n');
			expect(lines[0]).toBe('combined');
			expect(lines[1]).toBe('/tmp');
		});
	});

	// ==================== spawn() with streaming stdout/stderr ====================

	await describe('child_process.spawn stdout/stderr streaming', async () => {
		await it('spawn() sets proc.stdout as a Readable', async () => {
			const proc = spawn('echo', ['streaming_test']);
			expect(proc.stdout).toBeDefined();
			expect(typeof proc.stdout!.on).toBe('function');
		});

		await it('spawn() stdout emits data event with subprocess output', async () => {
			const output = await new Promise<string>((resolve, reject) => {
				const proc = spawn('echo', ['hello_stream']);
				expect(proc.stdout).toBeDefined();
				let buf = '';
				proc.stdout!.on('data', (chunk: Buffer) => { buf += chunk.toString(); });
				proc.stdout!.on('end', () => resolve(buf.trim()));
				proc.on('error', reject);
				setTimeout(() => reject(new Error('spawn stdout timeout')), 5000);
			});
			expect(output).toBe('hello_stream');
		});

		await it('spawn() stderr emits data event with subprocess stderr output', async () => {
			const output = await new Promise<string>((resolve, reject) => {
				const proc = spawn('sh', ['-c', 'echo err_stream >&2']);
				expect(proc.stderr).toBeDefined();
				let buf = '';
				proc.stderr!.on('data', (chunk: Buffer) => { buf += chunk.toString(); });
				proc.stderr!.on('end', () => resolve(buf.trim()));
				proc.on('error', reject);
				setTimeout(() => reject(new Error('spawn stderr timeout')), 5000);
			});
			expect(output).toBe('err_stream');
		});
	});

	await on('Gjs', async () => {
		await describe('child_process.spawn — GJS-from-GJS', async () => {
			await it('spawning a gjs child fires close with exit code 0', async () => {
				// Minimal script that does nothing — gjs exits 0 naturally.
				const code = await new Promise<number | null>((resolve, reject) => {
					const child = spawn('gjs', ['-c', 'const x = 1;']);
					child.on('close', resolve);
					child.on('error', reject);
					setTimeout(() => reject(new Error('gjs child did not close within 10 s')), 10_000);
				});
				expect(code).toBe(0);
			});

			await it('spawning a gjs child that throws fires close with non-zero exit code', async () => {
				// Uncaught throw — gjs exits 1.
				const code = await new Promise<number | null>((resolve, reject) => {
					const child = spawn('gjs', ['-c', 'throw new Error("intentional")']);
					child.on('close', resolve);
					child.on('error', reject);
					setTimeout(() => reject(new Error('gjs child did not close within 10 s')), 10_000);
				});
				expect(code).not.toBe(0);
			});
		});
	});
};
