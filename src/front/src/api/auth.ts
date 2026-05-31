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
