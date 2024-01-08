export interface OpMethod {
    functionName: string;
    definition: string;
    macro: string;
    completeFunction: string;
}

export interface OpSource {
    path: string;
    methods: OpMethod[];
    content?: string;
}

export interface OpenAIResponse {
    answers: string[];
}