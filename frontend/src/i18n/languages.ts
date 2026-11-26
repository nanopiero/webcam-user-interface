/** Languages of EUMETNET member countries. Names are shown in their own language. */
export const LANGUAGES = [
  { code: "en", locale: "en-GB", name: "English" },
  { code: "fr", locale: "fr-FR", name: "Français" },
  { code: "de", locale: "de-DE", name: "Deutsch" },
  { code: "fi", locale: "fi-FI", name: "Suomi" },
  { code: "sv", locale: "sv-SE", name: "Svenska" },
  { code: "da", locale: "da-DK", name: "Dansk" },
  { code: "nl", locale: "nl-NL", name: "Nederlands / Vlaams" },
  { code: "es", locale: "es-ES", name: "Español" },
  { code: "pt", locale: "pt-PT", name: "Português" },
  { code: "it", locale: "it-IT", name: "Italiano" },
  { code: "el", locale: "el-GR", name: "Ελληνικά" },
  { code: "cs", locale: "cs-CZ", name: "Čeština" },
  { code: "hu", locale: "hu-HU", name: "Magyar" },
  { code: "sl", locale: "sl-SI", name: "Slovenščina" },
  { code: "sk", locale: "sk-SK", name: "Slovenčina" },
  { code: "pl", locale: "pl-PL", name: "Polski" },
  { code: "ro", locale: "ro-RO", name: "Română" },
  { code: "hr", locale: "hr-HR", name: "Hrvatski" },
  { code: "sr", locale: "sr-RS", name: "Српски" },
  { code: "cnr", locale: "sr-ME", name: "Црногорски" },
  { code: "mk", locale: "mk-MK", name: "Македонски" },
  { code: "sq", locale: "sq-AL", name: "Shqip" },
  { code: "tr", locale: "tr-TR", name: "Türkçe" },
  { code: "et", locale: "et-EE", name: "Eesti" },
  { code: "lv", locale: "lv-LV", name: "Latviešu" },
  { code: "lt", locale: "lt-LT", name: "Lietuvių" },
  { code: "is", locale: "is-IS", name: "Íslenska" },
  { code: "nb", locale: "nb-NO", name: "Norsk bokmål" },
  { code: "ga", locale: "ga-IE", name: "Gaeilge" },
  { code: "lb", locale: "lb-LU", name: "Lëtzebuergesch" },
  { code: "mt", locale: "mt-MT", name: "Malti" },
] as const;

export type Language = typeof LANGUAGES[number]["code"];
export const LANGUAGE_STORAGE_KEY = "webcam-ui-language";
export const ROI_LANGUAGES: Record<string, Language> = {
  AT: "de", BE: "nl", HR: "hr", CY: "el", CZ: "cs", DK: "da", EE: "et", FI: "fi",
  FR: "fr", DE: "de", GR: "el", HU: "hu", IS: "is", IE: "en", IT: "it", LV: "lv",
  LT: "lt", LU: "fr", ME: "cnr", MT: "mt", NL: "nl", MK: "mk", NO: "nb", PL: "pl",
  PT: "pt", RO: "ro", RS: "sr", SK: "sk", SI: "sl", ES: "es", SE: "sv", CH: "de", GB: "en",
};

export function isLanguage(value: unknown): value is Language {
  return typeof value === "string" && LANGUAGES.some(item => item.code === value);
}

export function defaultLanguage(configuration: { language?: string; roi: { name?: string; countries: string[] } }): Language {
  if (isLanguage(configuration.language)) return configuration.language;
  if (configuration.roi.name?.trim().toLowerCase() === "europe") return "en";
  return ROI_LANGUAGES[configuration.roi.countries[0]?.toUpperCase()] ?? "en";
}
