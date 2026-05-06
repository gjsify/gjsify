import { type Plugin } from "vite";
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import glob from "fast-glob";
import type { XGettextPluginOptions } from "./types.js";
import {
  checkDependencies,
  ensureDirectory,
  processFilename,
} from "./utils.js";

// Add GLib preset constants
// From https://github.com/mesonbuild/meson/blob/467da051c859ba3112803b035e317bddadd756ef/mesonbuild/modules/i18n.py
const GLIB_PRESET_ARGS = [
  "--from-code=UTF-8",
  "--add-comments",
  // https://developer.gnome.org/glib/stable/glib-I18N.html
  "--keyword=_",
  "--keyword=N_",
  "--keyword=C_:1c,2",
  "--keyword=NC_:1c,2",
  "--keyword=g_dcgettext:2",
  "--keyword=g_dngettext:2,3",
  "--keyword=g_dpgettext2:2c,3",
  "--flag=N_:1:pass-c-format",
  "--flag=C_:2:pass-c-format",
  "--flag=NC_:2:pass-c-format",
  "--flag=g_dngettext:2:pass-c-format",
  "--flag=g_strdup_printf:1:c-format",
  "--flag=g_string_printf:2:c-format",
  "--flag=g_string_append_printf:2:c-format",
  "--flag=g_error_new:3:c-format",
  "--flag=g_set_error:4:c-format",
  "--flag=g_markup_printf_escaped:1:c-format",
  "--flag=g_log:3:c-format",
  "--flag=g_print:1:c-format",
  "--flag=g_printerr:1:c-format",
  "--flag=g_printf:1:c-format",
  "--flag=g_fprintf:2:c-format",
  "--flag=g_sprintf:2:c-format",
  "--flag=g_snprintf:3:c-format",
];

/**
 * Build command arguments with common options
 * @param baseArgs Base arguments for the command
 * @param options Options to add to arguments
 * @returns Complete argument array
 */
function buildCommandArgs(
  baseArgs: string[], 
  options: { 
    noLocation?: boolean; 
    noWrap?: boolean; 
    sortOutput?: boolean;
    additionalOptions?: string[];
  }
): string[] {
  const args = [...baseArgs];
  
  // Check if additional options already contain the flags to avoid duplicates
  const additionalOptions = options.additionalOptions || [];
  const hasNoLocation = additionalOptions.includes("--no-location");
  const hasNoWrap = additionalOptions.includes("--no-wrap");
  const hasSortOutput = additionalOptions.includes("--sort-output");
  
  if (options.noLocation && !hasNoLocation) {
    args.push("--no-location");
  }
  
  if (options.noWrap && !hasNoWrap) {
    args.push("--no-wrap");
  }
  
  if (options.sortOutput && !hasSortOutput) {
    args.push("--sort-output");
  }
  
  if (additionalOptions.length > 0) {
    args.push(...additionalOptions);
  }
  
  return args;
}

/**
 * Creates a Vite plugin that extracts translatable strings from source files
 * Uses GNU xgettext to generate a POT template file that can be used as basis for translations
 * @param options Configuration options for the plugin
 * @returns A Vite plugin that handles string extraction
 */
export function xgettextPlugin(options: XGettextPluginOptions): Plugin {
  const pluginName = "vite-plugin-xgettext";

  return {
    name: pluginName,

    async buildStart() {
      await checkDependencies("xgettext", pluginName, options.verbose ?? false);
      const files = await glob(options.sources);
      await extractStrings(files, options, pluginName);
    },

    configureServer(server) {
      server.watcher.add(options.sources);

      server.watcher.on("change", async (file) => {
        if (options.sources.some((pattern) => file.match(pattern))) {
          if (options.verbose) {
            console.log(
              `[${pluginName}] Source file changed: ${file}, re-running extraction`
            );
          }
          const files = await glob(options.sources);
          await extractStrings(files, options, pluginName);
        }
      });
    },
  };
}

async function generatePotfiles(
  files: string[],
  outputDir: string,
  pluginName: string,
  verbose = false
) {
  // Group files by extension
  const fileGroups = new Map<string, string[]>();

  files.forEach((file) => {
    const filename = path.basename(file);
    const group = getFileGroup(filename);
    if (!fileGroups.has(group)) {
      fileGroups.set(group, []);
    }
    fileGroups.get(group)?.push(file);
  });

  // Generate POTFILES for each group
  const potFiles: string[] = [];

  for (const [group, groupFiles] of fileGroups) {
    const potfilePath = path.join(outputDir, `${group}.POTFILES`);
    const content = groupFiles.join("\n");

    try {
      await fs.writeFile(potfilePath, content);
      potFiles.push(potfilePath);
      if (verbose) {
        console.log(
          `[${pluginName}] Generated ${group}.POTFILES with ${groupFiles.length} source files`
        );
      }
    } catch (error) {
      console.error(`[${pluginName}] Error writing ${group}.POTFILES:`, error);
    }
  }

  return potFiles;
}

function getFileGroup(fullFilename: string): string {
  // Process filename to handle .in extension
  const { filename, extension } = processFilename(fullFilename);

  // Special handling for metainfo.xml files
  if (filename.endsWith(".metainfo.xml") || filename.endsWith(".appdata.xml")) {
    return "metainfo";
  }

  switch (extension) {
    case ".ts":
    case ".js":
    case ".tsx":
      return "js";
    case ".ui":
    case ".xml":
      return "ui";
    case ".blp":
      return "blp";
    case ".desktop":
      return "desktop";
    default:
      return "other";
  }
}

async function extractStrings(
  files: string[],
  options: XGettextPluginOptions,
  pluginName: string
) {
  const {
    output,
    domain = "messages",
    keywords = [],
    preset,
    verbose = false,
  } = options;
  
  const noWrap = options.noWrap || false;

  try {
    const outputDir = path.dirname(output);
    await ensureDirectory(outputDir);

    // Read existing POT-Creation-Date from previous POT if present (for preservation)
    let prevPotCreationDate: string | undefined;
    try {
      const existingPot = await fs.readFile(output, "utf-8");
      const m = existingPot.match(/"POT-Creation-Date:\s*([^\n]+)\\n"/);
      if (m && m[1]) {
        prevPotCreationDate = m[1];
        if (verbose) {
          console.log(
            `[${pluginName}] Found previous POT-Creation-Date '${prevPotCreationDate}'`
          );
        }
      }
    } catch {
      // No previous POT available
    }

    // Generate grouped POTFILES
    const potFiles = await generatePotfiles(
      files,
      outputDir,
      pluginName,
      verbose
    );

    // Create temporary POT files for each group
    const tempPotFiles: string[] = [];

    for (const potFile of potFiles) {
      const group = path.basename(potFile).split(".")[0];
      const tempOutput = path.join(outputDir, `temp_${group}.pot`);

      // Build base arguments
      const baseArgs = [
        "--package-name=" + domain,
        options.version ? "--package-version=" + options.version : "",
        "--output=" + tempOutput,
        "--files-from=" + potFile,
        "--from-code=UTF-8",
        "--add-comments",
      ].filter(Boolean);

      // Add bug report address if specified
      if (options.msgidBugsAddress) {
        baseArgs.push("--msgid-bugs-address=" + options.msgidBugsAddress);
      }

      // Add copyright holder if specified
      if (options.copyrightHolder) {
        baseArgs.push("--copyright-holder=" + options.copyrightHolder);
      }

      // Add language-specific settings
      switch (group) {
        case "js":
        case "blp":
          baseArgs.push("--language=JavaScript");
          baseArgs.push(...keywords.map((k) => `--keyword=${k}`));
          if (preset === "glib") {
            baseArgs.push(...GLIB_PRESET_ARGS);
          }
          break;
        case "ui":
          baseArgs.push("--language=Glade");
          break;
        case "metainfo":
          // Find the first existing metainfo.its file
          const metainfoItsPath = await findMetainfoItsPath();

          if (!metainfoItsPath) {
            console.warn(
              "Warning: Could not find metainfo.its in any of the expected locations"
            );
            // Continue without the ITS file
          } else {
            baseArgs.push(`--its=${metainfoItsPath}`);
          }
          break;
        case "desktop":
          baseArgs.push("--language=Desktop");
          break;
      }

      // Build final arguments with options handling
      const args = buildCommandArgs(baseArgs, {
        noLocation: options.noLocation,
        noWrap,
        additionalOptions: options.xgettextOptions
      });

      if (verbose) {
        console.log(
          `[${pluginName}] Running xgettext for ${group}:`,
          args.join(" ")
        );
      }

      // Enforce deterministic timestamps if requested
      const env = { ...process.env };
      if (options.deterministic) {
        const epoch =
          typeof options.sourceDateEpoch === "number"
            ? options.sourceDateEpoch
            : 0;
        env.SOURCE_DATE_EPOCH = String(epoch);
      }

      await execa("xgettext", args, { env });

      // Check if file exists before adding to tempPotFiles
      try {
        await fs.access(tempOutput);
        tempPotFiles.push(tempOutput);
        if (verbose) {
          console.log(
            `[${pluginName}] Successfully created temporary POT file: ${tempOutput}`
          );
        }
      } catch (error) {
        console.warn(
          `[${pluginName}] Failed to create temporary POT file: ${tempOutput}`
        );
      }
    }

    // Combine all temporary POT files using msgcat
    if (tempPotFiles.length > 0) {
      const baseMsgcatArgs = ["--use-first", "-o", output, ...tempPotFiles];
      const msgcatArgs = buildCommandArgs(baseMsgcatArgs, {
        noLocation: options.noLocation,
        sortOutput: options.sortOutput,
        noWrap,
        additionalOptions: options.msgcatOptions
      });

      const env = { ...process.env };
      if (options.deterministic) {
        const epoch =
          typeof options.sourceDateEpoch === "number"
            ? options.sourceDateEpoch
            : 0;
        env.SOURCE_DATE_EPOCH = String(epoch);
      }

      await execa("msgcat", msgcatArgs, { env });

      // Clean up temporary files
      for (const tempFile of tempPotFiles) {
        await fs.unlink(tempFile);
      }
      for (const potFile of potFiles) {
        await fs.unlink(potFile);
      }
    }

    // Optionally normalize POT-Creation-Date header to a fixed or preserved value
    if (options.fixedCreationDate || options.preserveCreationDate || options.deterministic) {
      try {
        let normalizedDate: string | undefined = undefined;

        if (options.fixedCreationDate) {
          normalizedDate = options.fixedCreationDate;
        } else if (options.preserveCreationDate) {
          if (prevPotCreationDate) {
            normalizedDate = prevPotCreationDate;
            if (verbose) {
              console.log(
                `[${pluginName}] Preserving existing POT-Creation-Date '${normalizedDate}'`
              );
            }
          }
        }

        if (!normalizedDate && options.deterministic) {
          normalizedDate = formatSourceDateEpoch(
            typeof options.sourceDateEpoch === "number" ? options.sourceDateEpoch : 0
          );
        }

        if (normalizedDate) {
          const content = await fs.readFile(output, "utf-8");
          const replaced = content.replace(
            /^"POT-Creation-Date: .*\\n"$/m,
            `"POT-Creation-Date: ${normalizedDate}\\n"`
          );
          if (replaced !== content) {
            await fs.writeFile(output, replaced);
            if (verbose) {
              console.log(
                `[${pluginName}] Normalized POT-Creation-Date to '${normalizedDate}'`
              );
            }
          }
        }
      } catch (e) {
        console.warn(
          `[${pluginName}] Failed to normalize POT-Creation-Date header:`,
          e
        );
      }
    }

    if (options.autoUpdatePo) {
      await updatePoFiles(
        options.output,
        pluginName,
        options.verbose || false,
        options
      );
    }
  } catch (error) {
    throw new Error(`Failed to extract translations: ${error}`);
  }
}

async function updatePoFiles(
  potFile: string,
  pluginName: string,
  verbose: boolean,
  options: XGettextPluginOptions
) {
  try {
    const linguasPath = path.join(path.dirname(potFile), "LINGUAS");
    const languages = (await fs.readFile(linguasPath, "utf-8"))
      .split("\n")
      .filter(Boolean);

    for (const lang of languages) {
      const poFile = path.join(path.dirname(potFile), `${lang}.po`);
      if (verbose) {
        console.log(`[${pluginName}] Updating ${poFile}`);
      }
      const baseMsgmergeArgs = ["--update", "--backup=none", poFile, potFile];
      const args = buildCommandArgs(baseMsgmergeArgs, {
        noLocation: options.noLocation,
        noWrap: options.noWrap
      });

      const env = { ...process.env };
      if (options.deterministic) {
        const epoch =
          typeof options.sourceDateEpoch === "number"
            ? options.sourceDateEpoch
            : 0;
        env.SOURCE_DATE_EPOCH = String(epoch);
      }

      await execa("msgmerge", args, { env });

      // Post-process with msgcat to unwrap existing wrapped lines
      if (options.noWrap) {
        const tempFile = poFile + ".tmp";
        const msgcatArgs = ["--width=0", "--no-wrap", "-o", tempFile, poFile];
        await execa("msgcat", msgcatArgs, { env });
        await fs.rename(tempFile, poFile);
        if (verbose) {
          console.log(`[${pluginName}] Unwrapped lines in ${poFile}`);
        }
      }
    }
  } catch (error) {
    console.error(`[${pluginName}] Error updating PO files:`, error);
  }
}

/**
 * Formats a date in gettext header format using an epoch (seconds) in UTC timezone
 * Example output: 1970-01-01 00:00+0000
 */
function formatSourceDateEpoch(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const year = date.getUTCFullYear();
  const month = pad(date.getUTCMonth() + 1);
  const day = pad(date.getUTCDate());
  const hours = pad(date.getUTCHours());
  const minutes = pad(date.getUTCMinutes());
  return `${year}-${month}-${day} ${hours}:${minutes}+0000`;
}

/**
 * Finds the first existing metainfo.its file from installed gettext versions
 * @returns The path to the metainfo.its file if found, otherwise undefined
 */
async function findMetainfoItsPath(): Promise<string | undefined> {
  // Default path
  const defaultPath = "/usr/share/gettext/its/metainfo.its";

  // Check default path first
  if (existsSync(defaultPath)) {
    return defaultPath;
  }

  try {
    // Use glob to find all potential gettext version directories
    const getTextDirs = await glob("/usr/share/gettext-*");

    // Sort by version (newest first) if possible
    getTextDirs.sort((a, b) => {
      const versionA = a.replace("/usr/share/gettext-", "");
      const versionB = b.replace("/usr/share/gettext-", "");
      return versionB.localeCompare(versionA);
    });

    // Add specific version paths we know about
    const metainfoItsPaths = getTextDirs.map(
      (dir) => `${dir}/its/metainfo.its`
    );

    // Find first existing path
    return metainfoItsPaths.find((path) => existsSync(path));
  } catch (error) {
    console.warn("Error searching for metainfo.its:", error);
    return undefined;
  }
}
