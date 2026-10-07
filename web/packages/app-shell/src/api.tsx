import { ApiError, type AppName, type Client, type LoginResponse, NetworkError, createClient } from '@ppe/api-client'
import { type Lang, deviceLanguage, isLang, rememberDeviceLanguage } from '@ppe/i18n'
import { Fragment, type ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { reportErrors } from './error-reporter.ts'
import { type Session, clearLegacyToken, refreshDue, rememberKeepSignedIn, sessionFromToken, withRefreshLock } from './session.ts'

/** Asked of the user when an action needs their password again (a recent sign-in). */
export interface PasswordPrompt {
  /** Confirms the password; rejects (400) when it is wrong, for the dialog to say so. */
  confirm: (password: string) => Promise<void>
  cancel: () => void
}

interface ApiContext {
  client: Client
  session: Session | null
  /**
   * starting: asking the server whether this browser is signed in (its
   * refresh cookie); offline: the server could not be reached to ask; ready:
   * the answer is session.
   */
  status: 'starting' | 'offline' | 'ready'
  /** Asks again after offline. */
  retry: () => void
  signIn: (email: string, password: string, keepSignedIn: boolean) => Promise<void>
  signOut: () => Promise<void>
  /** Saves the signed-in user's interface language on their account and switches to it. */
  setUserLanguage: (lang: Lang) => Promise<void>
  /** Set while an action waits for the password to be confirmed. */
  passwordPrompt: PasswordPrompt | null
}

const Ctx = createContext<ApiContext | null>(null)

type Refreshed = 'signedIn' | 'signedOut' | 'offline'

/**
 * Tells this browser's other tabs that it signed out, so they do too at once:
 * every app's, since the apps on this origin share one sign-in.
 */
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('workwear.session')

export interface ApiProviderProps {
  children: ReactNode
  /** Which app this is, sent with every request so the Audit log can say where a change was made. */
  app: AppName
  /** The app's language switch, which swaps its own words (its `t`) as well as the shared ones. */
  setLanguage: (lang: Lang) => void
  /** Run when the user signs out here, before the session is dropped: the app clears what it keeps per user on this device. */
  onSignOut?: (userId: string) => void
}

export function ApiProvider({ children, app, setLanguage, onSignOut }: ApiProviderProps) {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<ApiContext['status']>('starting')
  // The client reads the token through a ref so it never needs rebuilding.
  const sessionRef = useRef(session)
  sessionRef.current = session

  /** Takes a sign-in or refresh answer as the session; the language stays the one in use for the same user. */
  const apply = useCallback((res: LoginResponse): Session => {
    const cur = sessionRef.current
    const lang = cur && cur.userId === res.user.id ? cur.language : isLang(res.user.language) ? res.user.language : 'en'
    const next = sessionFromToken(res.access_token, res.user.name, lang)
    if (!next) throw new Error('The server returned an unusable token.')
    // At once, so a request sent again after renewing reads the new token.
    sessionRef.current = next
    setSession(next)
    return next
  }, [])

  // An expired sign-in keeps what the app holds for the user (onSignOut is not run).
  const drop = useCallback(() => {
    sessionRef.current = null
    setSession(null)
  }, [])

  // One refresh at a time in this tab; withRefreshLock makes tabs take turns.
  const refreshing = useRef<Promise<Refreshed> | null>(null)
  const clientRef = useRef<Client | null>(null)
  const refresh = useCallback((): Promise<Refreshed> => {
    refreshing.current ??= withRefreshLock(() => clientRef.current!.refresh())
      .then(
        (res): Refreshed => {
          apply(res)
          return 'signedIn'
        },
        (err: unknown): Refreshed => {
          if (err instanceof NetworkError) return 'offline'
          if (err instanceof ApiError && err.status === 401) drop()
          return 'signedOut'
        },
      )
      .finally(() => {
        refreshing.current = null
      })
    return refreshing.current
  }, [apply, drop])

  const [prompt, setPrompt] = useState<{ resolve: (ok: boolean) => void } | null>(null)
  const promptPromise = useRef<Promise<boolean> | null>(null)

  const client = useMemo(() => {
    const c = createClient({
      app,
      getToken: () => sessionRef.current?.token ?? null,
      renew: () => refresh().then((r) => r === 'signedIn'),
      onUnauthenticated: drop,
      // Several requests refused at once share one prompt.
      confirmPassword: () => {
        promptPromise.current ??= new Promise<boolean>((resolve) => setPrompt({ resolve })).finally(() => {
          promptPromise.current = null
        })
        return promptPromise.current
      },
    })
    clientRef.current = c
    return c
  }, [app, refresh, drop])

  const start = useCallback(() => {
    setStatus('starting')
    void refresh().then((r) => setStatus(r === 'offline' ? 'offline' : 'ready'))
  }, [refresh])

  useEffect(() => {
    clearLegacyToken()
    start()
  }, [start])

  // While someone is signed in, the page's uncaught errors go to System's error list.
  const signedIn = session !== null
  useEffect(() => (signedIn ? reportErrors((r) => client.reportError(r)) : undefined), [signedIn, client])

  // Offline at start-up: ask again once the device is back online.
  useEffect(() => {
    if (status !== 'offline') return
    window.addEventListener('online', start)
    return () => window.removeEventListener('online', start)
  }, [status, start])

  useEffect(() => {
    if (!channel) return
    const onMessage = (e: MessageEvent) => e.data === 'signed-out' && drop()
    channel.addEventListener('message', onMessage)
    return () => channel.removeEventListener('message', onMessage)
  }, [drop])

  const signIn = useCallback(
    async (email: string, password: string, keepSignedIn: boolean) => {
      const res = await client.login(email, password, keepSignedIn)
      sessionRef.current = null
      const s = apply(res)
      rememberDeviceLanguage(s.language)
      rememberKeepSignedIn(keepSignedIn)
      setStatus('ready')
    },
    [client, apply],
  )

  // Sign out ends this browser's sign-in on the server (and its cookie), and
  // lets the app drop what it keeps for the user on this device (onSignOut).
  const signOut = useCallback(async () => {
    const cur = sessionRef.current
    if (cur) onSignOut?.(cur.userId)
    await client.logout().catch(() => {})
    channel?.postMessage('signed-out')
    drop()
  }, [client, drop, onSignOut])

  const applyLanguage = useCallback((lang: Lang) => {
    const cur = sessionRef.current
    if (!cur || cur.language === lang) return
    const next = { ...cur, language: lang }
    rememberDeviceLanguage(lang)
    sessionRef.current = next
    setSession(next)
  }, [])

  const setUserLanguage = useCallback(
    async (lang: Lang) => {
      const u = await client.setOwnLanguage(lang)
      if (isLang(u.language)) applyLanguage(u.language)
    },
    [client, applyLanguage],
  )

  // Keeps the access token fresh while the app is open: one past a third of
  // its life is swapped for a new one (about every 5 minutes for the 15-minute
  // token). Checked each minute, when the tab is shown again and when the
  // device is back online. A refused refresh (signed out elsewhere, the
  // account deactivated, the sign-in past its limits) signs out; a network
  // error waits for the next check. A request refused in between renews too
  // (the client's renew).
  const userId = session?.userId
  useEffect(() => {
    if (!userId) return
    const check = () => {
      const cur = sessionRef.current
      if (cur && refreshDue(cur.token)) void refresh()
    }
    check()
    const timer = window.setInterval(check, 60_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', check)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', check)
    }
  }, [userId, refresh])

  const passwordPrompt = useMemo<PasswordPrompt | null>(
    () =>
      prompt && {
        confirm: async (password: string) => {
          apply(await client.reauthenticate(password))
          setPrompt(null)
          prompt.resolve(true)
        },
        cancel: () => {
          setPrompt(null)
          prompt.resolve(false)
        },
      },
    [prompt, client, apply],
  )

  // The whole app remounts when the language changes, so nothing keeps text,
  // dates or amounts in the old one. Before sign-in, the device's language.
  const lang = session?.language ?? deviceLanguage()
  setLanguage(lang)

  const value = useMemo(
    () => ({ client, session, status, retry: start, signIn, signOut, setUserLanguage, passwordPrompt }),
    [client, session, status, start, signIn, signOut, setUserLanguage, passwordPrompt],
  )
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
