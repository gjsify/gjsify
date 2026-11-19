import { describe, it, expect } from '@gjsify/unit';

import { scanParameters, splitStatements } from './sql-scan.js';

export default async () => {
    await describe('scanParameters', async () => {
        await it('numbers anonymous parameters in order', async () => {
            expect(scanParameters('SELECT ?, ?, ?')).toStrictEqual([null, null, null]);
        });

        await it('reports named parameters with their sigil', async () => {
            expect(scanParameters('INSERT INTO t VALUES (:a, @b, $c)')).toStrictEqual([':a', '@b', '$c']);
        });

        await it('counts a repeated name once', async () => {
            expect(scanParameters('SELECT :a, :b, :a')).toStrictEqual([':a', ':b']);
        });

        await it('honours ?NNN and leaves gaps null', async () => {
            expect(scanParameters('SELECT ?3, ?1')).toStrictEqual(['?1', null, '?3']);
        });

        await it('numbers an anonymous parameter after the largest index so far', async () => {
            expect(scanParameters('SELECT ?2, ?, :a')).toStrictEqual([null, '?2', null, ':a']);
            expect(scanParameters('SELECT ?1, ?1')).toStrictEqual(['?1']);
        });

        await it('reads a blob literal and a number as neither parameter nor name', async () => {
            expect(scanParameters(`SELECT x'3a40', 1e5, a$b, :p`)).toStrictEqual([':p']);
        });

        await it('ignores parameters inside strings, identifiers and comments', async () => {
            const sql = `SELECT ':x', "?y", [@z], \`$w\` -- :c1\n, /* ?c2 */ :real`;
            expect(scanParameters(sql)).toStrictEqual([':real']);
        });

        await it('handles doubled quotes inside a string', async () => {
            expect(scanParameters(`SELECT 'it''s :no', :yes`)).toStrictEqual([':yes']);
        });

        await it('does not take a bare colon or cast-like text as a parameter', async () => {
            expect(scanParameters('SELECT 1 : 2')).toStrictEqual([]);
        });
    });

    await describe('splitStatements', async () => {
        await it('splits on semicolons and drops empty pieces', async () => {
            expect(splitStatements(';; SELECT 1;  ;SELECT 2 ;')).toStrictEqual(['SELECT 1', 'SELECT 2']);
        });

        await it('keeps semicolons inside strings, identifiers and comments', async () => {
            const sql = `INSERT INTO t VALUES ('a;b'); -- x;y\nSELECT "c;d" /* ; */;`;
            expect(splitStatements(sql)).toStrictEqual([`INSERT INTO t VALUES ('a;b')`, `SELECT "c;d"`]);
        });

        await it('drops comment-only pieces', async () => {
            expect(splitStatements('-- nothing\n; /* still nothing */ ;SELECT 1')).toStrictEqual(['SELECT 1']);
        });

        await it('keeps a trigger body in one statement', async () => {
            const trigger =
                'CREATE TRIGGER tr AFTER INSERT ON t BEGIN INSERT INTO log VALUES (1); UPDATE n SET c = c + 1; END';
            expect(splitStatements(`${trigger}; SELECT 1`)).toStrictEqual([trigger, 'SELECT 1']);
        });

        await it('does not end a trigger at the END of a CASE', async () => {
            const trigger =
                'CREATE TEMP TRIGGER tr AFTER INSERT ON t BEGIN UPDATE n SET c = CASE WHEN 1 THEN 2 ELSE 3 END; INSERT INTO log VALUES (1); END';
            expect(splitStatements(`${trigger};SELECT 2`)).toStrictEqual([trigger, 'SELECT 2']);
        });

        await it('keeps a WHEN clause with its own CASE before the body', async () => {
            const trigger =
                'CREATE TRIGGER IF NOT EXISTS tr AFTER UPDATE ON t WHEN CASE WHEN new.a THEN 1 END BEGIN SELECT 1; END';
            expect(splitStatements(`${trigger};SELECT 3`)).toStrictEqual([trigger, 'SELECT 3']);
        });

        await it('returns nothing for an empty or comment-only script', async () => {
            expect(splitStatements('')).toStrictEqual([]);
            expect(splitStatements('  -- only\n /* this */ ')).toStrictEqual([]);
        });

        await it('stops at an unterminated string instead of splitting inside it', async () => {
            expect(splitStatements(`SELECT 'a;b`)).toStrictEqual([`SELECT 'a;b`]);
        });

        await it('treats a plain BEGIN as its own statement', async () => {
            expect(splitStatements('BEGIN; INSERT INTO t VALUES (1); COMMIT')).toStrictEqual([
                'BEGIN',
                'INSERT INTO t VALUES (1)',
                'COMMIT',
            ]);
        });
    });
};
