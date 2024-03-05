export interface OpMethod {
  functionName: string;
  definition: string;
  macro: string;
  // completeFunction: string;
  isAsync: boolean;
}

export interface OpSource {
  path: string;
  relativePath: string;
  methods: OpMethod[];
  content?: string;
}

export interface OpenAIResponse {
  answers: string[];
  codeBlocks: string[];
  question: string;
}

/**
 * Interface for the arguments parsed in the parseArguments method.
 */
export interface Options {
  /** The prefix of the op methods to process */
  prefix?: string;
  /** The path the script should search for op methods */
  dir: string;
  /** The directory where the generated files should be placed */
  outDir: string;
  /** The base directory of the project */
  baseDir: string;
  /** If the AI should be used to write boilerplate for the methods */
  ai?: boolean;
  /** If the help should be shown */
  help?: boolean;
}
