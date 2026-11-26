import { providerBrand } from "./providerBrand";

export default function ProviderLogo({ kind, urls }: { kind?: string | null; urls: (string | null | undefined)[] }) {
  const brand = providerBrand(kind, urls);
  return brand ? <a className="provider-logo" href={brand.website} target="_blank" rel="noopener noreferrer"
    title={`Provider: ${brand.name}`}><img src={brand.logo} alt={`${brand.name} logo`} /></a> : null;
}
