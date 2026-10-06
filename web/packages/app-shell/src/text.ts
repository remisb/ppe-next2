import { localized } from '@ppe/i18n'

/** The words of sign-in, the sign-in gate and password checks, in each language. */
const en = {
  signIn: 'Sign in',
  signInHint: 'Use your work email and password.',
  signingIn: 'Signing in…',
  email: 'Email',
  password: 'Password',
  wrongPassword: 'Wrong email or password.',
  enterEmailAndPassword: 'Enter your email and password.',
  tooManyAttempts: 'Too many sign-in attempts. Wait a few minutes, then try again.',
  keepSignedIn: 'Keep me signed in',
  keepSignedInHint: 'Stay signed in on this device. Untick it on a shared computer.',
  checkingSignIn: 'Checking your sign-in…',
  offlineTitle: 'The server cannot be reached',
  offlineHint: 'Check your connection. The app tries again when you are back online.',
  confirmPasswordTitle: 'Confirm your password',
  confirmPasswordHint: 'You signed in a while ago. Enter your password to continue.',
  confirmPasswordButton: 'Continue',
  confirmingPassword: 'Checking…',
  passwordIncorrect: 'The password is incorrect.',
  cancel: 'Cancel',
  useAtLeast: (n: number) => `Use at least ${n} characters.`,
  tooLong: 'That password is too long.',
  enterCurrent: 'Enter your current password.',
  chooseDifferent: 'Choose a password different from the current one.',
  noMatch: 'The passwords do not match.',
}

export type ShellText = typeof en

const lt: ShellText = {
  signIn: 'Prisijungti',
  signInHint: 'Naudokite darbo el. paštą ir slaptažodį.',
  signingIn: 'Jungiamasi…',
  email: 'El. paštas',
  password: 'Slaptažodis',
  wrongPassword: 'Neteisingas el. pašto adresas arba slaptažodis.',
  enterEmailAndPassword: 'Įveskite el. pašto adresą ir slaptažodį.',
  tooManyAttempts: 'Per daug bandymų prisijungti. Palaukite kelias minutes ir bandykite dar kartą.',
  keepSignedIn: 'Likti prisijungus',
  keepSignedInHint: 'Šiame įrenginyje liksite prisijungę. Bendrame kompiuteryje varnelę nuimkite.',
  checkingSignIn: 'Tikrinamas prisijungimas…',
  offlineTitle: 'Nepavyksta pasiekti serverio',
  offlineHint: 'Patikrinkite ryšį. Programa bandys dar kartą, kai ryšys atsiras.',
  confirmPasswordTitle: 'Patvirtinkite slaptažodį',
  confirmPasswordHint: 'Prisijungėte seniai. Kad tęstumėte, įveskite slaptažodį.',
  confirmPasswordButton: 'Tęsti',
  confirmingPassword: 'Tikrinama…',
  passwordIncorrect: 'Slaptažodis neteisingas.',
  cancel: 'Atšaukti',
  useAtLeast: (n: number) => `Naudokite ne mažiau kaip ${n} simbolių.`,
  tooLong: 'Slaptažodis per ilgas.',
  enterCurrent: 'Įveskite dabartinį slaptažodį.',
  chooseDifferent: 'Pasirinkite kitokį slaptažodį nei dabartinis.',
  noMatch: 'Slaptažodžiai nesutampa.',
}

const ru: ShellText = {
  signIn: 'Войти',
  signInHint: 'Используйте рабочую эл. почту и пароль.',
  signingIn: 'Вход…',
  email: 'Эл. почта',
  password: 'Пароль',
  wrongPassword: 'Неверный адрес эл. почты или пароль.',
  enterEmailAndPassword: 'Введите адрес эл. почты и пароль.',
  tooManyAttempts: 'Слишком много попыток входа. Подождите несколько минут и попробуйте снова.',
  keepSignedIn: 'Оставаться в системе',
  keepSignedInHint: 'Вход сохранится на этом устройстве. На общем компьютере снимите отметку.',
  checkingSignIn: 'Проверка входа…',
  offlineTitle: 'Сервер недоступен',
  offlineHint: 'Проверьте подключение. Приложение попробует снова, когда связь восстановится.',
  confirmPasswordTitle: 'Подтвердите пароль',
  confirmPasswordHint: 'Вы вошли давно. Чтобы продолжить, введите пароль.',
  confirmPasswordButton: 'Продолжить',
  confirmingPassword: 'Проверка…',
  passwordIncorrect: 'Неверный пароль.',
  cancel: 'Отмена',
  useAtLeast: (n: number) => `Используйте не менее ${n} символов.`,
  tooLong: 'Пароль слишком длинный.',
  enterCurrent: 'Введите текущий пароль.',
  chooseDifferent: 'Выберите пароль, отличный от текущего.',
  noMatch: 'Пароли не совпадают.',
}

export const dictionaries = { en, lt, ru }

/** The shell's words in the language in use; read when drawing, never at module level. */
export const shellText = localized(dictionaries)
