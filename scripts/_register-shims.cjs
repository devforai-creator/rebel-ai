// Register shims for CLI usage
// This file should be required before any other imports via --require flag

const Module = require('module')

const originalRequire = Module.prototype.require

Module.prototype.require = function (id) {
  if (id === 'server-only') {
    // Return empty module instead of throwing
    return {}
  }
  return originalRequire.apply(this, arguments)
}
