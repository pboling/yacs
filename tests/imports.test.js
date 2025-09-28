import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('critical imports referenced by App.tsx exist', () => {
  it('should import required files and those files should exist', () => {
    const appPath = resolve(__dirname, '..', 'src', 'App.tsx');
    const srcDir = resolve(__dirname, '..', 'src');
    const content = readFileSync(appPath, 'utf8');
    const importRegex = /import\s+[^"'\n]+from\s+["'](\.\S*?\.(?:js|ts))["']/g;
    const imports = [];
    let m;
    while ((m = importRegex.exec(content)) !== null) {
      imports.push(m[1]);
    }
    const required = [
      ['./scanner.client.js'],
      ['./tokens.reducer.js'],
      ['./ws.subs.js', './ws.subs.ts'],
    ];
    for (const alts of required) {
      const present = alts.some((rel) => imports.includes(rel));
      expect(present).toBe(true);
      const existing = alts.find((rel) => existsSync(resolve(srcDir, rel)));
      expect(existing).toBeTruthy();
    }
  });
});
