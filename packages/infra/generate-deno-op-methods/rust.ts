import type { OpMethod, OpSource } from "./types.ts";

export async function findRustFunctions(rootDir: string): Promise<OpSource[]> {
  const results: OpSource[] = [];

  for await (const entry of Deno.readDir(rootDir)) {
    const fullPath = `${rootDir}/${entry.name}`;

    if (entry.isDirectory) {
      results.push(...await findRustFunctions(fullPath));
    } else if (entry.isFile && fullPath.endsWith(".rs")) {
      console.log("Found file: ", fullPath);
      const fileContent = await Deno.readTextFile(fullPath);
      const methods = extractMethods(fileContent);
      if (!methods.length) {
        continue;
      }
      results.push({
        path: fullPath,
        relativePath: fullPath.replace(rootDir, ""),
        methods,
        content: fileContent.trim(),
      });
    }
  }

  return results;
}

/**
 * Extracts the macro from a Rust method definition.
 */
function extractMacro(s: string): string | null {
  const re = /(#\[op[^\]]*\])/;
  const match = s.match(re);
  return match ? match[1] : null;
}

/**
 * Extracts the name of the function from a Rust method definition.
 */
function extractMethodName(rustCode: string): string | null {
  const methodRegex = /fn\s+(op_[^\s\(]+)/;
  const match = rustCode.match(methodRegex);
  return match ? match[1] : null;
}

/**
 * Finds all 'op' methods in a Rust file.
 *
 * This function uses a regular expression to find all methods that start with `#[op` and continue on the next line with `pub async fn op_`. The keywords `async` and `pub` are optional.
 * The regular expression ends when a new line contains a `}`, signaling the end of the method.
 *
 * @param s The content of the Rust file as a string.
 * @returns An array containing all found methods that start with `#[op`. If no methods are found, it returns `null`.
 */
function findMethods(s: string): string[] | null {
  const re = new RegExp("^#\\[op.*?^(pub )?(async )?fn op_.*?^}$", "gms");
  const matches = s.match(re)?.map((m) => m.trim()) || null;
  return matches;
}

function extractMethods(fileContent: string): OpMethod[] {
  const methods = findMethods(fileContent) || [];

  const result: OpMethod[] = [];

  for (const methodDef of methods) {
    const functionName = extractMethodName(methodDef);
    const macro = extractMacro(methodDef);
    if (!functionName || !macro) {
      continue;
    }
    result.push({
      functionName,
      definition: methodDef,
      macro,
      isAsync: functionName.includes("async") || macro.includes("async") ||
        false,
    });
  }

  return result;
}
