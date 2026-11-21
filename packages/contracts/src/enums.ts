export const USER_ROLES = ['CUSTOMER', 'MERCHANT', 'SUPER_ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const SHOP_STATUSES = ['ACTIVE', 'SUSPENDED', 'REMOVED'] as const;
export type ShopStatus = (typeof SHOP_STATUSES)[number];

export const PRODUCT_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const FULFILLMENT_PREFERENCES = ['DELIVERY', 'PICKUP'] as const;
export type FulfillmentPreference = (typeof FULFILLMENT_PREFERENCES)[number];

export const PAYMENT_METHODS = ['CHAPA', 'BANK_TRANSFER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PARENT_PAYMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID', 'FAILED'] as const;
export type ParentPaymentStatus = (typeof PARENT_PAYMENT_STATUSES)[number];

export const PARENT_FULFILLMENT_STATUSES = [
  'PENDING_PAYMENT',
  'PROCESSING',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
  'CANCELLED',
] as const;
export type ParentFulfillmentStatus = (typeof PARENT_FULFILLMENT_STATUSES)[number];

export const MERCHANT_PAYMENT_STATUSES = [
  'PENDING',
  'AWAITING_VERIFICATION',
  'PAID',
  'FAILED',
  'REJECTED',
] as const;
export type MerchantPaymentStatus = (typeof MERCHANT_PAYMENT_STATUSES)[number];

export const MERCHANT_FULFILLMENT_STATUSES = [
  'AWAITING_PAYMENT',
  'NEW',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'OUT_FOR_DELIVERY',
  'COMPLETED',
  'CANCELLED',
] as const;
export type MerchantFulfillmentStatus = (typeof MERCHANT_FULFILLMENT_STATUSES)[number];

export const PAYMENT_RECORD_STATUSES = [
  'PENDING',
  'PROCESSING',
  'AWAITING_VERIFICATION',
  'PAID',
  'FAILED',
  'REJECTED',
  'EXPIRED',
] as const;
export type PaymentRecordStatus = (typeof PAYMENT_RECORD_STATUSES)[number];

export const RECEIPT_REVIEW_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED'] as const;
export type ReceiptReviewStatus = (typeof RECEIPT_REVIEW_STATUSES)[number];

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'PASSWORD_CHANGE_REQUIRED',
  'NOT_FOUND',
  'CONFLICT',
  'BUSINESS_RULE',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL',
  'SERVICE_UNAVAILABLE',
  'ASSISTANT_UNAVAILABLE',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Reasons a cart or checkout line cannot be purchased right now. */
export const LINE_ISSUES = ['NOT_FOUND', 'UNAVAILABLE', 'INSUFFICIENT_STOCK'] as const;
export type LineIssue = (typeof LINE_ISSUES)[number];
