import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { sliceTextPage } from './artifacts.js';

export interface CorpusFile { path: string; text: string }

/** Only task documents are exposed. Gold data and the host filesystem never enter these tools. */
export function createCorpusTools(files: readonly CorpusFile[]): AgentTool[] {
  const corpus = new Map<string, string>();
  for (const file of files) {
    if (!file.path || file.path.includes('..') || file.path.startsWith('/') || /[\\\0]/.test(file.path) || corpus.has(file.path)) throw new Error('评测文档路径无效');
    corpus.set(file.path, file.text);
  }
  const get = (path: string) => {
    const text = corpus.get(path);
    if (text === undefined) throw new Error('该文件不属于本题文档');
    return text;
  };
  const respond = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }], details: {} });
  return [
    {
      name: 'list_directory', label: '列出题目文件', description: '列出本题可读取的文件；只允许本题虚拟目录，不访问宿主机。',
      parameters: Type.Object({}, { additionalProperties: false }), replay: 'safe',
      execute: async (_id, _args, signal) => {
        signal?.throwIfAborted();
        return respond([...corpus].map(([path, text]) => ({ path, characters: Array.from(text).length })));
      },
    },
    {
      name: 'read_file', label: '读取题目文档', description: '分页读取本题文档。offset 从 0 起，按 Unicode 字符计数；默认4096，每页最多16384字符。',
      parameters: Type.Object({ path: Type.String(), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 16384 })) }, { additionalProperties: false }), replay: 'safe',
      execute: async (_id, raw, signal) => {
        signal?.throwIfAborted();
        const args = raw as { path: string; offset?: number; limit?: number };
        return respond({ path: args.path, ...sliceTextPage(get(args.path), args.offset, args.limit) });
      },
    },
    {
      name: 'search_file', label: '搜索题目文档', description: '在一个题目文件中进行大小写敏感的字面量搜索，返回命中附近的原文、Unicode offset 和 nextOffset。limit默认10、最多20；不会执行正则或命令。',
      parameters: Type.Object({ path: Type.String(), query: Type.String({ minLength: 1, maxLength: 512 }), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })) }, { additionalProperties: false }), replay: 'safe',
      execute: async (_id, raw, signal) => {
        signal?.throwIfAborted();
        const args = raw as { path: string; query: string; offset?: number; limit?: number };
        const chars = Array.from(get(args.path));
        const start = args.offset ?? 0;
        const limit = args.limit ?? 10;
        if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 20 || typeof args.query !== 'string' || !args.query.length || args.query.length > 512) throw new Error('搜索参数无效');
        const segment = chars.slice(start).join('');
        const hits: { offset: number; text: string }[] = [];
        let cursor = 0;
        let nextOffset: number | null = null;
        while (hits.length < limit) {
          const match = segment.indexOf(args.query, cursor);
          if (match < 0) break;
          const offset = start + Array.from(segment.slice(0, match)).length;
          hits.push({ offset, text: chars.slice(Math.max(0, offset - 160), offset + Array.from(args.query).length + 240).join('') });
          cursor = match + args.query.length;
          nextOffset = start + Array.from(segment.slice(0, cursor)).length;
        }
        if (segment.indexOf(args.query, cursor) < 0) nextOffset = null;
        return respond({ path: args.path, query: args.query, matches: hits, nextOffset });
      },
    },
  ];
}
