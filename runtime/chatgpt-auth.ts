import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createModels, InMemoryCredentialStore,
  type Api, type AuthPrompt, type Model, type Provider, type AuthInteraction,
} from '@earendil-works/pi-ai';
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { AuthStatus, ModelOption, RuntimeEvent } from '../shared/protocol.js';

interface PendingPrompt {
  resolve: (value: string) => void;
  reject: (error: Error) => void;
}

/** Credentials stay in this process; the persisted host ID contains no account data. */
export class ChatGPTAuth {
  private readonly credentials = new InMemoryCredentialStore();
  private readonly models = createModels({
    credentials: this.credentials,
    authContext: { env: async () => undefined, fileExists: async () => false },
  });
  private deviceId = '';
  private connected = false;
  private controller?: AbortController;
  private readonly prompts = new Map<string, PendingPrompt>();

  constructor(
    private readonly dataDir: string,
    private readonly emit: (event: RuntimeEvent) => void,
    provider: Provider = openaiProvider(),
  ) {
    this.models.setProvider(provider);
  }

  async initialize(): Promise<void> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const file = path.join(this.dataDir, 'chatgpt-host.json');
    try {
      const saved = JSON.parse(await readFile(file, 'utf8')) as { deviceId?: unknown };
      if (typeof saved.deviceId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved.deviceId)) {
        throw new Error('ChatGPT host ID 文件无效，请恢复该文件或移除后重试。');
      }
      this.deviceId = saved.deviceId;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      this.deviceId = randomUUID();
      const temp = `${file}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify({ deviceId: this.deviceId }) + '\n', { mode: 0o600 });
      await rename(temp, file);
    }
  }

  status(): AuthStatus {
    return { connected: this.connected, loginPending: Boolean(this.controller) };
  }

  startLogin(): { started: boolean } {
    if (this.controller) return { started: false };
    if (!this.deviceId) throw new Error('ChatGPT 认证尚未初始化。');
    const controller = new AbortController();
    this.controller = controller;
    let outcomeMessage: string | undefined;
    const timer = setTimeout(() => controller.abort(), 5 * 60_000);
    timer.unref();
    this.emitStatus('请在浏览器中完成 ChatGPT 授权。');
    const interaction: AuthInteraction = {
      signal: controller.signal,
      prompt: (prompt) => this.prompt(prompt, controller.signal),
      notify: (event) => {
        if (event.type === 'auth_url') this.emit({ type: 'auth.url', url: event.url });
        else if (event.type === 'progress') this.emitStatus('正在连接 ChatGPT…');
      },
    };
    void this.models.login('openai', 'oauth', interaction, {
      getDeviceId: () => this.deviceId,
      agentName: 'M1TERA',
    }).then(() => {
      if (!controller.signal.aborted) {
        this.connected = true;
        outcomeMessage = 'ChatGPT 已连接。凭据仅在本次运行中保存。';
      }
    }).catch((error: unknown) => {
      // OAuth token endpoint errors can include response bodies. Never forward those to UI/logs.
      const portBusy = error instanceof Error && /Port 1455 is in use/.test(error.message);
      const httpStatus = error instanceof Error ? error.message.match(/OpenAI OAuth token request failed \((\d{3})\)/)?.[1] : undefined;
      const missingScope = error instanceof Error && /grant did not include/.test(error.message);
      const missingIdToken = error instanceof Error && /did not contain an ID token/.test(error.message);
      const message = controller.signal.aborted ? '登录已取消或超时。'
        : portBusy ? '登录回调端口 1455 正被使用，请结束其他登录后重试。'
        : httpStatus ? `ChatGPT 令牌交换失败（HTTP ${httpStatus}）。请检查账户授权与网络后重试。`
        : missingScope ? '账户未授予 ChatGPT 计划使用权限，请在官方授权页面允许计划访问后重试。'
        : missingIdToken ? 'ChatGPT 令牌响应缺少身份令牌，当前登录协议未完成。'
        : error instanceof TypeError ? 'ChatGPT 令牌交换网络请求失败，请检查应用对 auth.openai.com 的网络访问。'
        : 'ChatGPT 授权未完成。请检查网络、账户资格和浏览器中的授权结果后重试。';
      outcomeMessage = message;
    }).finally(() => {
      clearTimeout(timer);
      if (this.controller === controller) this.controller = undefined;
      this.emitStatus(outcomeMessage);
    });
    return { started: true };
  }

  private prompt(prompt: AuthPrompt, loginSignal: AbortSignal): Promise<string> {
    const id = randomUUID();
    const signal = prompt.signal ? AbortSignal.any([loginSignal, prompt.signal]) : loginSignal;
    return new Promise<string>((resolve, reject) => {
      const onAbort = () => {
        this.prompts.delete(id);
        reject(new Error('登录已取消。'));
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      this.prompts.set(id, {
        resolve: (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
        reject: (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
      });
      this.emit({ type: 'auth.prompt', id,
        message: '如果浏览器未自动返回，可粘贴完整的 localhost 回调地址。',
        placeholder: 'http://127.0.0.1:1455/auth/callback?…',
      });
    });
  }

  respond(promptId: string, value: string): { resolved: boolean } {
    const prompt = this.prompts.get(promptId);
    if (!prompt) return { resolved: false };
    this.prompts.delete(promptId);
    prompt.resolve(value);
    return { resolved: true };
  }

  cancel(): { cancelled: boolean } {
    const pending = this.controller;
    pending?.abort();
    return { cancelled: Boolean(pending) };
  }

  getModel(id: string): Model<Api> {
    const model = this.models.getModel('openai', id);
    if (!model) throw new Error(`Pi ${'1.1.0'} 未包含模型 ${id}；请使用 gpt-6.1-sol 或更新明确的模型配置。`);
    return model;
  }

  listModels(): ModelOption[] {
    // ChatGPT OAuth uses the Responses API. This is the pinned Pi chat catalog,
    // not a claim that every model is available to the current account plan.
    return this.models.getModels('openai')
      .filter((model) => model.api === 'openai-responses' && model.input.includes('text'))
      .map((model) => ({ id: model.id, name: model.name, contextWindow: model.contextWindow, reasoning: model.reasoning, source: 'catalog' as const }));
  }

  getStreamFn(): StreamFn {
    return this.models.streamSimple.bind(this.models);
  }

  async getAuth(signal?: AbortSignal): Promise<{ apiKey: string }> {
    if (!this.connected) throw new Error('请先在设置中 Continue with ChatGPT。');
    try {
      const auth = await this.models.getAuth('openai', { signal });
      if (!auth?.auth.apiKey) throw new Error('No auth');
      return { apiKey: auth.auth.apiKey };
    } catch {
      throw new Error(signal?.aborted ? '请求已取消。' : 'ChatGPT 登录已失效，请重新连接。');
    }
  }

  async logout(): Promise<void> {
    this.cancel();
    const credential = await this.credentials.read('openai');
    let revocationConfirmed = !credential || credential.type !== 'oauth';
    if (credential?.type === 'oauth' && typeof credential.clientId === 'string') {
      try {
        const discovery = await fetch('https://auth.openai.com/.well-known/openid-configuration', { signal: AbortSignal.timeout(10_000) });
        if (!discovery.ok) throw new Error('discovery failed');
        const metadata = await discovery.json() as { revocation_endpoint?: string };
        const endpoint = new URL(metadata.revocation_endpoint ?? '');
        if (endpoint.protocol !== 'https:' || endpoint.hostname !== 'auth.openai.com') throw new Error('invalid revocation endpoint');
        const response = await fetch(endpoint, {
          method: 'POST', signal: AbortSignal.timeout(10_000),
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: credential.refresh, token_type_hint: 'refresh_token', client_id: credential.clientId }),
        });
        revocationConfirmed = response.ok;
      } catch { /* Local sign-out still completes. */ }
    }
    await this.models.logout('openai');
    this.connected = false;
    this.emitStatus(revocationConfirmed ? 'ChatGPT 已断开。' : '本地已断开；远端撤销未确认，可在 ChatGPT 设置中断开此应用。');
  }

  private emitStatus(message?: string): void {
    this.emit({ type: 'auth.status', status: this.status(), ...(message ? { message } : {}) });
  }
}
