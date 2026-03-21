import { spawn, ChildProcess, SpawnOptionsWithoutStdio } from 'child_process';

export interface Resolve {
    stdout: string;
    stderr: string;
}

export interface Reject {
    code: number;
    stdout?: string;
    stderr: string;
}

export const run = (cmd: string, args: string[], options: SpawnOptionsWithoutStdio) => {
    return new Promise((resolve: (value: Resolve) => void, reject: (reason?: Reject) => void) => {

        let stdout = '';
        let stderr = '';

        const child: ChildProcess = spawn(cmd, args, options);

        child.stdout.pipe(process.stdout);
        child.stdout.on('data', function (data) {
            this.emit('stdout', data);
            stdout += data.toString();
        });

        child.stderr.pipe(process.stderr);
        child.stderr.on('data', function (data) {
            this.emit('stderr', data);
            stderr += data.toString();
        });

        child.on('close', function (code, signal) {            
            let result: Resolve = {
                stdout: stdout.toString(),
                stderr: stderr.toString()
            };

            if (code === 0) {
                return resolve(result);
            }

            const reason: Reject = {
                ...result,
                code,
            }

            return reject(reason);
        });

    });
}
