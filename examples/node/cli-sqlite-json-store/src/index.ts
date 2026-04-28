// SQLite-backed todo store — demonstrates node:sqlite on GJS and Node.js
// Reference: Node.js lib/sqlite.js
import '@gjsify/node-globals/register';
import { DatabaseSync } from 'node:sqlite';
import { runtimeName } from '@gjsify/runtime';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

// ---- Schema ----

const SCHEMA =
  'CREATE TABLE IF NOT EXISTS todos (' +
  'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
  'title TEXT NOT NULL, ' +
  'priority TEXT NOT NULL, ' +
  'done INTEGER NOT NULL DEFAULT 0, ' +
  'created_at TEXT NOT NULL' +
  ')';

// ---- Types ----

interface Todo {
  id: number;
  title: string;
  priority: string;
  done: boolean;
  created_at: string;
}

type Row = Record<string, unknown>;

// ---- Store ----

class SqliteTodoStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.prepare(SCHEMA).run();
  }

  create(data: { title: string; priority?: string; done?: boolean }): Todo {
    const result = this.db
      .prepare('INSERT INTO todos (title, priority, done, created_at) VALUES (:title, :priority, :done, :created_at)')
      .run({
        title: data.title,
        priority: data.priority ?? 'medium',
        done: data.done ? 1 : 0,
        created_at: new Date().toISOString(),
      });
    return this.findById(result.lastInsertRowid as number)!;
  }

  findById(id: number): Todo | undefined {
    const row = this.db
      .prepare('SELECT * FROM todos WHERE id = :id')
      .get({ id }) as Row | undefined;
    return row ? this.#toTodo(row) : undefined;
  }

  findAll(filter?: Partial<{ priority: string; done: boolean }>): Todo[] {
    const rows = this.db
      .prepare('SELECT * FROM todos ORDER BY id')
      .all() as Row[];
    const todos = rows.map(r => this.#toTodo(r));
    if (!filter) return todos;
    return todos.filter(t =>
      (filter.priority === undefined || t.priority === filter.priority) &&
      (filter.done === undefined || t.done === filter.done)
    );
  }

  update(id: number, data: Partial<Pick<Todo, 'title' | 'priority' | 'done'>>): Todo | null {
    const existing = this.findById(id);
    if (!existing) return null;
    this.db
      .prepare('UPDATE todos SET title = :title, priority = :priority, done = :done WHERE id = :id')
      .run({
        id,
        title: data.title ?? existing.title,
        priority: data.priority ?? existing.priority,
        done: (data.done ?? existing.done) ? 1 : 0,
      });
    return this.findById(id)!;
  }

  delete(id: number): boolean {
    const result = this.db
      .prepare('DELETE FROM todos WHERE id = :id')
      .run({ id });
    return (result.changes as number) > 0;
  }

  count(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM todos')
      .get() as Row | undefined;
    return (row?.count as number) ?? 0;
  }

  bulkInsert(items: Array<{ title: string; priority?: string; done?: boolean }>): void {
    const stmt = this.db.prepare(
      'INSERT INTO todos (title, priority, done, created_at) VALUES (:title, :priority, :done, :created_at)'
    );
    this.db.prepare('BEGIN').run();
    const now = new Date().toISOString();
    for (const item of items) {
      stmt.run({
        title: item.title,
        priority: item.priority ?? 'medium',
        done: item.done ? 1 : 0,
        created_at: now,
      });
    }
    this.db.prepare('COMMIT').run();
  }

  close(): void {
    this.db.close();
  }

  #toTodo(row: Row): Todo {
    return {
      id: row.id as number,
      title: row.title as string,
      priority: row.priority as string,
      done: Boolean(row.done),
      created_at: row.created_at as string,
    };
  }
}

// ---- Demo ----

function main() {
  console.log(`SQLite Todo Store running on ${runtimeName}\n`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-todos-'));
  const dbPath = path.join(tmpDir, 'todos.db');
  console.log(`Database: ${dbPath}\n`);

  const store = new SqliteTodoStore(dbPath);

  // CREATE
  console.log('--- CREATE ---');
  const t1 = store.create({ title: 'Learn GJS', priority: 'high' });
  const t2 = store.create({ title: 'Build an app', priority: 'medium' });
  const t3 = store.create({ title: 'Write tests', priority: 'high', done: true });
  console.log(`Created: ${t1.title} (id=${t1.id}, priority=${t1.priority})`);
  console.log(`Created: ${t2.title} (id=${t2.id}, priority=${t2.priority})`);
  console.log(`Created: ${t3.title} (id=${t3.id}, done=${t3.done})`);
  console.log(`Total: ${store.count()} records\n`);

  // BULK INSERT (transaction)
  console.log('--- BULK INSERT (transaction) ---');
  store.bulkInsert([
    { title: 'Setup CI', priority: 'high' },
    { title: 'Write docs', priority: 'low' },
    { title: 'Release v1', priority: 'medium' },
  ]);
  console.log(`After bulk insert: ${store.count()} records\n`);

  // READ
  console.log('--- READ ---');
  const found = store.findById(t1.id);
  console.log(`findById(${t1.id}): ${found?.title}`);

  const highPriority = store.findAll({ priority: 'high' });
  console.log(`High priority: ${highPriority.length} todos`);
  for (const t of highPriority) {
    console.log(`  [${t.done ? 'x' : ' '}] ${t.title}`);
  }

  const pending = store.findAll({ done: false });
  console.log(`Pending: ${pending.length} todos\n`);

  // UPDATE
  console.log('--- UPDATE ---');
  const updated = store.update(t1.id, { done: true });
  console.log(`Updated: ${updated?.title} → done: ${updated?.done}`);
  const updated2 = store.update(t2.id, { title: 'Build a great app', priority: 'high' });
  console.log(`Updated: id=${t2.id} → title="${updated2?.title}", priority=${updated2?.priority}\n`);

  // DELETE
  console.log('--- DELETE ---');
  const deleted = store.delete(t2.id);
  console.log(`delete(${t2.id}): ${deleted}`);
  console.log(`Remaining: ${store.count()} records\n`);

  // FINAL STATE (prepared statement reuse)
  console.log('--- FINAL STATE ---');
  const all = store.findAll();
  for (const t of all) {
    console.log(`  [${t.done ? 'x' : ' '}] id=${t.id} ${t.title} (${t.priority})`);
  }

  store.close();
  fs.rmSync(tmpDir, { recursive: true });
  console.log(`\nCleaned up ${tmpDir}`);
}

main();
