import { existsFD } from './fs.js';

export const STDIN_FD = 0;
export const STDOUT_FD = 1;
export const STDERR_FD = 2;

/** Check if the stdout file descriptor exists, if this is the case a tty (terminal) should exists (untested) */
export const existsTty = () => {
    return existsFD(STDOUT_FD);
}