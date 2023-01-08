import { StackTraceFrame } from './stack-trace-frame.js';

export interface ErrorData {
    errorType: string;
    message: string;
    frames: StackTraceFrame[],
    stackTraceLines: string[];
}