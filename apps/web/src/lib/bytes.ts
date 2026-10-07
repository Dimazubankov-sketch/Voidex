/** Bytes in the interface language: "0 Б", "4,8 ГБ", "1 ТБ" (decimal places only where they help). */
export function formatStorage(n: number, lang: string) {
  const units = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;
  let v = Math.max(0, n);
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return new Intl.NumberFormat(lang, { style: "unit", unit: units[u], unitDisplay: "short", maximumFractionDigits: u === 0 || v >= 100 ? 0 : 1 }).format(v);
}

export const GB = 1024 ** 3;
