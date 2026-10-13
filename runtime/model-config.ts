import { DEFAULT_SETTINGS } from '../shared/protocol.js';
import type { ConfiguredModel, CustomProvider, ModelCatalog, ModelOption, Settings } from '../shared/protocol.js';

const DEFAULT_PROVIDER_ID = 'custom-default';
const MAX_PROVIDERS = 12;
const MAX_MODELS = 256;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const DISCOVERY_TIMEOUT_MS = 4000;
const DISCOVERY_WARNING = '无法读取接口模型列表，请检查接口地址与凭据，或手动添加模型。';
const UNAVAILABLE_REASON = '接口已标记此模型停用或弃用，不能启用。';
const SCHEDULED_SHUTDOWN_REASON = '接口已标记此模型计划停用，不能启用。';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error(`${label}无效`);
  const result = value.trim();
  if (!result || result.length > maximum) throw new Error(`${label}无效`);
  return result;
}

function contextWindow(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 128 || value > 10_000_000) throw new Error('模型上下文窗口无效');
  return value;
}

function validateProviderId(value: unknown, allowOfficial = false): string {
  const id = boundedString(value, 200, '服务商 ID');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) || id === 'chatgpt' && !allowOfficial) throw new Error('服务商 ID 无效或使用保留名称');
  return id;
}

function baseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('接口地址无效');
  const input = value.trim();
  if (input.includes('?') || input.includes('#') || /^[a-z][\w+.-]*:\/\/[^/?#]*@/iu.test(input)) throw new Error('接口地址无效');
  let parsed: URL;
  try { parsed = new URL(input); } catch { throw new Error('接口地址无效'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('接口地址无效');
  return parsed.toString().replace(/\/+$/, '');
}

function apiFormat(value: unknown): Settings['apiFormat'] {
  if (value !== 'responses' && value !== 'chat-completions') throw new Error('接口格式无效');
  return value;
}

function configuredModels(value: unknown): ConfiguredModel[] {
  if (!Array.isArray(value) || value.length > MAX_MODELS) throw new Error('模型列表无效或超过 256 项');
  const ids = new Set<string>();
  return value.map((item: unknown) => {
    if (!record(item)) throw new Error('模型配置无效');
    const id = boundedString(item.id, 200, '模型 ID');
    if (ids.has(id)) throw new Error('模型 ID 重复');
    ids.add(id);
    if (typeof item.enabled !== 'boolean') throw new Error('模型启用状态无效');
    if (item.source !== undefined && item.source !== 'manual' && item.source !== 'endpoint') throw new Error('模型来源无效');
    return {
      id,
      enabled: item.enabled,
      ...(item.name !== undefined ? { name: boundedString(item.name, 100, '模型名称') } : {}),
      ...(item.contextWindow !== undefined ? { contextWindow: contextWindow(item.contextWindow) } : {}),
      ...(item.source !== undefined ? { source: item.source } : {}),
    };
  });
}

function providers(value: unknown): CustomProvider[] {
  if (!Array.isArray(value) || value.length > MAX_PROVIDERS) throw new Error('服务商列表无效或超过 12 项');
  const ids = new Set<string>();
  return value.map((item: unknown) => {
    if (!record(item)) throw new Error('服务商配置无效');
    const id = validateProviderId(item.id);
    if (ids.has(id)) throw new Error('服务商 ID 重复');
    ids.add(id);
    return {
      id,
      name: boundedString(item.name, 100, '服务商名称'),
      baseUrl: baseUrl(item.baseUrl),
      apiFormat: apiFormat(item.apiFormat),
      models: configuredModels(item.models),
    };
  });
}

function manualModel(id: string, enabled: boolean, window?: number): ConfiguredModel {
  return { id, enabled, source: 'manual', ...(window !== undefined ? { contextWindow: window } : {}) };
}

/** Keep the flat connection fields usable for older clients while preserving separate provider profiles. */
export function normalizeModelSettings(settings: Settings, previous?: Settings): Settings {
  if (settings.connection !== 'chatgpt' && settings.connection !== 'compatible') throw new Error('连接类型无效');
  const selectedUrl = baseUrl(settings.baseUrl);
  const selectedFormat = apiFormat(settings.apiFormat);
  const selectedModel = boundedString(settings.model, 200, '模型 ID');
  const selectedWindow = settings.contextWindow === undefined ? undefined : contextWindow(settings.contextWindow);
  const requestedProvider = settings.providerId === undefined ? undefined : validateProviderId(settings.providerId, true);
  const explicitProfiles = settings.chatgptModels !== undefined || settings.customProviders !== undefined;
  const chatgptModels = configuredModels(settings.chatgptModels ?? previous?.chatgptModels ?? [manualModel(DEFAULT_SETTINGS.model, true)]);
  const customProviders = providers(settings.customProviders ?? previous?.customProviders ?? []);
  let providerId = 'chatgpt';

  if (settings.connection === 'chatgpt') {
    if (!explicitProfiles && !chatgptModels.some((item) => item.id === selectedModel)) {
      if (chatgptModels.length >= MAX_MODELS) throw new Error('模型列表超过 256 项');
      // A saved model ID is not evidence that the current account can still use it.
      chatgptModels.push(manualModel(selectedModel, selectedModel === DEFAULT_SETTINGS.model, selectedWindow));
    }
  } else {
    let selected = requestedProvider === 'chatgpt' ? undefined : customProviders.find((item) => item.id === requestedProvider);
    const deletedSelection = explicitProfiles && requestedProvider !== undefined && requestedProvider !== 'chatgpt' && !selected;
    if (explicitProfiles && requestedProvider !== undefined) {
      if (requestedProvider === 'chatgpt' || selected && (selected.baseUrl !== selectedUrl || selected.apiFormat !== selectedFormat)) throw new Error('当前服务商与连接配置不一致');
    } else if (!selected) {
      if (!explicitProfiles && previous?.connection === 'compatible') selected = customProviders.find((item) => item.id === previous.providerId);
      selected ??= customProviders.find((item) => item.baseUrl === selectedUrl && item.apiFormat === selectedFormat);
    }
    if (!selected && !deletedSelection) {
      if (customProviders.length >= MAX_PROVIDERS) throw new Error('服务商列表超过 12 项');
      let id = DEFAULT_PROVIDER_ID;
      for (let suffix = 2; customProviders.some((item) => item.id === id); suffix++) id = `${DEFAULT_PROVIDER_ID}-${suffix}`;
      selected = { id, name: '自定义接口', baseUrl: selectedUrl, apiFormat: selectedFormat, models: [manualModel(selectedModel, true, selectedWindow)] };
      customProviders.push(selected);
    } else if (selected && !explicitProfiles) {
      selected.baseUrl = selectedUrl;
      selected.apiFormat = selectedFormat;
      const model = selected.models.find((item) => item.id === selectedModel);
      if (!model) {
        if (selected.models.length >= MAX_MODELS) throw new Error('模型列表超过 256 项');
        selected.models.push(manualModel(selectedModel, true, selectedWindow));
      } else if (selectedWindow !== undefined) {
        model.contextWindow = selectedWindow;
      }
    }
    // Removing the active profile leaves a disabled selection until the user chooses another one.
    providerId = selected?.id ?? requestedProvider!;
  }

  return {
    connection: settings.connection,
    apiFormat: selectedFormat,
    baseUrl: selectedUrl,
    model: selectedModel,
    systemPrompt: settings.systemPrompt,
    workspace: settings.workspace,
    enabledTools: [...settings.enabledTools],
    ...(selectedWindow !== undefined ? { contextWindow: selectedWindow } : {}),
    providerId,
    chatgptModels,
    customProviders,
    ...(settings.harness ? { harness: settings.harness } : {}),
  };
}

const INACTIVE_STATUSES = new Set(['deprecated', 'retired', 'disabled', 'shutdown', 'shut_down', 'shut-down', 'unavailable', 'inactive', 'decommissioned', 'discontinued', 'end-of-life', 'end_of_life', 'eol']);
const DATE_FIELDS = ['shutdown_date', 'shutdown_at', 'shutdownDate', 'deprecation_date', 'deprecated_at', 'deprecatedAt', 'retirement_date', 'retired_at', 'retiredAt', 'disabled_at', 'disabledAt'];

function timestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1_000_000_000_000 ? value * 1000 : value;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|[T ])/u.test(value)) return undefined;
  const calendarDate = value.slice(0, 10);
  const day = Date.parse(`${calendarDate}T00:00:00Z`);
  if (!Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== calendarDate) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function unavailableReason(model: Record<string, unknown>, now: number): string | undefined {
  const containers = [model, ...['lifecycle', 'lifecycle_status', 'lifecycleStatus'].flatMap((key) => record(model[key]) ? [model[key]] : [])];
  let scheduledShutdown = false;
  for (const item of containers) {
    for (const key of ['status', 'state', 'lifecycle', 'lifecycle_status', 'lifecycleStatus']) {
      const value = item[key];
      if (typeof value === 'string' && INACTIVE_STATUSES.has(value.trim().toLowerCase())) return UNAVAILABLE_REASON;
    }
    for (const key of ['deprecated', 'retired', 'disabled', 'shutdown']) {
      const value = item[key];
      const date = timestamp(value);
      if (value === true || typeof value === 'string' && ['true', 'yes', ...INACTIVE_STATUSES].includes(value.trim().toLowerCase()) || date !== undefined && date <= now) return UNAVAILABLE_REASON;
      if (key === 'shutdown' && date !== undefined) scheduledShutdown = true;
    }
    if (item.available === false || item.enabled === false) return UNAVAILABLE_REASON;
    for (const key of DATE_FIELDS) {
      const date = timestamp(item[key]);
      if (date !== undefined && date <= now) return UNAVAILABLE_REASON;
      if (date !== undefined && ['shutdown_date', 'shutdown_at', 'shutdownDate'].includes(key)) scheduledShutdown = true;
    }
  }
  return scheduledShutdown ? SCHEDULED_SHUTDOWN_REASON : undefined;
}

const TEXT_CAPABILITIES = new Set(['text', 'chat', 'completion', 'completions', 'conversation', 'responses', 'text-generation', 'text_generation', 'chat-completions', 'chat_completions']);
const NON_TEXT_CAPABILITIES = new Set(['embedding', 'embeddings', 'rerank', 'reranking', 'audio', 'speech', 'tts', 'transcription', 'image', 'images', 'image-generation', 'image_generation', 'video', 'video-generation', 'video_generation']);

function metadataTokens(value: unknown): string[] {
  if (typeof value === 'string') return [value.toLowerCase()];
  if (Array.isArray(value)) return value.flatMap((item) => typeof item === 'string' ? [item.toLowerCase()] : []);
  if (record(value)) return Object.entries(value).flatMap(([key, enabled]) => enabled === true ? [key.toLowerCase()] : []);
  return [];
}

function nonTextModel(model: Record<string, unknown>, id: string): boolean {
  const capabilities = metadataTokens(model.capabilities);
  if (capabilities.some((item) => NON_TEXT_CAPABILITIES.has(item)) && !capabilities.some((item) => TEXT_CAPABILITIES.has(item))) return true;
  for (const key of ['output_modalities', 'outputModalities', 'modality', 'modalities']) {
    const tokens = metadataTokens(model[key]);
    if (tokens.some((item) => NON_TEXT_CAPABILITIES.has(item)) && !tokens.some((item) => TEXT_CAPABILITIES.has(item))) return true;
  }
  // These families expose embeddings, media generation or speech-specific APIs, rather than chat.
  return /(?:^|[./_-])(?:embedding|embeddings|embed|rerank|reranker|whisper|tts|dall-e|imagen|imagegen|stable-diffusion|flux|audio|realtime|transcribe|transcription)(?:[./_-]|$)/iu.test(id)
    || /^gpt-image(?:[./_-]|$)/iu.test(id);
}

function endpointModels(value: unknown, apiKey?: string): ModelOption[] {
  if (!record(value) || !Array.isArray(value.data)) throw new Error('Invalid model list');
  const models: ModelOption[] = [];
  const ids = new Set<string>();
  const now = Date.now();
  for (const item of value.data as unknown[]) {
    if (!record(item)) continue;
    let id: string;
    try { id = boundedString(item.id, 200, '模型 ID'); } catch { continue; }
    if (ids.has(id) || apiKey && id.includes(apiKey) || nonTextModel(item, id)) continue;
    ids.add(id);
    const candidateName = typeof item.name === 'string' ? item.name.trim() : undefined;
    const name = candidateName && candidateName.length <= 100 && !candidateName.includes('\0') && !(apiKey && candidateName.includes(apiKey)) ? candidateName : id;
    const rawWindow = item.context_window ?? item.contextWindow ?? item.context_length ?? item.max_context_length;
    let window: number | undefined;
    try { if (rawWindow !== undefined) window = contextWindow(rawWindow); } catch { /* Invalid endpoint metadata must not override a manual limit. */ }
    const reason = unavailableReason(item, now);
    models.push({ id, name, source: 'endpoint', availability: reason ? 'unavailable' : 'available', ...(reason ? { unavailableReason: reason } : {}), ...(window !== undefined ? { contextWindow: window } : {}), ...(typeof item.reasoning === 'boolean' ? { reasoning: item.reasoning } : {}) });
  }
  return models;
}

async function boundedResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) throw new Error('Invalid model response');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (signal.aborted) throw new Error('Model discovery cancelled');
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Model response too large');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8')) as unknown;
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
}

/** Discover only the given endpoint. Errors intentionally omit response bodies and credential details. */
export async function discoverCompatibleModels(url: string, apiKey?: string, fetcher: typeof fetch = fetch): Promise<ModelCatalog> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let response: Response | undefined;
  try {
    const target = `${baseUrl(url)}/models`;
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { controller.abort(); reject(new Error('Model discovery timed out')); }, DISCOVERY_TIMEOUT_MS);
    });
    const request = (async () => {
      response = await fetcher(target, { method: 'GET', headers: { accept: 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, redirect: 'error', signal: controller.signal });
      if (!response.ok || response.redirected || response.url && response.url !== target) throw new Error('Model request failed');
      return endpointModels(await boundedResponse(response, controller.signal), apiKey);
    })();
    return { models: await Promise.race([request, deadline]), fetched: true };
  } catch {
    controller.abort();
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
    return { models: [], fetched: false, warning: DISCOVERY_WARNING };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
