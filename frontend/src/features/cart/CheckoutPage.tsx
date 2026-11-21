import type { CheckoutQuote, CheckoutResult, FulfillmentPreference, PaymentMethod } from '@marketplace/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, PackageCheck, Store, Truck } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../../auth/AuthProvider';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field, FormError, Input, Textarea } from '../../components/ui/Form';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/States';
import { api, errorMessage } from '../../lib/api';
import { cn } from '../../lib/cn';
import { formatMoney } from '../../lib/format';
import { LineIssueBadge } from './LineIssueBadge';

const OPTIONS: { value: FulfillmentPreference; title: string; description: string; icon: typeof Truck }[] = [
  { value: 'DELIVERY', title: 'Delivery', description: 'Each shop delivers its part. Shop delivery fees apply.', icon: Truck },
  { value: 'PICKUP', title: 'Pickup', description: 'Collect from each shop yourself. No delivery fees.', icon: PackageCheck },
];

export function CheckoutPage() {
  const { user } = useAuth();
  const [preference, setPreference] = useState<FulfillmentPreference>('DELIVERY');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CHAPA');
  const [contactName, setContactName] = useState(user?.fullName ?? '');
  const [addressName, setAddressName] = useState('');
  const [houseNumber, setHouseNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [payerEmail, setPayerEmail] = useState('');
  const [customerNote, setCustomerNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Every amount on this page is recomputed by the server from live prices and stock.
  const quoteQuery = useQuery({
    queryKey: ['checkout-quote', preference],
    queryFn: () => api.post<CheckoutQuote>('/checkout/quote', { fulfillmentPreference: preference }),
    staleTime: 0,
  });

  const placeOrder = async () => {
    if (submitting || !quoteQuery.data?.canCheckout) return;
    const body = {
      fulfillmentPreference: preference,
      paymentMethod,
      contactName,
      addressName,
      houseNumber,
      phoneNumber,
      customerNote,
      ...(paymentMethod === 'CHAPA' && payerEmail.trim() ? { payerEmail: payerEmail.trim() } : {}),
    };
    const serialized = JSON.stringify(body);
    if (!attempt.current || attempt.current.body !== serialized) {
      attempt.current = { key: crypto.randomUUID(), body: serialized };
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await api.post<CheckoutResult>('/checkout', body, {
        headers: { 'Idempotency-Key': attempt.current.key },
      });
      await queryClient.invalidateQueries({ queryKey: ['cart'] });
      if (result.chapa?.checkoutUrl) {
        window.location.assign(result.chapa.checkoutUrl);
        return;
      }
      navigate(`/orders/${result.order.id}`, {
        state: {
          notice: result.chapa?.initializationError
            ? 'Your order is saved and unpaid. The payment service did not start, so nothing was marked as paid.'
            : paymentMethod === 'BANK_TRANSFER'
              ? 'Order confirmed. Transfer each shop total, then upload the receipt.'
              : 'Order placed.',
        },
      });
    } catch (error) {
      setFormError(errorMessage(error, 'The order could not be placed.'));
      void quoteQuery.refetch();
    } finally {
      setSubmitting(false);
    }
  };

  const actionLabel = paymentMethod === 'CHAPA' ? 'Pay now' : 'Confirm order';

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <Link to="/cart" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-950">
        <ArrowLeft className="size-4" /> Back to cart
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-950">Review checkout</h1>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <fieldset>
            <legend className="mb-3 text-sm font-semibold text-ink-950">How do you want to receive your order?</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    'flex cursor-pointer gap-3 rounded-2xl border p-4 transition-colors',
                    preference === option.value ? 'border-ink-950 ring-2 ring-accent-400/60' : 'border-ink-200 hover:border-ink-400',
                  )}
                >
                  <input
                    type="radio"
                    name="fulfillment"
                    value={option.value}
                    checked={preference === option.value}
                    onChange={() => setPreference(option.value)}
                    className="sr-only"
                  />
                  <option.icon className="mt-0.5 size-5 shrink-0 text-accent-700" />
                  <span>
                    <span className="block text-sm font-semibold text-ink-950">{option.title}</span>
                    <span className="block text-sm text-ink-500">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {quoteQuery.isPending ? (
            <Skeleton className="h-64" />
          ) : quoteQuery.isError ? (
            <ErrorState error={quoteQuery.error} onRetry={() => void quoteQuery.refetch()} />
          ) : quoteQuery.data.shops.length === 0 ? (
            <EmptyState title="Your cart is empty" action={<ButtonLink to="/">Explore shops</ButtonLink>} />
          ) : (
            <div className="space-y-4">
              {quoteQuery.data.shops.map((group) => (
                <Card key={group.shopId}>
                  <div className="flex items-center gap-2 border-b border-ink-100 px-5 py-3 font-semibold text-ink-950">
                    <Store className="size-4 text-accent-700" /> {group.shopName}
                  </div>
                  <ul className="divide-y divide-ink-100 px-5">
                    {group.items.map((line) => (
                      <li key={line.cartItemId} className="flex items-start justify-between gap-4 py-3 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium text-ink-900">{line.name}</p>
                          <p className="text-ink-500">
                            {line.quantity} × {formatMoney(line.unitPrice)}
                          </p>
                          {line.issue ? (
                            <div className="mt-1">
                              <LineIssueBadge issue={line.issue} />
                            </div>
                          ) : null}
                        </div>
                        <p className={line.issue ? 'text-ink-400 line-through' : 'font-medium text-ink-900'}>
                          {formatMoney(line.lineTotal)}
                        </p>
                      </li>
                    ))}
                  </ul>
                  <dl className="space-y-1 border-t border-ink-100 px-5 py-3 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-ink-600">Subtotal</dt>
                      <dd>{formatMoney(group.subtotal)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-ink-600">Delivery fee</dt>
                      <dd>{formatMoney(group.deliveryFee)}</dd>
                    </div>
                    <div className="flex justify-between font-semibold text-ink-950">
                      <dt>Shop total</dt>
                      <dd>{formatMoney(group.total)}</dd>
                    </div>
                  </dl>
                </Card>
              ))}
            </div>
          )}
        </div>

        <Card className="h-fit p-5 lg:sticky lg:top-24">
          <h2 className="text-base font-semibold text-ink-950">Order total</h2>
          {quoteQuery.data ? (
            <>
              <dl className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-600">Merchandise</dt>
                  <dd className="font-medium">{formatMoney(quoteQuery.data.merchandiseSubtotal)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-600">Delivery fees</dt>
                  <dd className="font-medium">{formatMoney(quoteQuery.data.deliveryFeeTotal)}</dd>
                </div>
                <div className="flex justify-between border-t border-ink-100 pt-3 text-base font-semibold text-ink-950">
                  <dt>Total</dt>
                  <dd>{formatMoney(quoteQuery.data.grandTotal)}</dd>
                </div>
              </dl>
              {!quoteQuery.data.canCheckout && quoteQuery.data.shops.length > 0 ? (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  Some items changed since you added them.{' '}
                  <Link to="/cart" className="font-semibold underline underline-offset-4">
                    Update your cart
                  </Link>{' '}
                  to continue.
                </div>
              ) : null}
            </>
          ) : (
            <Skeleton className="mt-4 h-24" />
          )}

          <fieldset className="mt-5 space-y-2">
            <legend className="text-sm font-semibold text-ink-950">Payment</legend>
            {(
              [
                ['CHAPA', 'Chapa', 'Pay the full total online. The order stays unpaid until Chapa confirms it.'],
                ['BANK_TRANSFER', 'Bank transfer', 'Pay each shop directly and upload a receipt.'],
              ] as const
            ).map(([value, title, description]) => (
              <label key={value} className="flex cursor-pointer gap-2 text-sm">
                <input
                  type="radio"
                  name="payment"
                  value={value}
                  checked={paymentMethod === value}
                  onChange={() => setPaymentMethod(value)}
                />
                <span>
                  <span className="font-medium text-ink-950">{title}</span>
                  <span className="block text-ink-500">{description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="mt-4 space-y-3">
            <FormError message={formError} />
            <Field label="Contact name" required>
              {(field) => (
                <Input {...field} value={contactName} onChange={(event) => setContactName(event.target.value)} autoComplete="name" />
              )}
            </Field>
            <Field label="Address name" required hint="Area or landmark">
              {(field) => (
                <Input {...field} value={addressName} onChange={(event) => setAddressName(event.target.value)} />
              )}
            </Field>
            <Field label="House number" required>
              {(field) => (
                <Input {...field} value={houseNumber} onChange={(event) => setHouseNumber(event.target.value)} />
              )}
            </Field>
            <Field label="Phone" required>
              {(field) => (
                <Input
                  {...field}
                  value={phoneNumber}
                  onChange={(event) => setPhoneNumber(event.target.value)}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                />
              )}
            </Field>
            {paymentMethod === 'CHAPA' ? (
              <Field label="Email for the receipt" hint="Chapa uses this only to start the payment.">
                {(field) => (
                  <Input
                    {...field}
                    value={payerEmail}
                    onChange={(event) => setPayerEmail(event.target.value)}
                    type="email"
                    autoComplete="email"
                  />
                )}
              </Field>
            ) : null}
            <Field label="Note for the shops">
              {(field) => (
                <Textarea {...field} value={customerNote} onChange={(event) => setCustomerNote(event.target.value)} rows={2} maxLength={500} />
              )}
            </Field>
          </div>

          <Button
            type="button"
            className="mt-5 w-full"
            size="lg"
            loading={submitting}
            disabled={!quoteQuery.data?.canCheckout || submitting}
            onClick={() => void placeOrder()}
          >
            {actionLabel}
          </Button>
        </Card>
      </div>
    </div>
  );
}
