// Minimal fetch mock for Anthropic Messages API tests.
//
// Usage:
//   const mock = installFetchMock();
//   mock.queueResponse({ status: 200, body: { content: [...] } });
//   // ... call code under test ...
//   expect(mock.requests).toHaveLength(1);

import { vi } from "vitest";

export interface QueuedResponse {
  status?: number;
  body?: unknown;
  /** If set, fetch rejects with this error instead of resolving. */
  throwError?: Error;
}

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface FetchMock {
  fetch: ReturnType<typeof vi.fn>;
  queueResponse: (response: QueuedResponse) => void;
  requests: RecordedRequest[];
}

export function installFetchMock(): FetchMock {
  const queue: QueuedResponse[] = [];
  const requests: RecordedRequest[] = [];

  const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    if (init?.headers) {
      for (const [k, v] of Object.entries(init.headers)) {
        headers[k.toLowerCase()] = String(v);
      }
    }

    let parsedBody: unknown = init?.body;
    if (typeof init?.body === "string") {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        // leave as raw string
      }
    }

    requests.push({
      url: typeof url === "string" ? url : url.toString(),
      method: init?.method ?? "GET",
      headers,
      body: parsedBody,
    });

    const next = queue.shift();
    if (!next) {
      throw new Error("fetch-mock: no queued response");
    }
    if (next.throwError) {
      throw next.throwError;
    }

    const status = next.status ?? 200;
    const bodyText =
      next.body === undefined ? "" : JSON.stringify(next.body);

    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => (next.body === undefined ? null : next.body),
      text: async () => bodyText,
    } as unknown as Response;
  });

  vi.stubGlobal("fetch", fetchFn);

  return {
    fetch: fetchFn,
    queueResponse: (response) => queue.push(response),
    requests,
  };
}
