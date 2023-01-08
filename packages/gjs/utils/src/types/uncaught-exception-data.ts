import { ErrorData } from './error-data.js';

export interface UncaughtExceptionData extends ErrorData {
    error: Error;
}