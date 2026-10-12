import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RuntimeService } from './service.js';
import type { RuntimeRequest } from '../shared/protocol.js';

export { RuntimeService } from './service.js';

export async function startJsonlRuntime(dataDir: string, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout) {
  const write = (value: unknown) => { output.write(`${JSON.stringify(value)}\n`); };
  const service = new RuntimeService({ dataDir, emit: (event) => write({ kind: 'event', event }) });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const requests = new Set<Promise<void>>();
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = () => {
    shutdownPromise ??= Promise.resolve().then(async () => {
      lines.close();
      const closing = service.shutdown();
      await Promise.all([...requests]);
      await closing;
    });
    return shutdownPromise;
  };
  lines.on('line', (line) => {
    if (!line.trim()) return;
    if (Buffer.byteLength(line) > 2 * 1024 * 1024) {
      write({ kind: 'response', id: '', error: { code: 'INVALID_REQUEST', message: '请求最多 2 MiB' } });
      return;
    }
    let request: RuntimeRequest;
    try { request = JSON.parse(line) as RuntimeRequest; }
    catch { write({ kind: 'response', id: '', error: { code: 'INVALID_JSON', message: '请求不是有效 JSON' } }); return; }
    // No serial await here: approvals and cancellation must pass a running prompt.
    const pending = service.handle(request).then(write).then(() => {}).finally(() => requests.delete(pending));
    requests.add(pending);
  });
  lines.on('close', () => { void shutdown(); });
  return { service, shutdown };
}

const invokedFile = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedFile === fileURLToPath(import.meta.url)) {
  const flag = process.argv.indexOf('--data-dir');
  const dataDir = flag >= 0 ? process.argv[flag + 1] : undefined;
  if (!dataDir) {
    process.stderr.write('用法：node runtime/index.js --data-dir <应用数据目录>\n');
    process.exitCode = 1;
  } else {
    const runtime = await startJsonlRuntime(path.resolve(dataDir));
    const exit = () => { void runtime.shutdown().then(() => { process.exitCode = 0; }); };
    process.once('SIGTERM', exit);
    process.once('SIGINT', exit);
  }
}
