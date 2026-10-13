# m1tera

可自定义的个人 Agent 桌面应用。使用 Tauri 2、React、Node.js sidecar 和 Pi core。默认模型为 `gpt-6.1-sol`，新会话不启用工具、不自动加载项目指令、记忆或技能。轻量化目标是控制模型上下文：提示词、工具 schema 和历史显式可控，不以削减桌面功能或安装包体积为目标。

## 使用桌面应用

打开 macOS 构建产物 `src-tauri/target/release/bundle/macos/m1tera.app`。“设置”始终显示官方 **ChatGPT 账号 → Continue with ChatGPT** 入口，于系统浏览器完成授权后可拉取当前账号的模型目录。应用使用独立的官方 OAuth 授权，不读取或复制 Codex/ChatGPT 的既有凭据；使用自定义接口也不会隐藏官方登录入口。

授权能否使用模型取决于账户资格与服务端权限；应用不会自动切换到其他模型。凭据仅保存在后端内存中，退出后需要重新登录。持久化的安装 host ID 不包含账户或 token。

也支持多个自定义 OpenAI 兼容接口，各自配置名称、base URL、API key 和 Responses 或 Chat Completions 格式。API key 按服务商隔离，仅保存在本次运行的后端内存中。

侧栏可添加本地工作区，按工作区和分类管理会话。会话支持置顶、改名、归类和移动工作区；手动名称不会被后续消息覆盖。工作区仅保存目录引用，不自动读取目录内容或项目指令。新增组织元数据保存在本地，不进入模型上下文。

输入框底部只显示已勾选启用且未标记不可用的模型。同名模型按服务商区分；登录、目录发现和勾选启用是三个独立操作，发现新模型不会自动启用。运行时也拒绝向未启用或已不可用的模型发送请求。

每个会话可启用四项工具，并选择“逐次审批”或“自动审批”，默认逐次审批。读文件和列目录检查真实路径；逐次模式下写文件和命令每次需要批准，自动模式则批准当前会话已启用工具的操作，并展示执行状态。自动审批不启用额外工具，也不绕过文件路径检查。命令以当前用户权限运行，工作目录不是操作系统沙箱。

## 模型配置

v0.4 的官方模型发现使用当前账号的 OAuth Bearer 凭据请求 `GET https://api.openai.com/v1/models`，解析 `models[]` 中的 `slug`、`display_name` 和 `visibility`，只展示 `visibility = list` 的候选并保留服务端顺序。不回退展示整个 Pi 静态目录；未登录或发现失败时，仅保留显式的 `gpt-6.1-sol` 默认项或同账号最近的缓存，将其标为“未验证”并显示警告。目录结果不代表推理请求已通过真实账号验收。协议依据见 [官方模型与推理文档](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)。

自定义接口从其 `/models` 解析 `data[].id`，读取显示名称、上下文容量及 `lifecycle`、`deprecated`、`shutdown_date` 等明确元数据，不用 `created` 日期猜测是否退役。已停用、已弃用或明确计划停用的模型不能启用；未来停用日期显示“计划停用”，不描述为已经下架。[OpenAI 弃用说明](https://developers.openai.com/api/docs/deprecations) 区分弃用公告与实际停用日期。

每个自定义接口可拉取目录，也可手动添加模型 ID、可选显示名称和上下文上限。手动模型支持网关未列出的 ID，但始终明确标为“未验证”；容量未知时留空，不猜测。手动添加不能绕过目录明确的停用状态。最多配置 **12 个自定义接口**，每个接口最多保存 **256 个模型配置**；合法目录条目不按数量截断，单次目录响应限制为 **1 MiB**。多个接口的组织方式参考 [OpenCode providers](https://opencode.ai/docs/providers/)。

| 状态或操作 | 行为 |
| --- | --- |
| 新发现模型 | 默认不勾选；用户启用并保存后才进入输入框。 |
| 刷新失败 | 保留已知名称和容量，将原可用状态降为“未验证”并警告；不把已有明确不可用状态恢复为可用。 |
| 新成功目录缺少旧目录模型 | 将之前由接口发现的模型标为不可用；手动项继续保留用户显式配置意图和未验证状态。 |
| 停用、移除当前模型或删除当前接口 | 保留当前选择为待重选状态；发送前须显式选择其他已启用模型，不自动切换。 |

持久保存的是服务商名称、base URL、API 格式，以及模型 ID、来源、启用状态和用户手工指定的名称/上下文上限。实时目录名称、容量和可用性仅在内存中保留；退出后需要重新登录或配置 key，再拉取目录。不把自动取得的目录元数据写成手动覆盖值，避免以后刷新时仍使用旧容量。上下文上限缓存按服务商隔离，同名模型不会串用容量。旧版单接口设置迁移为 `custom-default`，保留原模型和配置意图。服务商配置与目录元数据不进入模型上下文。

密钥按服务商保存在内存：输入框留空保留该接口现有密钥，勾选“清除本接口的现有密钥”才显式清除。修改 base URL 或删除接口会清除对应密钥，不自动将原密钥带到新地址；同一 URL 下切换 API 格式保留密钥。新接口保存前的发现候选通过仅在内存中的 URL 和密钥 SHA256 指纹匹配；匹配后归入该接口的本次运行目录，避免保存配置后丢失已发现结果。目录候选、指纹和原密钥均不写入磁盘，也不跨重启保留。

v0.5 已通过独立官方 OAuth 授权验收：真实账号目录返回 7 个可见模型，`gpt-6.1-sol` 的可信上下文上限为 500,000 tokens，并完成下述真实评测；其他发现项保持未启用。验证不读取既有凭据。当前检查范围见 [0.6.0 验证记录](docs/validation-v6.md)，[0.5.0](docs/validation-v5.md) 与 [0.4.0](docs/validation-v4.md) 保留为历史结果。

## Harness 运行与上下文

v0.5 借鉴 Deep Agents 的可取回结果外置和 Pi durable 的检查点边界，继续使用 Pi core / ai 1.1.0，不引入新的 agent 框架依赖。调研来源与采用范围见 [Harness 调研](docs/harness-research-v5.md)。

设置中的“运行与上下文”支持工具结果外置、单个结果的 token 估算阈值、模型请求轮数和运行时间。默认阈值为 4096，最多 24 轮、300 秒；达到运行边界会暂停，用户可以检查后继续。这些是运行策略，不是模型容量或硬上下文裁剪。

较大的命令、目录或搜索结果保留到应用数据目录的会话 artifact，模型获得短预览和引用。出现引用且会话已具有工具能力时，才加入 `read_artifact`；它按 Unicode 字符分页，默认 4096、最多 16384 字符。新的纯聊天仍为 0 工具。错误、`read_file` 分页和 Skill 指令不二次外置，存储失败保留原始结果。已完成的旧大调用参数使用精简投影；原始参数和工具原文仍可审查，配对不被删除。

`read_file` 现在支持 `offset` / `limit`，可分页读取最多 8 MiB 文本文件；短文件返回保持一致。显式 `@` 附件仍完整读取，单文件上限保持 128 KiB。长文本 token 本地估算进行分块，超过 64 KiB 使用 UTF-8 字节上界，避免 tokenizer 在长无空白 Unicode 上卡住；数值与服务商 usage 分开显示。

确认接收输入、公布完整消息、执行工具及公布结果前保存相应检查点，审批等待与批准/拒绝也先保存再生效；transcript 与运行状态写入同一原子会话快照。流式 `text.delta` 用于即时显示，不逐条持久化，崩溃后未提交的文本增量可能丢失。同一会话最近 64 个请求标识可防重复接收；标识相同而任务输入或非密钥配置改变时会报冲突。中断后旧审批失效，结果未知的工具不自动重放；“继续任务”重新发起模型请求，写入与命令恢复为逐次审批。保存失败会停止后续操作，已经发生而未保存的外部效果仍为未知，不声称任意命令 exactly-once。凭据依然只在内存。

## Benchmark 与产品比较

顶栏“评测”复用当前已启用模型的连接与聊天 Harness。每题使用独立空历史，不加载用户项目指令、技能或记忆；标准答案只供本地评分或另一次 grader 请求。v0.6 在 BFCL / SimpleQA 之外新增 **Letta Context-Bench 与 LongHarness 四套长上下文任务**，同时记录实际输入、输出、缓存、请求数、工具调用数与运行边界。

### 本项目实测与已接入集合

| 评测 | 衡量能力 | 默认题数 / 数据总数 | 评分与许可 | 本项目状态 |
| --- | --- | --- | --- | --- |
| BFCL v4 | 工具选择与参数准确性 | 20 / 固定 20 题子集 | 本地 AST 移植、官方 Python 复核；Apache-2.0 | **v0.5：18/20，90%** |
| SimpleQA | 无浏览事实问答 | 20 / 固定 20 题子集 | 官方 A/B/C、同模型另次评分；MIT | **v0.5：16/20，80%** |
| Letta Context-Bench · Filesystem cloud | 十文件检索与多跳关联 | 3 / 100 | 官方 0 / 0.5 / 1 rubric，同模型评分；Apache-2.0 | **v0.6：3/3；mean reward 100%、全正确 100%** |
| LongHarness · 条件搜索 | 分散资料中的完整条件匹配集合 | 2 / 50 | 确定性 exact；数据许可未声明，外置下载 | Agent：0/1 已判分、未知 1；Direct：2/2、100%（均为两题小样本） |
| LongHarness · 冲突备忘录 | 跨备忘录矛盾识别 | 2 / 50 | 完整 ID 集合 exact；同上 | Agent 0/2（预算失败）；Direct 0/2；未知均为 0 |
| LongHarness · 程序追踪 | 八步依赖计算与证据检索 | 2 / 50 | 最终结果与证据同时 exact，另报 answer-only；同上 | Agent：0/1 已判分、未知 1；Direct：2/2、100%（均为两题小样本） |
| LongHarness · 等价程序 | 200 段程序的完整等价配对 | 2 / 50 | 无序配对集合 exact；同上 | Agent、Direct 均 0/1 已判分、未知 1；均为两题小样本 |

v0.5 的两套成绩来自官方 ChatGPT 连接的 `gpt-6.1-sol`，未知均为 0。SimpleQA 另有 3 题错误、1 题未作答，并有同模型评分偏差；BFCL 实际预测与官方 Python scorer 逐题一致。共 60 次真实请求、32,080 输入 tokens，包含缓存和评分请求。[原始结果与失败分析](docs/benchmarks/evaluation-v5.md)

新增集合采用固定前缀抽样，每题一次尝试。**Agent 检索轨**初始提供本题虚拟文件的 `list_directory`、分页 `read_file` 和字面量 `search_file`，结果外置后另提供只读取本题 artifact 的 `read_artifact`，实际工具集写入报告；不执行上下文程序，也不访问宿主文件或网络。默认最多 24 次模型请求、300 秒；作答累计 300,000 输入加输出 tokens 在完整响应后检查，Letta 评分请求另计，单次请求可能越界，usage 缺失时无法证明预算遵从。**LongHarness Direct 轨**一次读取完整原文、0 工具、1 次模型请求，用于同模型同题目的上下文策略对照；单请求时限最多 120 秒。每份报告保留实际配置；用户可调整策略，Agent 上限为 24 轮 / 600 秒，Direct 上限 1 轮 / 120 秒。作答达到运行边界计失败，评分边界或请求异常计未知。

Letta 报告同时显示 mean reward 与 reward=1 的完整正确率，二者不能混用；0.5 仅对应原版 rubric 的明确拒绝。这里的 Filesystem cloud 与 Letta **Filesystem v2**、EuniAI 的代码检索 **ContextBench** 是不同数据集。首次运行从固定官方 revision 下载完整题目语料并校验 SHA，下载失败不会用模拟数据生成成绩。LongHarness 缺少明确再分发许可，题目与官方 scorer 不放入仓库或安装包。[运行、数据与评分协议](benchmarks/README.md)

新增集合的原始报告、预算失败、请求异常及追踪任务协议修复均保留在 [v0.6 实测报告](docs/benchmarks/evaluation-v6.md)。当前是小样本观察；分段读取在已完成任务中增加了重复输入，不能由短首轮提示词推断总成本更低。

```sh
npm run benchmark -- --probe
npm run benchmark -- --suite letta-context --limit 3
npm run benchmark -- --suite longharness-tracing --limit 2 --profile agent
npm run benchmark -- --suite longharness-tracing --limit 2 --profile direct
npm run benchmark -- --suite all
python3 benchmarks/check-bfcl-oracle.py
```

CLI 省略 `--limit` 时采用表中各集合默认值；`all` 运行七套，共 51 题，包含额外评分与多轮请求。`--profile direct` 仅改变 LongHarness，其他集合保留原轨。CLI 只读取本进程的 `M1TERA_BENCHMARK_API_KEY` / `OPENAI_API_KEY`，远程接口没有凭据时预检为 blocked、成绩为 null；本地端点只完成配置预检，不证明真实模型连通；ChatGPT 订阅账号从桌面授权后运行，不迁移凭据给其他产品。

### 公开产品成绩：Terminal-Bench 4.0

以下是 **2026-10-13 抓取的官方榜单登记快照**，不是本项目重新运行其他产品的结果。每个配置为 66 题 × 5 次，共 330 trials；指标是 trial resolution rate，± 为官方报告的 95% 置信区间半宽。[官方榜单](https://www.tbench.ai/leaderboard)

| 产品 / Harness | 模型 | 推理档位 | TB 4.0 成绩 | 登记日期（UTC） |
| --- | --- | --- | ---: | --- |
| Claude Code | Opus 5.5 | max | 64.85% ± 3.11 | 2026-10-06 |
| Claude Code | Sonnet 5.5 | max | 61.82% ± 2.94 | 2026-10-06 |
| Codex | GPT-6 Astra | max | 58.18% ± 2.79 | 2026-09-03 |
| Codex | GPT-6.1 Sol | max | 58.18% ± 3.11 | 2026-10-06 |
| Grok Build | Grok 4.7 | xhigh | 37.58% ± 3.54 | 2026-09-21 |
| mini-SWE-agent | Gemini 3.8 Flash | high | 19.09% ± 3.36 | 2026-09-03 |
| Muse Code | Muse Spark 1.3 | xhigh | 14.55% ± 2.94 | 2026-10-06 |
| m1tera | GPT-6.1 Sol | — | **未评测 TB 4.0** | — |

模型、推理档位和产品配置不同，差值不能全部归因于 Harness。榜单未公开逐行产品版本、实际运行日期和 sandbox；登记日期也不是模型发布日期。TB 4.0 需要完整隔离环境与 GPU 任务，不能将本项目 BFCL / SimpleQA 小样本分数放进这张表排名，也不合并 TB 2.x / 3.x / 4.0 成绩。[快照、原始记录与条件](docs/benchmarks/product-comparison-sources-2026-10-13.md)

### 同模型 Harness 参考：LongHarness 发布实验

LongHarness 论文使用 **GPT-5.6-sol、high 推理、四套各 50 题、每实例 3M 累计 tokens**，对比不同上下文处理方式。以下成本是论文按当时 API 价格估算的每实例美元成本。[论文 Table 2](https://arxiv.org/html/2609.38137)

| Harness | 四套 exact 宏平均 | 论文估算 USD / 实例 |
| --- | ---: | ---: |
| Direct | 60.0% | $0.822 |
| RLM | 53.5% | $4.30 |
| OpenCode | 40.5% | $2.90 |
| mini-swe-agent | 68.0% | $0.816 |
| ReAct | 43.0% | $1.93 |

这些是发布方实验，工具能力也各不相同。本项目使用 `gpt-6.1-sol`、low 推理、小样本、只读检索和更低预算，故单列本项目结果，不插入同条件排名；论文美元成本不是 ChatGPT 订阅花费。[逐任务比较与适用边界](docs/benchmarks/comparison-2026-10-13.md)

Deep Agents 新版发布同时评估自主任务、多轮对话和上下文检索，促成本次新增 Letta；但其 avg@3、pass@3，以及 Hermes mean reward 都有独立分母和部分奖励规则，不能改写成单次完整成功率。[发布评测调研](docs/benchmarks/harness-launches-2026-10-13.md)

本地固定日志样本的上下文估算减少 80.05%，属于独立的管线验证，不能据此宣称优于任何外部产品。[本地报告](docs/benchmarks/harness-local.md)

## 输入、文件与 Skills

v0.3 的输入框支持 `/` 快捷命令、`@` 工作区文件和 `$` Skills。选择结果显示为可移除的标签；候选列表支持方向键、Enter 选择与 Escape 关闭。

| 命令 | 行为 |
| --- | --- |
| `/plan` | 本轮只制定计划；仅保留已启用的读文件、列目录工具，不提供写文件或终端命令。 |
| `/websearch` | 本轮必须实际搜索网页并引用来源。ChatGPT 和 OpenAI 官方 Responses 连接使用原生 web search，其余兼容接口使用网页搜索工具；搜索失败或未发生可核验检索时明确报错。 |
| `/new` | 新建会话。 |
| `/clear` | 清空当前草稿及已选命令、文件和 Skills。 |
| `/skills` | 打开 Skills 管理。 |

输入 `@` 后，在当前工作区中查找并选择文件。发送时读取已选文件正文，作为本轮请求的数据加入上下文；选择工作区不会自动加载项目文件、`AGENTS.md`、指令或记忆。

输入 `$` 后，选择已启用的 Skill，仅所选指令按需加入本轮上下文。Skills 管理支持创建、编辑、导入 `SKILL.md`、启用和停用；自定义 Skill 可删除，内置 Skill 只允许启用或停用，指令只读。导入仅读取用户选定的 `SKILL.md`，不会自动发现项目中的技能。

会话的“自动匹配”默认关闭。启用后，请求包含已启用 Skills 的简短目录与 `use_skill` 工具，模型根据任务调用工具后才加载相应指令；不会预先注入整个技能库。自动加载的完整指令仅保留在本轮工具链中，下次请求会把旧 `use_skill` 结果压成短标记，避免关闭自动匹配或停用技能后仍通过历史重新注入完整指令。手动选择和自动匹配均不授予额外的文件、命令或网络权限。

当前 `/websearch` 的协议与 citations 流程已通过 fixture 验证；DuckDuckGo 客户端搜索已使用应用相同的系统代理配置实测，返回 6 条公开结果。真实 ChatGPT 账号的原生搜索仍未验证，fixture 不代表账户具有对应权限。

整个窗口固定在可视区域；侧栏会话列表、聊天记录、设置和上下文抽屉独立滚动。聊天自动定位只修改聊天区域的滚动位置。Markdown 代码块和表格支持内部横向滚动。

## 开发与构建

要求 Node.js 24、npm、Rust 1.90+ 和对应平台的 Tauri 系统开发依赖。本工作区的隔离 Rust 工具链位于 `.toolchains/`；`npm run tauri` 会自动使用它，其他机器可使用系统 Rust。

```sh
git submodule update --init
npm ci
npm run verify:upstream
npm run desktop:dev
```

```sh
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run baseline
npm run desktop:build
```

E2E 默认使用隔离的 Chrome 测试环境；安装 Chromium 后也可指定 `M1TERA_TEST_BROWSER=chromium`。`npm run dev` 只提供浏览器布局预览，不能执行 agent。

构建会下载 Node **24.21.0**，核对固定 SHA256，将完整运行时依赖与模型数据装入 app。用户无需安装 Node。首次构建需要联网，下载缓存位于系统临时目录的 `m1tera-node-distributions`。使用 `npm run tauri -- build --bundles app,dmg` 可只构建 macOS app 与 DMG。

## 网络代理

Node sidecar 启用 Node 24 的环境代理支持。macOS 上若没有显式代理环境变量，应用读取现有系统 HTTP/HTTPS 代理；已有环境变量优先。Windows/Linux 可通过 HTTP_PROXY、HTTPS_PROXY、NO_PROXY 配置，首版不解析系统 PAC 或 SOCKS-only 配置。应用不改变系统代理设置。

## 上下文基线

输入框的圆环在发送前显示“本地预计输入 / 当前可用上下文上限”。预计输入包括当前草稿、历史、提示词、已选文件与 Skills，以及本轮工具定义；上限来自可信模型目录或用户显式配置，切换模型或修改提示词不会清空已取得的目录上限缓存。缺少上限时保持“未知”，不猜测容量或显示虚假的占用比例。ChatGPT 原生 web search 请求的有效上限为可信模型上限与 **128,000 tokens** 中的较小值；模型上限未知时仍保持未知。圆环可悬停查看数值，点击打开上下文详情。

上下文详情显示分项估算与服务商返回的每次运行首轮 usage。输入统计包含缓存读写；未提供或全零 usage 显示“未知”。文件和 Skills 的计数分别包含在消息与系统提示词分项中，不重复相加。本地 tokenizer 是 `o200k_base`，并包含保守封装开销，不代表模型或服务商的精确分项计数。

`npm run baseline` 生成 `docs/context-baseline.md` 与 JSON，**只做本地估算，不调用模型**。桌面应用连接模型后，点击“测量首轮基线”，发送相同短消息的三次独立请求，比较 0/4/20 工具定义。20 个工具为合成规模测试；测量不会执行任何工具，也不会写入会话。结果另存于应用数据目录的 `context-baseline.json`，仅含测量数值、模型和固定测试消息，不含凭据。

当前未设置硬 token 上限或自动摘要。历史过长时由模型接口返回错误，用户可以新建会话或调整上下文策略。

已完成 ChatGPT `gpt-6.1-sol` 实测：0/4/20 个工具定义的成功请求输入为 **49 / 237 / 957 tokens**。数值来自 0.1.0 的两轮测量，失败请求保留为未知，见 [实测报告](docs/context-baseline-live.md)。v0.5 已通过 299 项自动化检查（255 runtime、33 E2E、11 Rust）和 11 项包内 smoke，并完成官方账号目录与固定子集评测；见 [0.5.0 验证记录](docs/validation-v5.md)。[0.4.0](docs/validation-v4.md)、[0.3.0](docs/validation-v3.md)、[0.2.0](docs/validation-v2.md) 和 [首次真实模型验证](docs/validation.md) 保留为历史结果，不替代当前版本验收。[v0.5 独立视觉复核](docs/visual-verification-v5.md)已完成：功能与布局通过，生产字体尚未接入规范要求的 DM Sans，保留这一设计偏差。v0.6 已通过 453 项自动化检查和 8 组包内 smoke，见 [0.6.0 验证记录](docs/validation-v6.md)；其他平台、独立无 Node 机器安装及签名公证仍未验收。

## 源码与边界

- `src/`：聊天、配置、审批、上下文明细与测量界面。
- `src-tauri/`：Rust JSONL 桥、窗口和 sidecar 生命周期。
- `runtime/`：Pi Agent、认证、工具、会话存储和计量。
- `shared/protocol.ts`：类型化请求、响应与事件。
- `third_party/pi`：只读参考 submodule，固定 `v1.1.0` / `abe508e1b89912adde45528136c3221eb69acdd7`。

Pi core 与 pi-ai 均精确固定为 **1.1.0**。`docs/upstream.json` 记录 npm provenance 与源码提交、包摘要的比对；不等同于独立的 Sigstore 签名验签。上游源码不参与应用构建，也不引入 coding-agent 默认行为。

会话和设置保存在 Tauri 的平台应用数据目录，密钥不包含在这些文件中。恢复时将未提交结果的工具调用标为中断，并在界面保留“结果未知”语义；不将未知推断为未发生或执行失败，也不自动重放写入或命令。

工作区与分类保存于 `organization.json`，会话文件保留置顶、归属、审批模式、自动匹配设置及运行检查点，技能库保存在 `skills.json`；外置结果保存在会话隔离的 `artifacts/`，评测报告保存在 `benchmarks/`。已有 0.1.0 会话兼容加载，缺失的审批模式按逐次审批处理，缺失的自动匹配设置按关闭处理。设计规范及可交互参考位于 `opendesign/`，依据 Codex 的布局思路形成 m1tera 自有规范，没有使用或声称使用 Codex 的官方设计 token；现有 desktop-v2 HTML 是历史演示，不代表 v0.3/v0.4/v0.5 的真实执行或网络验证。

JSONL 请求上限为 2 MiB、响应上限为 16 MiB；超限明确失败，不截断协议 JSON。附件完整读取最多 128 KiB，文件工具允许在 8 MiB 内分页；单次写入 1 MiB、命令输出 64 KiB。文件路径检查属于应用层边界，不能替代 OS 隔离。

正常停止与退出会取消正在运行的工具。Unix 上 sidecar 被强制杀死或崩溃时，独立命令进程组可能残留；首版不承诺强制崩溃后的完整进程隔离和回收。

CI 已配置 macOS arm64/x64、Windows x64 和 Linux x64 原生构建与检查；本机验证不能代替其余平台的实际结果。首版安装包不包含公开发行签名、公证或自动更新。

参考：[GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol)、[Sign in with ChatGPT](https://developers.openai.com/siwc/token-sharing-open-source)、[Tauri sidecar](https://v2.tauri.app/develop/sidecar/)。

## 许可证

本项目采用 [MIT 许可证](LICENSE)，允许使用、修改和商业分发，分发时须保留版权声明及许可证文本。第三方代码与依赖遵循各自的许可证；Pi 和内置 Node 的许可证保留于 `third_party/pi/LICENSE` 与 `src-tauri/licenses/`。
