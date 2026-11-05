/**
 * What the check digits can and cannot catch (docs-import plan, phase 1):
 * made-up TD3 second lines misread at random, character by character
 * (look-alikes swapped at one rate, any other character at another), then
 * parsed by @ppe/mrz. Counts the reads accepted with a checked value wrong
 * (document number, dates, personal number and their digits; names,
 * nationality and sex have none), with one read and with two independent
 * reads that must agree (the live two-frame rule). Seeded, so the figures in
 * the plan come back the same.
 *
 *   node --experimental-strip-types scripts/simulate.ts [lines per row, 40000]
 */
import { checkDigitOf, parseMrz, type Mrz } from '@ppe/mrz'

const n = Number(process.argv[2] ?? 40000)
const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const D = '0123456789'
let seed = 11
const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647
const pick = (s: string) => s[Math.floor(rnd() * s.length)]!
const LOOK: Record<string, string> = { O: '0', '0': 'O', I: '1', '1': 'I', B: '8', '8': 'B', S: '5', '5': 'S', Z: '2', '2': 'Z' }

function line2(): string {
  const num = pick(A) + pick(A) + Array.from({ length: 7 }, () => pick(D)).join('')
  const birth = `${String(Math.floor(rnd() * 100)).padStart(2, '0')}0${1 + Math.floor(rnd() * 9)}1${Math.floor(rnd() * 9)}`
  const exp = `3${Math.floor(rnd() * 5)}0${1 + Math.floor(rnd() * 9)}2${Math.floor(rnd() * 8)}`
  const a = num + checkDigitOf(num) + 'UTO' + birth + checkDigitOf(birth) + 'F' + exp + checkDigitOf(exp) + '<<<<<<<<<<<<<<<'
  return a + checkDigitOf(a.slice(0, 10) + a.slice(13, 20) + a.slice(21, 43))
}

const checked = (l: string) => l.slice(0, 10) + l.slice(13, 20) + l.slice(21, 44)
const line1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<'
// Misreads only where a check digit could see them, so every wrong value counted is a checked one.
const places = new Set([...Array(44).keys()].filter((i) => !(i >= 10 && i < 13) && i !== 20))
const misread = (t: string, look: number, other: number) =>
  [...t].map((c, j) => (!places.has(j) ? c : LOOK[c] && rnd() < look ? LOOK[c] : rnd() < other ? pick(A + D) : c)).join('')
const read = (l: string) => parseMrz([line1, l], { today: '2026-11-05' })!

console.log('| Look-alike rate | Other rate | One read: right | One read: wrong | Two agreeing: right | Two agreeing: wrong |')
console.log('| --- | --- | --- | --- | --- | --- |')
for (const [look, other] of [
  [0.02, 0],
  [0.02, 0.005],
  [0.05, 0.01],
  [0.05, 0.02],
] as const) {
  const one = [0, 0]
  const two = [0, 0]
  for (let i = 0; i < n; i++) {
    const t = line2()
    const a = read(misread(t, look, other))
    const b = read(misread(t, look, other))
    const score = (acc: number[], m: Mrz | undefined) => {
      if (m) acc[checked(m.lines[1]!) === checked(t) ? 0 : 1]! += 1
    }
    score(one, a.valid ? a : undefined)
    score(two, a.valid && b.valid && a.lines[1] === b.lines[1] ? a : undefined)
  }
  const p = (x: number) => `${((100 * x) / n).toFixed(2)} %`
  console.log(`| ${look} | ${other} | ${p(one[0]!)} | ${p(one[1]!)} | ${p(two[0]!)} | ${p(two[1]!)} |`)
}
