import type { AssistantProductCard, AssistantShopCard } from '@marketplace/contracts';
import { z } from 'zod';
import {
  assistantCatalog,
  type AssistantCatalog,
  type NearbyShopGroup,
} from '../catalog/assistant-catalog.service.js';
import { toAssistantProduct, toAssistantShop } from '../catalog/assistant-dto.js';
import { logger } from '../../lib/logger.js';

/**
 * The allowlist is the security boundary. A name that is not in this map is never dispatched,
 * even if the model asks for it and even if a prompt says to ignore these instructions.
 * Customer coordinates are not parameters. The dispatcher adds a server-side origin, if the
 * shopper shared one, only when calling the catalog.
 */

const MAX_RESULTS = 10;

const priceArg = z.union([z.number().min(0).max(99_999_999.99), z.string().trim()]).transform((value, ctx) => {
  const text = typeof value === 'number' ? value.toString() : value;
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) {
    ctx.addIssue({
      code: 'custom',
      message: 'Use a non-negative price with at most two decimals',
    });
    return z.NEVER;
  }
  return text;
});

const limitArg = z.number().int().min(1).max(MAX_RESULTS).default(MAX_RESULTS);
const queryArg = z.string().trim().min(1).max(100);
const categoryArg = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9-]{1,100}$/, 'Unknown category');

const searchSchema = z
  .strictObject({
    query: queryArg.optional(),
    category: categoryArg.optional(),
    minPrice: priceArg.optional(),
    maxPrice: priceArg.optional(),
    availableOnly: z.boolean().default(true),
    limit: limitArg,
  })
  .refine(
    (value) =>
      value.query !== undefined ||
      value.category !== undefined ||
      value.minPrice !== undefined ||
      value.maxPrice !== undefined,
    'Provide a search term, a category, or a price bound',
  )
  .refine(
    (value) =>
      value.minPrice === undefined ||
      value.maxPrice === undefined ||
      Number(value.minPrice) <= Number(value.maxPrice),
    'Minimum price cannot be greater than maximum price',
  );

const nearbySchema = z
  .strictObject({
    query: queryArg.optional(),
    category: categoryArg.optional(),
    maxPrice: priceArg.optional(),
    radiusKm: z.number().gt(0).max(50).default(10),
    limit: limitArg,
  })
  .refine(
    (value) => value.query !== undefined || value.category !== undefined || value.maxPrice !== undefined,
    'Provide a search term, a category, or a maximum price',
  );

const toolSchemas = {
  searchProducts: searchSchema,
  getProductDetails: z.strictObject({ productId: z.uuid() }),
  getShopDetails: z.strictObject({ shopId: z.uuid() }),
  findNearbyShops: nearbySchema,
  compareProducts: z.strictObject({
    productIds: z.array(z.uuid()).min(2).max(5),
  }),
} as const;

export const ASSISTANT_TOOL_NAMES = Object.keys(toolSchemas) as (keyof typeof toolSchemas)[];

export interface ToolContext {
  /** Present only when the browser sent a validated location. Never taken from model arguments. */
  origin: { latitude: number; longitude: number } | null;
  area: string | null;
}

export interface ToolOutcome {
  /** Sent back to the model. Contains public catalog fields only. */
  forModel: Record<string, unknown>;
  products: AssistantProductCard[];
  shops: AssistantShopCard[];
}

const locationRequired: ToolOutcome = {
  forModel: {
    ok: false,
    error: 'LOCATION_REQUIRED',
    message:
      'The shopper has not shared a device location or a neighborhood. Ask them to allow location in the assistant panel, or to type an area such as a neighborhood. Do not ask them to paste coordinates.',
  },
  products: [],
  shops: [],
};

function invalidArguments(error: z.ZodError): ToolOutcome {
  return {
    forModel: {
      ok: false,
      error: 'INVALID_ARGUMENTS',
      message: error.issues[0]?.message ?? 'Those arguments are not valid.',
    },
    products: [],
    shops: [],
  };
}

function publishProducts(products: AssistantProductCard[]): AssistantProductCard[] {
  return products.map((product) => toAssistantProduct(product));
}

function publishShops(shops: AssistantShopCard[]): AssistantShopCard[] {
  return shops.map((shop) => toAssistantShop(shop));
}

function fromGroups(groups: NearbyShopGroup[]): { products: AssistantProductCard[]; shops: AssistantShopCard[] } {
  return {
    shops: publishShops(groups.map((group) => group.shop)),
    products: publishProducts(groups.flatMap((group) => group.products)),
  };
}

/**
 * Runs one model-requested tool. Unknown names and invalid arguments never reach the catalog.
 * Catalog failures return a fixed error code; database error text is not forwarded.
 */
export async function dispatchTool(
  name: string,
  args: unknown,
  context: ToolContext,
  catalog: AssistantCatalog = assistantCatalog,
): Promise<ToolOutcome> {
  const started = Date.now();
  const schema = toolSchemas[name as keyof typeof toolSchemas];
  if (!schema) {
    logger.info({ tool: name, status: 'rejected', durationMs: Date.now() - started }, 'assistant tool');
    return {
      forModel: { ok: false, error: 'UNKNOWN_TOOL', message: 'That function is not available.' },
      products: [],
      shops: [],
    };
  }

  const parsed = schema.safeParse(args ?? {});
  if (!parsed.success) {
    logger.info({ tool: name, status: 'invalid_arguments', durationMs: Date.now() - started }, 'assistant tool');
    return invalidArguments(parsed.error);
  }

  try {
    const outcome = await runTool(name as keyof typeof toolSchemas, parsed.data, context, catalog);
    logger.info(
      {
        tool: name,
        status: 'ok',
        durationMs: Date.now() - started,
        products: outcome.products.length,
        shops: outcome.shops.length,
      },
      'assistant tool',
    );
    return outcome;
  } catch {
    // Prisma errors can quote the query. Keep that text in the server log category only.
    logger.error({ tool: name, status: 'failed', durationMs: Date.now() - started }, 'assistant tool');
    return {
      forModel: { ok: false, error: 'CATALOG_UNAVAILABLE', message: 'The catalog could not be read.' },
      products: [],
      shops: [],
    };
  }
}

async function runTool(
  name: keyof typeof toolSchemas,
  args: z.output<(typeof toolSchemas)[typeof name]>,
  context: ToolContext,
  catalog: AssistantCatalog,
): Promise<ToolOutcome> {
  switch (name) {
    case 'searchProducts': {
      const input = args as z.output<typeof searchSchema>;
      const products = publishProducts(await catalog.searchProducts(input));
      return { forModel: { ok: true, products }, products, shops: [] };
    }
    case 'getProductDetails': {
      const { productId } = args as z.output<(typeof toolSchemas)['getProductDetails']>;
      const product = await catalog.getProduct(productId);
      const products = product ? publishProducts([product]) : [];
      return { forModel: { ok: true, product: products[0] ?? null }, products, shops: [] };
    }
    case 'getShopDetails': {
      const { shopId } = args as z.output<(typeof toolSchemas)['getShopDetails']>;
      const shop = await catalog.getShop(shopId);
      const shops = shop ? publishShops([shop]) : [];
      return { forModel: { ok: true, shop: shops[0] ?? null }, products: [], shops };
    }
    case 'findNearbyShops': {
      if (!context.origin && !context.area) return locationRequired;
      const input = args as z.output<typeof nearbySchema>;
      const groups = await catalog.findNearby({
        query: input.query,
        category: input.category,
        maxPrice: input.maxPrice,
        availableOnly: true,
        limit: input.limit,
        radiusKm: input.radiusKm,
        origin: context.origin,
        area: context.area,
      });
      const published = fromGroups(groups);
      return {
        forModel: {
          ok: true,
          shops: published.shops.map((shop, index) => ({
            ...shop,
            products: groups[index] ? publishProducts(groups[index].products) : [],
          })),
        },
        ...published,
      };
    }
    case 'compareProducts': {
      const { productIds } = args as z.output<(typeof toolSchemas)['compareProducts']>;
      const products = publishProducts(await catalog.compareProducts(productIds));
      return { forModel: { ok: true, products }, products, shops: [] };
    }
    default:
      return {
        forModel: { ok: false, error: 'UNKNOWN_TOOL' },
        products: [],
        shops: [],
      };
  }
}

/** JSON schemas handed to Gemini. Kept beside the Zod parsers so the model cannot invent parameters. */
export const ASSISTANT_FUNCTION_DECLARATIONS = [
  {
    name: 'searchProducts',
    description:
      'Search the public product catalog. Returns real products only. Has no access to accounts, orders, or payments.',
    parametersJsonSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Product words, such as shoes or laptop.' },
        category: { type: 'string', description: 'Category slug, such as fashion.' },
        minPrice: { type: 'number', description: 'Minimum price in ETB.' },
        maxPrice: { type: 'number', description: 'Maximum price in ETB.' },
        availableOnly: { type: 'boolean', description: 'When true, only products that can be purchased.' },
        limit: { type: 'integer', description: 'How many products to return, from 1 to 10.' },
      },
    },
  },
  {
    name: 'getProductDetails',
    description: 'Public details for one product id returned by search.',
    parametersJsonSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { productId: { type: 'string', description: 'Product id from a catalog result.' } },
      required: ['productId'],
    },
  },
  {
    name: 'getShopDetails',
    description: 'Public shop profile: name, description, address, phone, and logo. No payment details.',
    parametersJsonSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { shopId: { type: 'string', description: 'Shop id from a catalog result.' } },
      required: ['shopId'],
    },
  },
  {
    name: 'findNearbyShops',
    description:
      'Find public shops selling matching products and sort them by distance. Distance is computed by the server. This function does not accept coordinates.',
    parametersJsonSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string' },
        category: { type: 'string' },
        maxPrice: { type: 'number', description: 'Maximum price in ETB.' },
        radiusKm: { type: 'number', description: 'Search radius in kilometres, up to 50.' },
        limit: { type: 'integer', description: 'How many shops to return, from 1 to 10.' },
      },
    },
  },
  {
    name: 'compareProducts',
    description: 'Compare up to five products using their current public catalog records. Do not invent specifications.',
    parametersJsonSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        productIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Two to five product ids from earlier catalog results.',
        },
      },
      required: ['productIds'],
    },
  },
] as const;
