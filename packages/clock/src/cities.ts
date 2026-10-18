/**
 * Cities of the world clock (the Voidex-Clock list): a name and its IANA
 * zone. Several cities may share a zone (Москва and Тула); the zone is what a
 * card stores, the first city of that zone names it.
 */
export interface ClockCity {
  zone: string;
  ru: string;
  en: string;
}

export const CITY_OPTIONS: readonly ClockCity[] = [
  { zone: "Europe/Moscow", ru: "Москва", en: "Moscow" },
  { zone: "Europe/Kaliningrad", ru: "Калининград", en: "Kaliningrad" },
  { zone: "Asia/Yekaterinburg", ru: "Екатеринбург", en: "Yekaterinburg" },
  { zone: "Asia/Omsk", ru: "Омск", en: "Omsk" },
  { zone: "Asia/Novosibirsk", ru: "Новосибирск", en: "Novosibirsk" },
  { zone: "Asia/Vladivostok", ru: "Владивосток", en: "Vladivostok" },
  { zone: "Europe/London", ru: "Лондон", en: "London" },
  { zone: "Europe/Paris", ru: "Париж", en: "Paris" },
  { zone: "America/New_York", ru: "Нью-Йорк", en: "New York" },
  { zone: "America/Los_Angeles", ru: "Лос-Анджелес", en: "Los Angeles" },
  { zone: "Asia/Dubai", ru: "Дубай", en: "Dubai" },
  { zone: "Asia/Tokyo", ru: "Токио", en: "Tokyo" },
  { zone: "Asia/Shanghai", ru: "Пекин", en: "Beijing" },
  { zone: "Australia/Sydney", ru: "Сидней", en: "Sydney" },
  { zone: "Asia/Singapore", ru: "Сингапур", en: "Singapore" },
  { zone: "Europe/Istanbul", ru: "Стамбул", en: "Istanbul" },
  { zone: "Europe/Moscow", ru: "Тула", en: "Tula" },
];

export const DEFAULT_CITIES = ["Europe/Moscow", "Europe/Kaliningrad", "Asia/Yekaterinburg", "Asia/Omsk"];

export const isKnownZone = (zone: unknown): zone is string => typeof zone === "string" && CITY_OPTIONS.some((c) => c.zone === zone);

/** Name of a zone's city in the language (Russian, otherwise English); an unknown zone is named after its last part. */
export function cityName(zone: string, lang: string): string {
  const c = CITY_OPTIONS.find((x) => x.zone === zone);
  if (c) return lang === "ru" ? c.ru : c.en;
  return (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}

/** City search of «Добавить город»: by name in either language or by zone; one row per zone. */
export function searchCities(query: string): ClockCity[] {
  const q = query.trim().toLocaleLowerCase();
  const seen = new Set<string>();
  return CITY_OPTIONS.filter((c) => {
    if (seen.has(c.zone)) return false;
    const hit = !q || c.ru.toLocaleLowerCase().includes(q) || c.en.toLocaleLowerCase().includes(q) || c.zone.toLocaleLowerCase().includes(q);
    if (hit) seen.add(c.zone);
    return hit;
  });
}
