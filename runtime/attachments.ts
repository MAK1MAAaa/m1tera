import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { resolveWorkspacePath } from './tools.js';

export interface WorkspaceFile { path: string; size: number }
export interface FileAttachment extends WorkspaceFile { content: string }

const FILE_LIMIT = 128 * 1024;
const TOTAL_LIMIT = 512 * 1024;
const SKIPPED_DIRECTORIES = new Set(['.git', '.toolchains', 'node_modules', 'target', 'dist', 'dist-runtime', '.cache', '.next', '.venv', 'venv', '__pycache__', 'build', 'coverage', 'playwright-report', 'test-results']);

function checkCancelled(signal?: AbortSignal) { if (signal?.aborted) throw new Error('操作已取消'); }
function inside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}
function relativePath(root: string, filename: string) { return path.relative(root, filename).split(path.sep).join('/'); }
function validatePath(filename: string) {
  if (typeof filename !== 'string' || !filename || filename.length > 4096 || filename.includes('\0') || path.isAbsolute(filename)) throw new Error('附件必须使用工作区内的相对路径');
}

/** A bounded, demand-driven picker. Directory and link metadata never become model context. */
export async function listWorkspaceFiles(workspace: string, query = '', signal?: AbortSignal): Promise<WorkspaceFile[]> {
  checkCancelled(signal);
  if (typeof query !== 'string' || query.length > 500) throw new Error('文件搜索词过长');
  const root = await resolveWorkspacePath(workspace, '.');
  if (!(await stat(root)).isDirectory()) throw new Error('工作区不是目录');
  const needle = query.toLocaleLowerCase();
  const directories = [root];
  const results: WorkspaceFile[] = [];
  let directoryCount = 0;
  let fileCount = 0;
  while (directories.length && directoryCount < 2000 && fileCount < 10000 && results.length < 100) {
    checkCancelled(signal);
    const directory = directories.shift()!;
    directoryCount++;
    // Recheck queued directories: a directory may have become a symlink after discovery.
    const actual = await realpath(directory).catch(() => undefined);
    if (!actual || !inside(root, actual) || (await lstat(directory).catch(() => undefined))?.isSymbolicLink()) continue;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      checkCancelled(signal);
      if (fileCount >= 10000 || results.length >= 100) break;
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && directories.length + directoryCount < 2000) directories.push(filename);
        continue;
      }
      // Do not follow links in the picker, including directory links/cycles.
      if (!entry.isFile()) continue;
      fileCount++;
      const label = relativePath(root, filename);
      if (!label.toLocaleLowerCase().includes(needle)) continue;
      const metadata = await lstat(filename).catch(() => undefined);
      if (!metadata?.isFile() || metadata.size > FILE_LIMIT) continue;
      const resolved = await realpath(filename).catch(() => undefined);
      if (!resolved || !inside(root, resolved)) continue;
      results.push({ path: label, size: metadata.size });
    }
  }
  checkCancelled(signal);
  return results;
}

/** Explicit attachments are checked at open time and read without truncation. */
export async function readAttachments(workspace: string, paths: readonly string[], signal?: AbortSignal): Promise<FileAttachment[]> {
  checkCancelled(signal);
  if (!Array.isArray(paths) || paths.length > 8) throw new Error('每条消息最多附加 8 个文件');
  if (!paths.length) return [];
  const root = await resolveWorkspacePath(workspace, '.');
  const attachments: FileAttachment[] = [];
  const seen = new Set<string>();
  let totalSize = 0;
  for (const filename of paths) {
    checkCancelled(signal);
    validatePath(filename);
    const target = await resolveWorkspacePath(root, filename);
    if (seen.has(target)) continue;
    if (!(await lstat(target)).isFile()) throw new Error('附件只能是普通文件');
    const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await file.stat();
      if (!opened.isFile()) throw new Error('附件只能是普通文件');
      if (opened.size > FILE_LIMIT) throw new Error('单个附件不能超过 128 KiB');
      // Compare the opened inode with the current pathname, catching common parent/link swaps.
      const current = await realpath(path.resolve(root, filename));
      if (!inside(root, current) || await realpath(root) !== root) throw new Error('附件路径已改变或超出工作区');
      const currentMetadata = await lstat(current);
      if (!currentMetadata.isFile() || currentMetadata.dev !== opened.dev || currentMetadata.ino !== opened.ino) throw new Error('附件在读取前已改变，请重新选择');
      const buffer = Buffer.alloc(FILE_LIMIT + 1);
      let bytesRead = 0;
      while (bytesRead < buffer.length) {
        checkCancelled(signal);
        const read = await file.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
        if (!read.bytesRead) break;
        bytesRead += read.bytesRead;
      }
      checkCancelled(signal);
      if (bytesRead > FILE_LIMIT) throw new Error('单个附件不能超过 128 KiB');
      totalSize += bytesRead;
      if (totalSize > TOTAL_LIMIT) throw new Error('附件总大小不能超过 512 KiB');
      const bytes = buffer.subarray(0, bytesRead);
      if (bytes.includes(0)) throw new Error('附件必须是 UTF-8 文本，不能附加二进制文件');
      let content: string;
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
      catch { throw new Error('附件不是有效的 UTF-8 文本'); }
      for (const character of content) {
        const point = character.codePointAt(0)!;
        if (point < 32 && ![9, 10, 13].includes(point)) throw new Error('附件包含二进制控制字符');
      }
      // No contents leave this function if the pathname escapes during the read.
      const after = await realpath(path.resolve(root, filename));
      const afterMetadata = await lstat(after);
      if (!inside(root, after) || afterMetadata.dev !== opened.dev || afterMetadata.ino !== opened.ino) throw new Error('附件在读取时已改变，请重新选择');
      seen.add(target);
      attachments.push({ path: relativePath(root, path.resolve(root, filename)), content, size: bytesRead });
    } finally { await file.close(); }
  }
  return attachments;
}
