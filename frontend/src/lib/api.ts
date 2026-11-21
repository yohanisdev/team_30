import type { ApiErrorDetail, AuthSession, ErrorCode, PageMeta } from '@marketplace/contracts';
import { authStore } from '../auth/auth-store';
import { API_BASE_URL } from '../config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly details: ApiErrorDetail[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Field-level messages keyed by field path, for wiring into forms. */
  fieldErrors(): Record<string, string> {
    const errors: Record<string, string> = {};
    for (const detail of this.details) {
      if (detail.field && !errors[detail.field]) errors[detail.field] = detail.message;
    }
    return errors;
  }
}

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  query?: Query;
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Attach the bearer token when signed in (default true). */
  auth?: boolean;
}

export interface Page<T> {
  items: T[];
  meta: PageMeta;
}

function buildUrl(path: string, query?: Query): string {
  const url = `${API_BASE_URL}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${url}?${search}` : url;
}

function send(path: string, options: RequestOptions, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  if (token && options.auth !== false) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (options.formData) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  return fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body,
    credentials: 'include',
    signal: options.signal,
  });
}

async function parse<T>(response: Response): Promise<{ data: T; meta: Record<string, unknown> }> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(response.status, 'INTERNAL', 'The server sent an unexpected response.');
  }
  const envelope = payload as {
    success?: boolean;
    data?: T;
    meta?: Record<string, unknown>;
    error?: { code: ErrorCode; message: string; details?: ApiErrorDetail[]; requestId?: string };
  };
  if (!response.ok || envelope.success !== true) {
    const error = envelope.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'INTERNAL',
      error?.message ?? `Request failed (${response.status}).`,
      error?.details ?? [],
      error?.requestId,
    );
  }
  return { data: envelope.data as T, meta: envelope.meta ?? {} };
}

/* ----------------------------------------------------------------------------
 * Session refresh: one request at a time per tab (shared promise) and across tabs
 * (Web Locks), so two refreshes never present the same rotating cookie.
 * ------------------------------------------------------------------------- */

let refreshInFlight: Promise<AuthSession | null> | null = null;

async function performRefresh(): Promise<AuthSession | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      // Only a rejected session signs the user out; rate limits and outages keep it.
      if (response.status === 401 || response.status === 403) authStore.clear();
      return null;
    }
    const { data } = await parse<AuthSession>(response);
    authStore.setSession(data);
    return data;
  } catch {
    // Offline or server down: keep whatever session we have; the next call will retry.
    return null;
  }
}

export function refreshSession(): Promise<AuthSession | null> {
  refreshInFlight ??= (
    typeof navigator !== 'undefined' && navigator.locks
      ? navigator.locks.request('marketplace-auth-refresh', performRefresh)
      : performRefresh()
  ).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function request<T>(path: string, options: RequestOptions = {}) {
  const token = authStore.getToken();
  let response: Response;
  try {
    response = await send(path, options, token);
    // An expired access token is renewed once, silently, then the call is replayed.
    if (response.status === 401 && token && options.auth !== false && !path.startsWith('/auth/')) {
      const session = await refreshSession();
      if (session) response = await send(path, options, session.accessToken);
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(0, 'NETWORK_ERROR', 'Cannot reach the server. Check your connection and try again.');
  }
  return parse<T>(response);
}

export const api = {
  get: async <T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> =>
    (await request<T>(path, { query, signal })).data,

  page: async <T>(path: string, query?: Query, signal?: AbortSignal): Promise<Page<T>> => {
    const { data, meta } = await request<T[]>(path, { query, signal });
    return { items: data, meta: meta as unknown as PageMeta };
  },

  post: async <T>(
    path: string,
    body?: unknown,
    options: { auth?: boolean; headers?: Record<string, string> } = {},
  ): Promise<T> => (await request<T>(path, { method: 'POST', body: body ?? {}, ...options })).data,

  patch: async <T>(path: string, body: unknown): Promise<T> =>
    (await request<T>(path, { method: 'PATCH', body })).data,

  delete: async <T>(path: string): Promise<T> => (await request<T>(path, { method: 'DELETE' })).data,

  upload: async <T>(path: string, file: File, field = 'image'): Promise<T> => {
    const formData = new FormData();
    formData.append(field, file);
    return (await request<T>(path, { method: 'POST', formData })).data;
  },
};

/** A user-facing message for any thrown value. */
export function errorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
