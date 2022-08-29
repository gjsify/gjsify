import { FetchBaseError } from './base.js';
import type { SystemError } from '../types/index.js';

/**
 * FetchError interface for operational errors
 */
export class FetchError extends FetchBaseError {
    code: string;
    errno: string;
    erroredSysCall: string;

	/**
	 * @param message Error message for human
	 * @param type Error type for machine
	 * @param systemError For Node.js system error
	 */
	constructor(message: string, type?: string, systemError?: SystemError) {
		super(message, type);
		// When err.type is `system`, err.erroredSysCall contains system error and err.code contains system error code
		if (systemError) {
			// eslint-disable-next-line no-multi-assign
			this.code = this.errno = systemError.code;
			this.erroredSysCall = systemError.syscall;
		}
	}
}