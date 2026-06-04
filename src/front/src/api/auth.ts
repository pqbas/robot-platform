import type { UserInfo } from "@/types"
import { apiFetch } from "./client"

type LoginResponse = {
  access_token: string
  token_type: string
  role: string
}

export async function login(
  username: string,
  password: string,
): Promise<LoginResponse> {
  return apiFetch<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  })
}

export async function getMe(): Promise<UserInfo> {
  return apiFetch<UserInfo>("/api/auth/me")
}

export async function logout(): Promise<void> {
  // Clears the httpOnly auth cookie server-side (the SPA can't delete it from
  // JS). Best-effort: callers still drop the localStorage token regardless.
  await apiFetch("/api/auth/logout", { method: "POST" })
}
