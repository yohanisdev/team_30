import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ToastProvider } from '../../components/ui/Toast';
import { ShopFormPage } from './ShopFormPage';

describe('shop registration', () => {
  it('asks for the merchant name as text and rejects an empty name', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <ShopFormPage />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );

    const name = screen.getByLabelText(/Merchant name/);
    expect(name.tagName).toBe('INPUT');
    expect(screen.queryByRole('combobox', { name: /Merchant/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create shop' }));
    expect(await screen.findByText(/Enter the merchant's full name|Full name must be at least 2 characters/)).toBeInTheDocument();
  });
});
