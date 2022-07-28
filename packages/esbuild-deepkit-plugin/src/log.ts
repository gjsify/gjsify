import { inspect } from 'util';

export const printDiagnostics = (...args: any[]) => {
    console.log(inspect(args, false, 10, true));
}
  