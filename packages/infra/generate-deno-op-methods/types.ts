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
