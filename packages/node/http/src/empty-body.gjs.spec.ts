// An empty body must not reach libsoup. `Soup.MessageBody.append_bytes` asserts
// `g_bytes_get_size (buffer) > 0` and logs a CRITICAL otherwise; Node is silent for
// the same handler, and frameworks answer 401/404/412 with `res.end('')` routinely.
// The CRITICAL is logged, not thrown, so the test counts it through a GLib log handler.

import { describe, expect, it, on } from '@gjsify/unit';
import { createServer, get as httpGet } from 'node:http';
import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

type LogLevel = number;
interface GLibModule {
    LogLevelFlags: { LEVEL_CRITICAL: LogLevel };
    log_set_handler(
        domain: string,
        levels: LogLevel,
        fn: (domain: string, level: LogLevel, msg: string) => void,
    ): number;
    log_remove_handler(domain: string, id: number): void;
}

const answers: Array<[string, number, (res: ServerResponse) => void]> = [
    ["end('')", 401, (res) => res.end('')],
    ['end(Buffer.alloc(0))', 404, (res) => res.end(Buffer.alloc(0))],
    [
        "write('') + end()",
        412,
        (res) => {
            res.write('');
            res.end();
        },
    ],
    [
        'write(Buffer.alloc(0)) + end()',
        200,
        (res) => {
            res.write(Buffer.alloc(0));
            res.end();
        },
    ],
];

export default async () => {
    await on('Gjs', async () => {
        await describe('http: empty body chunks', async () => {
            const GLib = (await import('gi://GLib?version=2.0' as string)).default as GLibModule;

            for (const [label, status, answer] of answers) {
                await it(`${label} answers ${status} without a libsoup CRITICAL`, async () => {
                    const criticals: string[] = [];
                    const handler = GLib.log_set_handler(
                        'libsoup',
                        GLib.LogLevelFlags.LEVEL_CRITICAL,
                        (_d, _l, msg) => {
                            criticals.push(msg);
                        },
                    );
                    const server = createServer((_req: IncomingMessage, res: ServerResponse) => {
                        res.writeHead(status);
                        answer(res);
                    });
                    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
                    const port = (server.address() as AddressInfo).port;
                    try {
                        const result = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
                            httpGet(`http://127.0.0.1:${port}/`, (res: IncomingMessage) => {
                                let body = '';
                                res.setEncoding('utf8');
                                res.on('data', (c: string) => {
                                    body += c;
                                });
                                res.on('end', () => resolve({ statusCode: res.statusCode!, body }));
                                res.on('error', reject);
                            }).on('error', reject);
                        });
                        expect(result.statusCode).toBe(status);
                        expect(result.body).toBe('');
                        expect(criticals.join('\n')).toBe('');
                    } finally {
                        GLib.log_remove_handler('libsoup', handler);
                        await new Promise<void>((resolve) => server.close(() => resolve()));
                    }
                });
            }
        });
    });
};
