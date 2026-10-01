import { Router } from 'express';
import * as users from '../controllers/user.controller.js';
import verifyJWT from '../middleware/verifyJWT.js';
const router = Router();
router.use(verifyJWT);
/**
 * @openapi
 * /api/users/me:
 *   get:
 *     summary: Read your public profile and preferences
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     description: >-
 *       Returns all User scalar fields except passwordHash, plus hasPassword and nullable preferences. This
 *       includes googleId, isActive, and timestamps.
 *     responses:
 *       '200':
 *         description: Current active user.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - user
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *               additionalProperties: false
 *       '400':
 *         description: Invalid JSON.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Invalid JSON.
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *       '415':
 *         $ref: '#/components/responses/UnsupportedBodyEncoding'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/me', users.me);
/**
 * @openapi
 * /api/users/me:
 *   patch:
 *     summary: Edit your profile
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     description: >-
 *       Only the listed fields may be edited. Strings are trimmed and must be nonblank. An empty object is
 *       accepted. Null clears optional fields.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fullName:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 255
 *               phoneNumber:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 255
 *                 nullable: true
 *               address:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 255
 *                 nullable: true
 *               profilePictureUrl:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 2048
 *                 nullable: true
 *                 description: 'An absolute http: or https: URL.'
 *             additionalProperties: false
 *     responses:
 *       '200':
 *         description: Updated public user and preferences.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - user
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *               additionalProperties: false
 *       '400':
 *         description: >-
 *           A JSON object is required. / Invalid fullName. / Invalid phoneNumber. / Invalid address. / Invalid
 *           profilePictureUrl. / Field <key> cannot be edited. / Invalid JSON.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: A JSON object is required.
 *               error2:
 *                 value:
 *                   error: Invalid fullName.
 *               error3:
 *                 value:
 *                   error: Invalid phoneNumber.
 *               error4:
 *                 value:
 *                   error: Invalid address.
 *               error5:
 *                 value:
 *                   error: Invalid profilePictureUrl.
 *               error6:
 *                 value:
 *                   error: Field <key> cannot be edited.
 *               invalidJson:
 *                 value:
 *                   error: Invalid JSON.
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *       '415':
 *         $ref: '#/components/responses/UnsupportedBodyEncoding'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.patch('/me', users.edit);
/**
 * @openapi
 * /api/users/me/preferences:
 *   patch:
 *     summary: Update notification and display preferences
 *     tags:
 *       - Users
 *     security:
 *       - bearerAuth: []
 *     description: >-
 *       Upserts preferences. Unknown fields are rejected; an empty object is accepted. Non-null strings must be
 *       nonblank, at most 100 characters before trimming. Language is free text. Null timezone clears the
 *       preference.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               preferredNotificationChannel:
 *                 type: string
 *                 enum:
 *                   - email
 *                   - push
 *                   - sms
 *                   - in_app
 *               language:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 100
 *               theme:
 *                 type: string
 *                 enum:
 *                   - light
 *                   - dark
 *               timezone:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 100
 *                 nullable: true
 *                 description: A timezone accepted by Intl.DateTimeFormat.
 *             additionalProperties: false
 *     responses:
 *       '200':
 *         description: Stored preferences.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - preferences
 *               properties:
 *                 preferences:
 *                   $ref: '#/components/schemas/UserPreference'
 *               additionalProperties: false
 *       '400':
 *         description: >-
 *           A JSON object is required. / Unknown preference <key>. / Invalid preferredNotificationChannel. /
 *           Invalid language. / Invalid theme. / Invalid timezone. / Invalid notification channel. / Invalid
 *           JSON.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: A JSON object is required.
 *               error2:
 *                 value:
 *                   error: Unknown preference <key>.
 *               error3:
 *                 value:
 *                   error: Invalid preferredNotificationChannel.
 *               error4:
 *                 value:
 *                   error: Invalid language.
 *               error5:
 *                 value:
 *                   error: Invalid theme.
 *               error6:
 *                 value:
 *                   error: Invalid timezone.
 *               error7:
 *                 value:
 *                   error: Invalid notification channel.
 *               invalidJson:
 *                 value:
 *                   error: Invalid JSON.
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '409':
 *         $ref: '#/components/responses/DuplicateIdentity'
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *       '415':
 *         $ref: '#/components/responses/UnsupportedBodyEncoding'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.patch('/me/preferences', users.preferences);
export default router;
