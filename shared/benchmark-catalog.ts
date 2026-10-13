/** Browser-safe metadata; benchmark implementations and datasets stay in the sidecar. */
export const BENCHMARK_SUITES = [
  { id: 'bfcl-v4', name: 'BFCL v4 工具调用', total: 20, defaultLimit: 20, description: '10 道 simple_python + 10 道 multiple 原题；本地 AST 规则移植。' },
  { id: 'simpleqa', name: 'SimpleQA 事实问答', total: 20, defaultLimit: 20, description: '官方 seed=0 的 20 道原题，无浏览；同模型另次 A/B/C 评分。' },
  { id: 'letta-context', name: 'Letta Context-Bench 文件检索', total: 100, defaultLimit: 3, description: 'Filesystem cloud 原题与完整十文件；多轮只读检索，同模型 rubric 评分，包含部分奖励。' },
  { id: 'longharness-constraint', name: 'LongHarness 条件搜索', total: 50, defaultLimit: 2, description: '长文档中找出全部满足条件的人；精确集合评分。' },
  { id: 'longharness-memos', name: 'LongHarness 冲突备忘录', total: 50, defaultLimit: 2, description: '跨备忘录识别矛盾；精确 ID 集合评分。' },
  { id: 'longharness-tracing', name: 'LongHarness 程序追踪', total: 50, defaultLimit: 2, description: '追踪计算结果并引用证据；结果与证据同时精确匹配。' },
  { id: 'longharness-pairs', name: 'LongHarness 等价程序', total: 50, defaultLimit: 2, description: '识别所有等价程序对；精确无序集合评分。' },
] as const;

export type BenchmarkSuiteId = typeof BENCHMARK_SUITES[number]['id'];
export type BenchmarkProfile = 'agent' | 'direct';
export const benchmarkSuite = (id: string) => BENCHMARK_SUITES.find((suite) => suite.id === id);
