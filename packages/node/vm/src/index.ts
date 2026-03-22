// The vm module is Node.js's code evaluation facility.
// eval() usage is intentional here as it implements vm.runInThisContext().

export function runInThisContext(code: string, _options?: any): any {
  // eslint-disable-next-line no-eval
  return eval(code);
}

export function runInNewContext(_code: string, _context?: any, _options?: any): any {
  throw new Error('vm.runInNewContext is not supported in GJS');
}

export function createContext(_context?: any): any {
  return _context || {};
}

export function isContext(_context: any): boolean {
  return false;
}

export class Script {
  private _code: string;

  constructor(code: string, _options?: any) {
    this._code = code;
  }

  runInThisContext(_options?: any): any {
    // eslint-disable-next-line no-eval
    return eval(this._code);
  }

  runInNewContext(_context?: any, _options?: any): any {
    throw new Error('Script.runInNewContext is not supported in GJS');
  }
}

export default { runInThisContext, runInNewContext, createContext, isContext, Script };
