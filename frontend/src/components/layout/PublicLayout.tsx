import { Map as MapIcon, Search, ShoppingBag, Store } from 'lucide-react';
import { Suspense, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { APP_NAME, APP_TAGLINE } from '../../config';
import { useCart } from '../../features/cart/CartProvider';
import { cn } from '../../lib/cn';
import { ButtonLink } from '../ui/Button';
import { LoadingState } from '../ui/States';
import { ShoppingAssistant } from '../../features/assistant/ShoppingAssistant';
import { AccountMenu } from './AccountMenu';
import { Logo } from './Logo';

function SearchBox({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = query.trim();
    navigate(q ? `/search?q=${encodeURIComponent(q)}` : '/search');
  };

  return (
    <form role="search" onSubmit={submit} className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400" />
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search products across all shops"
        aria-label="Search products"
        maxLength={100}
        className="h-10 w-full rounded-xl border border-ink-200 bg-ink-50 pl-9 pr-3 text-sm placeholder:text-ink-400 focus:border-ink-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent-400/60"
      />
    </form>
  );
}

function CartButton() {
  const { mode, itemCount } = useCart();
  if (mode === 'unavailable') return null;
  return (
    <Link
      to="/cart"
      className="relative flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm font-medium text-ink-800 hover:bg-ink-50"
      aria-label={`Cart, ${itemCount} items`}
    >
      <ShoppingBag className="size-5" />
      <span className="hidden sm:inline">Cart</span>
      {itemCount > 0 ? (
        <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-accent-400 px-1 text-[11px] font-semibold text-ink-950 sm:static sm:min-w-6">
          {itemCount > 99 ? '99+' : itemCount}
        </span>
      ) : null}
    </Link>
  );
}

const navLink = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors',
    isActive ? 'text-ink-950 bg-ink-100' : 'text-ink-600 hover:text-ink-950 hover:bg-ink-50',
  );

export function PublicLayout() {
  const { user, ready } = useAuth();
  const isHome = useLocation().pathname === '/';
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-ink-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Logo className="shrink-0" />
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            <NavLink to="/" end className={navLink}>
              <MapIcon className="size-4" /> Map
            </NavLink>
            <NavLink to="/search" className={navLink}>
              <Store className="size-4" /> Products
            </NavLink>
          </nav>
          <SearchBox className="ml-auto hidden w-full max-w-md lg:block" />
          <div className="ml-auto flex items-center gap-1 lg:ml-0">
            <CartButton />
            {!ready ? null : user ? (
              <AccountMenu />
            ) : (
              <>
                <ButtonLink to="/login" variant="ghost" size="sm">
                  Sign in
                </ButtonLink>
                <ButtonLink to="/register" variant="primary" size="sm" className="hidden sm:inline-flex">
                  Create account
                </ButtonLink>
              </>
            )}
          </div>
        </div>
        {isHome ? null : (
          <div className="border-t border-ink-100 px-4 py-2 lg:hidden">
            <SearchBox />
          </div>
        )}
      </header>

      <main className="flex-1">
        <Suspense fallback={<LoadingState className="min-h-[50vh]" />}>
          <Outlet />
        </Suspense>
      </main>

      <ShoppingAssistant />

      <footer className="border-t border-ink-100 bg-ink-50/60">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-sm text-ink-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            <span className="font-semibold text-ink-800">{APP_NAME}</span> · {APP_TAGLINE}
          </p>
          <p>Prices in Ethiopian Birr (ETB). Made for Jimma.</p>
        </div>
      </footer>
    </div>
  );
}
