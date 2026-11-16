import { describe, it, expect } from '@gjsify/unit';

import { createSqliteDriver, toDriverError, type RawBackend, type RawStatement } from './driver.js';

interface Fake {
    log: string[];
    opened: string[];
    backend: RawBackend;
    /** Rows the next `SELECT changes(), last_insert_rowid()` reports. */
    counters: [string, string];
    failOn?: (sql: string) => Error | null;
}

function createFake(): Fake {
    const fake: Fake = { log: [], opened: [], counters: ['0', '0'], backend: null as unknown as RawBackend };
    fake.backend = {
        open(path, mode, uri) {
            fake.opened.push(`${path}|${mode}|${uri}`);
            return {
                prepare(sql: string): RawStatement {
                    const failure = fake.failOn?.(sql);
                    if (failure) throw failure;
                    let stepped = false;
                    const bookkeeping = sql.startsWith('SELECT changes()');
                    return {
                        bindNull: (i) => void fake.log.push(`null ${i}`),
                        bindLong: (i, v) => void fake.log.push(`long ${i} ${typeof v} ${v}`),
                        bindDouble: (i, v) => void fake.log.push(`double ${i} ${v}`),
                        bindText: (i, v) => void fake.log.push(`text ${i} ${v}`),
                        bindBlob: (i, v) => void fake.log.push(`blob ${i} ${Array.from(v).join(',')}`),
                        step: () => {
                            if (bookkeeping) {
                                const had = !stepped;
                                stepped = true;
                                return had;
                            }
                            fake.log.push(`step ${sql}`);
                            return false;
                        },
                        reset: () => {
                            stepped = false;
                        },
                        clearBindings: () => void fake.log.push('clear'),
                        close: () => void fake.log.push(`close ${sql}`),
                        getColumnCount: () => 1,
                        getColumnName: () => 'c',
                        getColumnType: () => 1,
                        getDouble: () => 0,
                        getText: (i) => fake.counters[i],
                        getBlob: () => new Uint8Array([1, 2, 255]),
                    };
                },
                close: () => void fake.log.push('close connection'),
            };
        },
    };
    return fake;
}

export default async () => {
    await describe('toDriverError', async () => {
        await it('parses the primary code and message', async () => {
            const e = toDriverError(new Error('Error code: 1, message: near "SELEC": syntax error')) as Error & {
                code: number;
            };
            expect(e.code).toBe(1);
            expect(e.message).toBe('near "SELEC": syntax error');
        });

        await it('maps constraint messages to their extended code', async () => {
            const cases: [string, number][] = [
                ['UNIQUE constraint failed: t.u', 2067],
                ['NOT NULL constraint failed: nn.a', 1299],
                ['FOREIGN KEY constraint failed', 787],
                ['CHECK constraint failed: c', 275],
            ];
            for (const [message, expected] of cases) {
                const e = toDriverError(new Error(`Error code: 19, message: ${message}`)) as Error & { code: number };
                expect(e.code).toBe(expected);
                expect(e.message).toBe(message);
            }
        });

        await it('reads the Java exception message when the wrapper has none', async () => {
            const cause = { nativeException: { getMessage: () => 'Error code: 5, message: database is locked' } };
            const e = toDriverError(cause) as Error & { code: number };
            expect(e.code).toBe(5);
            expect(e.message).toBe('database is locked');
        });

        await it('reports code 0 for a failure without a SQLite code', async () => {
            expect((toDriverError(new Error('boom')) as Error & { code: number }).code).toBe(0);
        });
    });

    await describe('createSqliteDriver', async () => {
        await it('passes open arguments through and exposes the enums', async () => {
            const fake = createFake();
            const driver = createSqliteDriver(fake.backend);
            driver.Database.open(':memory:', driver.OpenMode.READWRITE_CREATE, false);
            expect(fake.opened).toStrictEqual([`:memory:|${driver.OpenMode.READWRITE_CREATE}|false`]);
            expect(driver.StepResult.ROW === driver.StepResult.DONE).toBe(false);
        });

        await it('resolves parameter names, indices and count', async () => {
            const driver = createSqliteDriver(createFake().backend);
            const db = driver.Database.open(':memory:', driver.OpenMode.READWRITE_CREATE, false);
            const st = db.prepare('INSERT INTO t VALUES (:a, ?, @b)');
            expect(st.bind_parameter_count).toBe(3);
            expect(st.bind_parameter_index(':a')).toBe(1);
            expect(st.bind_parameter_index('@b')).toBe(3);
            expect(st.bind_parameter_index(':nope')).toBe(0);
            expect(st.bind_parameter_name(1)).toBe(':a');
            expect(st.bind_parameter_name(2)).toBe(null);
        });

        await it('runs every statement of exec(), including a trigger, then finalises them', async () => {
            const fake = createFake();
            const driver = createSqliteDriver(fake.backend);
            const db = driver.Database.open(':memory:', driver.OpenMode.READWRITE_CREATE, false);
            db.exec(
                'CREATE TABLE t(a); CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT 1; SELECT 2; END; INSERT INTO t VALUES (1)',
            );
            const stepped = fake.log.filter((l) => l.startsWith('step '));
            expect(stepped.length).toBe(3);
            expect(stepped[1]).toBe('step CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT 1; SELECT 2; END');
            expect(fake.log.filter((l) => l.startsWith('close ')).length).toBe(3);
        });

        await it('reads changes and last_insert_rowid through a SELECT', async () => {
            const fake = createFake();
            const driver = createSqliteDriver(fake.backend);
            const db = driver.Database.open(':memory:', driver.OpenMode.READWRITE_CREATE, false);
            fake.counters = ['3', '42'];
            expect(db.changes).toBe(3);
            expect(db.last_insert_rowid).toBe(42);
            fake.counters = ['0', '43'];
            expect(db.last_insert_rowid).toBe(43);
        });

        await it('tracks in_transaction across BEGIN, SAVEPOINT, RELEASE and COMMIT', async () => {
            const driver = createSqliteDriver(createFake().backend);
            const db = driver.Database.open(':memory:', driver.OpenMode.READWRITE_CREATE, false);
            expect(db.in_transaction).toBe(false);
            db.exec('BEGIN');
            expect(db.in_transaction).toBe(true);
            db.exec('SAVEPOINT s');
            db.exec('RELEASE s');
            expect(db.in_transaction).toBe(true);
            db.exec('COMMIT');
            expect(db.in_transaction).toBe(false);
            db.exec('SAVEPOINT s');
            expect(db.in_transaction).toBe(true);
            db.exec('RELEASE s');
            expect(db.in_transaction).toBe(false);
            db.exec('BEGIN');
            db.exec('ROLLBACK');
            expect(db.in_transaction).toBe(false);
        });

        await it('maps values: 64-bit integers stay exact, blobs arrive as bytes', async () => {
            const fake = createFake();
            const driver = createSqliteDriver(fake.backend);
            const db = driver.Database.open(':memory:', driver.OpenMode.READWRITE_CREATE, false);
            const st = db.prepare('SELECT ?, ?');
            st.bind_int64(1, 9007199254740993n);
            st.bind_blob(2, new Uint8Array([9, 8]));
            st.bind_blob(2, { get_data: () => new Uint8Array([7]) });
            expect(fake.log.includes('long 1 bigint 9007199254740993')).toBe(true);
            expect(fake.log.includes('blob 2 9,8')).toBe(true);
            expect(fake.log.includes('blob 2 7')).toBe(true);
            expect(Array.from(st.column_blob(0).get_data()!)).toStrictEqual([1, 2, 255]);
        });

        await it('turns a backend failure into an Error with the SQLite code', async () => {
            const fake = createFake();
            fake.failOn = (sql) =>
                sql.startsWith('SELEC ') ? new Error('Error code: 1, message: syntax error') : null;
            const driver = createSqliteDriver(fake.backend);
            const db = driver.Database.open(':memory:', driver.OpenMode.READWRITE_CREATE, false);
            let caught: (Error & { code?: number }) | null = null;
            try {
                db.prepare('SELEC 1');
            } catch (e) {
                caught = e as Error & { code?: number };
            }
            expect(caught?.code).toBe(1);
            expect(caught?.message).toBe('syntax error');
        });

        await it('finalises live statements on close() and rejects later use', async () => {
            const fake = createFake();
            const driver = createSqliteDriver(fake.backend);
            const db = driver.Database.open(':memory:', driver.OpenMode.READWRITE_CREATE, false);
            const st = db.prepare('SELECT 1');
            db.close();
            expect(st.is_valid).toBe(false);
            expect(db.is_open).toBe(false);
            expect(fake.log.includes('close SELECT 1')).toBe(true);
            expect(fake.log[fake.log.length - 1]).toBe('close connection');
            expect(() => db.prepare('SELECT 1')).toThrow('database is not open');
        });
    });
};
