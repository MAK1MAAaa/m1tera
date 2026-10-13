import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import type { ToolName } from '../shared/protocol.js';
import { MAX_TEXT_PAGE_LIMIT, sliceTextPage, validateTextPage } from './artifacts.js';

const FILE_LIMIT = 8 * 1024 * 1024;
const OUTPUT_LIMIT = 64 * 1024;
const WRITE_LIMIT = 1024 * 1024;

export interface ToolEnvironment {
  workspace: string;
  approve: (toolName: ToolName, args: Record<string, unknown>, description: string, signal?: AbortSignal) => Promise<boolean>;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error('操作已取消');
}

function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

/** Resolve the real directory as well as the lexical path: a symlink must not escape the workspace. */
export async function resolveWorkspacePath(workspace: string, input: string, forWrite = false): Promise<string> {
  if (!workspace) throw new Error('请先为会话选择工作区');
  const root = await realpath(workspace);
  if (!(await stat(root)).isDirectory()) throw new Error('工作区不是目录');
  const candidate = path.resolve(root, input);
  if (!isInside(root, candidate)) throw new Error('路径超出工作区');
  if (!forWrite) {
    const actual = await realpath(candidate);
    if (!isInside(root, actual)) throw new Error('符号链接指向工作区外');
    return actual;
  }
  const parent = await realpath(path.dirname(candidate));
  if (!isInside(root, parent)) throw new Error('父目录指向工作区外');
  const actual = path.join(parent, path.basename(candidate));
  try {
    const entry = await lstat(actual);
    if (entry.isSymbolicLink()) throw new Error('写入目标不能是符号链接');
    if (!entry.isFile()) throw new Error('写入目标不是普通文件');
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  return actual;
}

function result(text: string) {
  return { content: [{ type: 'text' as const, text }], details: {} };
}

async function readText(workspace: string, filename: string, offset?: number, limit?: number, signal?: AbortSignal) {
  throwIfAborted(signal);
  validateTextPage(offset, limit);
  const target = await resolveWorkspacePath(workspace, filename);
  const file = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await file.stat();
    if (!opened.isFile()) throw new Error('只能读取普通文件');
    if (opened.size > FILE_LIMIT) throw new Error('分页读取的文件不能超过 8 MiB');
    const buffer = Buffer.alloc(opened.size + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      throwIfAborted(signal);
      const part = await file.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (!part.bytesRead) break;
      bytesRead += part.bytesRead;
    }
    throwIfAborted(signal);
    if (bytesRead !== opened.size) throw new Error('文件在读取时改变，请重新读取');
    if (buffer.subarray(0, bytesRead).includes(0)) throw new Error('文件包含二进制内容');
    let text: string;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, bytesRead)); }
    catch { throw new Error('文件不是有效的 UTF-8 文本'); }
    const currentPath = await resolveWorkspacePath(workspace, filename);
    const current = await lstat(currentPath);
    if (currentPath !== target || !current.isFile() || current.dev !== opened.dev || current.ino !== opened.ino || current.size !== opened.size || current.mtimeMs !== opened.mtimeMs) throw new Error('文件在读取时改变，请重新读取');
    return sliceTextPage(text, offset, limit);
  } finally {
    await file.close();
  }
}

async function writeText(workspace: string, filename: string, content: string, signal?: AbortSignal) {
  throwIfAborted(signal);
  if (Buffer.byteLength(content) > WRITE_LIMIT) throw new Error('单次写入最多 1 MiB');
  const target = await resolveWorkspacePath(workspace, filename, true);
  const temporary = path.join(path.dirname(target), `.m1tera-${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      await file.writeFile(content, 'utf8');
      await file.sync();
    } finally {
      await file.close();
    }
    throwIfAborted(signal);
    // Recheck after approval and writing, so replacement cannot follow a newly introduced symlink.
    await resolveWorkspacePath(workspace, filename, true);
    await rename(temporary, target);
    return `已写入 ${filename}（${Buffer.byteLength(content)} 字节）`;
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

/** Approved shell commands are unrestricted OS processes; cwd is not an OS sandbox. */
export async function executeCommand(workspace: string, command: string, timeoutSeconds: number, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const cwd = await resolveWorkspacePath(workspace, '.');
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    let stopped = '';
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (reason: string) => {
      if (stopped) return;
      stopped = reason;
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill('SIGKILL'));
      } else {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
        forceTimer = setTimeout(() => {
          try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* The process group already exited. */ }
        }, 300);
        forceTimer.unref();
      }
    };
    const abort = () => stop('操作已取消');
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timeout = setTimeout(() => stop(`命令超时（${timeoutSeconds} 秒）`), timeoutSeconds * 1000);
    timeout.unref();
    const collect = (chunk: Buffer) => {
      const room = OUTPUT_LIMIT - bytes;
      if (room > 0) {
        const kept = chunk.subarray(0, room);
        chunks.push(kept);
        bytes += kept.length;
      }
      if (chunk.length > room) truncated = true;
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    };
    child.on('error', (error) => { cleanup(); reject(error); });
    child.on('close', (code) => {
      cleanup();
      // Keep the short forced group kill timer after cancellation: grandchildren can survive the shell.
      if (!stopped && forceTimer) clearTimeout(forceTimer);
      const output = Buffer.concat(chunks).toString('utf8') + (truncated ? '\n[输出已截断：最多 64 KiB]' : '');
      if (stopped) reject(new Error(`${stopped}${output ? `\n${output}` : ''}`));
      else if (code !== 0) reject(new Error(`命令退出码 ${code ?? '未知'}${output ? `\n${output}` : ''}`));
      else resolve(output || '命令执行成功，无输出');
    });
  });
}

export function createTools(names: readonly ToolName[], environment: ToolEnvironment): AgentTool[] {
  const definitions: Record<ToolName, AgentTool> = {
    list_directory: {
      name: 'list_directory', label: '列出目录', description: '列出工作区内目录的直接子项。',
      parameters: Type.Object({ path: Type.String({ description: '相对于工作区的目录路径；根目录使用 .' }) }, { additionalProperties: false }),
      replay: 'safe',
      execute: async (_id, raw, signal) => {
        const args = raw as { path: string };
        throwIfAborted(signal);
        const target = await resolveWorkspacePath(environment.workspace, args.path);
        const entries = await readdir(target, { withFileTypes: true });
        const lines = entries.slice(0, 1000).map((entry) => `${entry.isDirectory() ? '目录' : entry.isSymbolicLink() ? '链接' : '文件'}\t${entry.name}`);
        let text = lines.join('\n') || '空目录';
        if (entries.length > 1000) text += '\n[已截断：最多 1000 项]';
        if (Buffer.byteLength(text) > OUTPUT_LIMIT) text = Buffer.from(text).subarray(0, OUTPUT_LIMIT).toString('utf8') + '\n[输出已截断]';
        throwIfAborted(signal);
        return result(text);
      },
    },
    read_file: {
      name: 'read_file', label: '读取文件', description: '分页读取工作区内 UTF-8 文本文件，文件最多 8 MiB。offset 从 0 起，按 Unicode 字符计数；默认读取 4096 字符，每页最多 16384 字符。',
      parameters: Type.Object({ path: Type.String(), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TEXT_PAGE_LIMIT })) }, { additionalProperties: false }),
      replay: 'safe',
      execute: async (_id, raw, signal) => {
        const args = raw as { path: string; offset?: number; limit?: number };
        const page = await readText(environment.workspace, args.path, args.offset, args.limit, signal);
        const text = page.text + (page.nextOffset !== null ? `\n[还有内容：使用 read_file(path=${JSON.stringify(args.path)}, offset=${page.nextOffset}) 继续读取]` : '');
        return { content: [{ type: 'text', text }], details: { path: args.path, offset: page.offset, nextOffset: page.nextOffset, totalCharacters: page.totalCharacters } };
      },
    },
    write_file: {
      name: 'write_file', label: '写入文件', description: '经用户批准后创建或覆盖工作区内文本文件。父目录必须已存在。',
      parameters: Type.Object({ path: Type.String(), content: Type.String() }, { additionalProperties: false }),
      replay: 'never',
      execute: async (_id, raw, signal) => {
        const args = raw as { path: string; content: string };
        if (Buffer.byteLength(args.content) > WRITE_LIMIT) throw new Error('单次写入最多 1 MiB');
        await resolveWorkspacePath(environment.workspace, args.path, true);
        if (!await environment.approve('write_file', args, `创建或覆盖 ${args.path}（${Buffer.byteLength(args.content)} 字节）`, signal)) throw new Error('用户拒绝了写入文件');
        return result(await writeText(environment.workspace, args.path, args.content, signal));
      },
    },
    run_command: {
      name: 'run_command', label: '执行命令', description: '经用户批准后在工作区目录执行 shell 命令。命令可访问操作系统和工作区外文件；工作目录不是安全沙箱。',
      parameters: Type.Object({ command: Type.String(), timeoutSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })) }, { additionalProperties: false }),
      replay: 'never',
      execute: async (_id, raw, signal) => {
        const args = raw as { command: string; timeoutSeconds?: number };
        await resolveWorkspacePath(environment.workspace, '.');
        if (!await environment.approve('run_command', args, `执行命令：${args.command}\n此命令可访问工作区外文件和操作系统。`, signal)) throw new Error('用户拒绝了执行命令');
        return result(await executeCommand(environment.workspace, args.command, args.timeoutSeconds ?? 120, signal));
      },
    },
  };
  return [...new Set(names)].map((name) => definitions[name]);
}
