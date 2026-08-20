export const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// URLSearchParams encodes every value, so this is safe even if a filter
// value contains characters that would otherwise need manual escaping.
export async function apiGet<T>(
  path: string,
  params: Record<string, string | undefined>
): Promise<T> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, value);
  }
  const query = search.toString();

  const res = await fetch(`${BASE_URL}${path}${query ? `?${query}` : ""}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? `request failed with status ${res.status}`);
  }
  return res.json() as Promise<T>;
}
