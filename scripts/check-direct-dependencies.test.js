import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import checker from './check-direct-dependencies.js'

const { findUndeclaredImports, getImportedPackages, main, normalizePackageSpecifier } = checker

const tempDirs = []

function createTempProject() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rebel-ai-deps-'))
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

describe('check-direct-dependencies', () => {
  it('detects bare imports that are not declared in package.json', () => {
    const rootDir = createTempProject()
    writeFile(
      rootDir,
      'src/app/example.ts',
      `
        import { z } from 'zod'
        import localValue from './local'
        import serverOnly from '@/lib/server-only'
      `,
    )
    writeFile(rootDir, 'src/app/local.ts', 'export default 1')

    const result = findUndeclaredImports({
      rootDir,
      manifest: {
        name: 'rebel-ai',
        dependencies: {
          next: '^15.5.15',
        },
      },
    })

    expect(result).toEqual([
      {
        filePath: 'src/app/example.ts',
        packages: ['zod'],
      },
    ])
  })

  it('treats subpath imports, builtins, and require/import calls as their root package', () => {
    const packages = getImportedPackages(
      'example.ts',
      `
        import { redirect } from 'next/navigation'
        export { NextResponse } from 'next/server'
        const fs = require('node:fs')
        const path = require('path')
        const dynamic = import('@supabase/supabase-js')
        import 'server-only'
      `,
    )

    expect(packages).toEqual(['@supabase/supabase-js', 'next', 'server-only'])
    expect(normalizePackageSpecifier('node:fs')).toBeNull()
    expect(normalizePackageSpecifier('path')).toBeNull()
  })

  it('returns a failing exit code and useful output when undeclared imports exist', () => {
    const rootDir = createTempProject()
    writeFile(rootDir, 'scripts/example.js', "const { z } = require('zod')\n")
    writeFile(rootDir, 'package.json', JSON.stringify({ name: 'rebel-ai' }))

    const consoleImpl = {
      log: vi.fn(),
      error: vi.fn(),
    }

    const exitCode = main([], { rootDir, console: consoleImpl })

    expect(exitCode).toBe(1)
    expect(consoleImpl.error).toHaveBeenCalledWith(
      '[check-direct-dependencies] Undeclared direct imports found:',
    )
    expect(consoleImpl.error).toHaveBeenCalledWith('- scripts/example.js: zod')
  })
})
