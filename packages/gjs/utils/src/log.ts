import GLib from '@gjsify/types/GLib-2.0';
import { Signals } from '@gjsify/types/Gjs';

import type {
  StructuredLogData,
  SignalMethods,
  StackTraceFrame,
  ErrorData,
  UncaughtExceptionData,
  UnhandledRejectionData,
} from './types/index.js';

export const logLevelToString = (logLevel: GLib.LogLevelFlags) => {
  switch (logLevel) {
    case GLib.LogLevelFlags.FLAG_FATAL:
      return "FLAG_FATAL";
    case GLib.LogLevelFlags.FLAG_RECURSION:
      return "FLAG_RECURSION";
    case GLib.LogLevelFlags.LEVEL_CRITICAL:
      return "LEVEL_CRITICAL";
    case GLib.LogLevelFlags.LEVEL_DEBUG:
      return "LEVEL_DEBUG";
    case GLib.LogLevelFlags.LEVEL_ERROR:
      return "LEVEL_ERROR";
    case GLib.LogLevelFlags.LEVEL_INFO:
      return "LEVEL_INFO";
    case GLib.LogLevelFlags.LEVEL_MASK:
      return "LEVEL_MASK";
    case GLib.LogLevelFlags.LEVEL_MESSAGE:
      return "LEVEL_MESSAGE";
    case GLib.LogLevelFlags.LEVEL_WARNING:
      return "LEVEL_WARNING";
    default:
      return "UNKNOWN"
  }
}

const STACK_TRACE_REGEX = /^.*@(.*):(\d+):(\d+)/;

export const parseStackTrace = (stackTraceLine: string): StackTraceFrame | null => {
  const match = stackTraceLine.match(STACK_TRACE_REGEX);
  if (match) {
    const [, fileName, lineNumber, columnNumber] = match;
    return { fileName, lineNumber: Number(lineNumber), columnNumber: Number(columnNumber), line: stackTraceLine };
  }
  // console.warn("Can't parse stack trace line: " + stackTraceLine);
  return null;
}

const getStackTraceStartLineIndex = (lines: string[]) => {
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if(STACK_TRACE_REGEX.test(line)) {
      return i;
    }
  }
  return -1;
}

export const extractErrorData = (errorMessage: string): ErrorData => {
  const lines = errorMessage.split('\n');

  for (let line of lines) {
    line = line.trim();
  }

  const endOfErrorType = lines[0].indexOf(': ');
  let errorType = "Error";

  if(endOfErrorType > 0) {
    errorType = lines[0].slice(0, endOfErrorType);
    // If error type exists
    if(globalThis[errorType]) {
      lines[0] = lines[0].slice(endOfErrorType + 2);
    } else {
      errorType = "Error";
    }
  }

  let stackTraceLineIndex = getStackTraceStartLineIndex(lines);

  const message = lines.slice(0, stackTraceLineIndex).join('\n');
  const stackTraceLines = lines.slice(stackTraceLineIndex);
  const frames: StackTraceFrame[] = [];

  for (const stackTraceLine of stackTraceLines) {
    const frame = parseStackTrace(stackTraceLine);
    if(frame) {
      frames.push(frame)
    }
  }

  return {
    errorType,
    message,
    frames,
    stackTraceLines,
  }
}

/**
 * WORKAROUND: Extract the information from the log message until https://gitlab.gnome.org/GNOME/gjs/-/issues/523 is solved
 * @param errorMessage The original error message
 * @returns The extracted error type, error message and stack trace
 */
const reconstructErrorFromMessage = (errorMessage: string): UncaughtExceptionData => {
  const { errorType, frames, message, stackTraceLines } = extractErrorData(errorMessage);
  const ErrorType = globalThis[errorType] as typeof Error;
  const error = new ErrorType(message);
  error.stack = stackTraceLines.join("\n");

  return {
    error,
    errorType,
    frames,
    message,
    stackTraceLines,
  };
}

export interface LogSignals extends SignalMethods {
  connect(sigName: "unhandledRejection", callback: (self: LogSignals, structuredData: StructuredLogData, promiseData: UnhandledRejectionData) => void): number;
  connect(sigName: "uncaughtException", callback: (self: LogSignals, structuredData: StructuredLogData, errorData: UncaughtExceptionData) => void): number;

  emit(sigName: "unhandledRejection", structuredData: StructuredLogData, promiseData: UnhandledRejectionData): void;
  emit(sigName: "uncaughtException", structuredData: StructuredLogData, errorData: UncaughtExceptionData): void;
}

export class LogSignals {

  private static instance: LogSignals;

  /** This is a singleton because log_set_writer_func may only be called once */
  private constructor() {
    this.initHandler();
  }

  public static getSingleton() {
    if(LogSignals.instance) {
      return LogSignals.instance;
    }
    LogSignals.instance = new LogSignals();
    return LogSignals.instance;
  }

  private initHandler() {

    // @ts-ignore TODO: override type in ts-for-gir
    GLib.log_set_writer_func((level: GLib.LogLevelFlags, fields?: { MESSAGE: Uint8Array, PRIORITY: Uint8Array, GLIB_DOMAIN: Uint8Array }) => {

      const decoder = new TextDecoder('utf-8');
      const message = decoder.decode(fields?.MESSAGE);
      const priority = Number(decoder.decode(fields?.PRIORITY));
      const domain = decoder.decode(fields?.GLIB_DOMAIN);

      const data: StructuredLogData = {
        message,
        priority,
        domain
      }

      if (!this.handler(level, data)) {
        // Output error as usual 
        level |= GLib.LogLevelFlags.FLAG_RECURSION;
        GLib.log_default_handler(domain, level, message, null);
      }

      // @ts-ignore
      // GLib.log_set_writer_default();

      return GLib.LogWriterOutput.HANDLED;
    });
  }

  /**
   * A log handler to emit `unhandledRejection` and `uncaughtException` events
   * @param level The log level
   * @param data The structured log data
   * @returns `true` to catch the log or `false` to output the error to the console as usual
    */
  handler(level: GLib.LogLevelFlags, structuredData: StructuredLogData) {
    if(level === GLib.LogLevelFlags.LEVEL_WARNING && structuredData.domain === "Gjs" && structuredData.message.startsWith('Unhandled promise rejection')) {
      try {
        const errorData = reconstructErrorFromMessage(structuredData.message);
        // TODO we need a way to get the promise of the unhandled rejection, see https://gitlab.gnome.org/GNOME/gjs/-/issues/523
        const fakePromise = new Promise<any>(() => {});
        logSignals.emit("unhandledRejection", structuredData, {
          reason: errorData.error,
          promise: fakePromise,
          errorType: errorData.errorType,
          frames: errorData.frames,
          message: errorData.message,
          stackTraceLines: errorData.stackTraceLines,
        });
      } catch (error) {
        printerr(error)
      }

    } else if (level === GLib.LogLevelFlags.LEVEL_CRITICAL) {
      const errorData = reconstructErrorFromMessage(structuredData.message);
      logSignals.emit("uncaughtException", structuredData, errorData);
    }

    // Debug
    // print("\n\n[log_set_writer_func] \nmessage:", structuredData.message, "\nlogDomain:", structuredData.domain, `\nlevel: ${level} (${logLevelToString(level)})`, );

    return false;
  }
}

Signals.addSignalMethods(LogSignals.prototype);

/**
 * Emits log signals like `unhandledRejection` and `unhandledRejection`
 */
export const logSignals = LogSignals.getSingleton();


