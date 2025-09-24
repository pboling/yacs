Project development guidelines

Scope
- Audience: experienced frontend engineers.
- Stack: React 19 + TypeScript 5.8 + Vite 7 (rolldown-vite alias), ESM only (package.json type: module).
- Goal: document build/config, linting, testing approach, and practical tips specific to this repo.

1) Build and configuration
- Prerequisites
  - Node.js >= 20 (repo validated with Node 23). ESM is required.
  - PNPM/NPM/Yarn all work; examples below use npm.

- Install
  - npm ci (preferred for reproducible installs)
  - or npm install

- Dev server
  - npm run dev → starts Vite dev server with React fast refresh.
  - Default port is 5173 unless occupied.

- Production build
  - npm run build performs a TypeScript build (composite project) then Vite build.
  - TypeScript config uses project references via tsconfig.json:
    - tsconfig.app.json → app sources (src/**/*)
    - tsconfig.node.json → node-side config files (vite.config.ts)
  - No output from tsc (noEmit: true); the tsc step is type-checking only.

- Preview build
  - npm run preview → serves the dist folder built by Vite.

- Vite specifics
  - vite is overridden to rolldown-vite@7.1.12 via package.json overrides to opt into the Rolldown-based build. If you upgrade Vite, keep the override aligned or remove it intentionally.
  - Plugins: @vitejs/plugin-react with React Refresh enabled.

- TypeScript highlights (tsconfig.app.json)
  - target: ES2022, module: ESNext, moduleResolution: bundler, jsx: react-jsx
  - Strictness: strict, noUnusedLocals, noUnusedParameters, noFallthroughCasesInSwitch, noUncheckedSideEffectImports, erasableSyntaxOnly
  - Use of verbatimModuleSyntax and allowImportingTsExtensions is enabled; prefer explicit import types and extensionless imports in app code, but be aware of these flags during refactors.

- ESLint
  - Config: eslint.config.js using flat config API.
  - Extends: @eslint/js recommended, typescript-eslint recommended, react-hooks latest, react-refresh vite.
  - Script: npm run lint → eslint .
  - The config targets **/*.ts, **/*.tsx and ignores dist.

2) Testing
This template does not include a third-party test runner by default. For lightweight unit tests without adding dependencies, use Node’s built-in test runner (node:test), which works well for pure functions and simple module-level tests.

- One-time prerequisites
  - Node >= 20. The repo sets "type": "module"; author test files as ESM (import syntax) or use --input-type=module for inline tests.

- Directory & naming
  - You can place tests anywhere; common patterns are tests/**/*.test.{js,ts,mjs,cts} or co-located next to code.
  - Node’s test runner by default discovers files matching: **/*.test.* or **/*.spec.* (among others) when run as node --test.

- Running tests
  - Run a directory or file: node --test path/to/tests
  - Example: node --test src
  - Inline demo (validated):
    node --input-type=module --eval "import test from 'node:test'; import assert from 'node:assert/strict'; await test('math', () => assert.equal(2+2,4));"

- Example: authoring a simple test file
  - Create a file, e.g., tests/math.test.js with ESM:
    import test from 'node:test'
    import assert from 'node:assert/strict'

    test('adds', () => {
      assert.equal(2 + 2, 4)
    })

  - Run it: node --test tests/math.test.js

- TypeScript tests
  - If you want TypeScript tests without extra tooling, run them through ts-node or transpile first. Since this repo doesn’t include ts-node by default, prefer JS tests or add a devDependency on ts-node/tsx/Vitest if TS tests are desired.

- Adding a full-featured runner
  - For richer testing (watch mode, coverage, jsdom, React component testing), Vitest integrates seamlessly with Vite:
    - npm i -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom
    - Add scripts: "test": "vitest", "test:ui": "vitest --ui", "coverage": "vitest run --coverage"
    - Configure in vite.config.ts (Vitest block) and set environment: jsdom for DOM-based tests.

- What we validated now
  - We executed an inline node:test run to confirm the approach works with this repo’s ESM setup using Node 23. This demonstrates the minimal, dependency-free path for simple tests.

3) Additional development information
- React 19 notes
  - This template targets react@^19.1.1 and uses the modern JSX runtime (no need for React import in components).
  - The React Compiler is not enabled. See README for instructions if you opt in; enabling it can affect dev/build performance and ESLint rules.

- ESM-only environment
  - package.json has "type": "module". Use import/export everywhere, including config scripts. For Node one-offs, pass --input-type=module when using node --eval or name files .mjs.

- Code style
  - Follow TypeScript strictness flags; fix unused variables/parameters or prefix with _ when intentional.
  - Prefer function components and hooks; adhere to eslint-plugin-react-hooks rules (exhaustive-deps, rules-of-hooks).
  - Avoid default exports when possible; verbatimModuleSyntax encourages explicitness.

- Path and module resolution
  - moduleResolution: bundler aligns with Vite. Avoid Node-style resolution assumptions that conflict with bundlers (e.g., require, __dirname). Use import.meta and Vite aliases if added.

- Debugging tips
  - Vite dev: source maps are enabled by default; use browser devtools. React Fast Refresh preserves state during edits.
  - Preview vs dev: use npm run preview to more closely simulate production; some issues only surface in the built app.
  - ESLint: run npm run lint and enable IDE eslint integration for immediate feedback.

- Upgrading toolchain
  - If you upgrade TypeScript, double-check tsconfig flags still exist (e.g., erasableSyntaxOnly is relatively new) and that typescript-eslint is compatible.
  - If removing the rolldown-vite override, verify build outputs and plugin compatibility.

- CI suggestions (not present yet)
  - Cache node_modules and Vite cache (node_modules/.vite, if present).
  - Run: npm ci, npm run lint, npm run build, optional: basic smoke tests via node --test.

Appendix: Quick commands
- Install: npm ci
- Dev: npm run dev
- Lint: npm run lint
- Build: npm run build
- Preview: npm run preview
- Test (discovery): node --test
- Test (file): node --test tests/example.test.js
- Inline test (ESM): node --input-type=module --eval "import test from 'node:test'; import assert from 'node:assert/strict'; await test('ok', () => assert.ok(true));"