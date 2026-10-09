import { h, type Child } from './dom';

export type NoteInline =
  | { kind: 'text' | 'code'; text: string }
  | { kind: 'strong' | 'em'; children: NoteInline[] }
  | { kind: 'link'; text: string; href: string };

export type NoteBlock =
  | { kind: 'heading'; level: number; content: NoteInline[] }
  | { kind: 'paragraph'; content: NoteInline[] }
  | { kind: 'list'; ordered: boolean; items: NoteInline[][] }
  | { kind: 'code'; text: string };

export function safeNoteUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

export function noteInline(text: string): NoteInline[] {
  const tokens: NoteInline[] = [];
  const pattern = /\\([\\`*[\]])|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>]+)/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    const at = match.index!;
    if (at > start) tokens.push({ kind: 'text', text: text.slice(start, at) });
    if (match[1]) tokens.push({ kind: 'text', text: match[1] });
    else if (match[2]) tokens.push({ kind: 'code', text: match[2] });
    else if (match[3]) tokens.push({ kind: 'strong', children: noteInline(match[3]) });
    else if (match[4]) tokens.push({ kind: 'em', children: noteInline(match[4]) });
    else {
      const raw = match[6] ?? match[7].replace(/[.,;:!]+$/, '');
      const href = safeNoteUrl(raw);
      tokens.push(href ? { kind: 'link', text: match[5] ?? raw, href } : { kind: 'text', text: match[5] ?? match[0] });
      if (match[7] && raw.length < match[7].length) tokens.push({ kind: 'text', text: match[7].slice(raw.length) });
    }
    start = at + match[0].length;
  }
  if (start < text.length) tokens.push({ kind: 'text', text: text.slice(start) });
  return tokens;
}

export function noteBlocks(markdown: string): NoteBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: NoteBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, content: noteInline(heading[2]) });
      i++;
      continue;
    }
    const list = /^[-*+]\s+(.+)$|^\d+[.)]\s+(.+)$/.exec(line);
    if (list) {
      const ordered = !!list[2];
      const items: NoteInline[][] = [];
      const itemPattern = ordered ? /^\d+[.)]\s+(.+)$/ : /^[-*+]\s+(.+)$/;
      while (i < lines.length) {
        const item = itemPattern.exec(lines[i]);
        if (!item) break;
        let content = item[1];
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) content += ` ${lines[i++].trim()}`;
        items.push(noteInline(content));
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    const paragraph = [line];
    i++;
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|[-*+]\s|\d+[.)]\s)/.test(lines[i])) paragraph.push(lines[i++]);
    blocks.push({ kind: 'paragraph', content: noteInline(paragraph.join(' ')) });
  }
  return blocks;
}

function inlineNodes(tokens: NoteInline[]): Child[] {
  return tokens.map((token) => {
    switch (token.kind) {
      case 'text': return token.text;
      case 'code': return h('code', null, token.text);
      case 'strong': return h('strong', null, inlineNodes(token.children));
      case 'em': return h('em', null, inlineNodes(token.children));
      case 'link': return h('a', { href: token.href, target: '_blank', rel: 'noopener noreferrer' }, token.text);
    }
  });
}

export function renderNotes(markdown: string): HTMLElement {
  const blocks = noteBlocks(markdown);
  return h('div', { class: 'notes' }, blocks.length ? blocks.map((block) => {
    switch (block.kind) {
      case 'heading': return h(`h${Math.min(6, block.level + 1)}` as 'h2', null, inlineNodes(block.content));
      case 'paragraph': return h('p', null, inlineNodes(block.content));
      case 'list': return h(block.ordered ? 'ol' : 'ul', null, block.items.map((item) => h('li', null, inlineNodes(item))));
      case 'code': return h('pre', null, h('code', null, block.text));
    }
  }) : h('p', null, 'This pack has no reconstruction notes. Its sources are listed below.'));
}
