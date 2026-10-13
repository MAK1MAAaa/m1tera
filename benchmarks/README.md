# Harness 评测

首版集成两套公开数据的固定小规模原题评测。它们用于分开观察工具调用准确性和事实问答结果，不等同于完整、多轮 Agent 能力，也不申报官方排行榜。

| 评测 | 固定子集 | 运行和评分 |
| --- | --- | --- |
| BFCL v4 | `simple_python_0..9` 与 `multiple_0..9`，20 题 | 同一 Harness 的首个模型响应；工具只有原题 schema，函数不会访问系统。TypeScript 移植官方 Python 单调用 AST 规则；本地移植成绩。 |
| SimpleQA | 官方 Python `random.Random(0).sample(examples,20)` 的 20 题 | 每题空历史、空系统提示词、无工具、无浏览。完成回答后另一次独立请求使用完整官方 A/B/C grader。当前答题与评分模型相同，存在自评偏差。 |

题目、schema、原答案均来自官方来源，未替换问题或改题。`data.ts` 只改变本地存储结构；标准答案不会发送给答题 Agent，只用于本地 AST 评分或单独的 SimpleQA 评分请求。每题使用新上下文，不加载项目指令、技能、记忆或先前评测答案。低于 20 题时，BFCL 均匀取两类前缀，SimpleQA 取已固定抽样的前缀；这些更小的跑次不等同于官方对相应题数重新随机抽样。

版本、完整源文件 SHA256、固定子集 SHA256 和题目 ID 见 [sources.json](sources.json)。BFCL 来源固定 `6ea57973c7a6097fd7c5915698c54c17c5b1b6c8`，Apache-2.0；SimpleQA 源码固定 `652c89d0ca9df547706735883097e9537d40dc47`，MIT。官方 CSV 以下载 SHA256 固定，因为下载 URL 本身没有 revision。完整许可证保存在 `licenses/`，并随编译后的数据模块携带。

BFCL 的字符串归一、可选参数、字典允许值、函数名 `.` 到 `_` 转换均按官方评分规则实现。JavaScript JSON 解析不保留 Python `int` 与 `float` 的数值字面量差别，因此这份移植不作为官方 BFCL 分数。`official-bfcl-ast-checker.py` 是该提交的未改动官方源码；60 份正确/缺必需参数/额外参数的预期结果由这份 Python 代码生成，作为本地移植的行为对照。Python-only 依赖 shim 只提供官方 enum、OpenAI 函数名转换标记和未使用的 Java/JavaScript 导入，不替换评分函数。

保存的真实 BFCL 预测可另用这份 SHA 锁定的官方 Python scorer 核验；这一操作不调用模型，也不覆盖原始报告：

```sh
python3 benchmarks/check-bfcl-oracle.py --report docs/benchmarks/bfcl-v4-gpt-6.1-sol-live.json --output docs/benchmarks/bfcl-v4-official-check.json
```

核验输出 `mode: official-scorer-on-live-predictions`，逐题保留官方实际判定、错误和本地移植判定是否一致。仅接受同一固定数据 revision/hash 下的真实 BFCL 报告；未知或未完成预测仍为未知，不补成错题。它核验的是保存后的规范化 calls，未保留原始 API wire JSON 的数值字面量，也不是完整官方排行榜提交。无参数运行仍是 60 份离线 fixture 对照，`model_score: null`。

## 运行

桌面应用的评测入口复用当前已启用模型和后端内存凭据。兼容接口也可在独立 CLI 进程中运行：

```sh
node --import tsx scripts/benchmark.ts --probe
node --import tsx scripts/benchmark.ts --suite all --limit 20
```

CLI 只读取本进程 `M1TERA_BENCHMARK_API_KEY` 或 `OPENAI_API_KEY`。接口和模型可通过 `M1TERA_BENCHMARK_BASE_URL`、`M1TERA_BENCHMARK_MODEL` 或 `--base-url`、`--model` 指定；协议通过 `--api-format responses|chat-completions` 指定。不要把 API key 放入命令参数或聊天。CLI 不读取已有 Codex 认证或桌面应用私有凭据。无凭据时 `--probe` 明确报告 blocked、成绩未知，并以退出码 2 结束。`--output` 指定结果目录，默认 `docs/benchmarks/`。ChatGPT 订阅账户通过桌面应用自己的授权后运行。

SimpleQA 20 题包含 20 次答题和 20 次评分请求；BFCL 20 题包含 20 次答题请求。报告记录实际 usage（含缓存输入）与分开的 token 估算。任意请求缺 usage 时总 usage 记未知，并另外保留已有 usage 的小计；不得用零填补未知。评分请求失败、输出不是严格 A/B/C、取消或无法调用模型时对应成绩未知，不能作为错题或正确题。报告同时列出计划题数、已处理题数、已评分题数和未知数；准确率分母为已评分题数。`mode: fixture` 的测试回调永远不输出能力准确率。

## 暂未采用的常见评测

- [GAIA](https://huggingface.co/datasets/gaia-benchmark/GAIA)：官方数据已 gated，并禁止向可抓取仓库重新发布验证/测试集；需要 HF 数据授权、附件处理和有效联网能力。不能绕过 gate 或把第三方镜像当官方数据。
- [Terminal-Bench 2.1](https://github.com/harbor-framework/terminal-bench-2-1)：适合后续端到端终端任务，需 Harbor 和隔离容器。本机 Docker CLI 存在，Docker daemon 尚未运行；没有在宿主机直接运行外部任务来替代其隔离环境。
- [τ³-bench](https://github.com/sierra-research/tau2-bench)：需要领域工具和独立用户模拟模型，衡量多轮策略和最终环境状态。原 τ-bench 官方仓库已声明其题目过时，首版没有沿用过时任务。
- [AgentBench FC](https://github.com/THUDM/AgentBench)：多容器、任务服务和额外数据部署成本较高，后续可用它的 OS/数据库任务补充系统操作评测。

这些评测的待接入状态不能当作已运行或已经获得的能力分数。
