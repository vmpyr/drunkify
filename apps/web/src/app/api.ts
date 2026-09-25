export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function appUrl(path: string): string {
  return `${basePath}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined) headers.set('content-type', 'application/json');
  if (init?.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method.toUpperCase())) {
    headers.set('x-requested-with', 'drunkify');
  }
  const response = await fetch(appUrl(path), {
    credentials: 'include',
    ...init,
    headers,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: { code?: string; message?: string } & Record<string, unknown>;
    } | null;
    throw new ApiError(
      body?.error?.message ?? `Request failed (${response.status})`,
      response.status,
      body?.error?.code,
      body?.error ?? {},
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
