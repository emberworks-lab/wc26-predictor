/**
 * Flag emoji per FIFA TLA for the 48 qualified WC26 teams.
 * FIFA TLAs are not ISO 3166-1, so this is a hand-checked lookup
 * (England/Scotland use the Unicode subdivision flags).
 */

export const FLAG_BY_TLA: Readonly<Record<string, string>> = {
  // Group A
  CZE: '🇨🇿', MEX: '🇲🇽', RSA: '🇿🇦', KOR: '🇰🇷',
  // Group B
  BIH: '🇧🇦', CAN: '🇨🇦', QAT: '🇶🇦', SUI: '🇨🇭',
  // Group C
  BRA: '🇧🇷', HAI: '🇭🇹', MAR: '🇲🇦', SCO: '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  // Group D
  AUS: '🇦🇺', PAR: '🇵🇾', TUR: '🇹🇷', USA: '🇺🇸',
  // Group E
  CUW: '🇨🇼', ECU: '🇪🇨', GER: '🇩🇪', CIV: '🇨🇮',
  // Group F
  JPN: '🇯🇵', NED: '🇳🇱', SWE: '🇸🇪', TUN: '🇹🇳',
  // Group G
  BEL: '🇧🇪', EGY: '🇪🇬', IRN: '🇮🇷', NZL: '🇳🇿',
  // Group H
  CPV: '🇨🇻', KSA: '🇸🇦', ESP: '🇪🇸', URY: '🇺🇾',
  // Group I
  FRA: '🇫🇷', IRQ: '🇮🇶', NOR: '🇳🇴', SEN: '🇸🇳',
  // Group J
  ALG: '🇩🇿', ARG: '🇦🇷', AUT: '🇦🇹', JOR: '🇯🇴',
  // Group K
  COL: '🇨🇴', COD: '🇨🇩', POR: '🇵🇹', UZB: '🇺🇿',
  // Group L
  CRO: '🇭🇷', ENG: '🏴󠁧󠁢󠁥󠁮󠁧󠁿', GHA: '🇬🇭', PAN: '🇵🇦',
};

export const FALLBACK_FLAG = '🏳️';

export function flagForTla(tla: string | null | undefined): string {
  return (tla && FLAG_BY_TLA[tla]) || FALLBACK_FLAG;
}
