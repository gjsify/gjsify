import { ErrorData } from './error-data.js';

export interface UnhandledRejectionData extends ErrorData {
    reason: any;
    promise: Promise<any>;
}