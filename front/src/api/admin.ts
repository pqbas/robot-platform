import type { User, Empresa, Fundo, FruitType } from "@/types"
import { apiFetch } from "./client"

// --- Users ---

export function getUsers() {
  return apiFetch<User[]>("/api/users/")
}

export function createUser(data: {
  username: string
  password: string
  role?: string
  empresa_uuid?: string | null
}) {
  return apiFetch<User>("/api/users/", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export function updateUser(
  id: number,
  data: { role?: string; empresa_uuid?: string | null; is_active?: boolean },
) {
  return apiFetch<User>(`/api/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

export function deleteUser(id: number) {
  return apiFetch<void>(`/api/users/${id}`, { method: "DELETE" })
}

// --- Empresas ---

export function getEmpresas() {
  return apiFetch<Empresa[]>("/api/empresas/")
}

export function createEmpresa(data: { name: string }) {
  return apiFetch<Empresa>("/api/empresas/", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export function updateEmpresa(
  uuid: string,
  data: { name?: string; is_active?: boolean },
) {
  return apiFetch<Empresa>(`/api/empresas/${uuid}`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

// --- Fundos ---

export function getFundos() {
  return apiFetch<Fundo[]>("/api/fundos/")
}

export function createFundo(data: {
  empresa_uuid: string
  name: string
  region?: string | null
  fruit_type_uuid?: string | null
}) {
  return apiFetch<Fundo>("/api/fundos/", {
    method: "POST",
    body: JSON.stringify(data),
  })
}

export function updateFundo(
  uuid: string,
  data: {
    name?: string
    region?: string | null
    fruit_type_uuid?: string | null
    is_active?: boolean
  },
) {
  return apiFetch<Fundo>(`/api/fundos/${uuid}`, {
    method: "PUT",
    body: JSON.stringify(data),
  })
}

// --- Fruit Types ---

export function getFruitTypes() {
  return apiFetch<FruitType[]>("/api/fruit-types")
}
