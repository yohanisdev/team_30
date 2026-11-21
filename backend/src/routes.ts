import { Router } from 'express';
import { adminRouter } from './modules/admin/admin.routes.js';
import { assistantRouter } from './modules/assistant/assistant.routes.js';
import { cartRouter, checkoutRouter } from './modules/cart/cart.routes.js';
import { publicCatalogRouter } from './modules/catalog/public.routes.js';
import { authRouter } from './modules/identity/auth.routes.js';
import { merchantRouter } from './modules/merchant/merchant.routes.js';

export const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/ai', assistantRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/merchant', merchantRouter);
apiRouter.use('/cart', cartRouter);
apiRouter.use('/checkout', checkoutRouter);
apiRouter.use(publicCatalogRouter);
