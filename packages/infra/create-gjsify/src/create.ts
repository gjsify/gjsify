import { readFileSync, writeFileSync, mkdirSync, existsSync, cpSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export async function createProject(projectName: string): Promise<void> {
    const targetDir = resolve(process.cwd(), projectName)

    if (existsSync(targetDir)) {
        console.error(`Error: Directory "${projectName}" already exists.`)
        process.exit(1)
    }

    console.log(`Creating new Gjsify project in ${targetDir}...`)

    // Create directory structure
    mkdirSync(join(targetDir, 'src'), { recursive: true })

    // Copy template files
    const templatesDir = resolve(__dirname, '..', 'templates')

    // Generate package.json from template
    const packageJsonTemplate = readFileSync(join(templatesDir, 'package.json.tmpl'), 'utf-8')
    const packageJson = packageJsonTemplate.replace(/\{\{projectName\}\}/g, projectName)
    writeFileSync(join(targetDir, 'package.json'), packageJson)

    // Copy tsconfig.json
    cpSync(join(templatesDir, 'tsconfig.json.tmpl'), join(targetDir, 'tsconfig.json'))

    // Copy src/index.ts
    cpSync(join(templatesDir, 'src', 'index.ts.tmpl'), join(targetDir, 'src', 'index.ts'))

    console.log('')
    console.log('Project created successfully!')
    console.log('')
    console.log('Next steps:')
    console.log(`  cd ${projectName}`)
    console.log('  npm install')
    console.log('  npm run build')
    console.log('  npm start')
    console.log('')
}
