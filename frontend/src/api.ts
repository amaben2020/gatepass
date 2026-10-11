// Every call to the backend goes through here, so the "Under the hood" panel can show it.

export type LogEntry = {
  id: number;
  at: Date;
  method: string;
  path: string;
  status: number | 'ERR';
  ms: number;
  poll: boolean; // repeated background requests (waiting room, seat map): hidden by default
  request?: unknown;
  response?: unknown;
};

let entries: LogEntry[] = [];
let nextId = 1;
const listeners = new Set<(entries: LogEntry[]) => void>();

export function subscribeLog(listener: (entries: LogEntry[]) => void) {
  listeners.add(listener);
  listener(entries);
  return () => void listeners.delete(listener);
}

export function clearLog() {
  entries = [];
  listeners.forEach((l) => l(entries));
}

function record(entry: Omit<LogEntry, 'id' | 'at'>) {
  entries = [{ ...entry, id: nextId++, at: new Date() }, ...entries].slice(0, 200);
  listeners.forEach((l) => l(entries));
}

// The backend's 4xx bodies are { error, code }. `code` is what the UI switches on; `message` is what it shows.
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string | undefined,
    message: string,
  ) {
    super(message);
  }
}

type Options = { poll?: boolean; silent?: boolean };

export async function api<T>(method: string, path: string, body?: unknown, options: Options = {}): Promise<T> {
  const started = performance.now();
  let status: number | 'ERR' = 'ERR';
  let data: unknown;
  try {
    const res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    status = res.status;
    data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const err = data as { error?: string; code?: string } | null;
      throw new ApiError(res.status, err?.code, err?.error ?? res.statusText);
    }
    return data as T;
  } catch (err) {
    if (!(err instanceof ApiError)) data = { error: 'Network error: is the backend running on :4000?' };
    throw err;
  } finally {
    if (!options.silent) {
      record({ method, path, status, ms: Math.round(performance.now() - started), poll: !!options.poll, request: body, response: data });
    }
  }
}
