import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type { RequestMap, RuntimeEvent, RuntimeMethod, RuntimeRequest, RuntimeResponse } from '../../shared/protocol';

export interface RuntimeClient {
  transport: 'desktop' | 'browser' | 'test';
  request<M extends RuntimeMethod>(method: M, params: RequestMap[M]['params']): Promise<RequestMap[M]['result']>;
  subscribe(listener: (event: RuntimeEvent) => void): Promise<() => void>;
  chooseWorkspace(): Promise<string | null>;
  chooseSkillFile(): Promise<string | null>;
  openAuthUrl(url: string): Promise<void>;
  openExternalUrl(url: string): Promise<void>;
}

declare global {
  interface Window { __M1TERA_RUNTIME__?: RuntimeClient }
}

export function createRuntimeClient(): RuntimeClient {
  if (window.__M1TERA_RUNTIME__) return window.__M1TERA_RUNTIME__;
  if (!isTauri()) return {
    transport: 'browser',
    async request() { throw new Error('浏览器预览无法连接 Agent，请使用桌面应用。'); },
    async subscribe() { return () => undefined; },
    async chooseWorkspace() { return null; },
    async chooseSkillFile() { return null; },
    async openAuthUrl() { throw new Error('请在桌面应用中连接 ChatGPT。'); },
    async openExternalUrl(url) { if (!/^https?:\/\//i.test(url)) throw new Error('链接无效'); window.open(url, '_blank', 'noopener,noreferrer'); },
  };
  return {
    transport: 'desktop',
    async request<M extends RuntimeMethod>(method: M, params: RequestMap[M]['params']) {
      const request = { id: crypto.randomUUID(), method, params } as RuntimeRequest;
      const response = await invoke<RuntimeResponse>('runtime_request', { request });
      if (response.error) throw new Error(response.error.message);
      if (response.id !== request.id) throw new Error('运行时响应与请求不匹配。');
      return response.result as RequestMap[M]['result'];
    },
    async subscribe(listener) { return listen<RuntimeEvent>('agent-event', (event) => listener(event.payload)); },
    async chooseWorkspace() {
      const selected = await open({ directory: true, multiple: false, title: '选择 Agent 工作区' });
      return typeof selected === 'string' ? selected : null;
    },
    async openAuthUrl(url) { await invoke('open_auth_url', { url }); },
    async openExternalUrl(url) { await invoke('open_external_url', { url }); },
    async chooseSkillFile() {
      const selected = await open({ directory: false, multiple: false, title: '选择 SKILL.md', filters: [{ name: 'Skill 文件', extensions: ['md'] }] });
      return typeof selected === 'string' ? selected : null;
    },
  };
}
