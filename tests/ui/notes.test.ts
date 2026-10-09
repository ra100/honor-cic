import { describe, expect, it } from 'vitest';
import { getPack } from '../../src/registry';
import { noteBlocks, noteInline, safeNoteUrl, type NoteInline } from '../../src/ui/notes';

const links = (tokens: NoteInline[]): NoteInline[] => tokens.flatMap((token) => {
  if (token.kind === 'link') return [token];
  return 'children' in token ? links(token.children) : [];
});

describe('safe reconstruction Notes', () => {
  it('formats the actual Manticore headings, lists, bold labels, italics, inline code and source URL', () => {
    const blocks = noteBlocks(getPack('manticore')!.notes);
    expect(blocks[0]).toMatchObject({ kind: 'heading', level: 1 });
    expect(blocks.some((block) => block.kind === 'heading' && block.level === 2)).toBe(true);
    const lists = blocks.filter((block) => block.kind === 'list');
    expect(lists.length).toBeGreaterThan(1);
    expect(lists[0].ordered).toBe(false);
    expect(lists[0].items[0][0]).toEqual({ kind: 'strong', children: [{ kind: 'text', text: 'P' }] });
    expect(lists.flatMap((block) => block.items).flatMap(links)).toContainEqual({
      kind: 'link', text: 'https://honorverse.fandom.com/wiki/Battle_of_Manticore', href: 'https://honorverse.fandom.com/wiki/Battle_of_Manticore',
    });
    expect(noteInline('David Weber, *On Basilisk Station*, in `docs/`.')).toContainEqual({ kind: 'em', children: [{ kind: 'text', text: 'On Basilisk Station' }] });
    expect(noteInline('Use `hit_fraction`.')).toContainEqual({ kind: 'code', text: 'hit_fraction' });
  });

  it('formats the non-canon Training notes without losing their qualification', () => {
    const blocks = noteBlocks(getPack('training')!.notes);
    expect(blocks[0]).toMatchObject({ kind: 'heading', content: [{ kind: 'text', text: 'Training engagement (non-canon)' }] });
    expect(JSON.stringify(blocks)).toContain('This pack is not a canon battle.');
    expect(noteBlocks(' \n')).toEqual([]);
  });

  it('treats arbitrary HTML as text and never makes unsafe link protocols executable', () => {
    const malicious = '<script>alert(1)</script> <img src=x onerror=alert(2)> [run](javascript:alert(3)) [payload](data:text/html,test)';
    const tokens = noteInline(malicious);
    expect(links(tokens)).toEqual([]);
    expect(tokens[0]).toMatchObject({ kind: 'text', text: expect.stringContaining('<script>') });
    expect(safeNoteUrl('javascript:alert(1)')).toBeNull();
    expect(safeNoteUrl('data:text/html,test')).toBeNull();
    expect(safeNoteUrl('//untrusted.example')).toBeNull();
    expect(safeNoteUrl('https://example.com/source')).toBe('https://example.com/source');
  });

  it('supports escaped markers, ordered notes and literal code blocks without parsing their content', () => {
    expect(noteInline('\\*literal\\*')).toEqual([{ kind: 'text', text: '*' }, { kind: 'text', text: 'literal' }, { kind: 'text', text: '*' }]);
    expect(noteBlocks('1. First\n2. Second\n\n```html\n<script>literal</script>\n```')).toEqual([
      { kind: 'list', ordered: true, items: [[{ kind: 'text', text: 'First' }], [{ kind: 'text', text: 'Second' }]] },
      { kind: 'code', text: '<script>literal</script>' },
    ]);
  });
});
