import { z } from 'zod';
import { fullNameSchema } from './auth.js';
import { phoneSchema, uuidSchema } from './common.js';
import { FULFILLMENT_PREFERENCES, PAYMENT_METHODS } from './enums.js';
import type {
  FulfillmentPreference,
  LineIssue,
  MerchantFulfillmentStatus,
  MerchantPaymentStatus,
  ParentFulfillmentStatus,
  ParentPaymentStatus,
  PaymentMethod,
  PaymentRecordStatus,
  ReceiptReviewStatus,
} from './enums.js';

export const checkoutQuoteSchema = z.object({
  fulfillmentPreference: z.enum(FULFILLMENT_PREFERENCES),
});
export type CheckoutQuoteInput = z.infer<typeof checkoutQuoteSchema>;

export interface QuoteLine {
  cartItemId: string;
  productId: string;
  name: string;
  imageUrl: string | null;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
  issue: LineIssue | null;
}

export interface QuoteShopGroup {
  shopId: string;
  shopName: string;
  shopSlug: string;
  items: QuoteLine[];
  subtotal: string;
  deliveryFee: string;
  total: string;
}

/**
 * Server-computed checkout summary. Every amount comes from the database at request
 * time; nothing the browser remembers is trusted.
 */
export interface CheckoutQuote {
  fulfillmentPreference: FulfillmentPreference;
  currency: 'ETB';
  shops: QuoteShopGroup[];
  merchandiseSubtotal: string;
  deliveryFeeTotal: string;
  grandTotal: string;
  canCheckout: boolean;
  issues: { cartItemId: string; productId: string; name: string; issue: LineIssue }[];
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value ? value : undefined));

/**
 * Places the order from the server cart. Amounts are not accepted: the server prices
 * every line again inside the stock lock.
 */
export const checkoutSchema = z
  .object({
    fulfillmentPreference: z.enum(FULFILLMENT_PREFERENCES),
    paymentMethod: z.enum(PAYMENT_METHODS),
    customerNote: optionalText(500),
    payerEmail: z
      .union([z.string().trim().email('Enter a valid email'), z.literal(''), z.null()])
      .optional()
      .transform((value) => (value ? value : undefined)),
    addressId: uuidSchema.optional(),
    contactName: fullNameSchema.optional(),
    addressName: z.string().trim().min(2, 'Enter the address name').max(120).optional(),
    houseNumber: z.string().trim().min(1, 'Enter the house number').max(60).optional(),
    phoneNumber: phoneSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const inline = Boolean(value.contactName || value.addressName || value.houseNumber || value.phoneNumber);
    if (value.addressId && inline) {
      ctx.addIssue({
        code: 'custom',
        path: ['addressId'],
        message: 'Send a saved address or a new address, not both',
      });
      return;
    }
    if (value.addressId) return;
    if (!value.contactName) {
      ctx.addIssue({ code: 'custom', path: ['contactName'], message: 'Enter the contact name' });
    }
    if (!value.addressName) {
      ctx.addIssue({ code: 'custom', path: ['addressName'], message: 'Enter the address name' });
    }
    if (!value.houseNumber) {
      ctx.addIssue({ code: 'custom', path: ['houseNumber'], message: 'Enter the house number' });
    }
    if (!value.phoneNumber) {
      ctx.addIssue({ code: 'custom', path: ['phoneNumber'], message: 'Enter a phone number' });
    }
  });
export type CheckoutInput = z.input<typeof checkoutSchema>;
export type CheckoutRequest = z.output<typeof checkoutSchema>;

export interface CheckoutOrderItem {
  productId: string;
  productName: string;
  unitPrice: string;
  quantity: number;
  lineTotal: string;
}

export interface CheckoutBankInstructions {
  bankName: string;
  accountName: string;
  accountNumber: string;
  amount: string;
}

export interface CheckoutReceipt {
  status: ReceiptReviewStatus;
  uploadedAt: string;
  rejectionReason: string | null;
}

export interface CheckoutMerchantOrder {
  id: string;
  shopId: string;
  shopName: string;
  subtotal: string;
  deliveryFee: string;
  total: string;
  paymentStatus: MerchantPaymentStatus;
  fulfillmentStatus: MerchantFulfillmentStatus;
  items: CheckoutOrderItem[];
  bank: CheckoutBankInstructions | null;
  receipt: CheckoutReceipt | null;
}

export interface CheckoutOrder {
  id: string;
  orderNumber: string;
  paymentMethod: PaymentMethod;
  fulfillmentPreference: FulfillmentPreference;
  merchandiseSubtotal: string;
  deliveryFeeTotal: string;
  grandTotal: string;
  paymentStatus: ParentPaymentStatus;
  fulfillmentStatus: ParentFulfillmentStatus;
  contactName: string;
  addressName: string;
  houseNumber: string;
  phoneNumber: string;
  customerNote: string | null;
  merchantOrders: CheckoutMerchantOrder[];
}

export interface CheckoutChapaAttempt {
  paymentId: string;
  checkoutUrl: string | null;
  initializationError: boolean;
}

/** `chapa` is null for bank transfer. A checkout URL is present only after Chapa accepts the attempt. */
export interface CheckoutResult {
  order: CheckoutOrder;
  chapa: CheckoutChapaAttempt | null;
}

export interface CustomerOrderDetail extends CheckoutOrder {
  paymentAttempt: { status: PaymentRecordStatus; checkoutUrl: string | null } | null;
}
