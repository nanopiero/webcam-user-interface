import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LANGUAGES, ROI_LANGUAGES, defaultLanguage, isLanguage, LANGUAGE_STORAGE_KEY } from "../src/i18n/languages";
import { english, loadLanguage, translator } from "../src/i18n/core";
import { I18nProvider, useI18n } from "../src/i18n/I18nProvider";
import LanguageMenu from "../src/i18n/LanguageMenu";
import { snowClassLabel } from "../src/features/history/series";
import { usePresentation } from "../src/shared/usePresentation";

beforeEach(() => localStorage.clear());
const fields = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

describe("member-country languages", () => {
  it("covers all 33 member countries and offers unique language codes", () => {
    expect(Object.keys(ROI_LANGUAGES)).toHaveLength(33);
    expect(new Set(LANGUAGES.map(item => item.code)).size).toBe(LANGUAGES.length);
    expect(Object.values(ROI_LANGUAGES).every(isLanguage)).toBe(true);
    expect(LANGUAGES.find(item => item.code === "nl")?.name).toContain("Vlaams");
  });
  it("uses the ROI country before any browser-language preference, with an explicit deployment override", () => {
    for (const [country, language] of Object.entries(ROI_LANGUAGES)) {
      expect(defaultLanguage({ roi: { countries: [country] } })).toBe(language);
    }
    expect(defaultLanguage({ language: "fr", roi: { countries: ["BE"] } })).toBe("fr");
    expect(defaultLanguage({ roi: { countries: ["XX"] } })).toBe("en");
  });
  for (const language of LANGUAGES) {
    it(`${language.code} has every source message and preserves all interpolation fields`, async () => {
      const catalogue = await loadLanguage(language.code);
      for (const key of Object.keys(english)) {
        expect(catalogue[key], `${language.code}: ${key}`).toBeTruthy();
        expect(fields(catalogue[key]), `${language.code}: ${key}`).toEqual(fields(key));
      }
    });
  }
  it("keeps the agreed French snow terminology and distinguishes observation-specific high cover", async () => {
    const french = await loadLanguage("fr"), t = translator("fr");
    expect(Object.values(french).join(" ")).not.toMatch(/couverture neigeuse/i);
    expect(t("Observation timestamps").toLowerCase()).toContain("timestamp");
    expect(snowClassLabel(1, {}, t)).toBe("Couverture non différenciée");
    expect(snowClassLabel(1, { snow_threshold_low: -2, snow_threshold_high: 0 }, t)).toBe("Couverture étendue");
    expect(t("__proto__")).toBe("__proto__");
    expect(t("Unrecognised class ({value})", { value: 999 })).not.toContain("{value}");
  });
});

function Display() {
  const { language } = useI18n();
  const { number, countryLabel } = usePresentation();
  return <output>{language} · {number(1234.5)} · {countryLabel("DE")}</output>;
}

describe("language menu and display", () => {
  it("starts with the ROI language and saves a menu choice without changing observations", async () => {
    await loadLanguage("fr"); await loadLanguage("de");
    render(<I18nProvider configuration={{ roi: { countries: ["FR"] } }}><LanguageMenu /><Display /></I18nProvider>);
    expect(screen.getByRole("combobox")).toHaveValue("fr");
    expect(screen.getByRole("status")).toHaveTextContent(/fr · 1.234,5 · Allemagne/);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "de" } });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("de"));
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("de");
    expect(document.documentElement.lang).toBe("de");
  });
  it("honours a saved choice over the ROI and ignores unsupported stored values", async () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
    const view = render(<I18nProvider configuration={{ roi: { countries: ["FI"] } }}><LanguageMenu /></I18nProvider>);
    expect(screen.getByRole("combobox")).toHaveValue("en");
    view.unmount(); localStorage.setItem(LANGUAGE_STORAGE_KEY, "invalid-language");
    await loadLanguage("fi");
    render(<I18nProvider configuration={{ roi: { countries: ["FI"] } }}><LanguageMenu /></I18nProvider>);
    expect(screen.getByRole("combobox")).toHaveValue("fi");
  });
});
