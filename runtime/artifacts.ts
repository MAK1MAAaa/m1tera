import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import { countEstimatedTokens } from './context.js';

export const ARTIFACT_BYTE_LIMIT = 8 * 1024 * 1024;
export const DEFAULT_TEXT_PAGE_LIMIT = 4096;
export const MAX_TEXT_PAGE_LIMIT = 16384;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const PREVIEW_TOKEN_LIMIT = 1000;

export interface ArtifactMetadata {
  id: string;
  bytes: number;
  sha256: string;
  totalCharacters: number;
}

export interface TextPage {
  text: string;
  offset: number;
  nextOffset: number | null;
  totalCharacters: number;
}

function identifier(value: string, label: string) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${label}必须是有效的 UUID`);
  return value.toLowerCase();
}

export function validateTextPage(offset = 0, limit = DEFAULT_TEXT_PAGE_LIMIT) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('offset 须为非负整数，单位为 Unicode 字符');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_TEXT_PAGE_LIMIT) throw new Error(`limit 须为 1 到 ${MAX_TEXT_PAGE_LIMIT} 之间的整数`);
  return { offset, limit };
}

/** Offsets count Unicode code points, so a page never splits an emoji's surrogate pair. */
export function sliceTextPage(text: string, offset = 0, limit = DEFAULT_TEXT_PAGE_LIMIT): TextPage {
  validateTextPage(offset, limit);
  let totalCharacters = 0;
  const selected: string[] = [];
  for (const character of text) {
    if (totalCharacters >= offset && totalCharacters < offset + limit) selected.push(character);
    totalCharacters++;
  }
  if (offset > totalCharacters) throw new Error('offset 超出文本长度');
  const end = offset + selected.length;
  return { text: selected.join(''), offset, nextOffset: end < totalCharacters ? end : null, totalCharacters };
}

async function safeDirectory(directory: string) {
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(directory) !== directory) throw new Error('外置结果目录不能是符号链接或其他文件');
  return metadata;
}

/** Private application storage; opaque references are scoped to one session, never workspace paths. */
export class ArtifactStore {
  private root?: string;
  private readonly contentIndex = new Map<string, Promise<ArtifactMetadata>>();
  constructor(readonly directory: string) {}

  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const directory = await realpath(this.directory);
    const root = path.join(directory, 'artifacts');
    await mkdir(root, { recursive: true, mode: 0o700 });
    await safeDirectory(root);
    this.root = root;
  }

  private async sessionDirectory(sessionId: string, create = false) {
    const id = identifier(sessionId, '会话标识');
    if (!this.root) throw new Error('外置结果存储尚未初始化');
    await safeDirectory(this.root);
    const directory = path.join(this.root, id);
    if (create) {
      try { await mkdir(directory, { mode: 0o700 }); }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error; }
    }
    const metadata = await safeDirectory(directory);
    return { directory, metadata };
  }

  async put(sessionId: string, contentText: string): Promise<ArtifactMetadata> {
    const session = identifier(sessionId, '会话标识');
    if (typeof contentText !== 'string') throw new Error('外置结果必须是文本');
    // Node replaces lone surrogate halves while encoding UTF-8; refuse silent content loss.
    for (let index = 0; index < contentText.length; index++) {
      const point = contentText.charCodeAt(index);
      if (point >= 0xd800 && point <= 0xdbff) {
        const next = contentText.charCodeAt(++index);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error('外置结果包含无效的 Unicode 字符');
      } else if (point >= 0xdc00 && point <= 0xdfff) throw new Error('外置结果包含无效的 Unicode 字符');
    }
    const bytes = Buffer.byteLength(contentText, 'utf8');
    if (bytes > ARTIFACT_BYTE_LIMIT) throw new Error('单个外置结果不能超过 8 MiB');
    const sha256 = createHash('sha256').update(contentText, 'utf8').digest('hex');
    const key = `${session}\0${sha256}`;
    const existing = this.contentIndex.get(key);
    if (existing) {
      const saved = await existing;
      const { directory } = await this.sessionDirectory(session);
      try {
        const current = await lstat(path.join(directory, `${saved.id}.txt`));
        if (!current.isFile() || current.isSymbolicLink() || current.size !== saved.bytes) throw new Error('外置结果已改变或成为符号链接');
        return { ...saved };
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
        this.contentIndex.delete(key);
      }
    }
    const operation = this.writeArtifact(session, contentText, bytes, sha256);
    this.contentIndex.set(key, operation);
    try { return { ...await operation }; }
    catch (error) { if (this.contentIndex.get(key) === operation) this.contentIndex.delete(key); throw error; }
  }

  private async writeArtifact(sessionId: string, contentText: string, bytes: number, sha256: string): Promise<ArtifactMetadata> {
    const { directory, metadata } = await this.sessionDirectory(sessionId, true);
    const id = randomUUID();
    const target = path.join(directory, `${id}.txt`);
    const temporary = path.join(directory, `.${id}.tmp`);
    try {
      const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      try { await file.writeFile(contentText, 'utf8'); await file.sync(); }
      finally { await file.close(); }
      const current = (await this.sessionDirectory(sessionId)).metadata;
      if (current.dev !== metadata.dev || current.ino !== metadata.ino) throw new Error('外置结果目录在写入时改变');
      await rename(temporary, target);
      await this.sessionDirectory(sessionId);
      const totalCharacters = sliceTextPage(contentText, 0, 1).totalCharacters;
      return { id, bytes, sha256, totalCharacters };
    } finally { await unlink(temporary).catch(() => {}); }
  }

  async read(sessionId: string, id: string, offset = 0, limit = DEFAULT_TEXT_PAGE_LIMIT): Promise<TextPage> {
    identifier(sessionId, '会话标识');
    const artifactId = identifier(id, '外置结果标识');
    validateTextPage(offset, limit);
    const { directory, metadata: directoryMetadata } = await this.sessionDirectory(sessionId);
    const target = path.join(directory, `${artifactId}.txt`);
    const metadata = await lstat(target);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('外置结果不能是符号链接或其他文件');
    const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await file.stat();
      if (!opened.isFile() || opened.size > ARTIFACT_BYTE_LIMIT) throw new Error('外置结果不是普通文本文件或超过 8 MiB');
      if (opened.dev !== metadata.dev || opened.ino !== metadata.ino) throw new Error('外置结果在读取前改变');
      const buffer = Buffer.alloc(opened.size + 1);
      let bytes = 0;
      while (bytes < buffer.length) {
        const part = await file.read(buffer, bytes, buffer.length - bytes, bytes);
        if (!part.bytesRead) break;
        bytes += part.bytesRead;
      }
      if (bytes !== opened.size) throw new Error('外置结果在读取时改变');
      const currentDirectory = (await this.sessionDirectory(sessionId)).metadata;
      const current = await lstat(target);
      if (currentDirectory.dev !== directoryMetadata.dev || currentDirectory.ino !== directoryMetadata.ino || !current.isFile() || current.isSymbolicLink() || current.dev !== opened.dev || current.ino !== opened.ino || current.size !== opened.size || current.mtimeMs !== opened.mtimeMs) throw new Error('外置结果在读取时改变');
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, bytes)); }
      catch { throw new Error('外置结果不是有效的 UTF-8 文本'); }
      return sliceTextPage(text, offset, limit);
    } finally { await file.close(); }
  }
}

export function createReadArtifactTool(store: ArtifactStore, sessionId: string, allowedIds: ReadonlySet<string> = new Set()): AgentTool {
  identifier(sessionId, '会话标识');
  return {
    name: 'read_artifact', label: '读取外置结果',
    description: '按需分页读取本会话已披露的外置工具结果。offset 从 0 起，按 Unicode 字符计数；默认 4096 字符，每页最多 16384 字符。仅接受已披露的 ID，不能读取文件路径。',
    parameters: Type.Object({ id: Type.String({ pattern: UUID.source }), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TEXT_PAGE_LIMIT })) }, { additionalProperties: false }),
    replay: 'safe',
    execute: async (_id, raw, signal) => {
      if (signal?.aborted) throw new Error('操作已取消');
      const args = raw as { id: string; offset?: number; limit?: number };
      const id = identifier(args.id, '外置结果标识');
      if (!allowedIds.has(id)) throw new Error('此外置结果未授权给本次运行');
      const page = await store.read(sessionId, id, args.offset, args.limit);
      if (signal?.aborted) throw new Error('操作已取消');
      return { content: [{ type: 'text', text: page.text + (page.nextOffset !== null ? `\n[还有内容：使用 read_artifact(id=${JSON.stringify(id)}, offset=${page.nextOffset}) 继续读取]` : '') }], details: { id, offset: page.offset, nextOffset: page.nextOffset, totalCharacters: page.totalCharacters } };
    },
  };
}

export interface OffloadOptions { isError?: boolean; redact?: (text: string) => string }
export interface OffloadResult { result: AgentToolResult<unknown>; offloaded: boolean; artifact?: ArtifactMetadata; warning?: string }

function preview(text: string, metadata: ArtifactMetadata) {
  const head = [...text.slice(0, 1600)].slice(0, 400);
  const tail = [...text.slice(-1600)].slice(-400);
  const render = (size: number) => `工具结果已外置：${metadata.id}（${metadata.bytes} 字节，${metadata.totalCharacters} 个 Unicode 字符）。需要细节时使用 read_artifact(id=${JSON.stringify(metadata.id)}, offset=0)，按需分页读取。\n以下仅为首尾预览：\n${head.slice(0, size).join('')}\n[中间内容已省略]\n${size ? tail.slice(-size).join('') : ''}`;
  let size = Math.min(400, Math.floor(metadata.totalCharacters / 2));
  let textPreview = render(size);
  while (countEstimatedTokens(textPreview) > PREVIEW_TOKEN_LIMIT && size > 0) {
    size = Math.floor(size / 2);
    textPreview = render(size);
  }
  return textPreview;
}

/** Store before replacing the result; errors and paged reads retain their original semantics. */
export async function offloadToolResult(store: ArtifactStore, sessionId: string, toolName: string, result: AgentToolResult<unknown>, thresholdTokens: number, options: OffloadOptions = {}): Promise<OffloadResult> {
  if (!Number.isSafeInteger(thresholdTokens) || thresholdTokens < 1) throw new Error('外置阈值须为正整数 token 数');
  if (options.isError || result.isError || ['read_file', 'read_artifact', 'use_skill'].includes(toolName) || result.content.some((part) => part.type !== 'text')) return { result, offloaded: false };
  const text = result.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n');
  if (!text || countEstimatedTokens(text) <= thresholdTokens) return { result, offloaded: false };
  try {
    const safeText = options.redact ? options.redact(text) : text;
    const artifact = await store.put(sessionId, safeText);
    const details = result.details && typeof result.details === 'object' && !Array.isArray(result.details) ? result.details : {};
    return { result: { ...result, content: [{ type: 'text', text: preview(safeText, artifact) }], details: { ...details, artifact } }, artifact, offloaded: true };
  } catch { return { result, offloaded: false, warning: '工具结果外置未完成，保留原始结果。' }; }
}
