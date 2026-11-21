import { assistantChatSchema } from '@marketplace/contracts';
import { Router } from 'express';
import { parseBody, sendData } from '../../lib/http.js';
import { logger } from '../../lib/logger.js';
import { assistantLimiter } from '../../middleware/rate-limit.js';
import { handleChat } from './assistant.service.js';

export const assistantRouter = Router();

assistantRouter.post('/chat', assistantLimiter, async (req, res) => {
  const started = Date.now();
  const input = parseBody(assistantChatSchema, req);
  // Location is used only as a server-side origin. It is not written on the request the model sees.
  logger.info(
    { hasLocation: input.location !== undefined, hasArea: input.area !== undefined },
    'assistant request',
  );
  try {
    const data = await handleChat(input);
    logger.info({ status: 'ok', durationMs: Date.now() - started }, 'assistant request done');
    sendData(res, data);
  } catch (error) {
    logger.info({ status: 'error', durationMs: Date.now() - started }, 'assistant request done');
    throw error;
  }
});
