import type { AssistantChatResponse, AssistantProductCard, AssistantShopCard } from '@marketplace/contracts';
import { MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { api, errorMessage } from '../../lib/api';
import { RecommendationList } from './RecommendationList';

const SUGGESTIONS = [
  'Find shoes below 20,000 ETB',
  'Show phones under 15,000 birr',
  'Find the nearest shop selling laptops',
];

interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
  products: AssistantProductCard[];
  shops: AssistantShopCard[];
}

const NEEDS_LOCATION = /\b(near|nearby|nearest|closest|around me|close to me)\b/i;

function readPosition(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 8_000,
      maximumAge: 60_000,
    });
  });
}

/**
 * Shopper-facing chat. The Gemini key never reaches this file: the browser only calls
 * POST /ai/chat, and device coordinates are sent to our API so the server can measure distance.
 */
export function ShoppingAssistant() {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationState, setLocationState] = useState<'unknown' | 'on' | 'denied' | 'unsupported'>('unknown');
  const [area, setArea] = useState('');

  async function shareLocation(): Promise<{ latitude: number; longitude: number } | null> {
    if (location) return location;
    if (!navigator.geolocation) {
      setLocationState('unsupported');
      return null;
    }
    try {
      const position = await readPosition();
      const next = { latitude: position.coords.latitude, longitude: position.coords.longitude };
      setLocation(next);
      setLocationState('on');
      return next;
    } catch {
      setLocationState('denied');
      return null;
    }
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || pending) return;
    setError(null);
    const history = turns.slice(-10).map((turn) => ({ role: turn.role, text: turn.text }));
    setTurns((current) => [...current, { role: 'user', text: message, products: [], shops: [] }]);
    setDraft('');
    setPending(true);
    let origin = location;
    if (NEEDS_LOCATION.test(message) && !origin && locationState !== 'denied' && locationState !== 'unsupported') {
      origin = await shareLocation();
    }
    try {
      const data = await api.post<AssistantChatResponse>(
        '/ai/chat',
        {
          message,
          history,
          ...(origin ? { location: origin } : {}),
          ...(area.trim().length >= 2 ? { area: area.trim() } : {}),
        },
        { auth: false },
      );
      setTurns((current) => [
        ...current,
        { role: 'assistant', text: data.reply, products: data.products, shops: data.shops },
      ]);
    } catch (caught) {
      setError(errorMessage(caught, 'The assistant could not answer just now.'));
    } finally {
      setPending(false);
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };

  return (
    <>
      {open ? (
        <section
          aria-label="Shopping assistant"
          className="fixed inset-x-3 bottom-3 z-40 flex max-h-[min(40rem,calc(100dvh-5rem))] flex-col overflow-hidden rounded-2xl border border-ink-200 bg-ink-50 shadow-pop sm:inset-x-auto sm:right-6 sm:w-[24rem]"
        >
          <header className="flex items-start gap-3 border-b border-ink-100 bg-white px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-ink-950 text-accent-400">
              <Sparkles className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink-950">Shopping assistant</span>
              <span className="block text-xs text-ink-500">Searches the public catalog only</span>
            </span>
            <button
              type="button"
              className="rounded-lg p-1 text-ink-500 hover:bg-ink-100"
              aria-label="Close assistant"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
            <p className="rounded-xl bg-white px-3 py-2 text-xs leading-relaxed text-ink-600">
              {locationState === 'on'
                ? 'Using your location to sort nearby shops. The exact point stays on our server.'
                : 'For “near me”, allow location when the browser asks. If you decline, type a neighborhood instead.'}
            </p>
            {locationState === 'denied' || locationState === 'unsupported' ? (
              <label className="block text-xs text-ink-600">
                Neighborhood or area
                <input
                  value={area}
                  onChange={(event) => setArea(event.target.value)}
                  maxLength={80}
                  placeholder="Hermata, Jimma"
                  className="mt-1 h-9 w-full rounded-lg border border-ink-200 bg-white px-3 text-sm text-ink-900"
                />
              </label>
            ) : (
              <Button type="button" variant="secondary" size="sm" onClick={() => void shareLocation()}>
                {locationState === 'on' ? 'Location on' : 'Share location'}
              </Button>
            )}

            {turns.length === 0 ? (
              <div className="flex flex-wrap gap-2">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="rounded-full border border-ink-200 bg-white px-3 py-1.5 text-left text-xs text-ink-800 hover:border-ink-400"
                    onClick={() => void send(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : (
              turns.map((turn, index) => (
                <div key={`${turn.role}-${index}`} className={turn.role === 'user' ? 'flex justify-end' : ''}>
                  <div
                    className={
                      turn.role === 'user'
                        ? 'max-w-[85%] rounded-2xl bg-ink-950 px-3 py-2 text-sm text-white'
                        : 'max-w-full rounded-2xl bg-white px-3 py-2 text-sm text-ink-800'
                    }
                  >
                    <p className="whitespace-pre-wrap">{turn.text}</p>
                    {turn.role === 'assistant' ? (
                      <RecommendationList products={turn.products} shops={turn.shops} />
                    ) : null}
                  </div>
                </div>
              ))
            )}
            {pending ? (
              <p className="flex items-center gap-2 text-xs text-ink-500" role="status">
                <Spinner className="size-3.5" /> Looking through the catalog…
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                {error}
              </p>
            ) : null}
          </div>

          <form onSubmit={onSubmit} className="flex gap-2 border-t border-ink-100 bg-white p-3">
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={500}
              placeholder="Ask about products or shops"
              aria-label="Message the shopping assistant"
              className="h-10 min-w-0 flex-1 rounded-xl border border-ink-200 px-3 text-sm focus:border-ink-400 focus:outline-none focus:ring-2 focus:ring-accent-400/60"
            />
            <Button type="submit" size="sm" disabled={pending || draft.trim().length === 0} aria-label="Send">
              <Send className="size-4" />
            </Button>
          </form>
        </section>
      ) : (
        <button
          type="button"
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-ink-950 py-3 pl-4 pr-5 text-sm font-medium text-white shadow-pop hover:bg-ink-800 sm:bottom-6 sm:right-6"
          onClick={() => setOpen(true)}
        >
          <MessageCircle className="size-4 text-accent-400" />
          Assistant
        </button>
      )}
    </>
  );
}
