// Worker pool example for Node.js and GJS
// Demonstrates: worker_threads (MessageChannel, MessagePort, postMessage),
// events (EventEmitter), process, crypto (randomUUID)
// Note: On GJS, workers use Gio.Subprocess, not true threads

import '@gjsify/node-globals';
import { runtimeName } from '@gjsify/runtime';
import { EventEmitter } from 'node:events';
import { MessageChannel } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';

// ANSI colors
const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';

// ---- Task definitions ----

interface Task {
  id: string;
  type: string;
  data: unknown;
}

interface TaskResult {
  taskId: string;
  result: unknown;
  duration: number;
}

/** CPU-bound task: compute Fibonacci number. */
function fibonacci(n: number): number {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    const temp = a + b;
    a = b;
    b = temp;
  }
  return b;
}

/** CPU-bound task: check if a number is prime. */
function isPrime(n: number): boolean {
  if (n < 2) return false;
  if (n < 4) return true;
  if (n % 2 === 0 || n % 3 === 0) return false;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

/** Execute a task and return the result. */
function executeTask(task: Task): TaskResult {
  const start = Date.now();
  let result: unknown;

  switch (task.type) {
    case 'fibonacci':
      result = fibonacci(task.data as number);
      break;
    case 'isPrime':
      result = isPrime(task.data as number);
      break;
    case 'sort': {
      const arr = [...(task.data as number[])];
      arr.sort((a, b) => a - b);
      result = arr.length; // Return count (not the full array for display)
      break;
    }
    default:
      result = null;
  }

  return { taskId: task.id, result, duration: Date.now() - start };
}

// ---- Worker Pool (in-process, using MessageChannel for communication) ----

class WorkerPool extends EventEmitter {
  private poolSize: number;
  private taskQueue: Task[] = [];
  private activeWorkers = 0;
  private completedTasks = 0;

  constructor(poolSize: number) {
    super();
    this.poolSize = poolSize;
  }

  /** Submit a task to the pool. */
  submit(task: Task): void {
    this.taskQueue.push(task);
    this._processNext();
  }

  /** Process the next task in the queue. */
  private _processNext(): void {
    if (this.activeWorkers >= this.poolSize || this.taskQueue.length === 0) return;

    const task = this.taskQueue.shift()!;
    this.activeWorkers++;

    // Use MessageChannel to simulate worker communication
    // port1 = main side, port2 = worker side
    const { port1, port2 } = new MessageChannel();

    // "Worker" side: listen for task on port2, compute, send result back on port2
    port2.on('message', (msg: Task) => {
      const result = executeTask(msg);
      port2.postMessage(result);
    });

    // "Main" side: receive result on port1
    port1.on('message', (result: TaskResult) => {
      this.activeWorkers--;
      this.completedTasks++;
      port1.close();
      port2.close();
      this.emit('result', result);
      this._processNext();
    });

    // Send the task to the "worker" via port1 → arrives on port2
    port1.postMessage(task);
  }

  get pending(): number { return this.taskQueue.length; }
  get active(): number { return this.activeWorkers; }
  get completed(): number { return this.completedTasks; }
}

// ---- Main ----

async function main(): Promise<void> {
  const poolSize = 4;
  console.log(`${BOLD}${CYAN}gjsify Worker Pool${RESET}`);
  console.log(`${DIM}Runtime: ${runtimeName} | Pool size: ${poolSize}${RESET}`);
  console.log('');

  const pool = new WorkerPool(poolSize);
  const results: TaskResult[] = [];
  const startTime = Date.now();

  // Collect results
  pool.on('result', (result: TaskResult) => {
    results.push(result);
    console.log(`  ${GREEN}Done:${RESET} ${result.taskId.slice(0, 8)}... → ${result.result} (${result.duration}ms)`);
  });

  // Submit various tasks
  const tasks: Task[] = [
    { id: randomUUID(), type: 'fibonacci', data: 40 },
    { id: randomUUID(), type: 'fibonacci', data: 45 },
    { id: randomUUID(), type: 'isPrime', data: 999999937 },
    { id: randomUUID(), type: 'isPrime', data: 999999938 },
    { id: randomUUID(), type: 'fibonacci', data: 35 },
    { id: randomUUID(), type: 'sort', data: Array.from({ length: 100000 }, () => Math.floor(Math.random() * 1000000)) },
    { id: randomUUID(), type: 'isPrime', data: 2147483647 },
    { id: randomUUID(), type: 'fibonacci', data: 50 },
  ];

  console.log(`${YELLOW}Submitting ${tasks.length} tasks...${RESET}`);
  console.log('');

  for (const task of tasks) {
    console.log(`  ${DIM}Submit:${RESET} ${task.id.slice(0, 8)}... [${task.type}(${typeof task.data === 'object' ? 'array' : task.data})]`);
    pool.submit(task);
  }

  // Wait for all tasks to complete
  await new Promise<void>((resolve) => {
    const check = () => {
      if (pool.completed >= tasks.length) {
        resolve();
      } else {
        setTimeout(check, 10);
      }
    };
    check();
  });

  const totalTime = Date.now() - startTime;
  console.log('');
  console.log(`${DIM}─────────────────────────────────${RESET}`);
  console.log(`${GREEN}${results.length}${RESET} tasks completed in ${totalTime}ms`);
  console.log(`${DIM}Pool size: ${poolSize} | Total task time: ${results.reduce((sum, r) => sum + r.duration, 0)}ms${RESET}`);
}

await main();
