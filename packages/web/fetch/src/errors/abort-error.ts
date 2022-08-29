import { FetchBaseError } from './base.js';

/**
 * AbortError interface for cancelled requests
 */
export class AbortError extends FetchBaseError {
	constructor(message: string, type = 'aborted') {
		super(message, type);
	}
}