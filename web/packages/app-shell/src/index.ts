/**
 * What every staff app on this origin shares: the sign-in (one HttpOnly
 * refresh cookie, the access token in memory), the session and its
 * permissions, Sign in and Confirm your password, theme and density, password
 * rules, and the address router.
 */
export { ApiProvider, type ApiProviderProps, type PasswordPrompt, useApi, useSession } from './api.tsx'
export { ConfirmPassword } from './confirm-password.tsx'
export { type Density, applyDensity, loadDensity, saveDensity, useDensity } from './density.ts'
export { CheckingSignIn, Offline } from './gate.tsx'
export {
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  type PasswordChange,
  type PasswordErrors,
  passwordProblem,
  validatePasswordChange,
} from './password.ts'
export { type Addresses, type NavigateOptions, type Router, canGoBack, linkWith, useAddressRouter } from './router.ts'
export { ADMINISTRATION_PERMISSIONS, type Session, canAdminister, keepSignedInChoice, refreshDue, sessionFromToken } from './session.ts'
export { SignIn } from './sign-in.tsx'
export { type Theme, applyTheme, loadTheme, saveTheme, themes, useTheme } from './theme.ts'
