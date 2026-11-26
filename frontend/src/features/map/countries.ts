export type CountrySelection = ReadonlySet<string | null>;

const names = new Map<string, Intl.DisplayNames>();

export function countryLabel(code: string, locale = "en"): string {
  if (!names.has(locale)) names.set(locale, new Intl.DisplayNames([locale], { type: "region" }));
  const name = names.get(locale)!.of(code);
  return name && name !== code ? `${name} (${code})` : code;
}

