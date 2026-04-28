export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";
// JWT хранится локально только для demo UI, чтобы пользователь не вводил логин после перезагрузки страницы.
const TOKEN_KEY = "wishlist_demo_access_token";

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
};

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function buildWsUrl(path: string, query: Record<string, string>): string {
  // WebSocket использует тот же gateway, только схема http/https заменяется на ws/wss.
  const base = API_BASE_URL.replace(/^http/i, "ws").replace(/\/$/, "");
  const url = new URL(`${base}${path}`);
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  return url.toString();
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // Общая обертка над fetch добавляет JSON headers, JWT и нормальную ошибку для UI.
  const url = `${API_BASE_URL.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };

  if (options.auth !== false) {
    // Для публичных endpoints можно передать auth: false, тогда Authorization header не отправляется.
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined
  });

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json().catch(() => null) : await response.text().catch(() => "");

  if (!response.ok) {
    // Backend обычно возвращает { error }, но fallback оставлен для любых HTTP-ошибок.
    const serverError = typeof payload === "object" && payload && "error" in payload
      ? String((payload as { error?: unknown }).error ?? "")
      : "";
    const message = serverError || `Request failed: ${response.status} ${response.statusText}`;
    throw new ApiError(message, response.status, payload);
  }

  return payload as T;
}
