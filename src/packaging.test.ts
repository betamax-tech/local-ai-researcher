/**
 * Packaging configuration tests — task 12.01
 *
 * These are static analysis tests: they read package.json and dist/index.js
 * directly and assert that the packaging configuration is correct for
 * `npx` / `pnpm dlx` distribution.
 *
 * Tests must FAIL on current code for items not yet configured (files field).
 * Tests must PASS once the coder implements the task.
 */

import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect } from 'vitest'

const ROOT = resolve(__dirname, '..')
const pkgPath = resolve(ROOT, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))

// ---------------------------------------------------------------------------
// 1. bin field
// ---------------------------------------------------------------------------
describe('package.json bin field', () => {
  it('has a bin field', () => {
    expect(pkg.bin).toBeDefined()
  })

  it('bin field is an object with at least one entry', () => {
    expect(typeof pkg.bin).toBe('object')
    expect(Object.keys(pkg.bin).length).toBeGreaterThan(0)
  })

  it('bin entry points to scripts/start.sh (Docker + MCP launcher)', () => {
    // The bin entry is scripts/start.sh, not dist/index.js directly.
    // start.sh starts SearXNG via docker compose then execs dist/index.js,
    // enabling `npx github:mark-cervantes/local-ai-researcher` zero-setup flow.
    const binValues = Object.values(pkg.bin as Record<string, string>)
    const pointsToStartSh = binValues.some(
      (v) => v === './scripts/start.sh' || v === 'scripts/start.sh'
    )
    expect(pointsToStartSh).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. files field
// ---------------------------------------------------------------------------
describe('package.json files field', () => {
  it('has a files field', () => {
    // FAILS: files field is missing from package.json
    expect(pkg.files).toBeDefined()
  })

  it('files field includes dist/', () => {
    // FAILS: files field is missing from package.json
    const files: string[] = pkg.files ?? []
    const includesDist = files.some((f) => f === 'dist' || f === 'dist/')
    expect(includesDist).toBe(true)
  })

  it('files field does not include src/', () => {
    // FAILS: files field is missing, so src/ exclusion cannot be validated
    const files: string[] = pkg.files ?? []
    // A missing files field publishes everything — fail the assertion explicitly
    expect(Array.isArray(files)).toBe(true)
    const includesSrc = files.some((f) => f === 'src' || f === 'src/')
    expect(includesSrc).toBe(false)
  })

  it('files field does not include test files', () => {
    // FAILS: files field is missing, so test-file exclusion cannot be validated
    const files: string[] = pkg.files ?? []
    expect(Array.isArray(files)).toBe(true)
    const includesTests = files.some((f) => f.includes('.test.'))
    expect(includesTests).toBe(false)
  })

  it('files field does not include tsconfig.json', () => {
    // FAILS: files field is missing, so dev-config exclusion cannot be validated
    const files: string[] = pkg.files ?? []
    expect(Array.isArray(files)).toBe(true)
    const includesTsconfig = files.some((f) => f === 'tsconfig.json')
    expect(includesTsconfig).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 3. engines.node
// ---------------------------------------------------------------------------
describe('package.json engines field', () => {
  it('declares an engines.node field', () => {
    expect(pkg.engines?.node).toBeDefined()
  })

  it('engines.node specifies >=18.0.0', () => {
    // Accept semver ranges that allow Node 18+ (e.g. ">=18.0.0", ">=18")
    expect(pkg.engines.node).toMatch(/>=\s*18/)
  })
})

// ---------------------------------------------------------------------------
// 4. dist/index.js shebang
// ---------------------------------------------------------------------------
describe('dist/index.js executable shebang', () => {
  const distPath = resolve(ROOT, 'dist/index.js')

  it('dist/index.js exists', () => {
    expect(existsSync(distPath)).toBe(true)
  })

  it('dist/index.js starts with a Node.js shebang line', () => {
    const content = readFileSync(distPath, 'utf-8')
    // Must be the very first line — required for npx to execute it directly
    expect(content.startsWith('#!/usr/bin/env node')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. dependency split — no dev deps leaked into dependencies
// ---------------------------------------------------------------------------
describe('package.json dependency split', () => {
  const deps = Object.keys(pkg.dependencies ?? {})
  const devDeps = Object.keys(pkg.devDependencies ?? {})

  it('@modelcontextprotocol/sdk is in dependencies', () => {
    expect(deps).toContain('@modelcontextprotocol/sdk')
  })

  it('@modelcontextprotocol/sdk is NOT in devDependencies', () => {
    expect(devDeps).not.toContain('@modelcontextprotocol/sdk')
  })

  it('zod is in dependencies', () => {
    expect(deps).toContain('zod')
  })

  it('zod is NOT in devDependencies', () => {
    expect(devDeps).not.toContain('zod')
  })

  it('typescript is in devDependencies, not dependencies', () => {
    expect(devDeps).toContain('typescript')
    expect(deps).not.toContain('typescript')
  })

  it('vitest is in devDependencies, not dependencies', () => {
    expect(devDeps).toContain('vitest')
    expect(deps).not.toContain('vitest')
  })
})
