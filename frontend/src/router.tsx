import {
  ClipboardList,
  FolderTree,
  LayoutDashboard,
  Package,
  Store,
  UserCircle,
  Users,
  UsersRound,
} from 'lucide-react';
import { lazy, type ComponentType } from 'react';
import { createBrowserRouter, Outlet, ScrollRestoration } from 'react-router';
import { GuestOnly, RequireRole, RequireSignedIn } from './auth/guards';
import { DashboardLayout, type DashboardNavItem } from './components/layout/DashboardLayout';
import { PublicLayout } from './components/layout/PublicLayout';
import { HomeMapPage } from './features/discovery/HomeMapPage';
import { NotFoundPage, RouteErrorPage } from './pages/ErrorPages';

/**
 * Only the map landing page ships in the first download; every other page is its own chunk,
 * so shoppers never download the dashboards.
 */
function lazyPage<M extends Record<string, unknown>>(load: () => Promise<M>, name: keyof M & string) {
  return lazy(async () => ({ default: (await load())[name] as ComponentType }));
}

const SearchPage = lazyPage(() => import('./features/discovery/SearchPage'), 'SearchPage');
const StorefrontPage = lazyPage(() => import('./features/discovery/StorefrontPage'), 'StorefrontPage');
const ProductPage = lazyPage(() => import('./features/discovery/ProductPage'), 'ProductPage');
const CartPage = lazyPage(() => import('./features/cart/CartPage'), 'CartPage');
const CheckoutPage = lazyPage(() => import('./features/cart/CheckoutPage'), 'CheckoutPage');
const OrderPage = lazyPage(() => import('./features/orders/OrderPage'), 'OrderPage');
const LoginPage = lazyPage(() => import('./features/auth/LoginPage'), 'LoginPage');
const RegisterPage = lazyPage(() => import('./features/auth/RegisterPage'), 'RegisterPage');
const AccountPage = lazyPage(() => import('./features/auth/AccountPage'), 'AccountPage');
const ChangePasswordPage = lazyPage(() => import('./features/auth/ChangePasswordPage'), 'ChangePasswordPage');

const AdminOverviewPage = lazyPage(() => import('./features/admin/OverviewPage'), 'OverviewPage');
const AdminShopsPage = lazyPage(() => import('./features/admin/ShopsPage'), 'ShopsPage');
const AdminShopFormPage = lazyPage(() => import('./features/admin/ShopFormPage'), 'ShopFormPage');
const AdminMerchantsPage = lazyPage(() => import('./features/admin/MerchantsPage'), 'MerchantsPage');
const AdminMerchantDetailPage = lazyPage(() => import('./features/admin/MerchantDetailPage'), 'MerchantDetailPage');
const AdminCustomersPage = lazyPage(() => import('./features/admin/CustomersPage'), 'CustomersPage');
const AdminCategoriesPage = lazyPage(() => import('./features/admin/CategoriesPage'), 'CategoriesPage');
const AdminAuditLogPage = lazyPage(() => import('./features/admin/AuditLogPage'), 'AuditLogPage');

const MerchantDashboardPage = lazyPage(() => import('./features/merchant/DashboardPage'), 'DashboardPage');
const MerchantProductsPage = lazyPage(() => import('./features/merchant/ProductsPage'), 'ProductsPage');
const MerchantProductFormPage = lazyPage(() => import('./features/merchant/ProductFormPage'), 'ProductFormPage');
const MerchantShopPage = lazyPage(() => import('./features/merchant/ShopPage'), 'ShopPage');
const MerchantProfilePage = lazyPage(() => import('./features/merchant/ProfilePage'), 'ProfilePage');

const ADMIN_NAV: DashboardNavItem[] = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/shops', label: 'Shops', icon: Store },
  { to: '/admin/merchants', label: 'Merchants', icon: UsersRound },
  { to: '/admin/customers', label: 'Customers', icon: Users },
  { to: '/admin/categories', label: 'Categories', icon: FolderTree },
  { to: '/admin/audit-log', label: 'Audit log', icon: ClipboardList },
];

const MERCHANT_NAV: DashboardNavItem[] = [
  { to: '/merchant', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/merchant/products', label: 'Products', icon: Package },
  { to: '/merchant/shop', label: 'My shop', icon: Store },
  { to: '/merchant/profile', label: 'Profile', icon: UserCircle },
];

function RootLayout() {
  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <PublicLayout />,
        children: [
          { index: true, element: <HomeMapPage /> },
          { path: 'search', element: <SearchPage /> },
          { path: 'shops/:slug', element: <StorefrontPage /> },
          { path: 'products/:productId', element: <ProductPage /> },
          { path: 'cart', element: <CartPage /> },
          {
            path: 'checkout',
            element: (
              <RequireRole roles={['CUSTOMER']}>
                <CheckoutPage />
              </RequireRole>
            ),
          },
          {
            path: 'orders/:orderId',
            element: (
              <RequireRole roles={['CUSTOMER']}>
                <OrderPage />
              </RequireRole>
            ),
          },
          {
            path: 'login',
            element: (
              <GuestOnly>
                <LoginPage />
              </GuestOnly>
            ),
          },
          {
            path: 'register',
            element: (
              <GuestOnly>
                <RegisterPage />
              </GuestOnly>
            ),
          },
          {
            path: 'account',
            element: (
              <RequireSignedIn>
                <AccountPage />
              </RequireSignedIn>
            ),
          },
          {
            path: 'account/change-password',
            element: (
              <RequireSignedIn>
                <ChangePasswordPage />
              </RequireSignedIn>
            ),
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      {
        path: 'admin',
        element: (
          <RequireRole roles={['SUPER_ADMIN']}>
            <DashboardLayout area="Admin" nav={ADMIN_NAV} />
          </RequireRole>
        ),
        children: [
          { index: true, element: <AdminOverviewPage /> },
          { path: 'shops', element: <AdminShopsPage /> },
          { path: 'shops/new', element: <AdminShopFormPage /> },
          { path: 'shops/:shopId', element: <AdminShopFormPage /> },
          { path: 'merchants', element: <AdminMerchantsPage /> },
          { path: 'merchants/:merchantId', element: <AdminMerchantDetailPage /> },
          { path: 'customers', element: <AdminCustomersPage /> },
          { path: 'categories', element: <AdminCategoriesPage /> },
          { path: 'audit-log', element: <AdminAuditLogPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      {
        path: 'merchant',
        element: (
          <RequireRole roles={['MERCHANT']}>
            <DashboardLayout area="Merchant" nav={MERCHANT_NAV} />
          </RequireRole>
        ),
        children: [
          { index: true, element: <MerchantDashboardPage /> },
          { path: 'products', element: <MerchantProductsPage /> },
          { path: 'products/new', element: <MerchantProductFormPage /> },
          { path: 'products/:productId', element: <MerchantProductFormPage /> },
          { path: 'shop', element: <MerchantShopPage /> },
          { path: 'profile', element: <MerchantProfilePage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
