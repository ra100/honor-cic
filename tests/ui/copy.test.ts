import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|css|html)$/.test(p) ? [p] : [];
  });
}

describe('UI copy rules (DESIGN.md Copy, R-02, R-15)', () => {
  const files = [...walk('src/ui'), ...walk('src/render'), 'index.html'];
  it('has no em dashes in UI text', () => {
    expect(files.filter((f) => readFileSync(f, 'utf8').includes('\u2014'))).toEqual([]);
  });
  it('uses specific CTAs, never "Learn more" or "Explore"', () => {
    expect(files.filter((f) => /['"`>](Learn more|Explore)\b/.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
});
