#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { builtinModules } = require('node:module')
const ts = require('typescript')

const DEFAULT_SOURCE_DIRS = ['src', 'tests', 'scripts']
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'])
const BUILTIN_MODULES = new Set(
  builtinModules.flatMap((moduleName) =>
    moduleName.startsWith('node:') ? [moduleName, moduleName.slice(5)] : [moduleName],
  ),
)

function loadPackageManifest(rootDir = process.cwd()) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'))
}

function getDeclaredPackages(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ])
}

function isSourceFile(filePath) {
  if (filePath.endsWith('.d.ts')) {
    return false
  }

  return SOURCE_EXTENSIONS.has(path.extname(filePath))
}

function collectSourceFiles(rootDir = process.cwd(), sourceDirs = DEFAULT_SOURCE_DIRS) {
  const files = []

  function walk(currentPath) {
    const stats = fs.statSync(currentPath)
    if (stats.isDirectory()) {
      for (const entry of fs.readdirSync(currentPath)) {
        walk(path.join(currentPath, entry))
      }
      return
    }

    if (stats.isFile() && isSourceFile(currentPath)) {
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

function normalizePackageSpecifier(specifier) {
  if (!specifier) {
    return null
  }

  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    specifier.startsWith('@/') ||
    specifier.startsWith('#')
  ) {
    return null
  }

  if (/^[a-zA-Z]+:/.test(specifier)) {
    return BUILTIN_MODULES.has(specifier) ? specifier.replace(/^node:/, '') : null
  }

  const packageName = specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0]

  if (!packageName || BUILTIN_MODULES.has(packageName)) {
    return null
  }

  return packageName
}

function getImportedPackages(filePath, sourceText) {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true)
  const packages = new Set()

  function addSpecifier(specifier) {
    const packageName = normalizePackageSpecifier(specifier)
    if (packageName) {
      packages.add(packageName)
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
  return [...packages].sort()
}

function findUndeclaredImports({
  rootDir = process.cwd(),
  sourceDirs = DEFAULT_SOURCE_DIRS,
  manifest = loadPackageManifest(rootDir),
} = {}) {
  const declaredPackages = getDeclaredPackages(manifest)
  const missingByFile = []

  for (const filePath of collectSourceFiles(rootDir, sourceDirs)) {
    const sourceText = fs.readFileSync(filePath, 'utf8')
    const missingPackages = getImportedPackages(filePath, sourceText).filter(
      (packageName) => packageName !== manifest.name && !declaredPackages.has(packageName),
    )

    if (missingPackages.length > 0) {
      missingByFile.push({
        filePath: path.relative(rootDir, filePath),
        packages: missingPackages,
      })
    }
  }

  return missingByFile
}

function formatMissingImports(missingByFile) {
  return missingByFile.flatMap(({ filePath, packages }) =>
    packages.map((packageName) => `- ${filePath}: ${packageName}`),
  )
}

function main(argv = process.argv.slice(2), options = {}) {
  const rootDir = options.rootDir ?? process.cwd()
  const consoleImpl = options.console ?? console
  const sourceDirs = argv.length > 0 ? argv : DEFAULT_SOURCE_DIRS
  const missingByFile = findUndeclaredImports({ rootDir, sourceDirs })

  if (missingByFile.length === 0) {
    consoleImpl.log(
      `[check-direct-dependencies] OK (${sourceDirs.join(', ')} match package.json declarations)`,
    )
    return 0
  }

  consoleImpl.error('[check-direct-dependencies] Undeclared direct imports found:')
  for (const line of formatMissingImports(missingByFile)) {
    consoleImpl.error(line)
  }
  consoleImpl.error(
    'Declare each package in package.json dependencies/devDependencies instead of relying on transitive installs.',
  )
  return 1
}

if (require.main === module) {
  process.exitCode = main()
}

module.exports = {
  BUILTIN_MODULES,
  DEFAULT_SOURCE_DIRS,
  collectSourceFiles,
  findUndeclaredImports,
  formatMissingImports,
  getDeclaredPackages,
  getImportedPackages,
  isSourceFile,
  loadPackageManifest,
  main,
  normalizePackageSpecifier,
}
