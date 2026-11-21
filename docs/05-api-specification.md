# 5. API specification

Status: proposed contract. These routes are not implemented. Example hosts, ids, and payment URLs are illustrative. Do not treat them as deployed endpoints or real credentials.

Normative status transitions are in [07-order-and-payment-workflows.md](07-order-and-payment-workflows.md). Field names match [04-database-design.md](04-database-design.md).

## 5.1 Conventions

- Base path: `/api/v1`.
- JSON uses UTF-8. Money is a string with two decimal places, such as `"30000.00"`, so clients do not use binary floating point.
- Timestamps are ISO-8601 in UTC.
- Authenticated calls send `Authorization: Bearer <accessToken>`.
- The refresh token is an `HttpOnly` cookie named `refresh_token`, `Secure`, `SameSite=None`, `Path=/api/v1/auth`.
- Create and checkout calls may send `Idempotency-Key`. Checkout stores it on `orders.client_request_id`.

Success:

```json
{
  "success": true,
  "data": {},
  "error": null,
  "meta": {}
}
```

List `meta` is `{ "page": 1, "pageSize": 20, "total": 0 }`. Page size defaults to 20 and cannot exceed 50.

Error:

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Phone number is not valid.",
    "details": [{ "field": "phoneNumber", "message": "Use an Ethiopian mobile number." }]
  },
  "meta": {}
}
```

| HTTP | `error.code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body or query failed validation |
| 401 | `UNAUTHENTICATED` | Missing or invalid token, or refresh cookie rejected |
| 403 | `FORBIDDEN` | Authenticated, wrong role, or password change required |
| 403 | `PASSWORD_CHANGE_REQUIRED` | Merchant still holds a temporary password |
| 404 | `NOT_FOUND` | Missing, or hidden because it belongs to someone else |
| 409 | `CONFLICT` | Duplicate username, slug, or idempotency replay with a different body |
| 422 | `BUSINESS_RULE` | Stock, illegal status transition, or inactive shop |
| 429 | `RATE_LIMITED` | See security document |
| 500 | `INTERNAL` | Unexpected error. Body has a `requestId` and no stack trace |
| 502 | `ASSISTANT_UNAVAILABLE` | Gemini could not be reached. Used only by the assistant route |

`GET /api/v1/health` and `POST /api/v1/payments/chapa/webhook` are the only routes that do not use the success envelope. Health is a host probe. The webhook body is a short acknowledgement for Chapa. Every other route uses the envelope.

Ownership failures are `404`, not `403`, except for role mismatches on a route the caller is not allowed to use at all. A customer calling `/api/v1/admin/shops` receives `403`. A merchant opening another merchant's sub-order id receives `404`.

`PASSWORD_CHANGE_REQUIRED` allows only `GET /api/v1/auth/me`, `POST /api/v1/auth/change-password`, and `POST /api/v1/auth/logout`.

## 5.2 Traceability

| Requirement | Endpoints |
|---|---|
| FR-C-01, FR-C-05, FR-C-06 | Public shop, product, and category reads |
| FR-C-02, FR-C-03, FR-C-04 | `GET /shops` |
| FR-C-07, FR-C-10, UD-13 | Cart and merge |
| FR-C-08, FR-C-09 | Register, login |
| FR-C-11 … FR-C-15, FR-O-* | Checkout and customer orders |
| FR-M-* | `/api/v1/merchant/*` |
| FR-A-* | `/api/v1/admin/*` |
| FR-P-* | Checkout payment branch, Chapa retry, webhook, receipts |
| FR-AI-* | `POST /ai/chat` |
| Analytics | View posts, merchant analytics, admin analytics |

## 5.3 Authentication

### POST /api/v1/auth/register

| | |
|---|---|
| Description | Creates a customer account and a session |
| Role | Public |
| Authentication | No |
| Requirements | FR-C-09 |

Request:

```json
{ "fullName": "Liya Bekele", "username": "liya", "password": "a-suitable-password" }
```

Validation: full name 2–120 characters; username 3–30 characters matching `^[a-z0-9_]+$` after the server lowercases it; password at least 8 characters. Extra properties are rejected.

Response `201`: `data.user` is `{ "id", "role": "CUSTOMER", "fullName", "username" }`. `data.accessToken` is a JWT. The refresh cookie is set. The password hash is never returned.

Errors: `VALIDATION_ERROR`, `CONFLICT` when the username exists, `RATE_LIMITED`.

### POST /api/v1/auth/login

| | |
|---|---|
| Description | Starts a session for any role |
| Role | Public |
| Authentication | No |
| Requirements | FR-M-02, FR-C-08 |

Request: `{ "username": "liya", "password": "a-suitable-password" }`.

Response `200`: same session shape as register, plus `mustChangePassword`. A suspended account or a wrong password returns the same `401` message: `Invalid username or password.`

Errors: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `RATE_LIMITED`.

### POST /api/v1/auth/refresh

| | |
|---|---|
| Description | Rotates the refresh token and returns a new access token |
| Role | Any authenticated session |
| Authentication | Refresh cookie |
| Requirements | Security architecture |

Request body: empty.

Response `200`: `{ "accessToken": "<jwt>", "user": { "id", "role", "fullName", "username", "mustChangePassword" } }`. The previous refresh token is revoked.

Errors: `UNAUTHENTICATED` when the cookie is missing, expired, revoked, or reused. Reuse of a revoked token revokes every refresh token for that user.

### POST /api/v1/auth/logout

| | |
|---|---|
| Description | Revokes the presented refresh token |
| Role | Any |
| Authentication | Refresh cookie |
| Requirements | Security architecture |

Response `200`: `{ "loggedOut": true }`. The cookie is cleared. An already cleared cookie still returns `200`.

### GET /api/v1/auth/me

| | |
|---|---|
| Description | Returns the authenticated user |
| Role | Customer, merchant, or Super Admin |
| Authentication | Bearer |
| Requirements | FR-M-12 |

Response `200`: `{ "id", "role", "status", "fullName", "username", "mustChangePassword" }`.

Errors: `UNAUTHENTICATED`.

### POST /api/v1/auth/change-password

| | |
|---|---|
| Description | Replaces the current password and revokes other sessions |
| Role | Customer, merchant, or Super Admin |
| Authentication | Bearer |
| Requirements | FR-M-12, FR-A-03 |

Request: `{ "currentPassword": "temporary-value", "newPassword": "a-new-password" }`.

Validation: `newPassword` at least 8 characters and different from `currentPassword`.

Response `200`: `{ "passwordChanged": true, "accessToken": "<jwt>" }`. `token_version` increments. Other refresh tokens are revoked. `mustChangePassword` becomes false.

Errors: `VALIDATION_ERROR`, `UNAUTHENTICATED` when the current password is wrong.

## 5.4 Customer profile and addresses

### GET /api/v1/customers/me

| | |
|---|---|
| Description | Customer profile |
| Role | `CUSTOMER` |
| Authentication | Bearer |
| Requirements | FR-C-09 |

Response `200`: `{ "id", "fullName", "username" }`.

Errors: `FORBIDDEN` for other roles.

### PATCH /api/v1/customers/me

| | |
|---|---|
| Description | Updates the customer's full name |
| Role | `CUSTOMER` |
| Authentication | Bearer |
| Requirements | Profile correction before later checkouts |

Request: `{ "fullName": "Liya B. Bekele" }`. Username is immutable.

Response `200`: the profile object.

Errors: `VALIDATION_ERROR`, `FORBIDDEN`.

### GET /api/v1/customers/me/addresses

| | |
|---|---|
| Description | Lists the caller's saved addresses |
| Role | `CUSTOMER` |
| Authentication | Bearer |
| Requirements | FR-C-11 |

Response `200`: `data` is an array of `{ "id", "addressName", "houseNumber", "phoneNumber", "isDefault" }`.

### POST /api/v1/customers/me/addresses

Request:

```json
{
  "addressName": "Mentina",
  "houseNumber": "12",
  "phoneNumber": "0911000000",
  "isDefault": true
}
```

Validation: address name 2–120, house number 1–30, phone matches `^(\+251|0)9\d{8}$`. Setting `isDefault` clears the previous default.

Response `201`: the address.

Errors: `VALIDATION_ERROR`.

### PATCH /api/v1/customers/me/addresses/:addressId

Same fields, all optional, at least one required. An address owned by another customer returns `404`.

Response `200`: the address.

### DELETE /api/v1/customers/me/addresses/:addressId

Response `200`: `{ "deleted": true }`. Deleting an address does not change historical orders.

Errors: `NOT_FOUND`.

### GET /api/v1/notifications

| | |
|---|---|
| Description | Lists the caller's in-app notifications, newest first |
| Role | `CUSTOMER` or `MERCHANT` |
| Authentication | Bearer |
| Requirements | FR-M-06, FR-C-14 |

Query: `page`, `unreadOnly` (`true` or `false`).

Response item: `{ "id", "type", "title", "body", "data", "readAt", "createdAt" }`. `data` contains ids such as `merchantOrderId`, never a receipt URL.

### PATCH /api/v1/notifications/:notificationId

Request: `{ "read": true }`. Only the recipient may update it. Another user's id returns `404`.

Response `200`: the notification with `readAt` set. `read: false` is rejected; notifications are not unread by the client.

## 5.5 Shops

### GET /api/v1/shops

| | |
|---|---|
| Description | Public shop list for the map and shop search |
| Role | Public |
| Authentication | No |
| Requirements | FR-C-02, FR-C-03, FR-C-04 |

Query:

| Parameter | Rule |
|---|---|
| `q` | Optional shop name search, max 100 characters |
| `product` | Optional product text; returns shops with a matching visible product |
| `category` | Category slug |
| `swLat`, `swLng`, `neLat`, `neLng` | Optional bounding box. All four or none |
| `page`, `pageSize` | Pagination |

Response item:

```json
{
  "id": "11111111-1111-4111-8111-111111111111",
  "name": "Shop A",
  "slug": "shop-a",
  "addressText": "Jimma center",
  "latitude": "7.666700",
  "longitude": "36.833300",
  "productCount": 12
}
```

Bank fields are omitted. Only `ACTIVE` shops with an `ACTIVE` merchant are returned.

Errors: `VALIDATION_ERROR` for a partial bounding box or a latitude outside `-90`…`90`.

### GET /api/v1/shops/:slug

| | |
|---|---|
| Description | Public shop profile |
| Role | Public |
| Authentication | No |
| Requirements | FR-C-05 |

Response `200`: the list fields plus `description` and `phone`. No bank fields and no product array. Unknown, suspended, or removed shops return `404`.

### POST /api/v1/shops/:slug/views

| | |
|---|---|
| Description | Records one shop view |
| Role | Public |
| Authentication | Optional. A valid customer token stores `viewer_user_id` |
| Requirements | FR-M-11 |

Request: `{ "visitorId": "8f1c0b5e-2a4d-4e7a-9c1b-6d0e5f4a3b2c" }`. `visitorId` is a UUID generated by the browser.

Response `202`: `{ "recorded": true }`. The body does not include analytics totals. A hidden shop returns `404` and records nothing.

Errors: `VALIDATION_ERROR`, `RATE_LIMITED`.

## 5.6 Products and categories

### GET /api/v1/categories

| | |
|---|---|
| Description | Active categories for filters and the product form |
| Role | Public |
| Authentication | No |
| Requirements | FR-A-08, FR-C-06 |

Response item: `{ "id", "name", "slug" }`. Inactive categories are omitted. Merchants and admins use the admin category endpoints to see inactive rows.

### GET /api/v1/products

| | |
|---|---|
| Description | Cross-shop product search |
| Role | Public |
| Authentication | No |
| Requirements | FR-C-06, FR-AI-01 |

Query: `q`, `shopId`, `category`, `minPrice`, `maxPrice`, `available` (`true` or `false`), `page`, `pageSize`.

`available=true` returns only products that can be added to a cart. Omission returns visible `ACTIVE` products, including those that are out of stock or marked unavailable, with `canPurchase` set.

Response item:

```json
{
  "id": "22222222-2222-4222-8222-222222222222",
  "name": "Laptop",
  "price": "30000.00",
  "currency": "ETB",
  "imageUrl": "https://res.cloudinary.com/example/image/upload/v1/products/laptop.jpg",
  "canPurchase": true,
  "category": { "slug": "electronics", "name": "Electronics" },
  "shop": { "id": "11111111-1111-4111-8111-111111111111", "name": "Shop A", "slug": "shop-a" }
}
```

The public product payload does not include `stockQuantity`.

Errors: `VALIDATION_ERROR` when `minPrice` is greater than `maxPrice`.

### GET /api/v1/products/:productId

| | |
|---|---|
| Description | Public product detail |
| Role | Public |
| Authentication | No |
| Requirements | FR-C-05 |

Response adds `description` and the shop `addressText`, `latitude`, and `longitude`. Archived or hidden-shop products return `404`.

### POST /api/v1/products/:productId/views

Same contract as shop views, for `FR-M-11`. Request `{ "visitorId" }`. Response `202` `{ "recorded": true }`.

## 5.7 Cart

All cart routes require a customer bearer token. Prices in responses are current catalog prices. The guest cart itself is not a server resource; `POST /cart/merge` is how it enters the server.

### GET /api/v1/cart

| | |
|---|---|
| Description | Returns the server cart grouped by shop |
| Role | `CUSTOMER` |
| Authentication | Bearer |
| Requirements | FR-C-07, FR-C-10 |

Response:

```json
{
  "id": "33333333-3333-4333-8333-333333333333",
  "shops": [
    {
      "shopId": "11111111-1111-4111-8111-111111111111",
      "shopName": "Shop A",
      "items": [
        {
          "id": "44444444-4444-4444-8444-444444444444",
          "productId": "22222222-2222-4222-8222-222222222222",
          "name": "Laptop",
          "unitPrice": "30000.00",
          "quantity": 1,
          "lineTotal": "30000.00",
          "canPurchase": true
        }
      ]
    }
  ],
  "merchandiseSubtotal": "30000.00"
}
```

An empty cart is `200` with `shops: []`, not `404`.

### POST /api/v1/cart/items

Request: `{ "productId": "22222222-2222-4222-8222-222222222222", "quantity": 1 }`.

Validation: quantity 1–99. If the product is already in the cart, quantities are added and then capped by the same validation. The line is rejected when the product cannot be purchased.

Response `200`: the full cart.

Errors: `VALIDATION_ERROR`, `BUSINESS_RULE`, `NOT_FOUND`.

### PATCH /api/v1/cart/items/:itemId

Request: `{ "quantity": 2 }`. Quantity `0` is rejected; delete is the remove operation.

Response `200`: the cart. Another customer's item id returns `404`.

### DELETE /api/v1/cart/items/:itemId

Response `200`: the cart after removal.

### POST /api/v1/cart/merge

| | |
|---|---|
| Description | Merges a guest cart into the server cart |
| Role | `CUSTOMER` |
| Authentication | Bearer |
| Requirements | UD-13, FR-C-07 |

Request:

```json
{
  "items": [
    { "productId": "22222222-2222-4222-8222-222222222222", "quantity": 1 }
  ]
}
```

Validation: 1–30 items. Quantities for the same product id are summed with the server line. Lines that cannot be purchased are returned in `data.rejected` and are not added. Valid lines are added.

Response `200`: the cart plus `rejected: [{ "productId", "reason" }]`.

## 5.8 Checkout

### POST /api/v1/checkout

| | |
|---|---|
| Description | Atomically creates the parent order, one sub-order per shop, items, stock hold, and payment rows |
| Role | `CUSTOMER` |
| Authentication | Bearer |
| Requirements | FR-C-08, FR-C-11, FR-C-12, FR-C-13, FR-O-01 … FR-O-09, FR-P-01, FR-P-08 |

Header: `Idempotency-Key` required, 8–80 characters. A replay with the same user, key, and body returns the original `201` payload. The same key with a different body returns `409`.

Request:

```json
{
  "addressId": "55555555-5555-4555-8555-555555555555",
  "fulfillmentPreference": "DELIVERY",
  "paymentMethod": "CHAPA",
  "payerEmail": null
}
```

Either `addressId` or all of `addressName`, `houseNumber`, and `phoneNumber`. Not both. `payerEmail` is optional and is sent to Chapa only if the team adopts UD-01. It is ignored for `BANK_TRANSFER`.

Response `201` for the worked example, delivery fees zero, Chapa selected:

```json
{
  "order": {
    "id": "66666666-6666-4666-8666-666666666666",
    "orderNumber": "ORD-20261121-0007",
    "paymentMethod": "CHAPA",
    "fulfillmentPreference": "DELIVERY",
    "merchandiseSubtotal": "35000.00",
    "deliveryFeeTotal": "0.00",
    "grandTotal": "35000.00",
    "paymentStatus": "UNPAID",
    "fulfillmentStatus": "PENDING_PAYMENT",
    "merchantOrders": [
      {
        "id": "77777777-7777-4777-8777-777777777777",
        "shopName": "Shop A",
        "subtotal": "30000.00",
        "deliveryFee": "0.00",
        "total": "30000.00",
        "paymentStatus": "PENDING",
        "fulfillmentStatus": "AWAITING_PAYMENT",
        "items": [
          {
            "productName": "Laptop",
            "unitPrice": "30000.00",
            "quantity": 1,
            "lineTotal": "30000.00"
          }
        ]
      }
    ]
  },
  "chapa": {
    "paymentId": "88888888-8888-4888-8888-888888888888",
    "checkoutUrl": "https://checkout.chapa.co/example"
  }
}
```

The real response includes every sub-order. The snippet shows the shape with Shop A. Shop B and Shop C follow the same object shape for shoes at `2000.00` and a jacket at `3000.00`.

For `BANK_TRANSFER`, `chapa` is null and each merchant order includes:

```json
"bank": {
  "bankName": "Example Bank",
  "accountName": "Shop A Owner",
  "accountNumber": "1000000000000",
  "amount": "30000.00"
}
```

Those bank fields appear only on this customer's order payloads.

Errors:

| Code | Condition |
|---|---|
| `VALIDATION_ERROR` | Missing address, bad phone, bad enum |
| `BUSINESS_RULE` | Empty cart, any line not purchasable, insufficient stock |
| `CONFLICT` | Idempotency key reused with a different body |
| Chapa initialize failure after commit | The response stays `201`. `paymentStatus` remains `UNPAID`, and `chapa.initializationError` is `true`. The customer uses the retry endpoint. Checkout does not return `502` for this case |

Checkout does not return sibling data to anyone but the customer. Merchant notification is not sent here. It is sent when the sub-order later becomes `NEW`.

## 5.9 Orders

### GET /api/v1/orders

| | |
|---|---|
| Description | Lists the caller's parent orders |
| Role | `CUSTOMER` |
| Authentication | Bearer |
| Requirements | FR-C-14 |

Query: `page`, `paymentStatus`, `fulfillmentStatus`.

Response item: `{ "id", "orderNumber", "grandTotal", "paymentMethod", "paymentStatus", "fulfillmentStatus", "createdAt", "merchantOrderCount" }`.

### GET /api/v1/orders/:orderId

| | |
|---|---|
| Description | Parent order with every sub-order, item snapshot, and payment progress |
| Role | `CUSTOMER` |
| Authentication | Bearer |
| Requirements | FR-C-15, FR-P-13, FR-P-14 |

Response `data` uses the checkout order shape, plus `paymentAttempt` for the latest Chapa payment on that order: `{ "status", "checkoutUrl" }`. `checkoutUrl` is present only while that attempt is `PROCESSING`. For bank transfer, `paymentAttempt` is null. Each sub-order also includes `paymentStatus`, `fulfillmentStatus`, and `receipt`:

```json
"receipt": { "status": "AWAITING_VERIFICATION", "uploadedAt": "2026-11-21T08:00:00Z", "rejectionReason": null }
```

`receipt` is null when no receipt exists. Another customer's order id returns `404`.

## 5.10 Payments

### POST /api/v1/orders/:orderId/payments/chapa/retry

| | |
|---|---|
| Description | Starts a new Chapa initialization for an unpaid Chapa order |
| Role | `CUSTOMER` |
| Authentication | Bearer |
| Requirements | FR-P-02, test case for failed initialization |

Request: `{ "payerEmail": null }`.

The order must belong to the caller, use `CHAPA`, and still be `PENDING_PAYMENT` with hold state `HELD`. There must be no `PROCESSING` payment. The previous open attempt, if any, is marked `FAILED` inside the transaction that inserts the new attempt.

Response `200`: `{ "paymentId", "checkoutUrl" }`.

Errors: `NOT_FOUND`, `BUSINESS_RULE` when the order is expired, paid, or is a bank transfer.

### POST /api/v1/payments/chapa/webhook

| | |
|---|---|
| Description | Receives a Chapa callback and verifies it with Chapa |
| Role | Chapa server |
| Authentication | No bearer token. Authenticity comes from server-side verification |
| Requirements | FR-P-04, FR-P-05, FR-P-06 |

Request body: the JSON Chapa posts. The handler reads `tx_ref` and then calls Chapa's verify endpoint with the server secret. Amount, currency, and success status must match the stored payment. The exact webhook signature header is UD-03.

Response `200`: `{ "received": true }` after a successful verification or a duplicate `tx_ref` that was already applied. Response `400` when `tx_ref` is missing. Response `500` when Chapa's verify endpoint cannot be reached, so the callback can be retried. A verify response that says the payment failed marks the attempt `FAILED` and returns `200`.

This route never trusts an amount in the webhook body.

### POST /api/v1/merchant-orders/:merchantOrderId/receipts

| | |
|---|---|
| Description | Uploads a bank-transfer receipt for one sub-order |
| Role | `CUSTOMER` |
| Authentication | Bearer |
| Requirements | FR-P-10, FR-P-12 |

Multipart field `receipt` is required. Optional text field `note`, max 300 characters. The file must be JPEG, PNG, or WebP and at most 5 MB.

The sub-order must belong to the caller's parent order, the parent method must be `BANK_TRANSFER`, and the payment status must be `PENDING` or `REJECTED`.

Response `201`:

```json
{ "paymentStatus": "AWAITING_VERIFICATION", "uploadedAt": "2026-11-21T08:00:00Z" }
```

The response does not include a permanent public image URL.

Errors: `VALIDATION_ERROR`, `NOT_FOUND`, `BUSINESS_RULE`, `RATE_LIMITED`.

### GET /api/v1/payment-receipts/:receiptId

| | |
|---|---|
| Description | Returns a short-lived view of a private receipt |
| Role | Owning customer, owning merchant, or Super Admin |
| Authentication | Bearer |
| Requirements | Secure image handling |

Response `200`: `{ "url": "https://res.cloudinary.com/example/sign/example", "expiresInSeconds": 300 }`. Anyone else receives `404`.

## 5.11 Merchant

Merchant routes require role `MERCHANT` and `mustChangePassword = false`. Every id is resolved only inside the caller's ownership. Historical orders use `merchant_orders.merchant_id`. Catalog writes use current `shops.merchant_id`.

### GET /api/v1/merchant/dashboard

| | |
|---|---|
| Description | Overview counts |
| Role | `MERCHANT` |
| Authentication | Bearer |
| Requirements | FR-M-03 |

Response:

```json
{
  "newSubOrders": 1,
  "receiptsAwaitingVerification": 0,
  "paidSalesLast7Days": "30000.00",
  "paidSalesLast30Days": "30000.00",
  "shopViewsLast30Days": 40,
  "productViewsLast30Days": 90
}
```

Paid sales sum `merchant_orders.total` where `payment_status = PAID` and `fulfillment_status != CANCELLED`.

### GET /api/v1/merchant/shops

Response `200`: array of the caller's current shops, including bank fields, coordinates, delivery fee, and status. This is the merchant's read-only shop profile (`FR-M-12`, UD-06).

### GET /api/v1/merchant/products

Query: `shopId`, `page`. `shopId` is required when the merchant owns more than one shop.

Response items include `stockQuantity`, `isAvailable`, `status`, `price`, `categoryId`, and `imageUrl`.

### POST /api/v1/merchant/products

| | |
|---|---|
| Description | Creates a product on a shop the merchant owns |
| Requirements | FR-M-04, FR-M-05 |

Request:

```json
{
  "shopId": "11111111-1111-4111-8111-111111111111",
  "categoryId": "99999999-9999-4999-8999-999999999999",
  "name": "Laptop",
  "description": "14 inch laptop",
  "price": "30000.00",
  "imageUrl": "https://res.cloudinary.com/example/image/upload/v1/products/laptop.jpg",
  "stockQuantity": 5,
  "isAvailable": true
}
```

`shopId` may be omitted when the merchant owns exactly one shop. The image URL must use the configured Cloudinary cloud and the `products/` folder. The shop must be `ACTIVE` and the category `ACTIVE`.

Response `201`: the merchant product object.

Errors: `VALIDATION_ERROR`, `FORBIDDEN` when the shop is not owned, returned as `404` for a foreign `shopId`, `BUSINESS_RULE` when the shop or category is inactive.

### GET /api/v1/merchant/products/:productId

Response `200`: the merchant product. Foreign products return `404`.

### PATCH /api/v1/merchant/products/:productId

Any subset of the create fields except `shopId`. Moving a product between shops is not supported. Price changes do not alter order snapshots.

Response `200`: the product.

### DELETE /api/v1/merchant/products/:productId

Archives the product (`status = ARCHIVED`). Response `200`: `{ "status": "ARCHIVED" }`. The row remains.

### POST /api/v1/merchant/uploads/images

Multipart field `image`. JPEG, PNG, or WebP, maximum 5 MB.

Response `201`: `{ "imageUrl": "https://res.cloudinary.com/example/image/upload/v1/products/generated.jpg" }`.

Errors: `VALIDATION_ERROR`, `RATE_LIMITED`.

### GET /api/v1/merchant/orders

Query: `fulfillmentStatus`, `paymentStatus`, `page`.

Response item: `{ "id", "orderNumber", "shopName", "total", "paymentStatus", "fulfillmentStatus", "createdAt" }`. `orderNumber` is the parent number. `total` is the sub-order total only.

### GET /api/v1/merchant/orders/:merchantOrderId

Response includes parent `orderNumber`, `fulfillmentPreference`, fulfillment contact, own items with snapshots, own payment, and own receipt summary. It excludes sibling lines and the parent grand total (`FR-M-07`).

### POST /api/v1/merchant/orders/:merchantOrderId/confirm

| | |
|---|---|
| Description | Moves `NEW` to `CONFIRMED` when payment is `PAID` |
| Requirements | FR-M-08 |

Request body: empty.

Response `200`: `{ "fulfillmentStatus": "CONFIRMED", "paymentStatus": "PAID" }`.

Errors: `BUSINESS_RULE` when payment is not `PAID` or fulfillment is not `NEW`. `NOT_FOUND` for another merchant's id.

### PATCH /api/v1/merchant/orders/:merchantOrderId/fulfillment

Request: `{ "fulfillmentStatus": "PREPARING" }`.

Allowed targets are only the next states defined in the workflow document. `CONFIRMED` is not a legal target of this route. `CANCELLED` is not a legal target of this route.

Response `200`: `{ "fulfillmentStatus": "PREPARING" }`.

Errors: `BUSINESS_RULE`, `NOT_FOUND`.

### POST /api/v1/merchant/orders/:merchantOrderId/cancel

Request: `{ "reason": "Item damaged" }`. Reason is 2–300 characters.

Allowed from `NEW`, `CONFIRMED`, or `PREPARING`. Stock is returned once in that transaction. Parent statuses are re-aggregated.

Response `200`: `{ "fulfillmentStatus": "CANCELLED" }`.

### POST /api/v1/merchant/payments/:paymentId/verification

| | |
|---|---|
| Description | Accepts or rejects the latest bank-transfer receipt |
| Requirements | FR-M-09, FR-P-11 |

Request: `{ "decision": "ACCEPT", "reason": null }`. `reason` is required when `decision` is `REJECT` and must be 2–300 characters.

`ACCEPT` requires payment status `AWAITING_VERIFICATION`. It sets payment `PAID`, sub-order payment `PAID`, fulfillment `NEW`, notifies the merchant queue, and re-aggregates the parent.

`REJECT` sets payment `REJECTED`, sub-order payment `REJECTED`, fulfillment stays `AWAITING_PAYMENT`, and notifies the customer.

Response `200`: `{ "paymentStatus": "PAID", "fulfillmentStatus": "NEW" }` or the rejected equivalent.

Errors: `BUSINESS_RULE` when the method is Chapa or no receipt exists. `NOT_FOUND` when the payment is not the caller's.

### GET /api/v1/merchant/analytics

Query: `from`, `to` as dates. Default is the last 30 Addis Ababa dates, inclusive. Maximum range 366 days.

Response:

```json
{
  "from": "2026-10-22",
  "to": "2026-11-21",
  "paidSalesTotal": "30000.00",
  "paidSubOrderCount": 1,
  "unitsSold": 1,
  "shopViews": 40,
  "uniqueShopVisitors": 25,
  "productViews": 90,
  "uniqueProductVisitors": 50,
  "salesByDay": [{ "date": "2026-11-21", "total": "30000.00" }]
}
```

Definitions match [10-analytics-and-reporting.md](10-analytics-and-reporting.md).

### GET /api/v1/merchant/profile

Response: `{ "fullName", "username", "mustChangePassword" }`.

### PATCH /api/v1/merchant/profile

Request: `{ "fullName": "Abel Tadesse" }`. Password changes use `/api/v1/auth/change-password`.

Response `200`: the profile.

## 5.12 Super Admin

All routes require role `SUPER_ADMIN`. Responses may include bank details and statuses. They never include `password_hash`.

### GET /api/v1/admin/customers

Query: `q`, `status`, `page`. `q` matches username or full name.

Response item: `{ "id", "fullName", "username", "status", "createdAt" }`.

### GET /api/v1/admin/customers/:userId

Response adds `lastLoginAt` and order count. It does not include addresses by default. Addresses are customer-private; the admin order detail already contains the fulfillment snapshot that was needed to deliver.

### PATCH /api/v1/admin/customers/:userId/status

Request: `{ "status": "SUSPENDED" }`. Allowed values: `ACTIVE`, `SUSPENDED`. This is UD-10. Suspension increments `token_version` and writes an audit row.

Response `200`: `{ "id", "status" }`.

Errors: `BUSINESS_RULE` if the id is not a customer.

### GET /api/v1/admin/merchants

Same list shape as customers, role implied merchant, plus `shopCount`.

### POST /api/v1/admin/merchants

| | |
|---|---|
| Description | Creates a merchant and a temporary password |
| Requirements | FR-A-02, FR-A-03 |

Request: `{ "fullName": "Abel Tadesse", "username": "abel", "temporaryPassword": "temp-pass-1" }`.

The temporary password follows the same minimum as any password. The server hashes it, sets `must_change_password`, and returns the plaintext once.

Response `201`:

```json
{
  "id": "abababab-abab-4bab-8bab-abababababab",
  "username": "abel",
  "temporaryPassword": "temp-pass-1"
}
```

The audit metadata records the user id and username only.

Errors: `CONFLICT` for a duplicate username.

### GET /api/v1/admin/merchants/:userId

Response: profile fields, status, and shops `{ "id", "name", "status" }`.

### PATCH /api/v1/admin/merchants/:userId/status

Same body as customer status. Suspension hides the merchant's shops from the public catalog (`FR-A-07`).

### POST /api/v1/admin/merchants/:userId/reset-password

Request: `{ "temporaryPassword": "temp-pass-2" }`.

Response `200`: `{ "id", "temporaryPassword": "temp-pass-2", "mustChangePassword": true }`. `token_version` increments. Audit metadata omits the password.

### GET /api/v1/admin/shops

Query: `status`, `q`, `page`. Unlike the public list, this includes suspended and removed shops and includes bank fields.

### POST /api/v1/admin/shops

| | |
|---|---|
| Description | Creates a shop at an exact coordinate |
| Requirements | FR-A-01, FR-A-04 |

Request:

```json
{
  "merchantId": "abababab-abab-4bab-8bab-abababababab",
  "name": "Shop A",
  "description": "Electronics stall",
  "phone": "0911000000",
  "addressText": "Jimma center",
  "latitude": "7.666700",
  "longitude": "36.833300",
  "deliveryFeeEtb": "0.00",
  "bankName": "Example Bank",
  "bankAccountName": "Shop A Owner",
  "bankAccountNumber": "1000000000000",
  "status": "ACTIVE"
}
```

Validation: latitude and longitude ranges, fee `>= 0`, phone pattern, status `ACTIVE` or `SUSPENDED`. `merchantId` must be a merchant.

Response `201`: the shop, including generated `slug`.

### GET /api/v1/admin/shops/:shopId

Response `200`: the full shop row except internal timestamps may be included: the public fields, bank fields, status, and merchant `{ "id", "username", "status" }`.

### PATCH /api/v1/admin/shops/:shopId

Any subset of the create fields, including `merchantId`, coordinates, and `status` of `ACTIVE`, `SUSPENDED`, or `REMOVED`. At least one field is required. Ownership transfer does not update historical `merchant_orders.merchant_id`.

Response `200`: the shop. An audit row stores the changed non-secret fields. Bank account number is operational data and may be included in the audit diff because the Super Admin is the actor; it must not be written to application info logs.

### GET /api/v1/admin/categories

Response includes inactive categories: `{ "id", "name", "slug", "description", "isActive" }`.

### POST /api/v1/admin/categories

Request: `{ "name": "Electronics", "description": "Devices" }`.

Response `201`: the category with `isActive: true` and a slug.

Errors: `CONFLICT` on duplicate name.

### PATCH /api/v1/admin/categories/:categoryId

Request: any of `name`, `description`, `isActive`.

Response `200`: the category. There is no delete route (`FR-A-08`).

### GET /api/v1/admin/orders

Query: `page`, `paymentStatus`, `fulfillmentStatus`, `q` matching `order_number`.

Response item matches the customer list item plus `customer: { "id", "username" }`.

### GET /api/v1/admin/orders/:orderId

The customer order detail plus each sub-order's `merchantId`, payment ids, and settlement status if any. This is the full transaction view (`FR-A-10`, `FR-O-07`).

### GET /api/v1/admin/payments

Query: `method`, `status`, `page`.

Response item: `{ "id", "orderId", "merchantOrderId", "method", "amount", "currency", "status", "txRef", "createdAt" }`. `txRef` is null for bank transfer. Receipt images are not inlined; the receipt route remains the way to open a file.

### GET /api/v1/admin/settlements

Query: `status`, `merchantId`, `page`.

Response item: `{ "id", "merchantOrderId", "merchantId", "shopId", "grossAmount", "platformFeeAmount", "netAmount", "status", "createdAt" }`.

### PATCH /api/v1/admin/settlements/:settlementId

| | |
|---|---|
| Description | Records an offline Chapa payout or withholds it |
| Requirements | FR-P-07 |

Request: `{ "status": "SETTLED", "referenceNote": "Paid on 21 Nov" }`. Allowed targets: `SETTLED`, `WITHHELD`. `referenceNote` is required for `SETTLED`, 2–200 characters.

Response `200`: the settlement. A second transition from `SETTLED` is `BUSINESS_RULE`. The action is audited.

### GET /api/v1/admin/analytics

Query: `from`, `to`, same date rules as the merchant route.

Response:

```json
{
  "from": "2026-11-01",
  "to": "2026-11-21",
  "customers": 1,
  "merchants": 3,
  "activeShops": 3,
  "paidSalesTotal": "35000.00",
  "subOrdersByFulfillment": { "NEW": 3 },
  "subOrdersByPayment": { "PAID": 3 },
  "paidSalesByMethod": { "CHAPA": "35000.00", "BANK_TRANSFER": "0.00" },
  "topProducts": [{ "productId": "22222222-2222-4222-8222-222222222222", "name": "Laptop", "unitsSold": 1 }],
  "topShops": [{ "shopId": "11111111-1111-4111-8111-111111111111", "name": "Shop A", "paidTotal": "30000.00" }]
}
```

`paidSalesTotal` sums sub-order totals, not parent grand totals plus sub-orders.

### GET /api/v1/admin/audit-logs

Query: `page`, `action`, `entityType`, `entityId`.

Response item: `{ "id", "actorUserId", "action", "entityType", "entityId", "metadata", "ipAddress", "createdAt" }`. The list is newest first. There is no update or delete route.

## 5.13 AI assistant

### POST /api/v1/ai/chat

| | |
|---|---|
| Description | Answers a shopping question using public catalog tools only |
| Role | Public |
| Authentication | Optional and ignored for data access. A token is not a reason to load a profile |
| Requirements | FR-AI-01, FR-AI-02, FR-AI-03 |

Request:

```json
{
  "message": "What laptops can I get under 32000 ETB?",
  "history": [],
  "location": { "latitude": 7.6667, "longitude": 36.8333 },
  "area": "Hermata"
}
```

`location` and `area` are optional. The server uses them to measure distance or match a neighborhood. It does not forward the coordinates to Gemini. Unknown properties are dropped.

Validation:

- `message` is 1–500 characters.
- `history` contains at most 10 items of `{ "role": "user" | "assistant", "text": "..." }`.
- Each history text is 1–500 characters.
- Unknown properties are dropped, not forwarded.

Response `200`:

```json
{
  "reply": "Shop A lists a laptop at 30000.00 ETB.",
  "products": [
    {
      "productId": "22222222-2222-4222-8222-222222222222",
      "name": "Laptop",
      "price": "30000.00",
      "currency": "ETB",
      "shopName": "Shop A",
      "shopSlug": "shop-a",
      "available": true,
      "distanceKm": 2.1
    }
  ],
  "shops": []
}
```

`products` and `shops` contain only values returned by the catalog tools during this turn. `distanceKm` is null when the shopper did not ask for a nearby search. The client renders these cards; it does not parse prices out of `reply`.

The server does not persist the transcript.

Errors: `VALIDATION_ERROR`, `RATE_LIMITED`, `502` with code `ASSISTANT_UNAVAILABLE` when Gemini cannot be reached. That `502` uses the same error envelope and must not include the provider key or the raw prompt.

The tools the model may call are specified only in [09-ai-shopping-assistant.md](09-ai-shopping-assistant.md). This route has no parameters that select a table, a role, or a user id.

## 5.14 Operational

### GET /api/v1/health

| | |
|---|---|
| Description | Process and database check for the host |
| Role | Public |
| Authentication | No |
| Requirements | Deployment |

Response `200`: `{ "status": "ok" }`. Response `503`: `{ "status": "degraded" }` when the database ping fails. The body does not include version secrets or connection strings.

## 5.15 Endpoints that are intentionally absent

| Absent endpoint | Reason |
|---|---|
| Public merchant registration | FR-M-01 |
| Super Admin registration or role promotion | UD-09 |
| Customer password reset | UD-02 |
| Admin fulfillment override | FR-A-10 is read access |
| Automated refund | UD-05 |
| Card payment | Not a specified method |
| AI endpoints that accept SQL, table names, or order ids | FR-AI-02 |
| Direct browser upload to Cloudinary | Uploads go through the API so type and size are enforced |
