export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  base: string,
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", "Bearer " + token);
  const response = await fetch(base.replace(/\/$/, "") + path, {
    ...options,
    headers,
    credentials: "omit",
  });
  const data = await response
    .json()
    .catch(() => ({ message: "The server returned an unexpected response." }));
  if (!response.ok) {
    const validation = data.errors
      ? Object.values(data.errors).flat().join(" ")
      : "";
    throw new ApiError(
      validation || data.message || "Request failed.",
      response.status,
    );
  }
  return data as T;
}
export const json = (value: unknown) => JSON.stringify(value);
export function readStored<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
  } catch {
    return fallback;
  }
}
export function store(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
