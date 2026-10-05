import type { AppData, Phase, WeightEntry } from './types';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const contentType = response.headers.get('content-type') ?? '';
  const body = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = new Error(typeof body === 'object' && body?.error ? body.error : 'Request failed') as Error & {
      status?: number;
      code?: string;
      body?: unknown;
    };
    error.status = response.status;
    if (typeof body === 'object' && body) {
      error.code = body.code;
      error.body = body;
    }
    throw error;
  }
  return body as T;
}

export function getData() {
  return request<AppData>('/api/data');
}

export function login(password: string) {
  return request<{ ok: boolean }>('/api/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
}

export function logout() {
  return request<{ ok: boolean }>('/api/logout', { method: 'POST', body: '{}' });
}

export function setPhase(phase: Phase, startedOn: string) {
  return request('/api/settings/phase', {
    method: 'PUT',
    body: JSON.stringify({ phase, startedOn }),
  });
}

export function addEntry(payload: { date: string; weight: number; notes: string }) {
  return request<{ entry: WeightEntry }>('/api/entries', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateEntry(originalDate: string, payload: { date: string; weight: number; phase: Phase | null; notes: string | null }) {
  return request<{ entry: WeightEntry }>(`/api/entries/${originalDate}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
}

export function deleteEntry(date: string) {
  return request<{ ok: boolean }>(`/api/entries/${date}`, {
    method: 'DELETE',
    body: '{}',
  });
}

export function importEntries(entries: Array<{ date: string; weight: number; phase?: Phase | null; notes?: string | null }>) {
  return request<{ imported: number; updated: number }>('/api/import', {
    method: 'POST',
    body: JSON.stringify({ entries }),
  });
}
