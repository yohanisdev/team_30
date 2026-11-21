import { z } from 'zod';

/**
 * Shopping-assistant HTTP contract. These types are the only catalog fields the
 * browser renders for a chat turn. They are also the fields the model is allowed to see.
 * Customer coordinates are accepted here so the backend can measure distance, and are
 * not part of any tool argument the model can supply.
 */

// Unknown properties are dropped so a client cannot smuggle a role, tool name, or system block.
const historyItemSchema = z.object({
  role: z.enum(['user', 'assistant']),
  text: z.string().trim().min(1).max(500),
});

export const assistantChatSchema = z.object({
  message: z.string().trim().min(1, 'Enter a question').max(500, 'Keep the question under 500 characters'),
  history: z.array(historyItemSchema).max(10).default([]),
  location: z
    .strictObject({
      latitude: z.number().gte(-90).lte(90),
      longitude: z.number().gte(-180).lte(180),
    })
    .optional(),
  /** Neighborhood or area typed by the shopper when they decline device location. */
  area: z.string().trim().min(2).max(80).optional(),
});
export type AssistantChatInput = z.infer<typeof assistantChatSchema>;

export interface AssistantProductCard {
  productId: string;
  name: string;
  description: string;
  price: string;
  currency: 'ETB';
  imageUrl: string | null;
  available: boolean;
  categoryName: string;
  categorySlug: string;
  shopId: string;
  shopName: string;
  shopSlug: string;
  /** Kilometres from the shopper, rounded to 0.1 km. Null when distance was not requested. */
  distanceKm: number | null;
}

export interface AssistantShopCard {
  shopId: string;
  name: string;
  slug: string;
  description: string;
  addressText: string;
  phone: string;
  logoUrl: string | null;
  distanceKm: number | null;
  productCount: number;
}

export interface AssistantChatResponse {
  reply: string;
  products: AssistantProductCard[];
  shops: AssistantShopCard[];
}
