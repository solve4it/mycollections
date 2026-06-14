import type { Collection } from "@mycollections/core";

const BASE_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(`API error ${status}`);
  }
}

export class UnauthorizedError extends ApiError {
  constructor() {
    super(401);
  }
}

export function getToken(): string | null {
  return localStorage.getItem("api_token");
}

export function setToken(token: string): void {
  localStorage.setItem("api_token", token.trim());
}

export function clearToken(): void {
  localStorage.removeItem("api_token");
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
  if (res.status === 401) throw new UnauthorizedError();
  return res;
}

export async function listCollections(): Promise<Collection[]> {
  const res = await request("/api/collections");
  if (!res.ok) throw new ApiError(res.status);
  return res.json() as Promise<Collection[]>;
}
