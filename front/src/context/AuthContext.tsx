import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { UserInfo } from "@/types"
import * as authApi from "@/api/auth"

type AuthState = {
  user: UserInfo | null
  isAuthenticated: boolean
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthState>({
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
  const [user, setUser] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(
    !!localStorage.getItem("auth_token"),
  )
  const didValidate = useRef(false)

  // On mount only, if token exists, validate it by fetching /me
  useEffect(() => {
    const token = localStorage.getItem("auth_token")
    if (!token || didValidate.current) {
      setLoading(false)
      return
    }
    didValidate.current = true
    authApi
      .getMe()
      .then((u) => {
        setUser(u)
        setLoading(false)
      })
      .catch(() => {
        localStorage.removeItem("auth_token")
        setUser(null)
        setLoading(false)
      })
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const res = await authApi.login(username, password)
    localStorage.setItem("auth_token", res.access_token)
    const me = await authApi.getMe()
    setUser(me)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem("auth_token")
    setUser(null)
    window.location.replace("/login")
  }, [])

  return (
    <AuthContext.Provider
      value={{
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
