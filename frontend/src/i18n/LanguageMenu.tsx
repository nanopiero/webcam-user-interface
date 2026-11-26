import { LANGUAGES, isLanguage } from "./languages";
import { useI18n } from "./I18nProvider";

export default function LanguageMenu() {
  const { t, language, setLanguage, busy } = useI18n();
  return <label className="language-menu">
    <select aria-label={t("Language")} aria-busy={busy} disabled={busy} value={language} onChange={event => {
      if (isLanguage(event.target.value)) setLanguage(event.target.value);
    }}>{LANGUAGES.map(item => <option key={item.code} value={item.code} lang={item.code}>{item.name}</option>)}</select>
    <span className="language-short" aria-hidden="true">{language.toUpperCase()}</span>
  </label>;
}
