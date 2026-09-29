import { type Client, createClient } from '@ppe/api-client'
import { Fragment, type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { type Lang, deviceLanguage, isLang, rememberDeviceLanguage, setLanguage } from '@/i18n'

import { type Session, clearSession, loadSession, sessionFromToken, storeSession } from './session'
import { clearDraft } from './working-order'

interface ApiContext {
  client: Client
  session: Session | null
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => void
  /** Saves the signed-in user's interface language on their account and switches to it. */
  setUserLanguage: (lang: Lang) => Promise<void>
}

const Ctx = createContext<ApiContext | null>(null)

export function ApiProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession)
  // The client reads the token through a ref so it never needs rebuilding.
  const sessionRef = useRef(session)
  sessionRef.current = session

  // Sign out also drops the user's Create Order draft from this device. An
  // expired session (onUnauthenticated below) keeps it for their next sign-in.
  const signOut = useCallback(() => {
    if (sessionRef.current) clearDraft(sessionRef.current.userId)
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
      const s = sessionFromToken(res.access_token, res.user.name, isLang(res.user.language) ? res.user.language : 'en')
      if (!s) throw new Error('The server returned an unusable token.')
      rememberDeviceLanguage(s.language)
      storeSession(s)
      setSession(s)
    },
    [client],
  )

  const applyLanguage = useCallback((lang: Lang) => {
    const cur = sessionRef.current
    if (!cur || cur.language === lang) return
    const next = { ...cur, language: lang }
    rememberDeviceLanguage(lang)
    storeSession(next)
    setSession(next)
  }, [])

  const setUserLanguage = useCallback(
    async (lang: Lang) => {
      const u = await client.setOwnLanguage(lang)
      if (isLang(u.language)) applyLanguage(u.language)
    },
    [client, applyLanguage],
  )

  // The language may have changed on another device since this session began.
  const userId = session?.userId
  useEffect(() => {
    if (!userId) return
    client.me().then(
      (u) => isLang(u.language) && applyLanguage(u.language),
      () => {},
    )
  }, [client, userId, applyLanguage])

  // The whole app remounts when the language changes, so nothing keeps text,
  // dates or amounts in the old one. Before sign-in, the device's language.
  const lang = session?.language ?? deviceLanguage()
  setLanguage(lang)

  const value = useMemo(() => ({ client, session, signIn, signOut, setUserLanguage }), [client, session, signIn, signOut, setUserLanguage])
  return (
    <Ctx.Provider value={value}>
      <Fragment key={lang}>{children}</Fragment>
    </Ctx.Provider>
  )
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
