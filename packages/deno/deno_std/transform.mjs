// Credits: https://github.com/dzearing/transform-typed-imports

import {
    ModuleResolutionKind,
    Project,
  } from "ts-morph";
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { writeFile, mkdir, rm } from 'fs/promises';
import cpy from 'cpy';
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectPath = __dirname;
const divider = "--------------------------------------------------";
const targetDirName = '.tmp';
const targetDirPath = join(projectPath, targetDirName);

const copy = async () => {

    // Remove old temporary dir
    if (existsSync(targetDirPath)) {
        await rm(targetDirPath, { recursive: true, force: true })
    }

    await cpy([
        join(projectPath, "original/**/*.ts"),
        join(projectPath, "original/**/*.mts"),
        join(projectPath, "original/**/*.cts"),
        join(projectPath, "original/**/*.tsx"),
        join(projectPath, "original/**/*.js"),
        join(projectPath, "original/**/*.mjs"),
        join(projectPath, "original/**/*.cjs"),
        join(projectPath, "original/**/*.jsx"),
        '!' + join(projectPath, "http/_mock_conn.ts"),
        '!' + join(projectPath, "original/node/integrationtest"),
        '!' + join(projectPath, "original/encoding/testdata"),
    ], targetDirPath);
}

const transform = async () => {
    const silent = false;
    const tsConfigFilePath = join(
        projectPath,
        "tsconfig.json"
    );

    if (!existsSync(tsConfigFilePath)) {
        throw new Error('tsconfig,json not found in ' + tsConfigFilePath);
    }

    const log = (...messages) => {
        if (!silent) {
          console.log(...messages);
        }

    };

    // initialize
    const project = new Project({
            // Read more: https://ts-morph.com/setup/
            tsConfigFilePath,
            skipAddingFilesFromTsConfig: true,
            compilerOptions: {
            moduleResolution: ModuleResolutionKind.NodeJs,
            jsx: 4,
        },
    });

    log("Finding source files...");

    await copy();

    // add source files
    project.addSourceFilesAtPaths([
        join(targetDirPath, "**/*.ts"),
        join(targetDirPath, "**/*.mts"),
        join(targetDirPath, "**/*.cts"),
        join(targetDirPath, "**/*.tsx"),
        join(targetDirPath, "**/*.js"),
        join(targetDirPath, "**/*.mjs"),
        join(targetDirPath, "**/*.cjs"),
        join(targetDirPath, "**/*.jsx"),
    ]);

    let filesParsed = project.getSourceFiles();

    log(
        `Processing ${filesParsed.length} file(s)${
          filesParsed.length ? ` (Total parsed: ${filesParsed.length})` : ""
        }...`
    );


    // For each source file...
    for (let source of filesParsed) {
        let fileChange = false;
        const sourceFilePath = source.getFilePath();
        log(`${divider}\nParsing source "${sourceFilePath}"`);

        for (let decl of source.getImportStringLiterals()) {
            const literalValue = decl.getLiteralValue();

            // Update module specifier
            if (/ts$/.test(literalValue)) {
                const transformedLiteralValue = literalValue.replace(/ts$/, 'js');
                log(`Transform ${literalValue} -> ${transformedLiteralValue}`)
                decl.setLiteralValue(transformedLiteralValue);
                fileChange = true;
            }

        }

        // ...Iterate through imports;
        for (let decl of source.getImportDeclarations()) {

            const moduleSpecifier = decl.getModuleSpecifierValue();

            // Update module specifier
            if (/ts$/.test(moduleSpecifier)) {
                const transformedModuleSpecifier = moduleSpecifier.replace(/ts$/, 'js');
                log(`Transform ${moduleSpecifier} -> ${transformedModuleSpecifier}`)
                decl.setModuleSpecifier(transformedModuleSpecifier);
                fileChange = true;
            }
        }

        if (fileChange) {
            // Save the source.
            log(`\nSaving source file "${sourceFilePath}"`);
            await writeFile(source.getFilePath(), `// @ts-nocheck\n` + source.getText(), 'utf8');
            // await source.save();
        }
    }
}

await transform();