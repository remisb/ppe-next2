import type { Messages } from '../index'

const shell: Messages['shell'] = {
  appName: '__NAME_LT__',
  signInTagline: 'Sistemos „Darbo drabužiai ir įranga“ dalis.',
  mainNav: 'Pagrindinis',
  home: 'Pradžia',
}

const home: Messages['home'] = {
  empty: 'Čia dar nieko nėra.',
}

export const lt = { shell, home }
