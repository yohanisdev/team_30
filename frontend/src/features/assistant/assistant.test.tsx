import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ShoppingAssistant } from './ShoppingAssistant';

const product = {
  productId: '22222222-2222-4222-8222-222222222222',
  name: 'Running shoes',
  description: 'Lightweight trainers',
  price: '12500.00',
  currency: 'ETB' as const,
  imageUrl: null,
  available: true,
  categoryName: 'Fashion',
  categorySlug: 'fashion',
  shopId: '11111111-1111-4111-8111-111111111111',
  shopName: 'Tigist Fashion',
  shopSlug: 'tigist-fashion',
  distanceKm: 2.1,
};

describe('shopping assistant', () => {
  it('does not mention a Gemini key in frontend configuration', () => {
    const root = resolve(process.cwd(), 'src');
    const files: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/\.(ts|tsx|js|jsx|css|html)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
          files.push(path);
        }
      }
    };
    walk(root);
    const leaked = files.filter((path) => /GEMINI_API_KEY|VITE_GEMINI/i.test(readFileSync(path, 'utf8')));
    expect(leaked).toEqual([]);
  });

  it('shows catalog product cards from the assistant response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: { reply: 'I found one product in the catalog.', products: [product], shops: [] },
          error: null,
          meta: {},
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ShoppingAssistant />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Assistant' }));
    await user.click(screen.getByRole('button', { name: 'Find shoes below 20,000 ETB' }));

    expect(await screen.findByRole('link', { name: /Running shoes/ })).toHaveAttribute(
      'href',
      '/products/22222222-2222-4222-8222-222222222222',
    );
    expect(screen.getByText('ETB 12,500.00')).toBeInTheDocument();
    expect(screen.getByText('Tigist Fashion')).toBeInTheDocument();
    expect(screen.getByText('2.1 km away')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.message).toBe('Find shoes below 20,000 ETB');
    expect(body).not.toHaveProperty('apiKey');
    expect(JSON.stringify(body)).not.toMatch(/GEMINI/i);
  });
});
