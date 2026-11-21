import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM, type PublicShopSummary } from '@marketplace/contracts';
import { MarkerClusterer, type Renderer } from '@googlemaps/markerclusterer';
import { AdvancedMarker, InfoWindow, Map as GoogleMap, Pin, useMap } from '@vis.gl/react-google-maps';
import { ArrowRight, MapPin, X } from 'lucide-react';
import { useCallback, useEffect, useEffectEvent, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { MapsProvider } from '../../components/maps/MapsProvider';
import { GOOGLE_MAPS_MAP_ID } from '../../config';
import { pluralize } from '../../lib/format';

export type Bounds = google.maps.LatLngBoundsLiteral;

/** The exact coordinates stored for the shop by the administrator. */
export function shopPosition(shop: { latitude: string; longitude: string }): google.maps.LatLngLiteral {
  return { lat: Number(shop.latitude), lng: Number(shop.longitude) };
}

export function isInBounds(shop: { latitude: string; longitude: string }, bounds: Bounds): boolean {
  const { lat, lng } = shopPosition(shop);
  const withinLng = bounds.west <= bounds.east ? lng >= bounds.west && lng <= bounds.east : lng >= bounds.west || lng <= bounds.east;
  return lat >= bounds.south && lat <= bounds.north && withinLng;
}

const clusterRenderer: Renderer = {
  render: ({ count, position }) => {
    const content = document.createElement('div');
    content.className = 'map-cluster';
    content.textContent = String(count);
    return new google.maps.marker.AdvancedMarkerElement({
      position,
      content,
      title: `${count} shops`,
      zIndex: 1000 + count,
    });
  },
};

interface ShopMapProps {
  shops: PublicShopSummary[];
  selectedId: string | null;
  onSelect: (shopId: string | null) => void;
  onBoundsChange?: (bounds: Bounds) => void;
  className?: string;
}

export function ShopMap(props: ShopMapProps) {
  return (
    <MapsProvider className={props.className}>
      <div className={props.className}>
        <GoogleMap
          mapId={GOOGLE_MAPS_MAP_ID}
          defaultCenter={DEFAULT_MAP_CENTER}
          defaultZoom={DEFAULT_MAP_ZOOM}
          gestureHandling="greedy"
          mapTypeControl={false}
          streetViewControl={false}
          fullscreenControl={false}
          clickableIcons={false}
          onIdle={(event) => {
            const bounds = event.map.getBounds();
            if (bounds) props.onBoundsChange?.(bounds.toJSON());
          }}
          onClick={() => props.onSelect(null)}
          className="size-full"
        >
          <ShopMarkers {...props} />
        </GoogleMap>
      </div>
    </MapsProvider>
  );
}

function ShopMarkers({ shops, selectedId, onSelect }: ShopMapProps) {
  const map = useMap();
  const [markers, setMarkers] = useState<Record<string, google.maps.marker.AdvancedMarkerElement>>({});
  const clusterer = useMemo(() => (map ? new MarkerClusterer({ map, renderer: clusterRenderer }) : null), [map]);

  useEffect(() => {
    return () => clusterer?.setMap(null);
  }, [clusterer]);

  useEffect(() => {
    if (!clusterer) return;
    clusterer.clearMarkers();
    clusterer.addMarkers(Object.values(markers));
  }, [clusterer, markers]);

  const registerMarker = useCallback((shopId: string, marker: google.maps.marker.AdvancedMarkerElement | null) => {
    setMarkers((current) => {
      if (marker ? current[shopId] === marker : !current[shopId]) return current;
      const next = { ...current };
      if (marker) next[shopId] = marker;
      else delete next[shopId];
      return next;
    });
  }, []);

  const frameResults = useEffectEvent((target: google.maps.Map) => {
    if (shops.length === 0) return;
    if (shops.length === 1) {
      target.setCenter(shopPosition(shops[0]!));
      target.setZoom(16);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    for (const shop of shops) bounds.extend(shopPosition(shop));
    target.fitBounds(bounds, 56);
  });

  // Bring the selected shop into view, zooming in far enough to break up its cluster.
  const revealShop = useEffectEvent((target: google.maps.Map, shopId: string) => {
    const shop = shops.find((item) => item.id === shopId);
    if (!shop) return;
    target.panTo(shopPosition(shop));
    if ((target.getZoom() ?? 0) < 15) target.setZoom(15);
  });

  // Re-frame only when the set of shops changes (a new search or filter), not on every render.
  const shopKey = shops.map((shop) => shop.id).join(',');
  useEffect(() => {
    if (map) frameResults(map);
  }, [map, shopKey]);

  useEffect(() => {
    if (map && selectedId) revealShop(map, selectedId);
  }, [map, selectedId]);

  const selected = shops.find((shop) => shop.id === selectedId) ?? null;

  return (
    <>
      {shops.map((shop) => (
        <ShopMarker
          key={shop.id}
          shop={shop}
          selected={shop.id === selectedId}
          onSelect={onSelect}
          registerMarker={registerMarker}
        />
      ))}
      {selected ? (
        <InfoWindow
          position={shopPosition(selected)}
          pixelOffset={[0, -46]}
          onCloseClick={() => onSelect(null)}
          headerDisabled
          minWidth={220}
        >
          <div className="relative space-y-2 pb-1 text-sm">
            <button
              type="button"
              aria-label="Close"
              onClick={() => onSelect(null)}
              className="absolute right-0 top-0 rounded-md p-0.5 text-ink-500 hover:bg-ink-100 hover:text-ink-950"
            >
              <X className="size-3.5" />
            </button>
            <p className="pr-6 text-base font-semibold text-ink-950">{selected.name}</p>
            <p className="flex items-start gap-1.5 text-ink-600">
              <MapPin className="mt-0.5 size-3.5 shrink-0" />
              {selected.addressText}
            </p>
            <p className="text-ink-600">{pluralize(selected.productCount, 'product')}</p>
            {selected.categories.length > 0 ? (
              <p className="text-xs text-ink-500">{selected.categories.map((category) => category.name).join(' · ')}</p>
            ) : null}
            <Link
              to={`/shops/${selected.slug}`}
              className="inline-flex items-center gap-1 rounded-lg bg-ink-950 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800"
            >
              Visit shop <ArrowRight className="size-3.5" />
            </Link>
          </div>
        </InfoWindow>
      ) : null}
    </>
  );
}

function ShopMarker({
  shop,
  selected,
  onSelect,
  registerMarker,
}: {
  shop: PublicShopSummary;
  selected: boolean;
  onSelect: (shopId: string) => void;
  registerMarker: (shopId: string, marker: google.maps.marker.AdvancedMarkerElement | null) => void;
}) {
  const ref = useCallback(
    (marker: google.maps.marker.AdvancedMarkerElement | null) => registerMarker(shop.id, marker),
    [registerMarker, shop.id],
  );
  return (
    <AdvancedMarker
      ref={ref}
      position={shopPosition(shop)}
      title={shop.name}
      zIndex={selected ? 2000 : undefined}
      onClick={() => onSelect(shop.id)}
    >
      <Pin
        background={selected ? '#f0b429' : '#0b0b0f'}
        borderColor={selected ? '#8f5b0b' : '#0b0b0f'}
        glyphColor={selected ? '#0b0b0f' : '#f0b429'}
        scale={selected ? 1.25 : 1}
      />
    </AdvancedMarker>
  );
}
