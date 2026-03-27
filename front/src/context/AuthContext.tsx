import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import type { UserInfo } from "@/types"
import * as authApi from "@/api/auth"

type AuthState = {
  token: string | null
  user: UserInfo | null
  isAuthenticated: boolean
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState>({
  token: null,
  user: null,
  isAuthenticated: false,
  loading: true,
  login: async () => {},
  logout: () => {},
})

export function useAuth() {
  return useContext(AuthContext)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("auth_token"),
  )
  const [user, setUser] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(!!localStorage.getItem("auth_token"))

  // On mount, if token exists, validate it by fetching /me
  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    authApi
      .getMe()
      .then((u) => {
        setUser(u)
        setLoading(false)
      })
      .catch(() => {
        // Token invalid/expired — clear silently
        localStorage.removeItem("auth_token")
        setToken(null)
        setUser(null)
        setLoading(false)
      })
  }, [token])

  const login = useCallback(async (username: string, password: string) => {
    const res = await authApi.login(username, password)
    localStorage.setItem("auth_token", res.access_token)
    setToken(res.access_token)
    const me = await authApi.getMe()
    setUser(me)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem("auth_token")
    setToken(null)
    setUser(null)
    window.location.replace("/login")
  }, [])

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        isAuthenticated: !!user,
        loading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
