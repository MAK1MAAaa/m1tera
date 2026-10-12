# MVP 验证记录

这是 0.1.0 的历史验证记录。当前 0.2.0 的设计升级、自动审批及会话组织验证另见 [0.2.0 验证记录](validation-v2.md)；`m1tera.app` 路径会随本机重新打包更新。

验证日期：2026-10-12。当前实际构建环境为 macOS arm64、Node 24.21.0、Rust 1.99.0；Rust 工具链安装在本工作区 `.toolchains/`，未依赖全局安装。

| 验证项 | 结果与范围 |
| --- | --- |
| TypeScript、ESLint、生产构建 | `npm run typecheck`、`npm run lint`、`npm run build` 通过 |
| 自动化运行时与认证测试 | 20 项通过；覆盖本地真实 HTTP/SSE 模拟服务、Responses / Chat Completions、工具集、usage 缺失和缓存、凭据保密、审批拒绝、取消、路径逃逸、命令取消和会话恢复 |
| 浏览器界面测试 | 3 项 Playwright 通过；覆盖预览标识、模拟认证与流式消息、未知 usage、按会话工具配置及写入审批。模型请求在这组测试中使用模拟运行时 |
| Rust 桥及原生配置 | `cargo check`、`cargo clippy` 和 9 项 `cargo test` 通过；覆盖 OAuth URL 限制、JSONL 分帧/超限、系统代理解析 |
| 源码与依赖来源 | Pi submodule 干净；源码 tag / commit、安装包和 lockfile 版本一致。npm provenance 源码 SHA / 包摘要一致；没有进行独立 Sigstore 签名验证 |
| macOS arm64 安装产物 | release app 和 DMG 构建成功，随 app 携带固定 Node 和完整生产依赖；安装产物未经公开签名或公证 |
| 排除系统 Node | 将 PATH 限制为 `/usr/bin:/bin`，使用应用携带的 Node 完成设置、会话及上下文 RPC；通过。尚未在独立的无 Node 机器安装验收 |
| 原生桌面与真实 ChatGPT | 在打包应用中完成官方授权；`gpt-6.1-sol` 流式聊天返回 `OK`，实际输入 49、输出 5 tokens |
| 真实模型工具调用 | 独立测试会话仅启用 `read_file`，工作区为 `tests/fixtures/workspace`；模型调用成功，最终返回 `m1tera read_file smoke test: OK`。首轮实际输入 105、输出 41 tokens，缓存为 0；该计数不代表整个多轮工具任务用量 |
| 真实上下文基线 | 两轮中取得 0/4/20 工具定义的成功样本 49/237/957 输入 tokens；失败案例和证据另见 [报告](context-baseline-live.md) |

最终原生界面通过 accessibility 状态及截图检查。新会话不发送工具；测试工具只读取随项目提供的无敏感信息文件。真实调用没有执行写文件或命令，写入/命令批准、拒绝和取消由自动化行为测试验证。

产物位于：

- `src-tauri/target/release/bundle/macos/m1tera.app`
- `src-tauri/target/release/bundle/dmg/m1tera_0.1.0_aarch64.dmg`

安装包约 63.7 MiB。该版本产物 SHA256 记录在 [历史产物清单](release-artifacts-0.1.0.json)；当时 app 内 16 个编译后的运行时文件与 `dist-runtime` 逐文件散列一致，原生程序也包含代理修复。

其他平台的 CI 配置已写入 `.github/workflows/desktop.yml`，包含 macOS x64、Windows x64 和 Linux x64；未创建远程仓库或执行这些平台的 CI。当前仅承诺本机已验证的行为，其余安装验收仍待独立环境执行。

文件工具执行工作区真实路径限制。批准的命令以当前用户权限运行，工作目录不构成 OS 沙箱；Unix sidecar 强制崩溃或杀死后，独立命令进程组可能残留。首版没有自动摘要、持久化凭据、公开发行签名或自动更新。
