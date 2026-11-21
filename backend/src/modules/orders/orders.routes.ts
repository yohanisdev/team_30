import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { validationError } from '../../lib/errors.js';
import { parseBody, sendData } from '../../lib/http.js';
import { idParam } from '../../lib/params.js';
import { authOf, guard } from '../../middleware/authenticate.js';
import { uploadLimiter } from '../../middleware/rate-limit.js';
import { detectImageType } from '../media/image-type.js';
import * as orders from './orders.service.js';

const retrySchema = z.object({
  payerEmail: z
    .union([z.string().trim().email('Enter a valid email'), z.literal(''), z.null()])
    .optional()
    .transform((value) => (value ? value : undefined)),
});

const receiptParser = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4 },
}).single('receipt');

export const ordersRouter = Router();
ordersRouter.use(guard('CUSTOMER'));

ordersRouter.get('/:orderId', async (req, res) => {
  sendData(res, await orders.getOrder(authOf(req).userId, idParam(req, 'orderId', 'Order')));
});

ordersRouter.post('/:orderId/payments/chapa/retry', async (req, res) => {
  const { payerEmail } = parseBody(retrySchema, req);
  sendData(
    res,
    await orders.retryChapa(authOf(req).userId, idParam(req, 'orderId', 'Order'), payerEmail),
  );
});

export const receiptRouter = Router();
receiptRouter.use(guard('CUSTOMER'));

receiptRouter.post('/:merchantOrderId/receipts', uploadLimiter, receiptParser, async (req, res) => {
  if (!req.file) {
    throw validationError('Choose a receipt image.', [{ field: 'receipt', message: 'An image file is required' }]);
  }
  const type = detectImageType(req.file.buffer);
  if (!type) {
    throw validationError('Only JPEG, PNG or WebP images are allowed.', [
      { field: 'receipt', message: 'Unsupported file type' },
    ]);
  }
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : undefined;
  sendData(
    res,
    await orders.submitReceipt(authOf(req).userId, idParam(req, 'merchantOrderId', 'Order'), {
      buffer: req.file.buffer,
      type,
    }, note || undefined),
    201,
  );
});
