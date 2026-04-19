#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const DEFAULT_SOURCE_DIRS = ['src']
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'])
const BROWSER_SUPABASE_CLIENT_SPECIFIER = '@/lib/supabase/client'
const ALLOWED_RUNTIME_IMPORTERS = [
  'src/app/dashboard/chats/[id]/hooks/useChatRealtimeSubscription.ts',
  'src/app/dashboard/chats/[id]/hooks/useChatSummariesState.ts',
]

function normalizeRelativePath(filePath) {
  return filePath.split(path.sep).join('/')
}

function isSourceFile(filePath) {
  if (filePath.endsWith('.d.ts')) {
    return false
  }

  return SOURCE_EXTENSIONS.has(path.extname(filePath))
}

function isRuntimeSourceFile(relativePath) {
  const normalizedPath = normalizeRelativePath(relativePath)

  if (
    normalizedPath.startsWith('src/tests/') ||
    normalizedPath.includes('/__tests__/') ||
    /\.test\.[^.]+$/.test(normalizedPath) ||
    /\.spec\.[^.]+$/.test(normalizedPath)
  ) {
    return false
  }

  return true
}

function collectRuntimeSourceFiles(rootDir = process.cwd(), sourceDirs = DEFAULT_SOURCE_DIRS) {
  const files = []

  function walk(currentPath) {
    const stats = fs.statSync(currentPath)
    if (stats.isDirectory()) {
      for (const entry of fs.readdirSync(currentPath)) {
        walk(path.join(currentPath, entry))
      }
      return
    }

    if (!stats.isFile() || !isSourceFile(currentPath)) {
      return
    }

    const relativePath = path.relative(rootDir, currentPath)
    if (isRuntimeSourceFile(relativePath)) {
      files.push(currentPath)
    }
  }

  for (const relativeDir of sourceDirs) {
    const absoluteDir = path.join(rootDir, relativeDir)
    if (fs.existsSync(absoluteDir)) {
      walk(absoluteDir)
    }
  }

  return files.sort()
}

function getImportedSpecifiers(filePath, sourceText) {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)
  const specifiers = new Set()

  function addSpecifier(specifier) {
    if (specifier) {
      specifiers.add(specifier)
    }
  }

  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      addSpecifier(node.moduleSpecifier.text)
    }

    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      addSpecifier(node.moduleReference.expression.text)
    }

    if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const [firstArg] = node.arguments
      if (!ts.isStringLiteralLike(firstArg)) {
        ts.forEachChild(node, visit)
        return
      }

      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require')
      ) {
        addSpecifier(firstArg.text)
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return [...specifiers].sort()
}

function findBrowserSupabaseClientImporters({
  rootDir = process.cwd(),
  sourceDirs = DEFAULT_SOURCE_DIRS,
  specifier = BROWSER_SUPABASE_CLIENT_SPECIFIER,
} = {}) {
  const importers = []

  for (const filePath of collectRuntimeSourceFiles(rootDir, sourceDirs)) {
    const sourceText = fs.readFileSync(filePath, 'utf8')
    const importedSpecifiers = getImportedSpecifiers(filePath, sourceText)
    if (!importedSpecifiers.includes(specifier)) {
      continue
    }

    importers.push(normalizeRelativePath(path.relative(rootDir, filePath)))
  }

  return importers.sort()
}

function findUnexpectedBrowserSupabaseClientImports({
  rootDir = process.cwd(),
  sourceDirs = DEFAULT_SOURCE_DIRS,
  allowedImporters = ALLOWED_RUNTIME_IMPORTERS,
  specifier = BROWSER_SUPABASE_CLIENT_SPECIFIER,
} = {}) {
  const allowedSet = new Set(allowedImporters.map(normalizeRelativePath))
  return findBrowserSupabaseClientImporters({ rootDir, sourceDirs, specifier }).filter(
    (filePath) => !allowedSet.has(filePath),
  )
}

function main(argv = process.argv.slice(2), options = {}) {
  const rootDir = options.rootDir ?? process.cwd()
  const consoleImpl = options.console ?? console
  const sourceDirs = argv.length > 0 ? argv : DEFAULT_SOURCE_DIRS
  const unexpectedImporters = findUnexpectedBrowserSupabaseClientImports({
    rootDir,
    sourceDirs,
    allowedImporters: options.allowedImporters ?? ALLOWED_RUNTIME_IMPORTERS,
  })

  if (unexpectedImporters.length === 0) {
    consoleImpl.log(
      `[check-browser-supabase-client] OK (${BROWSER_SUPABASE_CLIENT_SPECIFIER} runtime imports remain within the allowlist)`,
    )
    return 0
  }

  consoleImpl.error(
    '[check-browser-supabase-client] Unexpected runtime imports of @/lib/supabase/client found:',
  )
  for (const filePath of unexpectedImporters) {
    consoleImpl.error(`- ${filePath}`)
  }
  consoleImpl.error('Move the flow to a server-owned boundary or update the explicit allowlist.')
  return 1
}

if (require.main === module) {
  process.exitCode = main()
}

module.exports = {
  ALLOWED_RUNTIME_IMPORTERS,
  BROWSER_SUPABASE_CLIENT_SPECIFIER,
  DEFAULT_SOURCE_DIRS,
  collectRuntimeSourceFiles,
  findBrowserSupabaseClientImporters,
  findUnexpectedBrowserSupabaseClientImports,
  getImportedSpecifiers,
  isRuntimeSourceFile,
  isSourceFile,
  main,
  normalizeRelativePath,
}
