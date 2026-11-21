import type { CustomerOrderDetail } from '@marketplace/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { Button, ButtonLink } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { FormError } from '../../components/ui/Form';
import { ErrorState, LoadingState } from '../../components/ui/States';
import { api, errorMessage } from '../../lib/api';
import { formatMoney } from '../../lib/format';

export function OrderPage() {
  const { orderId } = useParams();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const orderQuery = useQuery({
    queryKey: ['order', orderId],
    queryFn: () => api.get<CustomerOrderDetail>(`/orders/${orderId}`),
    enabled: Boolean(orderId),
  });

  const retry = useMutation({
    mutationFn: () =>
      api.post<{ paymentId: string; checkoutUrl: string }>(`/orders/${orderId}/payments/chapa/retry`, {}),
    onSuccess: (result) => {
      window.location.assign(result.checkoutUrl);
    },
    onError: (caught) => setError(errorMessage(caught, 'Payment could not be started. The order is still unpaid.')),
  });

  const upload = useMutation({
    mutationFn: ({ merchantOrderId, file }: { merchantOrderId: string; file: File }) =>
      api.upload<{ paymentStatus: string }>(`/merchant-orders/${merchantOrderId}/receipts`, file, 'receipt'),
    onSuccess: async () => {
      setError(null);
      await queryClient.invalidateQueries({ queryKey: ['order', orderId] });
    },
    onError: (caught) => setError(errorMessage(caught, 'The receipt could not be uploaded.')),
  });

  if (orderQuery.isPending) return <LoadingState />;
  if (orderQuery.isError || !orderQuery.data) {
    return <ErrorState error={orderQuery.error} onRetry={() => void orderQuery.refetch()} />;
  }

  const order = orderQuery.data;
  const unpaid = order.paymentStatus !== 'PAID';

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <Link to="/cart" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-950">
        <ArrowLeft className="size-4" /> Back to cart
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-ink-950">Order {order.orderNumber}</h1>
      <p className="mt-1 text-sm text-ink-500">
        {order.paymentMethod === 'CHAPA' ? 'Chapa' : 'Bank transfer'} · {formatMoney(order.grandTotal)} ·{' '}
        {unpaid ? 'Not paid' : 'Paid'}
      </p>
      {notice ? <p className="mt-4 rounded-xl bg-accent-50 px-4 py-3 text-sm text-accent-900">{notice}</p> : null}
      <FormError message={error} />

      {order.paymentMethod === 'CHAPA' && unpaid ? (
        <Card className="mt-4 p-5">
          <p className="text-sm text-ink-700">
            {order.paymentAttempt?.checkoutUrl
              ? 'The payment page is ready. Opening it does not mark this order as paid.'
              : 'Chapa has not confirmed a payment. This order stays unpaid until it does.'}
          </p>
          {order.paymentAttempt?.checkoutUrl ? (
            <Button className="mt-3" onClick={() => window.location.assign(order.paymentAttempt?.checkoutUrl ?? '')}>
              Continue to Chapa
            </Button>
          ) : (
            <Button className="mt-3" loading={retry.isPending} onClick={() => retry.mutate()}>
              Try payment again
            </Button>
          )}
        </Card>
      ) : null}

      <div className="mt-4 space-y-4">
        {order.merchantOrders.map((sub) => (
          <Card key={sub.id}>
            <div className="border-b border-ink-100 px-5 py-3">
              <h2 className="font-semibold text-ink-950">{sub.shopName}</h2>
              <p className="text-sm text-ink-500">
                {formatMoney(sub.total)} · {sub.paymentStatus.replaceAll('_', ' ').toLowerCase()}
              </p>
            </div>
            <ul className="divide-y divide-ink-100 px-5">
              {sub.items.map((item) => (
                <li key={item.productId} className="flex justify-between gap-3 py-3 text-sm">
                  <span>
                    {item.productName} · {item.quantity} × {formatMoney(item.unitPrice)}
                  </span>
                  <span className="font-medium">{formatMoney(item.lineTotal)}</span>
                </li>
              ))}
            </ul>
            {sub.bank ? (
              <div className="space-y-2 border-t border-ink-100 px-5 py-4 text-sm">
                <p className="font-medium text-ink-950">Transfer instructions</p>
                <p>Bank: {sub.bank.bankName}</p>
                <p>Account name: {sub.bank.accountName}</p>
                <p>Account number: {sub.bank.accountNumber}</p>
                <p>Amount: {formatMoney(sub.bank.amount)}</p>
                {sub.receipt ? (
                  <p className="text-ink-600">
                    Receipt {sub.receipt.status.toLowerCase()}
                    {sub.receipt.rejectionReason ? ` — ${sub.receipt.rejectionReason}` : ''}
                  </p>
                ) : (
                  <p className="text-ink-600">No receipt uploaded yet.</p>
                )}
                {sub.paymentStatus === 'PENDING' || sub.paymentStatus === 'REJECTED' ? (
                  <label className="mt-2 block text-xs font-medium text-ink-700">
                    Upload receipt
                    <input
                      className="mt-1 block w-full text-sm"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) upload.mutate({ merchantOrderId: sub.id, file });
                      }}
                    />
                  </label>
                ) : null}
              </div>
            ) : null}
          </Card>
        ))}
      </div>
      <ButtonLink to="/" variant="secondary" className="mt-6">
        Continue shopping
      </ButtonLink>
    </div>
  );
}
