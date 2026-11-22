import type { AuthUser } from '@marketplace/contracts';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { LoginPage, returnPathFor } from './LoginPage';

const { login } = vi.hoisted(() => ({ login: vi.fn() }));

vi.mock('../../auth/AuthProvider', async () => {
  const actual = await vi.importActual<typeof import('../../auth/AuthProvider')>('../../auth/AuthProvider');
  return { ...actual, useAuth: () => ({ login }) };
});

const admin: AuthUser = {
  id: '11111111-1111-4111-8111-111111111111',
  role: 'SUPER_ADMIN',
  status: 'ACTIVE',
  fullName: 'E-Gebeya Super Admin',
  username: 'gebeya',
  mustChangePassword: false,
};

function Location() {
  const location = useLocation();
  return <div>at {location.pathname}</div>;
}

function renderLogin() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/admin" element={<Location />} />
        <Route path="/account/change-password" element={<Location />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Super Admin sign-in', () => {
  it('sends username and password, then opens the admin dashboard', async () => {
    login.mockResolvedValue(admin);
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Username'), 'Gebeya');
    await user.type(screen.getByLabelText('Password'), 'a-real-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(login).toHaveBeenCalledWith({ username: 'gebeya', password: 'a-real-password' });
    expect(await screen.findByText('at /admin')).toBeInTheDocument();
  });

  it('sends a first-login Super Admin to change their password', async () => {
    login.mockResolvedValue({ ...admin, mustChangePassword: true });
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Username'), 'admin');
    await user.type(screen.getByLabelText('Password'), 'temporary-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(login).toHaveBeenCalledWith({ username: 'admin', password: 'temporary-password' });
    expect(await screen.findByText('at /account/change-password')).toBeInTheDocument();
  });

  it('keeps a Super Admin who still must change their password off the dashboard', () => {
    expect(returnPathFor({ ...admin, mustChangePassword: true }, '/admin')).toBe('/account/change-password');
    expect(returnPathFor(admin, '/admin/shops')).toBe('/admin/shops');
    expect(returnPathFor({ ...admin, role: 'CUSTOMER' }, '/admin')).toBe('/');
  });
});
