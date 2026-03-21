import { readdirSync } from 'fs'
import { types } from 'util'
import { resolve } from 'path'

const regex = /(test|spec).(m|c)?(j)sx?$/m
const arg = process.argv.slice(2)[0]
const dir = resolve(process.cwd() || '', arg || '')

console.log('Running tests in', dir)

const files = readdirSync(dir).filter((file) => regex.test(file))
const tests: {name: string; fn: () => Promise<any>}[] = [];

(globalThis as any).Deno = {};
(globalThis as any).Deno.test = function test(name: string, fn: () => Promise<any>) {
  tests.push({ name, fn })
}

async function run() {
  await Promise.all(files.map((file) => import('file://' + dir + '/' + file))).catch((e) =>
    console.error(e)
  )
  tests.forEach((t) => {
    if (types.isAsyncFunction(t.fn)) {
      t.fn()
        .then(() => console.log('✅', t.name))
        .catch((e) => {
          console.log('❌', t.name)
          console.log(e.stack)
        })
    } else {
      try {
        t.fn()
        console.log('✅', t.name)
      } catch (e) {
        console.log('❌', t.name)
        console.log(e.stack)
      }
    }
  })
}

try {
  run()
} catch (error) {
  console.error(error);
}

