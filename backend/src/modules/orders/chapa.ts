import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';

export interface ChapaInitializeInput {
  amount: string;
  currency: 'ETB';
  txRef: string;
  email: string | null;
  fullName: string;
  orderId: string;
}

export type ChapaInitializeResult = { checkoutUrl: string } | { error: true };

const CHAPA_INITIALIZE_URL = 'https://api.chapa.co/v1/transaction/initialize';

/** Accept only an https URL on Chapa's own host. Anything else is treated as a failed initialization. */
export function isChapaCheckoutUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'chapa.co' || url.hostname.endsWith('.chapa.co'));
  } catch {
    return false;
  }
}

/**
 * Asks Chapa to start a payment. A missing key or a rejected request returns `{ error: true }`
 * and never includes the secret or Chapa's response body.
 */
export async function initializeChapa(input: ChapaInitializeInput): Promise<ChapaInitializeResult> {
  const secret = env.CHAPA_SECRET_KEY;
  if (!secret || !input.email) return { error: true };

  const [firstName, ...rest] = input.fullName.split(/\s+/);
  const returnUrl = env.CHAPA_RETURN_URL ?? `${env.FRONTEND_ORIGIN[0]}/orders/${input.orderId}`;
  let response: Response;
  try {
    response = await fetch(CHAPA_INITIALIZE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secret}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        amount: input.amount,
        currency: input.currency,
        email: input.email,
        first_name: firstName || 'Customer',
        last_name: rest.join(' ') || 'Customer',
        tx_ref: input.txRef,
        callback_url: env.CHAPA_CALLBACK_URL,
        return_url: returnUrl,
        customization: { title: 'Gebeya', description: 'Marketplace order' },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    logger.warn({ errName: error instanceof Error ? error.name : 'Error' }, 'Chapa initialize failed');
    return { error: true };
  }

  if (!response.ok) {
    logger.warn({ status: response.status }, 'Chapa initialize rejected');
    return { error: true };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { error: true };
  }
  const checkoutUrl = (payload as { data?: { checkout_url?: unknown } }).data?.checkout_url;
  if (typeof checkoutUrl !== 'string' || !isChapaCheckoutUrl(checkoutUrl)) return { error: true };
  return { checkoutUrl };
}
