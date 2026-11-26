interface Props {
  countries: string[];
  roi: { name: string; countries: string[] };
  value: boolean;
  onChange: (value: boolean) => void;
}

export default function CountryFilter({ countries, roi, value, onChange }: Props) {
  const hasBordering = countries.some(code => !roi.countries.includes(code));
  if (!hasBordering) return null;
  return <section className="country-filter" aria-label="WEOW country filter">
    <label className="checkbox bordering-toggle"><input type="checkbox" checked={value} onChange={event => onChange(event.target.checked)} />Show bordering webcams</label>
  </section>;
}
