# Frontend: Regions dropdown (country names, not codes)

This guide explains how to power the admin/storefront **“All regions”** filter pill with human-readable **country names** using TradeVero’s regions API — instead of showing raw codes like `US`, `JP`, `TH`.

Related APIs:
- Regions list/search: `GET /api/v1/regions`
- Products by country name: `GET /api/v1/products?country=Japan`
- Products by exact code: `GET /api/v1/products?locationCode=JP`
- Admin products (same filters): `GET /api/v1/admin/products?country=...`
- Populate DB: `POST /api/v1/admin/products/sync` (syncs regions + products)

Source of truth for names/codes: eSIM Access `POST /location/list`, stored in our `regions` table after admin sync.

---

## Goal UX

| State | Label in pill |
|-------|----------------|
| No filter | **All regions** |
| Country selected | **United States** (name), not `US` |
| Regional plan selected | **Europe** (region name), not the provider code |

Dropdown options should list **names**. Internally, keep both `code` and `name` so product queries stay correct.

```text
┌──────────────────────┐
│ All regions        ▾ │
└──────────────────────┘
          │
          ▼
┌──────────────────────┐
│ All regions          │
│ United States        │
│ Japan                │
│ Spain                │
│ Europe               │  ← type = REGION (multi-country)
│ …                    │
└──────────────────────┘
```

---

## Prerequisites

1. Admin has run **Sync from supplier** at least once (`POST /admin/products/sync`).
2. That sync fills `regions` from eSIM Access location list.
3. If `GET /regions` returns `[]`, tell the admin to sync — don’t fall back to showing product `locationCode`s as the only labels.

---

## API: load dropdown options

```http
GET /api/v1/regions
GET /api/v1/regions?q=jap
GET /api/v1/regions?type=1
```

| Query | Purpose |
|-------|---------|
| *(none)* | Full list (countries + multi-country regions), ordered by name |
| `q` | Typeahead filter by **name or code** (e.g. `jap` → Japan) |
| `type=1` | Countries only |
| `type=2` | Multi-country regions only |

**Response item**

```json
{
  "id": "uuid",
  "code": "US",
  "name": "United States",
  "type": 1,
  "typeLabel": "COUNTRY",
  "subLocations": []
}
```

Regional example:

```json
{
  "code": "EU-40",
  "name": "Europe",
  "type": 2,
  "typeLabel": "REGION",
  "subLocations": [
    { "code": "ES", "name": "Spain" },
    { "code": "FR", "name": "France" }
  ]
}
```

---

## TypeScript types

```ts
type RegionOption = {
  id: string;
  code: string;
  name: string;
  type: number;
  typeLabel: 'COUNTRY' | 'REGION';
  subLocations: Array<{ code: string; name: string }>;
};

/** UI selection for the pill */
type RegionFilter =
  | { kind: 'all' }
  | { kind: 'region'; code: string; name: string };
```

---

## Recommended frontend wiring

### 1) Fetch options once (or with search)

**Simple dropdown (all options):**

```ts
const regions = await api.get<RegionOption[]>('/api/v1/regions');
// Prefer countries for a clean filter; include regions if you sell multi-country plans
const options = regions.filter((r) => r.typeLabel === 'COUNTRY');
// or: const options = regions; // show both
```

**Searchable combobox (best UX for 100+ countries):**

```ts
// debounce 200–300ms
const regions = await api.get<RegionOption[]>('/api/v1/regions', {
  params: { q: searchText },
});
```

### 2) Render **names** in the menu

```tsx
<button type="button">
  {selected?.kind === 'region' ? selected.name : 'All regions'}
  <ChevronDown />
</button>

<ul role="listbox">
  <li onClick={() => setSelected({ kind: 'all' })}>All regions</li>
  {options.map((r) => (
    <li key={r.code} onClick={() => setSelected({ kind: 'region', code: r.code, name: r.name })}>
      {r.name}
      {/* optional secondary hint — do not use as primary label */}
      {/* <span className="muted">{r.code}</span> */}
    </li>
  ))}
</ul>
```

**Do**
- Primary label = `region.name`
- Pill closed state = selected `name` or `All regions`

**Don’t**
- Use `locationCode` / `code` as the only visible label
- Build the dropdown from distinct `product.locationCode` values (codes only, no names)

### 3) Filter products with the selection

Prefer filtering by **country name** (uses regions resolution, including regional packages that cover that country):

```ts
if (selected.kind === 'all') {
  await api.get('/api/v1/products', { params: { page, limit } });
  // admin: /api/v1/admin/products?status=DRAFT&page=&limit=
} else {
  await api.get('/api/v1/products', {
    params: {
      page,
      limit,
      country: selected.name, // "United States"
    },
  });
}
```

Exact code also works if you already have `code`:

```ts
params: { locationCode: selected.code } // "US"
```

| Approach | When to use |
|----------|-------------|
| `country={name}` | Best default — name search + includes covering regional plans |
| `locationCode={code}` | Exact match on product’s stored code only |

For the admin catalog table, same query params on `GET /admin/products`.

### 4) Keep URL state readable

```text
?country=United%20States&page=1
```

or

```text
?locationCode=US&page=1
```

On load: if URL has `country` or `locationCode`, resolve the pill label from `/regions` (match by name or code) so the pill shows **United States**, not `US`.

```ts
async function hydrateFilterFromUrl(params: URLSearchParams): Promise<RegionFilter> {
  const country = params.get('country');
  const code = params.get('locationCode');
  if (!country && !code) return { kind: 'all' };

  const q = country ?? code!;
  const matches = await api.get<RegionOption[]>('/api/v1/regions', { params: { q } });
  const hit =
    matches.find((r) => r.name === country) ??
    matches.find((r) => r.code === code) ??
    matches[0];

  if (!hit) return { kind: 'all' };
  return { kind: 'region', code: hit.code, name: hit.name };
}
```

---

## Mapping cheat sheet

| UI shows | Store / send |
|----------|----------------|
| `United States` | `country=United States` or `locationCode=US` |
| `Japan` | `country=Japan` or `locationCode=JP` |
| `All regions` | omit both params |

Products still return `locationCode: "US"` on each row — that’s fine for badges/debug. The **dropdown** should not list codes as primary text. Optionally show a small muted code next to the name inside the open menu only.

---

## Empty / error states

| Situation | UX |
|-----------|-----|
| `regions` empty | Pill disabled or menu: “No regions yet — run Sync from supplier” |
| Search no matches | “No countries match” |
| Regions fail to load | Keep “All regions”; toast error; don’t invent codes from products |

---

## Admin vs public

| Surface | Regions fetch | Product list |
|---------|---------------|--------------|
| Public shop | `GET /regions` (public) | `GET /products?country=` |
| Admin catalog | `GET /regions` (public) | `GET /admin/products?country=` + auth |

Same dropdown component can be shared; only the products endpoint and auth differ.

---

## Acceptance checklist

- [ ] Dropdown options loaded from `GET /regions`, not from product `locationCode`s alone
- [ ] Closed pill shows **country/region name** or **All regions**
- [ ] Open list shows names (code optional as secondary)
- [ ] Selecting a country refetches products with `country={name}` (or `locationCode={code}`)
- [ ] “All regions” clears the filter
- [ ] Searchable list uses `?q=` for long country lists
- [ ] After admin sync, new countries appear without hardcoding

---

## Quick example (React-ish)

```tsx
function RegionFilterPill({
  value,
  onChange,
}: {
  value: RegionFilter;
  onChange: (v: RegionFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const { data: regions = [] } = useQuery({
    queryKey: ['regions', q],
    queryFn: () =>
      fetch(`/api/v1/regions?q=${encodeURIComponent(q)}`).then((r) => r.json()),
  });

  const label = value.kind === 'all' ? 'All regions' : value.name;

  return (
    <div>
      <button type="button" onClick={() => setOpen((o) => !o)}>
        {label} ▾
      </button>
      {open && (
        <div role="listbox">
          <input
            placeholder="Search countries"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button type="button" onClick={() => onChange({ kind: 'all' })}>
            All regions
          </button>
          {regions.map((r: RegionOption) => (
            <button
              key={r.code}
              type="button"
              onClick={() =>
                onChange({ kind: 'region', code: r.code, name: r.name })
              }
            >
              {r.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// When filter changes:
// GET /products?country=United%20States&page=1&limit=20
```

That’s the contract: **display names from `/regions`, filter products with `country` (name) or `locationCode` (code), default pill = “All regions”.**
