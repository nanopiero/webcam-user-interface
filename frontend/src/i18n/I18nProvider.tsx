import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { defaultLanguage, isLanguage, LANGUAGES, LANGUAGE_STORAGE_KEY, type Language } from "./languages";
import { loadLanguage, translator } from "./core";

function storedLanguage(): Language | null {
  try { const value = localStorage.getItem(LANGUAGE_STORAGE_KEY); return isLanguage(value) ? value : null; }
  catch { return null; }
}

const I18nContext = createContext({ language: "en" as Language, locale: "en-GB", t: translator("en"),
  busy: false, error: "", setLanguage: (_language: Language) => {} });

export function preferredLanguage(configuration: { language?: string; roi: { name?: string; countries: string[] } }): Language {
  return storedLanguage() ?? defaultLanguage(configuration);
}

export function I18nProvider({ configuration, children }: {
  configuration: { language?: string; roi: { name?: string; countries: string[] } }; children: ReactNode;
}) {
  const [language, setLanguage] = useState<Language>(() => preferredLanguage(configuration));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const generation = useRef(0);
  const value = useMemo(() => ({ language, locale: LANGUAGES.find(item => item.code === language)!.locale,
    busy, error, t: translator(language), setLanguage: async (next: Language) => {
      if (!isLanguage(next) || next === language) return;
      const request = ++generation.current;
      setBusy(true); setError("");
      try {
        await loadLanguage(next);
        if (request !== generation.current) return;
        setLanguage(next);
        try { localStorage.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Storage is optional. */ }
      } catch { if (request === generation.current) setError("Language could not load. Try again."); }
      finally { if (request === generation.current) setBusy(false); }
    } }), [language, busy, error]);
  useEffect(() => { document.documentElement.lang = language === "cnr" ? "sr-ME" : language; }, [language]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() { return useContext(I18nContext); }
