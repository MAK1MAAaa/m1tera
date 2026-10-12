export interface SearchSource { title: string; url: string }
export interface HostedSearchEvent { id: string; status: 'started' | 'finished'; isError?: boolean }

export const HOSTED_SEARCH_TOOL = { type: 'web_search', search_context_size: 'low' } as const;

export function safeSearchSource(value: unknown): SearchSource | undefined {
  if (!value || typeof value !== 'object') return;
  const source = value as Record<string, unknown>;
  if (typeof source.url !== 'string' || source.url.length > 2048) return;
  try {
    const url = new URL(source.url);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return;
    return { title: typeof source.title === 'string' ? source.title.slice(0, 200) : url.hostname, url: url.href };
  } catch { return; }
}

/** Observe native search/citations without changing the bytes consumed by Pi's SSE parser. */
export function observeHostedSearchFetch(
  onSearch: (event: HostedSearchEvent) => void,
  onSource: (source: SearchSource) => void,
  fetcher: typeof globalThis.fetch = globalThis.fetch,
): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await fetcher(input, init);
    if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) return response;
    const decoder = new TextDecoder();
    let pending = '';
    let dropping = false;
    const started = new Set<string>();
    const finished = new Set<string>();
    const sources = new Set<string>();
    function citation(raw: unknown) {
      const source = safeSearchSource(raw);
      if (source && !sources.has(source.url) && sources.size < 12) { sources.add(source.url); onSource(source); }
    }
    function item(raw: unknown, done: boolean) {
      if (!raw || typeof raw !== 'object') return;
      const value = raw as Record<string, unknown>;
      if (value.type === 'web_search_call' && typeof value.id === 'string') {
        if (!started.has(value.id)) { started.add(value.id); onSearch({ id: value.id, status: 'started' }); }
        if (done && !finished.has(value.id)) { finished.add(value.id); onSearch({ id: value.id, status: 'finished', isError: value.status !== 'completed' }); }
        const action = value.action as Record<string, unknown> | undefined;
        if (Array.isArray(action?.sources)) action.sources.forEach(citation);
      }
      if (value.type === 'message' && Array.isArray(value.content)) {
        for (const part of value.content) if (part && typeof part === 'object' && Array.isArray(part.annotations)) {
          for (const annotation of part.annotations) if (annotation?.type === 'url_citation') citation(annotation.url_citation ?? annotation);
        }
      }
    }
    function frame(text: string) {
      const data = text.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
      if (!data || data === '[DONE]') return;
      let event: Record<string, unknown>;
      try { event = JSON.parse(data); } catch { return; }
      if (event.type === 'response.output_item.added') item(event.item, false);
      if (event.type === 'response.output_item.done') item(event.item, true);
      if (event.type === 'response.output_text.annotation.added') {
        const annotation = event.annotation as Record<string, unknown> | undefined;
        if (annotation?.type === 'url_citation') citation(annotation.url_citation ?? annotation);
      }
      if (event.type === 'response.completed' && event.response && typeof event.response === 'object') {
        const output = (event.response as Record<string, unknown>).output;
        if (Array.isArray(output)) output.forEach((value) => item(value, true));
      }
    }
    const observer = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        pending = (pending + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
        for (;;) {
          const boundary = pending.indexOf('\n\n');
          if (boundary < 0) break;
          const next = pending.slice(0, boundary);
          pending = pending.slice(boundary + 2);
          if (!dropping && next.length <= 1024 * 1024) frame(next);
          dropping = false;
        }
        if (pending.length > 1024 * 1024) { pending = ''; dropping = true; }
      },
      flush() { if (!dropping && pending.trim()) frame(pending + decoder.decode()); },
    });
    return new Response(response.body.pipeThrough(observer), { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
