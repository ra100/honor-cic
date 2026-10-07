import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });
}

const core = walk('src/core');

describe('architecture', () => {
  it('keeps src/core free of render, ui, three and DOM access', () => {
    const banned = /from ['"](\.\.\/)+(render|ui)\/|from ['"]three|\bdocument\.|\bwindow\./;
    expect(core.filter((f) => banned.test(readFileSync(f, 'utf8')))).toEqual([]);
  });

  it('keeps src/core deterministic (no Math.random)', () => {
    expect(core.filter((f) => /Math\.random/.test(readFileSync(f, 'utf8')))).toEqual([]);
  });
});
