import GLib from '@gjsify/types/GLib-2.0';
const Signals = imports.signals;

import type { StructuredLogData, SignalMethods } from './types/index.js';

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

const STACK_TRACE_REGEX = /^.*@.*:\d+:\d+/

const getStackTraceStartLineIndex = (lines: string[]) => {
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if(STACK_TRACE_REGEX.test(line)) {
      return i;
    }
  }
  return -1;
}

const extractErrorData = (errorMessage: string) => {
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
  const stackTrace = lines.slice(stackTraceLineIndex);
  return {
    errorType,
    message,
    stackTrace
  }
}

/**
 * WORKAROUND: Extract the information from the log message until https://gitlab.gnome.org/GNOME/gjs/-/issues/523 is solved
 * @param errorMessage The original error message
 * @returns The extracted error type, error message and stack trace
 */
const reconstructErrorFromMessage = (errorMessage: string) => {
  const { errorType, message, stackTrace } = extractErrorData(errorMessage);
  const ErrorType = globalThis[errorType] as typeof Error;
  const error = new ErrorType(message + "\n" + stackTrace.join("\n"));
  // error.message = message;
  error.stack = stackTrace.join("\n");

  return error;
}

export interface LogSignals extends SignalMethods {
  connect(sigName: "unhandledRejection", callback: (self: LogSignals, data: StructuredLogData, promiseData: { reason: any }) => void): number;
  connect(sigName: "uncaughtException", callback: (self: LogSignals, data: StructuredLogData, error: Error) => void): number;

  emit(sigName: "unhandledRejection", data: StructuredLogData, promiseData: { reason: any }): void;
  emit(sigName: "uncaughtException", data: StructuredLogData, error: Error): void;
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
  handler(level: GLib.LogLevelFlags, data: StructuredLogData) {
    if(level === GLib.LogLevelFlags.LEVEL_WARNING && data.domain === "Gjs" && data.message.startsWith('Unhandled promise rejection')) {
      try {
        const reason = reconstructErrorFromMessage(data.message);
        logSignals.emit("unhandledRejection", data, { reason });
      } catch (error) {
        printerr(error)
      }

    } else if (level === GLib.LogLevelFlags.LEVEL_CRITICAL) {
      const error = reconstructErrorFromMessage(data.message);
      logSignals.emit("uncaughtException", data, error);
    }

    // Debug
    // print("\n\n[log_set_writer_func] \nmessage:", data.message, "\nlogDomain:", data.domain, `\nlevel: ${level} (${logLevelToString(level)})`, );

    return false;
  }
}

Signals.addSignalMethods(LogSignals.prototype);

/**
 * Emits log signals like `unhandledRejection` and `unhandledRejection`
 */
export const logSignals = LogSignals.getSingleton();


