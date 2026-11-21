import { Search, Store, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button } from '../../components/ui/Button';
import { ImageWithFallback } from '../../components/ui/ImageWithFallback';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { APP_TAGLINE, hasMapsKey } from '../../config';
import { cn } from '../../lib/cn';
import { formatMoney, pluralize } from '../../lib/format';
import { useCategories, usePublicProducts, usePublicShops, type ShopFilters } from './queries';
import { ShopListItem } from './ShopCard';
import { isInBounds, ShopMap, type Bounds } from './ShopMap';

type SearchMode = 'product' | 'shop';

export function HomeMapPage() {
  const [params, setParams] = useSearchParams();
  const mode: SearchMode = params.get('mode') === 'shop' ? 'shop' : 'product';
  const term = params.get('q')?.trim() ?? '';
  const category = params.get('category') ?? '';

  const filters = useMemo<ShopFilters>(
    () => ({
      ...(term ? (mode === 'shop' ? { q: term } : { product: term }) : {}),
      ...(category ? { category } : {}),
    }),
    [term, mode, category],
  );

  const shopsQuery = usePublicShops(filters);
  const categoriesQuery = useCategories();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [onlyInView, setOnlyInView] = useState(true);
  const [draft, setDraft] = useState(term);
  const [draftMode, setDraftMode] = useState<SearchMode>(mode);

  const shops = useMemo(() => shopsQuery.data?.items ?? [], [shopsQuery.data]);
  const visibleShops = useMemo(
    () => (hasMapsKey && onlyInView && bounds ? shops.filter((shop) => isInBounds(shop, bounds)) : shops),
    [shops, bounds, onlyInView],
  );
  const filtered = !!term || !!category;

  const update = (next: { q?: string; mode?: SearchMode; category?: string }) => {
    const merged = { q: term, mode, category, ...next };
    const search = new URLSearchParams();
    if (merged.q) search.set('q', merged.q);
    if (merged.q && merged.mode === 'shop') search.set('mode', 'shop');
    if (merged.category) search.set('category', merged.category);
    setSelectedId(null);
    setOnlyInView(true);
    setParams(search, { replace: true });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    update({ q: draft.trim(), mode: draftMode });
  };

  const clearAll = () => {
    setDraft('');
    update({ q: '', category: '' });
  };

  return (
    <div className="grid lg:h-[calc(100dvh-4rem)] lg:grid-cols-[420px_minmax(0,1fr)] lg:grid-rows-[auto_minmax(0,1fr)] lg:overflow-hidden">
        <section
          className="space-y-3 border-b border-ink-100 p-4 lg:col-start-1 lg:row-start-1 lg:border-r"
          aria-label="Find shops"
        >
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink-950">Shops near you</h1>
            <p className="text-sm text-ink-500">{APP_TAGLINE}</p>
          </div>
          <form onSubmit={submit} className="space-y-2" role="search">
            <div className="inline-flex rounded-xl bg-ink-100 p-1 text-sm" role="radiogroup" aria-label="Search by">
              {(['product', 'shop'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={draftMode === value}
                  onClick={() => setDraftMode(value)}
                  className={cn(
                    'rounded-lg px-3 py-1 font-medium transition-colors',
                    draftMode === value ? 'bg-white text-ink-950 shadow-sm' : 'text-ink-600 hover:text-ink-900',
                  )}
                >
                  {value === 'product' ? 'Products' : 'Shop names'}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
                <input
                  type="search"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  maxLength={100}
                  placeholder={draftMode === 'product' ? 'e.g. coffee, phone charger' : 'e.g. Abebe Coffee'}
                  aria-label={draftMode === 'product' ? 'Find shops selling a product' : 'Find shops by name'}
                  className="h-10 w-full rounded-xl border border-ink-200 bg-white pl-9 pr-3 text-sm placeholder:text-ink-400 focus:border-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400/60"
                />
              </div>
              <Button type="submit">Search</Button>
            </div>
          </form>
          <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Filter by category">
            <CategoryChip active={!category} onClick={() => update({ category: '' })}>
              All
            </CategoryChip>
            {categoriesQuery.data?.map((item) => (
              <CategoryChip
                key={item.id}
                active={category === item.slug}
                onClick={() => update({ category: category === item.slug ? '' : item.slug })}
              >
                {item.name}
              </CategoryChip>
            ))}
          </div>
        </section>

        <div className="flex min-h-0 flex-col lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:h-full">
          <div className="h-[45vh] min-h-64 shrink-0 overflow-hidden lg:h-auto lg:min-h-0 lg:flex-1">
            <ShopMap
              shops={shops}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onBoundsChange={setBounds}
              className="size-full"
            />
          </div>
          <RecommendedProducts term={mode === 'product' ? term : ''} category={category} />
        </div>

        <section
          className="border-ink-100 lg:col-start-1 lg:row-start-2 lg:overflow-y-auto lg:border-r"
          aria-label="Shop list"
        >
          <div className="flex items-center justify-between gap-2 px-4 pt-4 text-sm">
            <p className="text-ink-600" aria-live="polite">
              {shopsQuery.isPending
                ? 'Finding shops…'
                : shopsQuery.isPlaceholderData
                  ? 'Searching…'
                  : hasMapsKey && onlyInView && bounds
                  ? `${pluralize(visibleShops.length, 'shop')} in this map area`
                  : pluralize(shops.length, 'shop')}
            </p>
            <div className="flex items-center gap-3">
              {hasMapsKey && onlyInView && bounds && visibleShops.length < shops.length ? (
                <button type="button" className="font-medium text-ink-950 hover:underline" onClick={() => setOnlyInView(false)}>
                  Show all {shops.length}
                </button>
              ) : null}
              {filtered ? (
                <button type="button" onClick={clearAll} className="flex items-center gap-1 font-medium text-ink-950 hover:underline">
                  <X className="size-3.5" /> Clear
                </button>
              ) : null}
            </div>
          </div>
          <div className="p-4">
            {shopsQuery.isPending ? (
              <div className="space-y-3">
                {[0, 1, 2].map((index) => (
                  <Skeleton key={index} className="h-32" />
                ))}
              </div>
            ) : shopsQuery.isError ? (
              <ErrorState error={shopsQuery.error} onRetry={() => void shopsQuery.refetch()} />
            ) : shops.length === 0 ? (
              <EmptyState
                icon={<Store className="size-6" />}
                title={filtered ? 'No shops match your search' : 'No shops yet'}
                description={
                  filtered
                    ? 'Try a different word or category.'
                    : 'Shops appear here as soon as the marketplace administrator opens them.'
                }
                action={filtered ? <Button variant="secondary" onClick={clearAll}>Clear filters</Button> : undefined}
              />
            ) : visibleShops.length === 0 ? (
              <EmptyState
                title="No shops in this part of the map"
                description="Zoom out or move the map to see more shops."
                action={<Button variant="secondary" onClick={() => setOnlyInView(false)}>Show all shops</Button>}
              />
            ) : (
              <ul className="space-y-3">
                {visibleShops.map((shop) => (
                  <ShopListItem
                    key={shop.id}
                    shop={shop}
                    selected={shop.id === selectedId}
                    onSelect={() => setSelectedId(shop.id === selectedId ? null : shop.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </section>
    </div>
  );
}

function RecommendedProducts({ term, category }: { term: string; category: string }) {
  const productsQuery = usePublicProducts({
    page: 1,
    pageSize: 8,
    available: 'true',
    sort: term ? 'relevance' : 'newest',
    ...(term ? { q: term } : {}),
    ...(category ? { category } : {}),
  });
  const products = productsQuery.data?.items ?? [];

  return (
    <section aria-label="Recommended products" className="shrink-0 border-t border-ink-100 bg-white">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3">
        <h2 className="text-sm font-semibold text-ink-950">Recommended products</h2>
        <Link to="/search" className="text-xs font-medium text-ink-700 hover:text-ink-950 hover:underline">
          See all
        </Link>
      </div>
      {productsQuery.isPending ? (
        <div className="flex gap-3 overflow-hidden px-4 py-3">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-24 w-56 shrink-0" />
          ))}
        </div>
      ) : productsQuery.isError ? (
        <div className="px-4 py-3">
          <ErrorState error={productsQuery.error} onRetry={() => void productsQuery.refetch()} />
        </div>
      ) : products.length === 0 ? (
        <p className="px-4 py-3 text-sm text-ink-500">No products to recommend yet.</p>
      ) : (
        <ul className="scrollbar-none flex gap-3 overflow-x-auto px-4 py-3">
          {products.map((product) => (
            <li key={product.id} className="w-56 shrink-0">
              <Link
                to={`/products/${product.id}`}
                className="flex gap-3 rounded-xl border border-ink-100 bg-white p-2 transition-colors hover:border-ink-300"
              >
                <ImageWithFallback src={product.imageUrl} alt="" className="size-16 shrink-0 rounded-lg" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink-950">{product.name}</span>
                  <span className="block truncate text-xs text-ink-500">{product.shop.name}</span>
                  <span className="mt-1 block text-sm font-semibold text-ink-950">{formatMoney(product.price)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'shrink-0 rounded-full border px-3 py-1 text-sm font-medium transition-colors',
        active ? 'border-ink-950 bg-ink-950 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-ink-400',
      )}
    >
      {children}
    </button>
  );
}
