use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use tokio::sync::oneshot;

const MAX_REQUEST_BYTES: usize = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const BASELINE_TIMEOUT: Duration = Duration::from_secs(210);
const METHODS: &[&str] = &[
    "settings.get",
    "settings.set",
    "auth.status",
    "auth.login",
    "auth.respond",
    "auth.cancel",
    "auth.logout",
    "models.list",
    "models.discover",
    "organization.get",
    "workspaces.create",
    "workspaces.rename",
    "categories.create",
    "files.list",
    "skills.list",
    "skills.get",
    "skills.create",
    "skills.update",
    "skills.import",
    "skills.delete",
    "sessions.list",
    "sessions.create",
    "sessions.load",
    "sessions.configure",
    "sessions.update",
    "sessions.delete",
    "run.start",
    "run.cancel",
    "approval.resolve",
    "context.preview",
    "context.baseline",
];

type Reply = oneshot::Sender<Result<Value, String>>;

#[derive(Default)]
struct ProcessState {
    child: Option<CommandChild>,
    generation: u64,
    pending: HashMap<String, Reply>,
    active_runs: HashMap<String, String>,
}

#[derive(Default)]
struct Shared {
    process: Mutex<ProcessState>,
    shutting_down: AtomicBool,
    shutdown_complete: AtomicBool,
}

#[derive(Clone, Default)]
pub struct RuntimeBridge {
    shared: Arc<Shared>,
}

struct JsonlFrames {
    partial: Vec<u8>,
    max_bytes: usize,
}

impl JsonlFrames {
    fn new(max_bytes: usize) -> Self {
        Self {
            partial: Vec::new(),
            max_bytes,
        }
    }

    fn push(&mut self, chunk: &[u8]) -> Result<Vec<Vec<u8>>, ()> {
        let mut lines = Vec::new();
        for part in chunk.split_inclusive(|byte| *byte == b'\n') {
            let complete = part.last() == Some(&b'\n');
            let bytes = if complete {
                &part[..part.len() - 1]
            } else {
                part
            };
            if bytes.len() > self.max_bytes.saturating_sub(self.partial.len()) {
                return Err(());
            }
            self.partial.extend_from_slice(bytes);
            if complete {
                if self.partial.last() == Some(&b'\r') {
                    self.partial.pop();
                }
                lines.push(std::mem::take(&mut self.partial));
            }
        }
        Ok(lines)
    }
}

fn validate_request(request: &Value) -> Result<&str, String> {
    let id = request
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty() && id.len() <= 128)
        .ok_or("运行时请求 ID 无效")?;
    let method = request
        .get("method")
        .and_then(Value::as_str)
        .ok_or("运行时方法无效")?;
    if !METHODS.contains(&method) {
        return Err("不支持此运行时方法".into());
    }
    if !request.get("params").is_some_and(Value::is_object) {
        return Err("运行时请求参数必须是对象".into());
    }
    Ok(id)
}

fn runtime_entry(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app.path().resource_dir().map_err(|_| "无法定位应用资源")?;
    let bundled = resource_dir.join("resources/runtime/index.js");
    if bundled.is_file() {
        return Ok(bundled);
    }
    // Cargo dev execution can happen before resources have been copied.
    #[cfg(debug_assertions)]
    {
        let development =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist-runtime/runtime/index.js");
        if development.is_file() {
            return Ok(development);
        }
    }
    Err("Agent 运行时文件缺失，请重新构建或安装应用".into())
}

impl RuntimeBridge {
    fn ensure_started(&self, app: &AppHandle) -> Result<(), String> {
        if self.shared.shutting_down.load(Ordering::SeqCst) {
            return Err("应用正在退出".into());
        }
        let mut process = self.shared.process.lock().map_err(|_| "运行时状态不可用")?;
        if self.shared.shutting_down.load(Ordering::SeqCst) {
            return Err("应用正在退出".into());
        }
        if process.child.is_some() {
            return Ok(());
        }
        let entry = runtime_entry(app)?;
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|_| "无法定位应用数据目录")?;
        std::fs::create_dir_all(&data_dir).map_err(|_| "无法创建应用数据目录")?;
        let working_dir = entry
            .parent()
            .and_then(|parent| parent.parent())
            .ok_or("运行时资源路径无效")?;
        let command = app
            .shell()
            .sidecar("node")
            .map_err(|_| "应用内置的 Node.js 运行时缺失")?
            .arg("--use-env-proxy")
            .arg(&entry)
            .arg("--data-dir")
            .arg(&data_dir)
            .current_dir(working_dir)
            // Do not inherit NODE_OPTIONS or NODE_PATH from a developer shell.
            .env("NODE_OPTIONS", "")
            .env("NODE_PATH", "")
            .envs(crate::network::sidecar_environment())
            // The plugin's default line reader accumulates an unbounded Vec before
            // emitting an event. Read fixed-size chunks and bound JSONL frames here.
            .set_raw_out(true)
            .set_process_group(true);
        let (mut receiver, child) = command
            .spawn()
            .map_err(|_| "无法启动应用内置的 Agent 运行时")?;
        process.generation += 1;
        let generation = process.generation;
        process.child = Some(child);
        drop(process);

        let bridge = self.clone();
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut frames = JsonlFrames::new(MAX_RESPONSE_BYTES);
            while let Some(event) = receiver.recv().await {
                match event {
                    CommandEvent::Stdout(bytes) => {
                        let Ok(lines) = frames.push(&bytes) else {
                            bridge.failed(
                                &app,
                                generation,
                                "Agent 运行时单条消息超过 16 MiB 限制，连接已关闭",
                            );
                            return;
                        };
                        for line in lines {
                            if bridge.handle_line(&app, generation, &line).is_err() {
                                bridge.failed(&app, generation, "Agent 运行时返回了无效消息");
                                return;
                            }
                        }
                    }
                    // Stderr can contain provider diagnostics. Never forward or log it,
                    // because an upstream library may echo credentials in an error.
                    CommandEvent::Stderr(_) => {}
                    CommandEvent::Error(_) | CommandEvent::Terminated(_) => {
                        bridge.failed(
                            &app,
                            generation,
                            "Agent 运行时已停止。发送新请求可重新启动；此前请求不会自动重试",
                        );
                        return;
                    }
                    _ => {}
                }
            }
            bridge.failed(&app, generation, "Agent 运行时连接已关闭");
        });
        Ok(())
    }

    fn handle_line(&self, app: &AppHandle, generation: u64, bytes: &[u8]) -> Result<(), ()> {
        if bytes.iter().all(u8::is_ascii_whitespace) {
            return Ok(());
        }
        if bytes.len() > MAX_RESPONSE_BYTES {
            return Err(());
        }
        let envelope: Value = serde_json::from_slice(bytes).map_err(|_| ())?;
        let mut process = self.shared.process.lock().map_err(|_| ())?;
        if process.generation != generation {
            return Ok(());
        }
        match envelope.get("kind").and_then(Value::as_str) {
            Some("response") => {
                let id = envelope.get("id").and_then(Value::as_str).ok_or(())?;
                if let Some(reply) = process.pending.remove(id) {
                    let _ = reply.send(Ok(envelope));
                }
            }
            Some("event") => {
                let event = envelope.get("event").ok_or(())?;
                match event.get("type").and_then(Value::as_str) {
                    Some("run.started") => {
                        if let (Some(session), Some(run)) = (
                            event.get("sessionId").and_then(Value::as_str),
                            event.get("runId").and_then(Value::as_str),
                        ) {
                            process.active_runs.insert(session.into(), run.into());
                        }
                    }
                    Some("run.finished") => {
                        if let Some(session) = event.get("sessionId").and_then(Value::as_str) {
                            process.active_runs.remove(session);
                        }
                    }
                    Some(_) => {}
                    None => return Err(()),
                }
                let event = event.clone();
                drop(process);
                let _ = app.emit("agent-event", event);
            }
            _ => return Err(()),
        }
        Ok(())
    }

    fn failed(&self, app: &AppHandle, generation: u64, message: &str) {
        let (child, pending, active_runs) = {
            let Ok(mut process) = self.shared.process.lock() else {
                return;
            };
            if process.generation != generation || process.child.is_none() {
                return;
            }
            (
                process.child.take(),
                std::mem::take(&mut process.pending),
                std::mem::take(&mut process.active_runs),
            )
        };
        for (_, reply) in pending {
            let _ = reply.send(Err(message.into()));
        }
        if let Some(child) = child {
            let _ = child.kill();
        }
        if !self.shared.shutting_down.load(Ordering::SeqCst) {
            for (session, run) in active_runs {
                let _ = app.emit(
                    "agent-event",
                    json!({
                        "type": "run.finished", "sessionId": session, "runId": run,
                        "status": "error", "error": message
                    }),
                );
            }
            let _ = app.emit(
                "agent-event",
                json!({"type": "runtime.failed", "message": message}),
            );
        }
    }

    pub fn begin_shutdown(&self) -> bool {
        !self.shared.shutting_down.swap(true, Ordering::SeqCst)
    }

    pub fn shutdown_complete(&self) -> bool {
        self.shared.shutdown_complete.load(Ordering::SeqCst)
    }

    pub async fn shutdown(&self) {
        if let Ok(mut process) = self.shared.process.lock() {
            let sessions: Vec<_> = process.active_runs.keys().cloned().collect();
            if let Some(child) = process.child.as_mut() {
                let _ = child.write(
                    b"{\"id\":\"shutdown-auth\",\"method\":\"auth.cancel\",\"params\":{}}\n",
                );
                for session in sessions {
                    let request = json!({
                        "id": format!("shutdown-{session}"), "method": "run.cancel",
                        "params": {"sessionId": session}
                    });
                    if let Ok(mut bytes) = serde_json::to_vec(&request) {
                        bytes.push(b'\n');
                        let _ = child.write(&bytes);
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(500)).await;
        self.terminate();
        self.shared.shutdown_complete.store(true, Ordering::SeqCst);
    }

    pub fn terminate(&self) {
        let (child, pending) = {
            let Ok(mut process) = self.shared.process.lock() else {
                return;
            };
            process.active_runs.clear();
            (process.child.take(), std::mem::take(&mut process.pending))
        };
        for (_, reply) in pending {
            let _ = reply.send(Err("应用正在退出".into()));
        }
        if let Some(child) = child {
            let _ = child.kill();
        }
    }
}

#[tauri::command]
pub async fn runtime_request(
    app: AppHandle,
    bridge: State<'_, RuntimeBridge>,
    request: Value,
) -> Result<Value, String> {
    let id = validate_request(&request)?.to_owned();
    let timeout = if request.get("method").and_then(Value::as_str) == Some("context.baseline") {
        BASELINE_TIMEOUT
    } else {
        REQUEST_TIMEOUT
    };
    let mut bytes = serde_json::to_vec(&request).map_err(|_| "无法编码运行时请求")?;
    if bytes.len() > MAX_REQUEST_BYTES {
        return Err("运行时请求超过 2 MiB 限制".into());
    }
    bytes.push(b'\n');
    bridge.ensure_started(&app)?;
    let (reply, receiver) = oneshot::channel();
    let (generation, write_failed) = {
        let mut process = bridge
            .shared
            .process
            .lock()
            .map_err(|_| "运行时状态不可用")?;
        if process.pending.contains_key(&id) {
            return Err("运行时请求 ID 已存在".into());
        }
        if process.child.is_none() || bridge.shared.shutting_down.load(Ordering::SeqCst) {
            return Err("Agent 运行时连接不可用".into());
        }
        let generation = process.generation;
        process.pending.insert(id.clone(), reply);
        let write_failed = match process.child.as_mut() {
            Some(child) => child.write(&bytes).is_err(),
            None => true,
        };
        (generation, write_failed)
    };
    if write_failed {
        bridge.failed(
            &app,
            generation,
            "Agent 运行时连接不可用；此请求不会自动重试",
        );
        return Err("Agent 运行时连接不可用；此请求不会自动重试".into());
    }
    match tokio::time::timeout(timeout, receiver).await {
        Ok(Ok(response)) => response,
        Ok(Err(_)) => Err("Agent 运行时连接已关闭".into()),
        Err(_) => {
            if let Ok(mut process) = bridge.shared.process.lock() {
                process.pending.remove(&id);
            }
            Err("Agent 运行时请求超时；此请求不会自动重试".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bridge_accepts_only_known_object_requests() {
        assert!(validate_request(&json!({"id":"a","method":"settings.get","params":{}})).is_ok());
        assert!(validate_request(&json!({"id":"a","method":"shell.execute","params":{}})).is_err());
        assert!(validate_request(&json!({"id":"","method":"settings.get","params":{}})).is_err());
        assert!(validate_request(&json!({"id":"a","method":"settings.get","params":[]})).is_err());
    }

    #[test]
    fn bridge_methods_cover_the_shared_frontend_protocol() {
        let source = include_str!("../../shared/protocol.ts");
        let requests = source
            .split_once("export interface RequestMap {")
            .unwrap()
            .1
            .split_once("\n}")
            .unwrap()
            .0;
        let declared: std::collections::BTreeSet<&str> = requests
            .lines()
            .filter_map(|line| {
                line.trim()
                    .strip_prefix('\'')?
                    .split_once("':")
                    .map(|(method, _)| method)
            })
            .collect();
        let accepted: std::collections::BTreeSet<&str> = METHODS.iter().copied().collect();
        assert!(!declared.is_empty());
        assert_eq!(
            accepted, declared,
            "Rust IPC methods and RequestMap must stay aligned"
        );
        for method in declared {
            assert!(
                validate_request(&json!({"id":"protocol-check","method":method,"params":{}}))
                    .is_ok()
            );
        }
    }

    #[test]
    fn jsonl_preserves_split_utf8_and_multiple_messages() {
        let mut frames = JsonlFrames::new(1024);
        let bytes = "{\"text\":\"中文\"}\n{\"id\":2}\r\n\n".as_bytes();
        assert!(frames.push(&bytes[..11]).unwrap().is_empty());
        let lines = frames.push(&bytes[11..]).unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&lines[0]).unwrap()["text"],
            "中文"
        );
        assert_eq!(serde_json::from_slice::<Value>(&lines[1]).unwrap()["id"], 2);
        assert!(lines[2].is_empty());
        assert!(frames.partial.is_empty());
    }

    #[test]
    fn jsonl_rejects_oversized_unterminated_message_before_allocating_it() {
        let mut frames = JsonlFrames::new(4);
        assert!(frames.push(b"123").unwrap().is_empty());
        assert!(frames.push(b"45").is_err());
        assert_eq!(frames.partial.len(), 3);
        let mut frames = JsonlFrames::new(4);
        assert_eq!(frames.push(b"1234\n").unwrap(), vec![b"1234".to_vec()]);
    }
}
