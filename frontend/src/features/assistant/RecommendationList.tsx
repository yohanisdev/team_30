import type { AssistantProductCard, AssistantShopCard } from '@marketplace/contracts';
import { MapPin } from 'lucide-react';
import { Link } from 'react-router';
import { ImageWithFallback } from '../../components/ui/ImageWithFallback';
import { formatMoney } from '../../lib/format';

export function formatDistance(km: number | null): string | null {
  if (km === null) return null;
  if (km < 0.1) return 'Under 0.1 km';
  return `${km.toFixed(1)} km away`;
}

export function ProductRecommendation({ product }: { product: AssistantProductCard }) {
  const distance = formatDistance(product.distanceKm);
  return (
    <Link
      to={`/products/${product.productId}`}
      className="flex gap-3 rounded-xl border border-ink-100 bg-white p-2 transition-colors hover:border-ink-300"
    >
      <ImageWithFallback
        src={product.imageUrl}
        alt=""
        className="size-16 shrink-0 rounded-lg"
        iconClassName="size-5"
      />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-sm font-medium text-ink-950">{product.name}</span>
        <span className="mt-0.5 block truncate text-xs text-ink-500">{product.shopName}</span>
        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className="font-semibold text-ink-950">{formatMoney(product.price)}</span>
          <span className={product.available ? 'text-emerald-700' : 'text-ink-500'}>
            {product.available ? 'Available' : 'Unavailable'}
          </span>
          {distance ? (
            <span className="inline-flex items-center gap-1 text-ink-500">
              <MapPin className="size-3" /> {distance}
            </span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

export function ShopRecommendation({ shop }: { shop: AssistantShopCard }) {
  const distance = formatDistance(shop.distanceKm);
  return (
    <Link
      to={`/shops/${shop.slug}`}
      className="flex gap-3 rounded-xl border border-ink-100 bg-white p-2 transition-colors hover:border-ink-300"
    >
      <ImageWithFallback src={shop.logoUrl} alt="" className="size-12 shrink-0 rounded-lg" iconClassName="size-5" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium text-ink-950">{shop.name}</span>
        <span className="mt-0.5 block truncate text-xs text-ink-500">{shop.addressText}</span>
        {distance ? <span className="mt-1 block text-xs text-ink-500">{distance}</span> : null}
      </span>
    </Link>
  );
}

export function RecommendationList({
  products,
  shops,
}: {
  products: AssistantProductCard[];
  shops: AssistantShopCard[];
}) {
  if (products.length === 0 && shops.length === 0) return null;
  return (
    <div className="mt-2 space-y-2">
      {shops.map((shop) => (
        <ShopRecommendation key={shop.shopId} shop={shop} />
      ))}
      {products.map((product) => (
        <ProductRecommendation key={product.productId} product={product} />
      ))}
    </div>
  );
}
