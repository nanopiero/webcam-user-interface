export type CountrySelection = ReadonlySet<string | null>;

const names = new Intl.DisplayNames(["en"], { type: "region" });

export function countryLabel(code: string): string {
  const name = names.of(code);
  return name && name !== code ? `${name} (${code})` : code;
}

