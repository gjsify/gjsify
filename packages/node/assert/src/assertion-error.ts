// Reference: Node.js lib/internal/assert/assertion_error.js
// Reimplemented for GJS

import { safeInspect } from './inspect-fallback.js';

interface AssertionErrorOptions {
  actual?: unknown;
  expected?: unknown;
  message?: string | Error;
  operator?: string;
  stackStartFn?: Function;
}

export class AssertionError extends Error {
  actual: unknown;
  expected: unknown;
  operator: string;
  code: string;
  generatedMessage: boolean;

  constructor(options: AssertionErrorOptions) {
    const {
      actual,
      expected,
      operator = 'fail',
      stackStartFn,
    } = options;

    const isGenerated = options.message == null;
    const message = isGenerated
      ? generateMessage(actual, expected, operator)
      : String(options.message);

    // super() must be called before any `this` access (SpiderMonkey requirement)
    super(message);

    this.name = 'AssertionError';
    this.code = 'ERR_ASSERTION';
    this.actual = actual;
    this.expected = expected;
    this.operator = operator;
    this.generatedMessage = isGenerated;

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, stackStartFn || this.constructor);
    }
  }

  toString(): string {
    return `${this.name} [${this.code}]: ${this.message}`;
  }

  // Support for util.inspect and console.log
  [Symbol.for('nodejs.util.inspect.custom')](_depth: number, _options: unknown): string {
    return this.toString();
  }
}

const kReadableOperator: Record<string, string> = {
  'deepStrictEqual': 'Expected values to be strictly deep-equal:',
  'strictEqual': 'Expected values to be strictly equal:',
  'strictEqualObject': 'Expected "actual" to be reference-equal to "expected":',
  'deepEqual': 'Expected values to be loosely deep-equal:',
  'notDeepStrictEqual': 'Expected "actual" not to be strictly deep-equal to:',
  'notStrictEqual': 'Expected "actual" to be strictly unequal to:',
  'notStrictEqualObject': 'Expected "actual" not to be reference-equal to "expected":',
  'notDeepEqual': 'Expected "actual" not to be loosely deep-equal to:',
  'notIdentical': 'Values have same structure but are not reference-equal:',
  'notEqual': 'Expected "actual" to be loosely unequal to:',
  'equal': 'Expected values to be loosely equal:',
  '==': 'Expected values to be loosely equal:',
  '!=': 'Expected "actual" to be loosely unequal to:',
  '===': 'Expected values to be strictly equal:',
  '!==': 'Expected "actual" to be strictly unequal to:',
  'fail': 'Failed',
};

function generateMessage(actual: unknown, expected: unknown, operator: string): string {
  const header = kReadableOperator[operator] || `Operator: ${operator}`;

  if (operator === 'fail') {
    return 'Failed';
  }

  const actualStr = safeInspect(actual);
  const expectedStr = safeInspect(expected);

  return `${header}\n\n+ actual - expected\n\n+ ${actualStr}\n- ${expectedStr}\n`;
}
