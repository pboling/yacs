// CI-specific ESLint flat config layer
// Imports the base config and promotes selected TypeScript warnings to errors for gating.
// Usage: npm run lint:ci (see package.json)
import base from './eslint.config.js'

// Helper to detect TS block (matches our base config structure)
function isTsBlock(block) {
  return Array.isArray(block.files) && block.files.some((p) => p.includes('ts,tsx'))
}

export default base.map((block) => {
  if (isTsBlock(block)) {
    const next = { ...block }
    next.rules = { ...(block.rules || {}) }
    // Promote high-confidence rules to errors for CI gating
    const promoteToError = [
      '@typescript-eslint/no-unused-vars',
      '@typescript-eslint/no-unsafe-assignment',
      '@typescript-eslint/no-unsafe-member-access',
      '@typescript-eslint/restrict-plus-operands',
      '@typescript-eslint/restrict-template-expressions',
      '@typescript-eslint/no-unnecessary-type-conversion',
    ]
    for (const r of promoteToError) {
      if (r in next.rules) {
        const current = next.rules[r]
        if (Array.isArray(current)) {
          next.rules[r] = ['error', ...current.slice(1)]
        } else {
          next.rules[r] = 'error'
        }
      }
    }
    // Keep these as warnings to avoid CI noise / allow gradual improvement
    // (leave existing severity if already stricter)
    const keepWarn = [
      '@typescript-eslint/no-explicit-any',
      '@typescript-eslint/no-unnecessary-condition',
      '@typescript-eslint/no-empty-function',
    ]
    for (const r of keepWarn) {
      if (r in next.rules) {
        const current = next.rules[r]
        if (current === 'warn' || (Array.isArray(current) && current[0] === 'warn')) continue
      }
    }
    return next
  }
  return block
})
