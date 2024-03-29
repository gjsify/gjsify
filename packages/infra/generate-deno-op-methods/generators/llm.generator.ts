import OpenAI from "npm:openai";
import { load as loadEnv } from "https://deno.land/std/dotenv/mod.ts";
import { basename } from "https://deno.land/std/path/mod.ts";

import { BaseGenerator } from "./base.generator.ts";
import { extractCodeBlocks } from "../utils/markdown.ts";
import { OpenAIResponse, OpMethod, OpSource } from "../types.ts";

const wrapInRustCodeBlock = (code: string) => `\`\`\`rust\n${code}\n\`\`\``;

class LLMGenerator extends BaseGenerator {
  MAX_ITERATIONS = 3;
  SYSTEM_ENVIRONMENTS_PROMT =
    "You are a programming assistant who is very proficient with Rust, TypeScript, and various JavaScript environments such as Node.js, Deno, Bun, Browser, and GJS. Additionally, you are well-versed in Browserify and Babel, which is helpful for reimplementing these environments. I am also able to develop extensions in C if the method cannot be implemented with pure TypeScript.";
  SYSTEM_GNOME_PROMPT =
    "You are an assistant who helps me reimplement the runtime and core of Deno, which is programmed in Rust, into TypeScript using GJS (GNOME JavaScript). For this, you are well-versed in the GNOME ecosystem and familiar with the existing libraries, and you know which of these libraries might be useful right now. You understand that these can be used with GJS thanks to GObject introspection.";

  MAX_ATTEMPTS = 5;

  constructor(protected readonly openai: OpenAI) {
    super();
  }

  async askLLMAboutFunction(
    source: OpSource,
    method: OpMethod,
    iteration = 0,
  ): Promise<OpenAIResponse> {
    if (!source.content) throw new Error("Source content is missing");

    let question =
      `RImplement the Rust function '${method.functionName}' in TypeScript as a code scaffolding. Write a meaningful TSDoc comment with parameters what the method does and how this could be implemented. Only answer with the TypeScript code.` +
      `\nFollow these rules:` +
      `\n* Export function with export statement` +
      `\n* Same function name`;

    if (method.isAsync) {
      question += "\n* The function is asynchronous";
    } else {
      question += "\n* The function is synchronous";
    }

    question += `\nRust source code path: \`${source.relativePath}\`` +
      `\nRust source code content:\n${wrapInRustCodeBlock(source.content)}`;

    // console.debug(question);

    console.log(
      `\nAsking OpenAI about function ${method.functionName} in file ${
        basename(source.path)
      }...`,
    );

    try {
      const completion = await openai.chat.completions.create({
        messages: [
          { role: "system", content: this.SYSTEM_ENVIRONMENTS_PROMT },
          { role: "user", content: question },
        ],
        model: "gpt-4",
      });

      // console.debug(JSON.stringify(completion, null, 2));

      const answers = completion.choices.filter((c) => !!c.message.content).map(
        (c) => c.message.content || "",
      );

      const codeBlocks: string[] = [];
      for (const answer of answers) {
        const blocks = extractCodeBlocks(answer);
        codeBlocks.push(...blocks);
      }

      if (codeBlocks.length === 0) {
        console.error("No code blocks found in answers: ", answers);
        if (iteration < this.MAX_ITERATIONS) {
          console.error("Retry...");
          return this.askLLMAboutFunction(
            source,
            method,
            iteration,
          );
        }
      }

      return { answers: answers, codeBlocks, question };
    } catch (error) {
      console.error("Error while requesting OpenAI: ", error);
      throw error;
    }
  }

  async askLLMAboutFunctionWithRetry(
    source: OpSource,
    method: OpMethod,
    iteration = 0,
    attempt = 0,
  ): Promise<OpenAIResponse | null> {
    try {
      // Attempt to make the API call
      return await this.askLLMAboutFunction(source, method, iteration);
    } catch (error) {
      if (error.message.includes("429") && attempt < this.MAX_ATTEMPTS) { // Check for rate limit error and max attempts
        if (error.message.includes("Request too large")) {
          console.error("Request too large, skipping...");
          return null;
        }

        // Wait for a period of time before retrying
        const waitTime = Math.pow(2, attempt) * 1000; // Exponential backoff
        console.log(
          `Rate limit exceeded, retrying in ${waitTime / 1000} seconds...`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this.askLLMAboutFunctionWithRetry(
          source,
          method,
          iteration,
          attempt + 1,
        ); // Retry with incremented attempt count
      } else {
        // If not a rate limit error or max attempts reached, rethrow the error
        throw error;
      }
    }
  }

  public async generate(
    source: OpSource,
    method: OpMethod,
  ): Promise<string> {
    const answers = await this.askLLMAboutFunction(source, method);
    if (!answers) return "";
    console.debug("question: ", answers.question);
    console.debug("answer: ", answers.answers[0]);
    console.debug("code:", answers.codeBlocks[0]);

    const tsContent = answers.codeBlocks.join("\n\n");
    return tsContent;
  }
}

const env = await loadEnv();
const OPENAI_API_KEY = env["OPENAI_API_KEY"];

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Export singleton instance
export const llmGenerator = new LLMGenerator(openai);
