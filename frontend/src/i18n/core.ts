import en from "./locales/en.json";
import type { Language } from "./languages";

export type Parameters = Record<string, string | number>;
export type Translator = (message: string, parameters?: Parameters) => string;
export type Catalogue = Record<string, string>;
export const english: Catalogue = en;
const catalogues = import.meta.glob<{ default: Catalogue }>("./locales/*.json");
const loaded = new Map<Language, Catalogue>([["en", english]]);
const pending = new Map<Language, Promise<Catalogue>>();

export function loadLanguage(language: Language): Promise<Catalogue> {
  const existing = loaded.get(language);
  if (existing) return Promise.resolve(existing);
  const request = pending.get(language);
  if (request) return request;
  const loader = catalogues[`./locales/${language}.json`];
  if (!loader) return Promise.reject(new Error(`Language catalogue unavailable: ${language}`));
  const promise = loader().then(module => { loaded.set(language, module.default); return module.default; })
    .finally(() => pending.delete(language));
  pending.set(language, promise);
  return promise;
}

export function translator(language: Language): Translator {
  return (message, parameters = {}) => {
    const catalogue = loaded.get(language) ?? english;
    const translated = Object.hasOwn(catalogue, message) ? catalogue[message] : Object.hasOwn(english, message) ? english[message] : message;
    return translated.replace(/\{(\w+)\}/g, (token, name: string) => Object.hasOwn(parameters, name) ? String(parameters[name]) : token);
  };
}
