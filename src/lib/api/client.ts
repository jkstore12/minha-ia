type ApiErrorPayload = {
  error?: string;
  message?: string;
};

async function readApiError(response: Response) {
  const payload = (await response.json().catch(() => null)) as ApiErrorPayload | null;
  return payload?.error || payload?.message || `Falha na operação (${response.status}).`;
}

export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });

  if (!response.ok) {
    throw new Error(await readApiError(response));
  }

  return (await response.json().catch(() => ({}))) as T;
}
