import express from 'express';
import cors from 'cors';
import './config/env.js';
import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import userRoutes from './routes/user.routes.js';
import relationshipRoutes from './routes/relationships.routes.js';
import invitationRoutes from './routes/invitations.routes.js';
import dashboardRoutes from './routes/dashboard/index.js';
import prescriptionScanRoutes from './routes/prescription-scans/index.js';
import { installImageStorage } from './routes/prescription-scans/storage.js';
import medicationRoutes from './routes/medications/index.js';
import doctorRoutes from './routes/doctors/index.js';
import scheduleRoutes from './routes/schedules/index.js';
import inventoryRoutes from './routes/inventory/index.js';
import errorHandler from './middleware/errorHandler.js';
import swaggerUi from 'swagger-ui-express';
import swaggerSpec from './docs/swaggerConfig.js';

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '32kb' }));
/**
 * @openapi
 * /api-docs.json:
 *   get:
 *     summary: Read the OpenAPI specification
 *     tags: [System]
 *     security: []
 *     responses:
 *       '200':
 *         description: Generated OpenAPI 3.0 document.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               additionalProperties: true
 */
app.get('/api-docs.json', (_req, res) => res.json(swaggerSpec));
/**
 * @openapi
 * /api-docs:
 *   get:
 *     summary: Open the interactive Swagger UI
 *     tags: [System]
 *     security: []
 *     responses:
 *       '200':
 *         description: Interactive documentation (at the trailing-slash URL).
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 *       '301':
 *         description: Redirect to /api-docs/.
 *         headers:
 *           Location:
 *             schema:
 *               type: string
 *               example: /api-docs/
 *         content:
 *           text/html:
 *             schema:
 *               type: string
 */
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
app.use('/api/auth', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, authRoutes);
app.use('/api/users', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, userRoutes);
app.use('/api/relationships', relationshipRoutes);
app.use('/api/invitations', invitationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/prescription-scans', prescriptionScanRoutes);
app.use('/api/medications', medicationRoutes);
app.use('/api/doctors', doctorRoutes);
app.use('/api', scheduleRoutes);
app.use('/api', inventoryRoutes);
installImageStorage(app);
app.use('/api', healthRoutes);
app.use(errorHandler);
export default app;
