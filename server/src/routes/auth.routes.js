import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import verifyJWT from '../middleware/verifyJWT.js';
const router = Router();
/**
 * @openapi
 * /api/auth/register:
 *   post:
 *     summary: Register a password account
 *     tags:
 *       - Auth
 *     description: >-
 *       Creates an unverified local account and emails a single-use verification token valid for 24 hours. Does
 *       not sign in. Unknown body fields are ignored. An existing email (including a Google account) returns
 *       409; registration does not link it.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - fullName
 *               - email
 *               - password
 *             properties:
 *               fullName:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 255
 *                 description: Nonblank, trimmed.
 *               email:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 254
 *                 description: Trimmed and lowercased; must match /^[^\s@]+@[^\s@]+\.[^\s@]+$/.
 *               phoneNumber:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 40
 *                 nullable: true
 *                 description: Optional; null is accepted. Non-null values must be nonblank and are trimmed.
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 description: At least 8 JavaScript string characters and at most 72 UTF-8 bytes. Not trimmed.
 *             additionalProperties: true
 *     responses:
 *       '201':
 *         description: Account created; no session tokens.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - user
 *                 - message
 *               properties:
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *                 message:
 *                   type: string
 *                   enum:
 *                     - Account created. Check your email to verify it.
 *               additionalProperties: false
 *       '400':
 *         description: >-
 *           A JSON object is required. / Invalid fullName. / Invalid email. / Invalid phoneNumber. / Password
 *           must contain at least 8 characters and at most 72 UTF-8 bytes. / Invalid JSON.
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
 *                   error: Invalid email.
 *               error4:
 *                 value:
 *                   error: Invalid phoneNumber.
 *               error5:
 *                 value:
 *                   error: Password must contain at least 8 characters and at most 72 UTF-8 bytes.
 *               invalidJson:
 *                 value:
 *                   error: Invalid JSON.
 *       '409':
 *         $ref: '#/components/responses/DuplicateIdentity'
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *       '415':
 *         $ref: '#/components/responses/UnsupportedBodyEncoding'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/register', auth.register);
/**
 * @openapi
 * /api/auth/login:
 *   post:
 *     summary: Sign in with email and password
 *     tags:
 *       - Auth
 *     description: >-
 *       Returns the public user and app JWT pair. The email must be verified and the account active. Google-only
 *       accounts must use Google Sign-In. Unknown body fields are ignored.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 254
 *                 description: Trimmed and lowercased; must match /^[^\s@]+@[^\s@]+\.[^\s@]+$/.
 *               password:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 description: At least 8 JavaScript string characters and at most 72 UTF-8 bytes. Not trimmed.
 *             additionalProperties: true
 *           example:
 *             email: patient@example.test
 *             password: example-password
 *     responses:
 *       '200':
 *         description: Signed in; access token lasts 900 seconds, refresh token 7 days.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Session'
 *       '400':
 *         description: >-
 *           A JSON object is required. / Invalid email. / Password must contain at least 8 characters and at
 *           most 72 UTF-8 bytes. / This account uses Google Sign-In. Sign in with Google. / Invalid JSON.
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
 *                   error: Invalid email.
 *               error3:
 *                 value:
 *                   error: Password must contain at least 8 characters and at most 72 UTF-8 bytes.
 *               error4:
 *                 value:
 *                   error: This account uses Google Sign-In. Sign in with Google.
 *               invalidJson:
 *                 value:
 *                   error: Invalid JSON.
 *       '401':
 *         description: Invalid email or password. / Account unavailable.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Invalid email or password.
 *               error2:
 *                 value:
 *                   error: Account unavailable.
 *       '403':
 *         description: Verify your email before signing in.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Verify your email before signing in.
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *       '415':
 *         $ref: '#/components/responses/UnsupportedBodyEncoding'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/login', auth.login);
/**
 * @openapi
 * /api/auth/google:
 *   post:
 *     summary: Sign in or link using a Google ID token
 *     tags:
 *       - Auth
 *     description: >-
 *       Verifies the Google ID token. Resolves the Google identity, links a matching local email account while
 *       retaining its password/provider, or creates a Google-only account. Issues the same app JWT pair as
 *       password login. Unknown fields are ignored.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - idToken
 *             properties:
 *               idToken:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 10000
 *             additionalProperties: true
 *     responses:
 *       '200':
 *         description: Signed in.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Session'
 *       '400':
 *         description: A JSON object is required. / Invalid idToken. / Invalid JSON.
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
 *                   error: Invalid idToken.
 *               invalidJson:
 *                 value:
 *                   error: Invalid JSON.
 *       '401':
 *         description: Invalid or expired Google ID token. / Google must provide a verified email. / Account unavailable.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Invalid or expired Google ID token.
 *               error2:
 *                 value:
 *                   error: Google must provide a verified email.
 *               error3:
 *                 value:
 *                   error: Account unavailable.
 *       '409':
 *         description: >-
 *           Email is already associated with another Google account. / An account with this email or Google
 *           identity already exists.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Email is already associated with another Google account.
 *               error2:
 *                 value:
 *                   error: An account with this email or Google identity already exists.
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *       '415':
 *         $ref: '#/components/responses/UnsupportedBodyEncoding'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/google', auth.google);
/**
 * @openapi
 * /api/auth/refresh:
 *   post:
 *     summary: Rotate the refresh token
 *     tags:
 *       - Auth
 *     description: >-
 *       Uses the refresh token in the JSON body, not bearer authentication. Atomically replaces the single Redis
 *       refresh session; the previous refresh token cannot be reused. Unknown fields are ignored.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 4096
 *             additionalProperties: true
 *     responses:
 *       '200':
 *         description: New token pair; there is no user field in this response.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TokenPair'
 *       '400':
 *         description: A JSON object is required. / Invalid refreshToken. / Invalid JSON.
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
 *                   error: Invalid refreshToken.
 *               invalidJson:
 *                 value:
 *                   error: Invalid JSON.
 *       '401':
 *         description: Invalid or expired refresh token. / Refresh token revoked or already used. / Account unavailable.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Invalid or expired refresh token.
 *               error2:
 *                 value:
 *                   error: Refresh token revoked or already used.
 *               error3:
 *                 value:
 *                   error: Account unavailable.
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *       '415':
 *         $ref: '#/components/responses/UnsupportedBodyEncoding'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/refresh', auth.refresh);
/**
 * @openapi
 * /api/auth/logout:
 *   post:
 *     summary: Revoke the current refresh session
 *     tags:
 *       - Auth
 *     description: Deletes the user refresh session from Redis. Already-issued access tokens remain valid until expiry.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       '200':
 *         description: Logged out.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - message
 *               properties:
 *                 message:
 *                   type: string
 *                   enum:
 *                     - Logged out.
 *               additionalProperties: false
 *             example:
 *               message: Logged out.
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
router.post('/logout', verifyJWT, auth.logout);
/**
 * @openapi
 * /api/auth/forgot-password:
 *   post:
 *     summary: Request a password reset email
 *     tags:
 *       - Auth
 *     description: >-
 *       Always returns the same successful message for a syntactically valid email. Only active accounts with a
 *       password receive an email; absent, inactive, and Google-only accounts do not. Reset tokens last 15
 *       minutes. Unknown fields are ignored.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 254
 *                 description: Trimmed and lowercased; must match /^[^\s@]+@[^\s@]+\.[^\s@]+$/.
 *             additionalProperties: true
 *     responses:
 *       '200':
 *         description: If this email has an eligible password account, a reset link has been sent.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - message
 *               properties:
 *                 message:
 *                   type: string
 *                   enum:
 *                     - If this email has an eligible password account, a reset link has been sent.
 *               additionalProperties: false
 *             example:
 *               message: If this email has an eligible password account, a reset link has been sent.
 *       '400':
 *         description: A JSON object is required. / Invalid email. / Invalid JSON.
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
 *                   error: Invalid email.
 *               invalidJson:
 *                 value:
 *                   error: Invalid JSON.
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *       '415':
 *         $ref: '#/components/responses/UnsupportedBodyEncoding'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/forgot-password', auth.forgotPassword);
/**
 * @openapi
 * /api/auth/reset-password:
 *   post:
 *     summary: Reset a password with an emailed token
 *     tags:
 *       - Auth
 *     description: >-
 *       Consumes a single-use reset token, changes the password, and revokes the refresh session. Unknown fields
 *       are ignored.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - newPassword
 *             properties:
 *               token:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 64
 *                 pattern: ^[a-f0-9]{64}$
 *                 description: Trimmed before token validation.
 *               newPassword:
 *                 type: string
 *                 format: password
 *                 minLength: 8
 *                 description: At least 8 JavaScript string characters and at most 72 UTF-8 bytes. Not trimmed.
 *             additionalProperties: true
 *     responses:
 *       '200':
 *         description: Password reset. Sign in with your new password.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - message
 *               properties:
 *                 message:
 *                   type: string
 *                   enum:
 *                     - Password reset. Sign in with your new password.
 *               additionalProperties: false
 *             example:
 *               message: Password reset. Sign in with your new password.
 *       '400':
 *         description: >-
 *           A JSON object is required. / Invalid token. / Password must contain at least 8 characters and at
 *           most 72 UTF-8 bytes. / Invalid or expired token. / This account uses Google Sign-In. / Invalid JSON.
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
 *                   error: Invalid token.
 *               error3:
 *                 value:
 *                   error: Password must contain at least 8 characters and at most 72 UTF-8 bytes.
 *               error4:
 *                 value:
 *                   error: Invalid or expired token.
 *               error5:
 *                 value:
 *                   error: This account uses Google Sign-In.
 *               invalidJson:
 *                 value:
 *                   error: Invalid JSON.
 *       '401':
 *         description: Account unavailable.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Account unavailable.
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *       '415':
 *         $ref: '#/components/responses/UnsupportedBodyEncoding'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/reset-password', auth.resetPassword);
/**
 * @openapi
 * /api/auth/verify-email/{token}:
 *   get:
 *     summary: Verify an email address
 *     tags:
 *       - Auth
 *     security: []
 *     parameters:
 *       - name: token
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           pattern: ^[a-f0-9]{64}$
 *         description: Raw 64-character lowercase hexadecimal token from the email.
 *     description: >-
 *       Consumes the emailed, single-use 24-hour token and marks the active account verified. Returns JSON, not
 *       a redirect.
 *     responses:
 *       '200':
 *         description: Email verified. You can now sign in.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - message
 *               properties:
 *                 message:
 *                   type: string
 *                   enum:
 *                     - Email verified. You can now sign in.
 *               additionalProperties: false
 *             example:
 *               message: Email verified. You can now sign in.
 *       '400':
 *         description: Invalid or expired token. / Invalid JSON.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Invalid or expired token.
 *               invalidJson:
 *                 value:
 *                   error: Invalid JSON.
 *       '401':
 *         description: Account unavailable.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Account unavailable.
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *       '415':
 *         $ref: '#/components/responses/UnsupportedBodyEncoding'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/verify-email/:token', auth.verifyEmail);
export default router;
