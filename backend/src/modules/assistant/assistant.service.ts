import type { AssistantChatInput, AssistantChatResponse, AssistantProductCard, AssistantShopCard } from '@marketplace/contracts';
import { env } from '../../config/env.js';
import { AppError, serviceUnavailable } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { googleGeminiClient, type GeminiClient, type GeminiRequest, type GeminiToolStep } from './gemini.js';
import { ASSISTANT_TOOL_NAMES, dispatchTool, type ToolContext } from './tools.js';

/** A turn may execute at most this many tool calls. Further requests from the model are ignored. */
const MAX_TOOL_CALLS = 3;

/**
 * Tests inject a client here. `null` forces the "not configured" response even when a key is present,
 * so the suite does not call Gemini and does not depend on the developer key.
 */
let testClient: GeminiClient | null | undefined;

export function setAssistantClientForTests(client: GeminiClient | null | undefined): void {
  if (env.NODE_ENV !== 'test') throw new Error('The assistant test client is only available in tests.');
  testClient = client;
}

function resolveClient(explicit?: GeminiClient): GeminiClient | null {
  if (explicit) return explicit;
  if (env.NODE_ENV === 'test' && testClient !== undefined) return testClient;
  if (!env.GEMINI_API_KEY) return null;
  return googleGeminiClient;
}

function remember(
  products: Map<string, AssistantProductCard>,
  shops: Map<string, AssistantShopCard>,
  nextProducts: AssistantProductCard[],
  nextShops: AssistantShopCard[],
) {
  for (const product of nextProducts) {
    if (!products.has(product.productId)) products.set(product.productId, product);
  }
  for (const shop of nextShops) {
    if (!shops.has(shop.shopId)) shops.set(shop.shopId, shop);
  }
}

function fallbackReply(productCount: number, shopCount: number, located: boolean): string {
  if (productCount === 0 && shopCount === 0) {
    return 'I could not find matching products in the catalog.';
  }
  if (located && shopCount > 0) {
    return shopCount === 1
      ? 'I found one shop in the catalog. The distance was calculated by the server.'
      : `I found ${shopCount} shops in the catalog, nearest first. Distances were calculated by the server.`;
  }
  return productCount === 1
    ? 'I found one product in the catalog.'
    : `I found ${productCount} products in the catalog.`;
}

/**
 * One shopper turn. The model receives the message, prior text, and tool results.
 * Location stays in `context` and is applied only inside the catalog tool.
 */
export async function handleChat(
  input: AssistantChatInput,
  options: { client?: GeminiClient } = {},
): Promise<AssistantChatResponse> {
  const client = resolveClient(options.client);
  if (!client) {
    throw serviceUnavailable('The shopping assistant is not configured.');
  }

  const context: ToolContext = {
    origin: input.location ?? null,
    area: input.area ?? null,
  };
  const products = new Map<string, AssistantProductCard>();
  const shops = new Map<string, AssistantShopCard>();
  const steps: GeminiToolStep[] = [];
  let callsUsed = 0;
  let reply = '';

  const request = (): GeminiRequest => ({
    history: input.history,
    message: input.message,
    allowTools: callsUsed < MAX_TOOL_CALLS,
    steps,
  });

  try {
    for (let round = 0; round < MAX_TOOL_CALLS && callsUsed < MAX_TOOL_CALLS; round += 1) {
      const turn = await client.complete(request());
      if (turn.calls.length === 0) {
        reply = turn.text;
        break;
      }
      const batch = turn.calls.slice(0, MAX_TOOL_CALLS - callsUsed);
      for (const call of batch) {
        // Only declared tools are executable. The name is checked again inside the dispatcher.
        if (!(ASSISTANT_TOOL_NAMES as readonly string[]).includes(call.name)) {
          const rejected = await dispatchTool(call.name, call.args, context);
          steps.push({ call, result: rejected.forModel });
        } else {
          const outcome = await dispatchTool(call.name, call.args, context);
          steps.push({ call, result: outcome.forModel });
          remember(products, shops, outcome.products, outcome.shops);
        }
        callsUsed += 1;
      }
      if (turn.text && batch.length === turn.calls.length) reply = turn.text;
    }

    if (!reply) {
      const closing = await client.complete({ ...request(), allowTools: false });
      reply = closing.text;
    }
  } catch (error) {
    // A model failure after a catalog read still returns those public results.
    if (products.size === 0 && shops.size === 0) throw error;
    if (!(error instanceof AppError)) throw error;
    logger.warn({ products: products.size, shops: shops.size }, 'assistant used the catalog fallback');
  }
  if (!reply) reply = fallbackReply(products.size, shops.size, context.origin !== null);

  logger.info(
    {
      tools: steps.map((step) => step.call.name),
      products: products.size,
      shops: shops.size,
      located: context.origin !== null,
    },
    'assistant chat',
  );

  return {
    reply,
    products: [...products.values()],
    shops: [...shops.values()],
  };
}
