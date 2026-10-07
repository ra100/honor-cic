export const C_KM_S = 299_792.458;
export const G0_KM_S2 = 0.00980665;
export const LS_KM = C_KM_S;
export const LM_KM = 17_987_547.48;
export const LH_KM = 1_079_252_848.8;
export const AU_KM = 149_597_870.7;
export const MKM_KM = 1_000_000;
/** Julian year, used for T-year periods (a D convention, see notes.md). */
export const T_YEAR_S = 31_557_600;

export type Unit =
  | 'km' | 'Mkm' | 'LM' | 'm' | 'km/s' | 'km/s2' | 'g' | 's' | 'min' | 'yr'
  | 't' | 'deg' | 'count' | 'c' | 'Msun' | 'PD-date' | 'text' | 'ratio';

/** Factor from an authored unit to the base unit of its dimension; null for non-numeric units. */
export function baseFactor(unit: Unit): number | null {
  switch (unit) {
    case 'km': case 'km/s': case 'km/s2': case 's': case 't': case 'deg':
    case 'count': case 'c': case 'Msun': case 'ratio':
      return 1;
    case 'Mkm': return MKM_KM;
    case 'LM': return LM_KM;
    case 'm': return 0.001;
    case 'g': return G0_KM_S2;
    case 'min': return 60;
    case 'yr': return T_YEAR_S;
    case 'PD-date': case 'text': return null;
  }
}

export const gToKmS2 = (g: number): number => g * G0_KM_S2;
export const kmS2ToG = (a: number): number => a / G0_KM_S2;
export const lmToKm = (lm: number): number => lm * LM_KM;
export const kmToLm = (km: number): number => km / LM_KM;
export const mkmToKm = (mkm: number): number => mkm * MKM_KM;
export const kmToMkm = (km: number): number => km / MKM_KM;
export const toFractionC = (kmS: number): number => kmS / C_KM_S;

export function fmtDistance(km: number): string {
  const a = Math.abs(km);
  if (a >= 10 * LM_KM) return `${(km / LM_KM).toFixed(2)} LM`;
  if (a >= MKM_KM) return `${(km / MKM_KM).toFixed(2)} Mkm`;
  if (a >= 1) return `${Math.round(km).toLocaleString('en-US')} km`;
  return `${Math.round(km * 1000)} m`;
}

export function fmtDuration(s: number): string {
  const sign = s < 0 ? '-' : '';
  let x = Math.abs(Math.round(s));
  const h = Math.floor(x / 3600);
  x -= h * 3600;
  const m = Math.floor(x / 60);
  const sec = x - m * 60;
  const ss = String(sec).padStart(2, '0');
  return h ? `${sign}${h}:${String(m).padStart(2, '0')}:${ss}` : `${sign}${m}:${ss}`;
}

export const fmtCount = (n: number): string => Math.round(n).toLocaleString('en-US');
