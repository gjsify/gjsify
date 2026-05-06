import { type Plugin } from "vite";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import type { MsgfmtPluginOptions, MsgfmtFormat } from "./types.js";
import {
  checkDependencies,
  findAvailableLanguages,
  ensureDirectory,
} from "./utils.js";

/**
 * Remove XML comments from a file content
 * @param content The XML content as string
 * @returns The content with comments removed
 */
function removeXmlComments(content: string): string {
  // Remove XML comments <!-- ... -->
  return content.replace(/<!--[\s\S]*?-->/g, '');
}

/**
 * Build msgfmt command arguments
 * @param baseArgs Base arguments for msgfmt
 * @param options Plugin options
 * @returns Complete argument array
 */
function buildMsgfmtArgs(baseArgs: string[], options: { msgfmtOptions?: string[] }): string[] {
  const args = [...baseArgs];
  
  if (options.msgfmtOptions && options.msgfmtOptions.length > 0) {
    args.push(...options.msgfmtOptions);
  }
  
  return args;
}

/**
 * Get output file extension based on the format
 * @param format The output format
 * @returns The file extension for the given format
 */
function getOutputExtension(format: MsgfmtFormat): string {
  switch (format) {
    case "mo":
      return ".mo";
    case "java":
    case "java2":
      return ".class";
    case "csharp":
      return ".dll";
    case "csharp-resources":
      return ".resources.dll";
    case "tcl":
      return ".msg";
    case "desktop":
      return ".desktop";
    case "xml":
      return ".xml";
    case "json":
      return ".json";
    case "qt":
      return ".qm";
    default:
      return ".mo";
  }
}

/**
 * Creates a Vite plugin that compiles PO translation files to various formats
 * Supports metainfo files with special processing
 * @param options Configuration options for the plugin
 * @returns A Vite plugin that handles PO compilation
 */
export function msgfmtPlugin(options: MsgfmtPluginOptions): Plugin {
  const {
    poDirectory,
    outputDirectory,
    domain = "messages",
    format = "mo",
    templateFile,
    verbose = false,
    msgfmtOptions = [],
    useLocaleStructure = true,
    removeComments = true,
  } = options;

  const pluginName = "vite-plugin-msgfmt";

  async function compilePoFiles() {
    try {
      // Check if PO directory exists
      try {
        await ensureDirectory(poDirectory);
      } catch {
        if (verbose) {
          console.log(
            `[${pluginName}] PO directory ${poDirectory} does not exist yet, skipping compilation`
          );
        }
        return;
      }

      // Create output directory
      await ensureDirectory(outputDirectory);

      // For XML format, we can use the bulk mode if a template is provided
      if (format === "xml" && templateFile) {
        // Use bulk mode for XML format
        const outputFile = path.join(
          outputDirectory,
          options.filename || `${domain}${getOutputExtension(format)}`
        );

        if (verbose) {
          console.log(
            `[${pluginName}] Compiling all languages to ${outputFile} using bulk mode`
          );
        }

        // Build arguments for bulk mode
        const baseArgs = [
          "--output-file=" + outputFile,
          "--xml",
          "--template=" + templateFile,
          "-d",
          poDirectory,
        ];
        const args = buildMsgfmtArgs(baseArgs, { msgfmtOptions });

        if (verbose) {
          console.log(`[${pluginName}] Running msgfmt with: ${args.join(" ")}`);
        }

        await execa("msgfmt", args);

        // Remove comments from XML output if requested
        if (removeComments !== false) {
          try {
            const content = await fs.readFile(outputFile, 'utf-8');
            const cleanedContent = removeXmlComments(content);
            await fs.writeFile(outputFile, cleanedContent, 'utf-8');
            
            if (verbose) {
              console.log(`[${pluginName}] Removed comments from ${outputFile}`);
            }
          } catch (error) {
            if (verbose) {
              console.warn(`[${pluginName}] Failed to remove comments: ${error}`);
            }
          }
        }
      } else {
        // Find available languages for individual processing
        const languages = await findAvailableLanguages(
          poDirectory,
          pluginName,
          verbose
        );

        if (languages.length === 0) {
          if (verbose) {
            console.log(`[${pluginName}] No translation files found`);
          }
          return;
        }

        // Process each language individually for other formats
        for (const lang of languages) {
          const poFile = path.join(poDirectory, `${lang}.po`);

          let outputPath: string;
          let outputFile: string;

          if (useLocaleStructure && format === "mo") {
            // Use standard gettext locale structure
            outputPath = path.join(
              outputDirectory,
              "locale",
              lang,
              "LC_MESSAGES"
            );
            outputFile = path.join(
              outputPath,
              options.filename || `${domain}${getOutputExtension(format)}`
            );
          } else {
            // Use simple language-based structure
            outputPath = path.join(outputDirectory, lang);
            outputFile = path.join(
              outputPath,
              options.filename || `${domain}${getOutputExtension(format)}`
            );
          }

          // Create the directory structure
          await ensureDirectory(outputPath);

          if (verbose) {
            console.log(`[${pluginName}] Compiling ${poFile} to ${outputFile}`);
          }

          // Build arguments for individual processing
          const baseArgs = [
            "--output-file=" + outputFile,
            `--${format}`,
            poFile
          ];
          const args = buildMsgfmtArgs(baseArgs, { msgfmtOptions });

          if (verbose) {
            console.log(
              `[${pluginName}] Running msgfmt with: ${args.join(" ")}`
            );
          }

          await execa("msgfmt", args);
        }
      }
    } catch (error) {
      throw new Error(`Failed to compile files: ${error}`);
    }
  }

  return {
    name: pluginName,

    async buildStart() {
      await checkDependencies("msgfmt", pluginName, verbose);
      await compilePoFiles();
    },

    configureServer(server) {
      server.watcher.add(poDirectory);

      server.watcher.on("change", async (file) => {
        if (file.endsWith(".po")) {
          if (verbose) {
            console.log(
              `[${pluginName}] PO file changed: ${file}, recompiling`
            );
          }
          await compilePoFiles();
        }
      });
    },
  };
}
