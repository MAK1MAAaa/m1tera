# Harness 评测

当前集成七套可选评测：两个历史单轮集合、Letta Context-Bench 的 Filesystem cloud，以及 LongHarness 四套长上下文任务。它们分别观察工具调用、知识回答、文件检索和上下文策略，不合成为“Agent 总分”，不申报官方排行榜。真实评测复用聊天的 Pi harness factory；fixture 只用于流程验证，能力指标始终为 null。

## 数据、默认题量与评分

| Suite ID | 衡量能力 | 默认 / 可选范围 | 采样与评分 | 许可 / 数据引入 |
| --- | --- | --- | --- | --- |
| `bfcl-v4` | 工具选择及参数 | 20 / 1–20 | 两类前缀均匀取样；单轮 AST 移植，官方 Python 可复核 | Apache-2.0；固定 20 题随应用携带 |
| `simpleqa` | 无浏览事实问答 | 20 / 1–20 | 官方 seed=0 固定 20 题抽样的前缀；另次同模型 A/B/C grader | MIT；固定 20 题与官方模板随应用携带 |
| `letta-context` | 十文件、多跳关联检索 | 3 / 1–100 | `cb-cloud-0...` 固定前缀，每题完整十文件；官方 0 / 0.5 / 1 rubric | Apache-2.0；题目和语料外置下载，rubric 与许可保留 |
| `longharness-constraint` | 完整条件匹配集合 | 2 / 1–50 | 官方 0 号起固定前缀；完整人名 ID 集合 exact | 未声明；原始数据外置下载，不分发 |
| `longharness-memos` | 跨备忘录矛盾 | 2 / 1–50 | 同上；完整 memo ID 集合 exact，拒绝重复 | 同上 |
| `longharness-tracing` | 八步程序结果及证据 | 2 / 1–50 | 同上；最终 JSON 和证据同时 exact，另报 answer-only | 同上 |
| `longharness-pairs` | 程序的语义配对 | 2 / 1–50 | 同上；规范化无序整数对后完整集合 exact | 同上 |

BFCL 原子集是 `simple_python_0..9` 和 `multiple_0..9`。测试函数仅记录调用，不访问宿主、网络或真实 API。SimpleQA 使用官方 Python `random.Random(0).sample(examples,20)` 固定原题；减少题数取该抽样前缀，不是重新随机抽样。[固定版本与源文件 SHA](sources.json)

### Letta Context-Bench

来源为 Deep Agents 固定提交 `a96a3b63b206feef23af9237a1a64a93d1f52aef` 中保留许可的 Letta `filesystem_cloud`：100 题、完整十文件。每题都提供 people、pets、vehicles、bank accounts、credit cards、employments、addresses、insurance、internet、medical 原始语料，不按题目提示预选文件；`required_files`、`verification_query` 和标准答案不进入作答工具或 prompt。[固定源码](https://github.com/langchain-ai/deepagents/tree/a96a3b63b206feef23af9237a1a64a93d1f52aef/libs/evals/harbor_adapters/contextbench/vendor)

模型完成任务后另发一次 grader 请求，使用官方 rubric 并要求有限 JSON reward：正确为 1，错误或失败尝试为 0，明确拒绝且未尝试为 0.5。`meanReward` 是已判分题目的奖励均值，`accuracy` 是 reward=1 的比例；0.5 不算完整正确。当前答题与 judge 使用同一已选模型，单次 rollout；不等同于官方不同 judge、三次 rollout 的 mean / avg@3，也不等同于 Letta Filesystem v2 榜单。评分输出非法或请求失败为未知。

### LongHarness

完整 200 题来自 HF revision `95c54a1646cc486f6702308a1e820cb361960fd4`，每套 50 题；根 manifest SHA-256 为 `28b7f2418982db028427f35fd79a119acf83b4a7c254b2ee69c9162e0c01df9a`。先校验 manifest 与官方 checksum 清单，再校验每份 context 的大小、路径、内容 SHA 和 gold SHA。缓存按内容摘要命名，拒绝符号链接、污染和超限；下载或校验失败不会改用 fixture。[固定公共数据](https://huggingface.co/datasets/StringNLP/longharness/tree/95c54a1646cc486f6702308a1e820cb361960fd4)

模型只获得选中实例的原文 `context.md` 及其任务指令。标准答案、带答案路径的 manifest、其他实例和官方 scorer 均不可读。数据卡和 GitHub 未声明明确再分发许可证，因此题目、答案和官方评分源码只用于外置下载评测，不加入仓库或安装包。

程序追踪的 context 本身只要求程序输出，任务级 README 另要求 JSON 对象类型的 `answer` 与八个支持 cell ID 的 `evidence`；适配器独立表述这一公开要求，并外置校验原任务说明 SHA。新报告记录 `longharness-task-contract-v3` 与每题基础任务指令的 `promptSha256`，该摘要不包括运行 wrapper、语料和工具 schema。缺少字段或对象类型说明的追踪报告保留为调试记录，不计能力成绩。真实缓存核对证明其他三类任务的原、新 prompt 字节相同。[协议核验](../docs/benchmarks/longharness-protocol-v3-check.json)

本地评分器独立实现固定 `score_one` 规则，非模型 judge。接受完整 JSON、单个完整 JSON 围栏、memo 原指令中的 `Final Answer: [M-…]`；不猜取解释文本中的答案，不执行上下文代码，不做数值或 ID 语义转换。程序追踪同时要求最终结果和无重复证据集合，结果正确而证据错误只计辅助 answer-only。原版 Python scorer 下载到临时目录后先核验 SHA，再对照 60 个合成正反例，exact / answer-only / evidence **60/60 一致**；这不是模型成绩。[接入核验](../docs/benchmarks/adapter-options-2026-10-13.md)

BFCL 的字符串归一、可选参数、字典允许值、函数名 `.` 到 `_` 转换均按官方评分规则实现。JavaScript JSON 解析不保留 Python `int` 与 `float` 的数值字面量差别，因此这份移植不作为官方 BFCL 分数。`official-bfcl-ast-checker.py` 是该提交的未改动官方源码；60 份正确/缺必需参数/额外参数的预期结果由这份 Python 代码生成，作为本地移植的行为对照。Python-only 依赖 shim 只提供官方 enum、OpenAI 函数名转换标记和未使用的 Java/JavaScript 导入，不替换评分函数。

保存的真实 BFCL 预测可另用这份 SHA 锁定的官方 Python scorer 核验；这一操作不调用模型，也不覆盖原始报告：

```sh
python3 benchmarks/check-bfcl-oracle.py --report docs/benchmarks/bfcl-v4-gpt-6.1-sol-live.json --output docs/benchmarks/bfcl-v4-official-check.json
```

核验输出 `mode: official-scorer-on-live-predictions`，逐题保留官方实际判定、错误和本地移植判定是否一致。仅接受同一固定数据 revision/hash 下的真实 BFCL 报告；未知或未完成预测仍为未知，不补成错题。它核验的是保存后的规范化 calls，未保留原始 API wire JSON 的数值字面量，也不是完整官方排行榜提交。无参数运行仍是 60 份离线 fixture 对照，`model_score: null`。

## 运行与上下文轨

桌面评测入口使用当前启用模型与后端内存凭据。兼容接口可从独立 CLI 进程运行；ChatGPT 订阅账户通过桌面应用的独立授权运行，不把令牌复制到其他 Agent 产品或 CLI。

```sh
npm run benchmark -- --probe
npm run benchmark -- --suite bfcl-v4 --limit 20
npm run benchmark -- --suite letta-context --limit 3
npm run benchmark -- --suite longharness-tracing --limit 2 --profile agent
npm run benchmark -- --suite longharness-tracing --limit 2 --profile direct
npm run benchmark -- --suite all
```

省略 `--limit` 时按各套默认题数运行；`all` 默认七套、51 题，包含多轮请求和独立 grader 调用。显式 limit 会应用到所有选中集合，必须符合各套范围。`--profile direct` 仅适用于 LongHarness；在 `all` 中只改变 LongHarness，其余集合仍用原轨。`--output` 指定报告目录，默认 `docs/benchmarks/`。

| 轨道 | 可见上下文与工具 | 运行预算 |
| --- | --- | --- |
| BFCL / SimpleQA | 首个模型响应；原题 schema 或 0 工具；无浏览 | 每次最多 1 次模型请求；单请求最多 120 秒 |
| Letta / LongHarness Agent | 原题 prompt，加虚拟题目文件；初始目录/分页读取/字面搜索，外置后本题 `read_artifact` | 默认 24 次模型请求、300 秒；可调整至上限 24 轮 / 600 秒 |
| LongHarness Direct | 完整选中 context 一次放入 prompt，0 工具 | 1 次模型请求；单请求最多 120 秒 |

文件工具只访问本题闭包内的完整语料，不能访问宿主路径、网络或命令。读取按 Unicode 字符分页，默认 4096、最多 16384 字符；搜索为大小写敏感的字面量，默认 10、最多 20 个命中。每题空系统提示词、新历史，不加载用户会话、Skills、记忆或项目指令。

文件类评测的作答累计 token 预算为 300,000 输入加输出（Letta 评分另计），在完整模型响应边界检查；单次请求可能越界，usage 缺失时不能证明预算遵从。作答达轮数、时限或 token 边界计失败；评分请求达边界计未知并保留原因；模型或评分请求异常计未知。报告记录实际 profile、工具集、low/off 推理、轮数、时限与 token 预算。Direct 和 Agent 只有在同模型、同题目、同采样、同推理设置下才是可解释的本地策略对照；论文更高预算和脚本工具轨另列为外部参考。

CLI 只读取本进程的 `M1TERA_BENCHMARK_API_KEY` 或 `OPENAI_API_KEY`。接口和模型可由 `M1TERA_BENCHMARK_BASE_URL`、`M1TERA_BENCHMARK_MODEL` 或 `--base-url`、`--model` 指定；协议为 `--api-format responses|chat-completions`。不要把密钥放入命令参数或聊天。远程接口无凭据时 `--probe` 为 blocked、分数 null，退出码 2；本地端点可只完成配置预检，不证明实际模型连通。预检不下载数据或调用模型。

首次运行 Letta / LongHarness 需要联网下载固定公共数据。桌面缓存位于应用数据目录的 `benchmark-cache/`，不进入普通聊天上下文；缓存命中也验证 SHA。独立 CLI 使用临时隔离数据目录，结束后清理，因此新 CLI 进程可能再次下载。各题上下文与答案的隔离在运行时执行，不依赖 GUI 权限。

## 指标与未知值

报告记录服务商累计 input、output、cache read/write，实际模型请求数与工具调用数；本地 token 估算单独列出。任意执行缺 usage 时总 usage 保持未知，同时保留已有 usage 小计，不用零填补。

计划题数、已处理数、已判分数与未知数分别列出，准确率及 Letta mean reward 的分母为已判分题目。取消、请求或评分异常为未知，不补成正确、错误或弃答；SimpleQA 官方 C 才算 NOT_ATTEMPTED。达确定的运行边界计失败。`mode: fixture` 不发布能力准确率或奖励成绩。

v0.5 实际结果：BFCL 18/20、90%；SimpleQA 16/20、80%，均未知 0。保存后的 BFCL 预测经官方 Python scorer 逐题复核一致。报告和失败分析保持为历史结果，不随新增集合修改。[v0.5 评测](../docs/benchmarks/evaluation-v5.md)

## 外部比较与后续集合

[公开产品与 Harness 比较](../docs/benchmarks/comparison-2026-10-13.md) 分开列出 TB 4.0 当前官方登记、LongHarness 同模型论文实验，以及本项目结果。Deep Agents avg@3、Hermes mean reward、Letta v2 和本文 Filesystem cloud 有不同数据及分母，不直接并榜。

- [Terminal-Bench 4.0](https://www.tbench.ai/run)：当前产品比较使用这一版本。需要 Harbor、独立 GPU/容器环境、任务 verifier 与 66×5 trials；本项目尚未完成这一集合。Docker daemon 可用不等于任务环境与评测完成，宿主命令不能替代隔离。
- [τ³-bench](https://github.com/sierra-research/tau2-bench)：真实用户模拟器、领域工具、多轮策略与环境结果；不把固定对话或单轮问答改名为 τ³。
- [EuniAI ContextBench](https://github.com/EuniAI/ContextBench)：代码任务的文件、符号、跨度检索 precision / recall / efficiency；与这里 Letta Filesystem cloud 不同。
- [GAIA](https://huggingface.co/datasets/gaia-benchmark/GAIA)：需按官方数据授权处理 gated 数据、附件与联网，不把镜像当已授权原题。

待接入或外部登记不是本项目已经获得的成绩。
