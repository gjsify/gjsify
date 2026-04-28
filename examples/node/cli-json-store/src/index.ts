// JSON file-based data store — demonstrates fs, crypto, buffer, path on GJS
// Reference: Node.js fs, crypto, path APIs
import { runtimeName } from '@gjsify/runtime';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as os from 'node:os';

// ---- JSON Store ----

interface Record {
  id: string;
  createdAt: string;
  updatedAt: string;
  [key: string]: unknown;
}

class JsonStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    // Ensure the file exists
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf8');
    }
  }

  private readAll(): Record[] {
    const data = fs.readFileSync(this.filePath, 'utf8');
    return JSON.parse(data);
  }

  private writeAll(records: Record[]): void {
    fs.writeFileSync(this.filePath, JSON.stringify(records, null, 2), 'utf8');
  }

  /** Create a new record with auto-generated ID. */
  create(data: Omit<Record, 'id' | 'createdAt' | 'updatedAt'>): Record {
    const records = this.readAll();
    const now = new Date().toISOString();
    const record: Record = {
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      ...data,
    };
    records.push(record);
    this.writeAll(records);
    return record;
  }

  /** Find a record by ID. */
  findById(id: string): Record | undefined {
    return this.readAll().find(r => r.id === id);
  }

  /** Find all records matching a predicate. */
  findAll(predicate?: (r: Record) => boolean): Record[] {
    const records = this.readAll();
    return predicate ? records.filter(predicate) : records;
  }

  /** Update a record by ID. */
  update(id: string, data: Partial<Record>): Record | null {
    const records = this.readAll();
    const idx = records.findIndex(r => r.id === id);
    if (idx === -1) return null;
    records[idx] = {
      ...records[idx],
      ...data,
      id, // Preserve ID
      updatedAt: new Date().toISOString(),
    };
    this.writeAll(records);
    return records[idx];
  }

  /** Delete a record by ID. Returns true if found. */
  delete(id: string): boolean {
    const records = this.readAll();
    const filtered = records.filter(r => r.id !== id);
    if (filtered.length === records.length) return false;
    this.writeAll(filtered);
    return true;
  }

  /** Count all records. */
  count(): number {
    return this.readAll().length;
  }
}

// ---- Demo ----

function main() {
  console.log(`JSON Store running on ${runtimeName}\n`);

  // Create store in temp directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-store-'));
  const dbPath = path.join(tmpDir, 'todos.json');
  console.log(`Database: ${dbPath}\n`);

  const store = new JsonStore(dbPath);

  // CREATE
  console.log('--- CREATE ---');
  const todo1 = store.create({ title: 'Learn GJS', done: false, priority: 'high' });
  const todo2 = store.create({ title: 'Build an app', done: false, priority: 'medium' });
  const todo3 = store.create({ title: 'Write tests', done: true, priority: 'high' });
  console.log(`Created: ${todo1.title} (${todo1.id})`);
  console.log(`Created: ${todo2.title} (${todo2.id})`);
  console.log(`Created: ${todo3.title} (${todo3.id})`);
  console.log(`Total: ${store.count()} records\n`);

  // READ
  console.log('--- READ ---');
  const found = store.findById(todo1.id);
  console.log(`Found by ID: ${found?.title} (priority: ${found?.priority})`);

  const highPriority = store.findAll(r => r.priority === 'high');
  console.log(`High priority: ${highPriority.length} records`);

  const completed = store.findAll(r => r.done === true);
  console.log(`Completed: ${completed.length} records\n`);

  // UPDATE
  console.log('--- UPDATE ---');
  const updated = store.update(todo1.id, { done: true });
  console.log(`Updated: ${updated?.title} → done: ${updated?.done}\n`);

  // DELETE
  console.log('--- DELETE ---');
  const deleted = store.delete(todo2.id);
  console.log(`Deleted ${todo2.title}: ${deleted}`);
  console.log(`Remaining: ${store.count()} records\n`);

  // Final state
  console.log('--- FINAL STATE ---');
  const all = store.findAll();
  for (const record of all) {
    console.log(`  [${record.done ? 'x' : ' '}] ${record.title} (${record.id.slice(0, 8)}...)`);
  }

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true });
  console.log(`\nCleaned up ${tmpDir}`);
}

main();
