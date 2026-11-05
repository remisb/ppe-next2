/**
 * The codes an MRZ's issuing state and nationality may hold: ISO 3166-1
 * alpha-3 (249 codes, from the ISO list) and ICAO Doc 9303 Part 3's own
 * additions. Neither field is under a check digit in TD3, nor nationality in
 * any format, so an unknown code is how a misread there is caught.
 */

/** ISO 3166-1 alpha-3. */
const ISO = `
  ABW AFG AGO AIA ALA ALB AND ARE ARG ARM ASM ATA ATF ATG AUS AUT AZE BDI BEL BEN BES BFA BGD
  BGR BHR BHS BIH BLM BLR BLZ BMU BOL BRA BRB BRN BTN BVT BWA CAF CAN CCK CHE CHL CHN CIV CMR
  COD COG COK COL COM CPV CRI CUB CUW CXR CYM CYP CZE DEU DJI DMA DNK DOM DZA ECU EGY ERI ESH
  ESP EST ETH FIN FJI FLK FRA FRO FSM GAB GBR GEO GGY GHA GIB GIN GLP GMB GNB GNQ GRC GRD GRL
  GTM GUF GUM GUY HKG HMD HND HRV HTI HUN IDN IMN IND IOT IRL IRN IRQ ISL ISR ITA JAM JEY JOR
  JPN KAZ KEN KGZ KHM KIR KNA KOR KWT LAO LBN LBR LBY LCA LIE LKA LSO LTU LUX LVA MAC MAF MAR
  MCO MDA MDG MDV MEX MHL MKD MLI MLT MMR MNE MNG MNP MOZ MRT MSR MTQ MUS MWI MYS MYT NAM NCL
  NER NFK NGA NIC NIU NLD NOR NPL NRU NZL OMN PAK PAN PCN PER PHL PLW PNG POL PRI PRK PRT PRY
  PSE PYF QAT REU ROU RUS RWA SAU SDN SEN SGP SGS SHN SJM SLB SLE SLV SMR SOM SPM SRB SSD STP
  SUR SVK SVN SWE SWZ SXM SYC SYR TCA TCD TGO THA TJK TKL TKM TLS TON TTO TUN TUR TUV TWN TZA
  UGA UKR UMI URY USA UZB VAT VCT VEN VGB VIR VNM VUT WLF WSM YEM ZAF ZMB ZWE
`

/**
 * ICAO 9303 Part 3 §5: Germany's D, the British nationality classes, the
 * United Nations, the stateless and refugee codes, the EU and the bodies
 * that issue travel documents; RKS (Kosovo) as its documents print it.
 */
const ICAO = 'D GBD GBN GBO GBP GBS UNO UNA UNK XXA XXB XXC XXX EUE XOM XPO XCC XES XBA XIM XCO XDC XEC RKS'

/** Utopia, the state of ICAO's specimens: read, and noted (`specimen`), never taken for a real document. */
export const SPECIMEN_STATE = 'UTO'

const KNOWN = new Set([...ISO.split(/\s+/), ...ICAO.split(' '), SPECIMEN_STATE].filter(Boolean))

/** Whether code (without its fillers) is a state, nationality or body an MRZ may name. */
export function isKnownState(code: string): boolean {
  return KNOWN.has(code)
}
