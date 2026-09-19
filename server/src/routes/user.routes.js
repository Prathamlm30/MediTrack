import { Router } from 'express';
import * as users from '../controllers/user.controller.js';
import verifyJWT from '../middleware/verifyJWT.js';
const router = Router();
router.use(verifyJWT);
router.get('/me', users.me);
router.patch('/me', users.edit);
router.patch('/me/preferences', users.preferences);
export default router;
