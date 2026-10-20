const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const rootDir = path.resolve(__dirname, '..')
const sourcePath = path.join(rootDir, 'supabase/tests/data_api_grants.test.sql.in')
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebel-ai-data-api-grants-'))
const testPath = path.join(tempDir, 'data_api_grants.test.sql')

try {
  // The CLI mounts test files into pg_prove without their sibling migrations.
  // Inline psql includes so the test always executes the real migration source.
  const sql = fs
    .readFileSync(sourcePath, 'utf8')
    .replace(/^\\ir (.+)\r?$/gm, (_, relativePath) =>
      fs.readFileSync(path.resolve(path.dirname(sourcePath), relativePath.trim()), 'utf8'),
    )
  fs.writeFileSync(testPath, sql)
  const result = spawnSync('supabase', ['test', 'db', testPath], {
    cwd: rootDir,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  fs.rmSync(testPath, { force: true })
  fs.rmdirSync(tempDir)
}
