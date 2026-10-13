import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RuntimeService } from '../runtime/service.js';
import { BENCHMARK_SUITES } from '../runtime/benchmarks.js';
import type { BenchmarkReport, BenchmarkSuiteId } from '../runtime/benchmarks.js';
import { DEFAULT_SETTINGS } from '../shared/protocol.js';
import type { RuntimeRequest, Settings } from '../shared/protocol.js';

const args = process.argv.slice(2);
function option(name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error('命令参数缺少值。');
  return value;
}

async function main() {
  const allowed = new Set(['--suite', '--limit', '--base-url', '--model', '--api-format', '--output', '--probe', '--help']);
  for (const arg of args) if (arg.startsWith('--') && !allowed.has(arg)) throw new Error('未知命令参数。');
  if (args.includes('--help')) {
    console.log('用法：node --import tsx scripts/benchmark.ts --suite bfcl-v4|simpleqa|all --limit 20 [--probe] [--output docs/benchmarks]');
    console.log('凭据仅从本次进程 M1TERA_BENCHMARK_API_KEY 或 OPENAI_API_KEY 读取，不读取桌面应用或 Codex 凭据。');
    console.log('ChatGPT 订阅账户请在桌面应用中授权后启动评测；本 CLI 使用 OpenAI 兼容接口。');
    return;
  }
  const requested = option('--suite') ?? 'all';
  if (!['bfcl-v4', 'simpleqa', 'all'].includes(requested)) throw new Error('未知评测集。');
  const suites: BenchmarkSuiteId[] = requested === 'all' ? ['bfcl-v4', 'simpleqa'] : [requested as BenchmarkSuiteId];
  const limit = Number(option('--limit') ?? 20);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('评测题数必须为 1 至 20 的整数。');
  const baseUrl = option('--base-url') ?? process.env.M1TERA_BENCHMARK_BASE_URL ?? 'https://api.openai.com/v1';
  const endpoint = new URL(baseUrl);
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('接口 URL 仅支持不含凭据或查询参数的 HTTP(S) 地址。');
  const model = option('--model') ?? process.env.M1TERA_BENCHMARK_MODEL ?? 'gpt-6.1-sol';
  const apiFormat = option('--api-format') ?? 'responses';
  if (!['responses', 'chat-completions'].includes(apiFormat)) throw new Error('API 格式必须为 responses 或 chat-completions。');
  const apiKey = process.env.M1TERA_BENCHMARK_API_KEY || process.env.OPENAI_API_KEY;
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  const ready = Boolean(apiKey) || local;
  const preflight = { mode: 'preflight', status: ready ? 'configured' : 'blocked', credentialsAvailable: Boolean(apiKey), localEndpoint: local,
    suites: BENCHMARK_SUITES.filter((suite) => suites.includes(suite.id)).map((suite) => ({ id: suite.id, selectedTasks: limit })),
    scores: null, reason: ready ? '接口配置存在；尚未验证连通性或调用模型。' : '本进程没有可用接口凭据。请从桌面应用的当前登录账户启动评测，或在此进程配置 API key。真实成绩未知。' };
  if (args.includes('--probe') || !ready) {
    console.log(JSON.stringify(preflight, null, 2));
    if (!ready) process.exitCode = 2;
    return;
  }
  if (apiKey && (apiKey.length > 4096 || /[\r\n\0]/.test(apiKey))) throw new Error('接口凭据格式无效。');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'm1tera-benchmark-'));
  const service = new RuntimeService({ dataDir: directory, emit: () => {} });
  const request = async (method: string, params: unknown = {}) => {
    const response = await service.handle({ id: crypto.randomUUID(), method, params } as RuntimeRequest);
    if (response.error) throw new Error(`运行时拒绝评测请求（${response.error.code}）。`);
    return response.result;
  };
  const cancel = () => { void request('benchmark.cancel').catch(() => undefined); };
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const settings: Settings = { ...DEFAULT_SETTINGS, connection: 'compatible', apiFormat: apiFormat as Settings['apiFormat'], baseUrl, model, systemPrompt: '' };
    await request('settings.set', { settings, ...(apiKey ? { apiKey } : {}) });
    const output = path.resolve(option('--output') ?? 'docs/benchmarks');
    await mkdir(output, { recursive: true });
    for (const suite of suites) {
      const started = await request('benchmark.start', { suite, limit }) as { runId: string };
      await (service as RuntimeService & { waitForBenchmark(): Promise<void> }).waitForBenchmark();
      const report = await request('benchmark.report', { runId: started.runId }) as BenchmarkReport;
      const destination = path.join(output, `${suite}-${Date.now()}.json`);
      await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`);
      console.log(JSON.stringify({ suite, mode: report.mode, status: report.status, completed: report.completed, total: report.total,
        graded: report.metrics.graded, unknown: report.metrics.unknown, accuracy: report.metrics.accuracy, denominator: report.metrics.denominator, report: destination }));
      if (report.status === 'cancelled' || report.metrics.unknown > 0) { process.exitCode = 2; break; }
    }
  } finally {
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
    await service.shutdown();
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch(() => {
  // Provider/runtime exceptions can contain credentials. The diagnostic is deliberately fixed.
  console.error('评测未完成：配置、运行时或模型请求失败。未获得可核验的真实成绩。');
  process.exitCode = 1;
});
