import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { requireTestDatabaseUrl } from './test-database'

export default function setup() {
  execFileSync(process.execPath, [join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: requireTestDatabaseUrl() },
    stdio: 'inherit'
  })
}
