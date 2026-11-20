declare global {
  interface Window {
    Telegram?: { WebApp?: { initData?: string; ready(): void; expand(): void } };
  }
}

export const OFFLINE = "Зв’язок перервано. Перевірте підключення.";

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export async function request<T>(path: string, payload?: object): Promise<T> {
  const initData = window.Telegram?.WebApp?.initData;
  const headers = new Headers();
  if (initData) headers.set("Authorization", "tma " + initData);
  if (payload) headers.set("Content-Type", "application/json");
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(path, {
      method: payload ? "POST" : "GET",
      headers,
      body: payload ? JSON.stringify(payload) : undefined,
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      throw new ApiError(body?.error ?? "Не вдалося зв’язатися з Betbook.", response.status);
    }
    return await response.json();
  } finally {
    window.clearTimeout(timeout);
  }
}
