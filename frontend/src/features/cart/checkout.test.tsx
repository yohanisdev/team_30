import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/AuthProvider';
import { CheckoutPage } from './CheckoutPage';

const quote = {
  fulfillmentPreference: 'DELIVERY',
  currency: 'ETB',
  shops: [
    {
      shopId: 'shop-1',
      shopName: 'Shoe Shop',
      shopSlug: 'shoe-shop',
      items: [
        {
          cartItemId: 'line-1',
          productId: 'product-1',
          name: 'Running shoes',
          imageUrl: null,
          unitPrice: '12500.00',
          quantity: 1,
          lineTotal: '12500.00',
          issue: null,
        },
      ],
      subtotal: '12500.00',
      deliveryFee: '0.00',
      total: '12500.00',
    },
  ],
  merchandiseSubtotal: '12500.00',
  deliveryFeeTotal: '0.00',
  grandTotal: '12500.00',
  canCheckout: true,
  issues: [],
};

function renderCheckout() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter>
          <CheckoutPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('checkout', () => {
  it('shows Pay now and submits the checkout request once', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) return new Response('{}', { status: 401 });
      if (url.endsWith('/checkout/quote')) {
        return new Response(JSON.stringify({ success: true, data: quote, error: null, meta: {} }), { status: 200 });
      }
      if (url.endsWith('/checkout') && init?.method === 'POST') {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              order: {
                id: 'order-1',
                orderNumber: 'ORD-1',
                paymentStatus: 'UNPAID',
                merchantOrders: [],
              },
              chapa: { paymentId: 'pay-1', checkoutUrl: null, initializationError: true },
            },
            error: null,
            meta: {},
          }),
          { status: 201 },
        );
      }
      return new Response('{}', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    renderCheckout();

    expect(await screen.findByRole('button', { name: 'Pay now' })).toBeEnabled();
    await user.type(screen.getByLabelText(/Contact name/), 'Sara Bekele');
    await user.type(screen.getByLabelText(/Address name/), 'Hermata');
    await user.type(screen.getByLabelText(/House number/), '12');
    await user.type(screen.getByLabelText(/^Phone/), '0911223344');
    await user.click(screen.getByRole('button', { name: 'Pay now' }));

    await screen.findByRole('button', { name: 'Pay now' });
    const checkoutCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/checkout') && call[1]?.method === 'POST');
    expect(checkoutCall).toBeTruthy();
    const headers = new Headers(checkoutCall?.[1]?.headers);
    expect(headers.get('Idempotency-Key')).toEqual(expect.any(String));
    const body = JSON.parse(String(checkoutCall?.[1]?.body));
    expect(body.paymentMethod).toBe('CHAPA');
    expect(body.contactName).toBe('Sara Bekele');
    expect(body).not.toHaveProperty('grandTotal');
  });
});
