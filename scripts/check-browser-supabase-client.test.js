import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import checker from './check-browser-supabase-client.js'

const {
  findBrowserSupabaseClientImporters,
  findUnexpectedBrowserSupabaseClientImports,
  isRuntimeSourceFile,
  main,
} = checker

const tempDirs = []

function createTempProject() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebel-ai-browser-supabase-'))
  tempDirs.push(rootDir)
  return rootDir
}

function writeFile(rootDir, relativePath, contents) {
  const absolutePath = path.join(rootDir, relativePath)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, contents)
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const rootDir = tempDirs.pop()
    if (rootDir) {
      fs.rmSync(rootDir, { recursive: true, force: true })
    }
  }
})

describe('check-browser-supabase-client', () => {
  it('detects unexpected runtime imports of the browser Supabase client', () => {
    const rootDir = createTempProject()
    writeFile(
      rootDir,
      'src/app/dashboard/example/Widget.tsx',
      "import { createClient } from '@/lib/supabase/client'\n",
    )

    const result = findUnexpectedBrowserSupabaseClientImports({
      rootDir,
      allowedImporters: [],
    })

    expect(result).toEqual(['src/app/dashboard/example/Widget.tsx'])
  })

  it('ignores test-only imports when checking runtime boundaries', () => {
    const rootDir = createTempProject()
    writeFile(
      rootDir,
      'src/app/dashboard/example/Widget.test.tsx',
      "import { createClient } from '@/lib/supabase/client'\n",
    )
    writeFile(
      rootDir,
      'src/tests/mocks/example.ts',
      "import { createClient } from '@/lib/supabase/client'\n",
    )

    expect(isRuntimeSourceFile('src/app/dashboard/example/Widget.test.tsx')).toBe(false)
    expect(isRuntimeSourceFile('src/tests/mocks/example.ts')).toBe(false)
    expect(findBrowserSupabaseClientImporters({ rootDir })).toEqual([])
  })

  it('returns a failing exit code and useful output when a new runtime importer appears', () => {
    const rootDir = createTempProject()
    writeFile(
      rootDir,
      'src/app/dashboard/example/Widget.tsx',
      "import { createClient } from '@/lib/supabase/client'\n",
    )

    const consoleImpl = {
      log: vi.fn(),
      error: vi.fn(),
    }

    const exitCode = main([], {
      rootDir,
      console: consoleImpl,
      allowedImporters: [],
    })

    expect(exitCode).toBe(1)
    expect(consoleImpl.error).toHaveBeenCalledWith(
      '[check-browser-supabase-client] Unexpected runtime imports of @/lib/supabase/client found:',
    )
    expect(consoleImpl.error).toHaveBeenCalledWith('- src/app/dashboard/example/Widget.tsx')
  })

  it('passes when runtime imports stay inside the explicit allowlist', () => {
    const rootDir = createTempProject()
    const allowedImporter = 'src/app/dashboard/example/Allowed.tsx'
    writeFile(rootDir, allowedImporter, "import { createClient } from '@/lib/supabase/client'\n")

    const result = findUnexpectedBrowserSupabaseClientImports({
      rootDir,
      allowedImporters: [allowedImporter],
    })

    expect(result).toEqual([])
  })
})
