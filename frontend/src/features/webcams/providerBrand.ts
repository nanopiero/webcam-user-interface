import windyLogo from "../../../../logos/windy.png";
import skapingLogo from "../../../../logos/skaping.png";
import fintrafficLogo from "../../../../logos/fintraffic.svg";
import meteoCentreLogo from "../../../../logos/meteo-centre.png";

export interface ProviderBrand { name: string; logo: string; website: string; domains: string[] }

const BRANDS: Record<string, ProviderBrand> = {
  windy: { name: "Windy", logo: windyLogo, website: "https://www.windy.com/", domains: ["windy.com"] },
  skaping: { name: "Skaping", logo: skapingLogo, website: "https://www.skaping.com/",
    domains: ["skaping.com", "skaping.quanteec.com", "skaping.s3.gra.io.cloud.ovh.net"] },
  fintraffic: { name: "Fintraffic", logo: fintrafficLogo, website: "https://www.fintraffic.fi/en",
    domains: ["fintraffic.fi", "digitraffic.fi"] },
  "meteo-centre": { name: "Météo Centre", logo: meteoCentreLogo, website: "https://www.meteo-centre.fr/",
    domains: ["meteo-centre.fr"] },
};

/** Prefer published provider identity; otherwise recognize only known URL hostnames. */
export function providerBrand(kind?: string | null, urls: (string | null | undefined)[] = []): ProviderBrand | null {
  if (kind && Object.hasOwn(BRANDS, kind)) return BRANDS[kind];
  for (const url of urls) {
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      const brand = Object.values(BRANDS).find(item => item.domains.some(domain =>
        parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)));
      if (brand) return brand;
    } catch { /* A missing/invalid public URL does not establish a provider. */ }
  }
  return null;
}
