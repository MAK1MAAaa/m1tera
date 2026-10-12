import { mkdir, writeFile } from 'node:fs/promises';
import { DEFAULT_SETTINGS } from '../shared/protocol.js';
import { runBaseline } from '../runtime/baseline.js';

const report = await runBaseline({ settings: DEFAULT_SETTINGS });
await mkdir('docs', { recursive: true });
await writeFile('docs/context-baseline.json', JSON.stringify(report, null, 2) + '\n');
const lines = [
  '# 首轮上下文基线', '',
  '状态：本报告仅做本地估算，不调用真实模型；实际 usage 为未知。已完成的桌面实测另见 [ChatGPT 基线报告](context-baseline-live.md)。', '',
  `目标模型：${report.model}；固定用户消息：${report.prompt}`, '',
  '| 工具定义数 | 系统提示词估算 | 工具估算 | 消息估算 | 合计估算 | 实际输入 usage |',
  '| ---: | ---: | ---: | ---: | ---: | --- |',
  ...report.cases.map(({ toolCount, estimate }) => `| ${toolCount} | ${estimate.system} | ${estimate.tools} | ${estimate.history} | ${estimate.total} | 未测量 |`), '',
  '使用 o200k_base 对文本和序列化结构进行估算，含保守消息封装开销；不能视为服务商实际 tokenizer 或分项 usage。20 个工具是基础工具同结构的合成规模测试，不执行工具。', '',
  '在桌面应用连接 ChatGPT 后，点击“测量首轮基线”可对同一模型发送 0/4/20 工具定义的三次独立请求。真实输入计入缓存读写；缺失或全零 usage 标记未知。未设置硬 token 上限。', '',
];
await writeFile('docs/context-baseline.md', lines.join('\n'));
console.log(lines.join('\n'));
