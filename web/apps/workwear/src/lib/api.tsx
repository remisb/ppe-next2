import { type Client, createClient } from '@ppe/api-client'
import { type ReactNode, createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'

import { type Session, clearSession, loadSession, sessionFromToken, storeSession } from './session'

interface ApiContext {
  client: Client
  session: Session | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => void
}

const Ctx = createContext<ApiContext | null>(null)

export function ApiProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession)
  // The client reads the token through a ref so it never needs rebuilding.
  const sessionRef = useRef(session)
  sessionRef.current = session

  const signOut = useCallback(() => {
    clearSession()
    setSession(null)
  }, [])

  const client = useMemo(
    () =>
      createClient({
        getToken: () => sessionRef.current?.token ?? null,
        onUnauthenticated: () => {
          clearSession()
          setSession(null)
        },
      }),
    [],
  )

  const signIn = useCallback(
    async (email: string, password: string) => {
      const res = await client.login(email, password)
      const s = sessionFromToken(res.access_token, res.user.name)
      if (!s) throw new Error('The server returned an unusable token.')
      storeSession(s)
      setSession(s)
    },
    [client],
  )

  const value = useMemo(() => ({ client, session, signIn, signOut }), [client, session, signIn, signOut])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApi(): ApiContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApi outside ApiProvider')
  return ctx
}

/** The signed-in session; only call below the sign-in gate. */
export function useSession(): Session {
  const { session } = useApi()
  if (!session) throw new Error('useSession without a session')
  return session
}
