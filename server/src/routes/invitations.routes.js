import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import prisma from '../prismaClient.js';
import verifyJWT from '../middleware/verifyJWT.js';
import * as validate from '../middleware/validation.js';
import { requiredEnv } from '../config/env.js';
import { HttpError } from '../services/authErrors.js';
import { relationshipUsers, withPerspective } from './relationships.routes.js';

const router = Router();
const invitationLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const inviterIdentity = { select: { id: true, fullName: true, email: true } };
let transporter;
router.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

function validToken(token) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(404, 'Invitation not found.');
  return token;
}

async function pendingInvitation(token, db = prisma) {
  const invitation = await db.invitation.findUnique({
    where: { inviteToken: validToken(token) }, include: { inviter: inviterIdentity },
  });
  if (!invitation) throw new HttpError(404, 'Invitation not found.');
  if (invitation.status === 'expired' || invitation.expiresAt <= new Date()) throw new HttpError(410, 'Invitation expired.');
  if (invitation.status !== 'sent') throw new HttpError(409, 'Invitation already answered.');
  return invitation;
}

function requireInvitee(invitation, user) {
  if (invitation.inviteeEmail.toLowerCase() !== user.email.toLowerCase() || !user.emailVerified) {
    throw new HttpError(403, 'Sign in with the verified email this invitation was sent to.');
  }
  if (invitation.inviterUserId === user.id) throw new HttpError(400, 'You cannot invite yourself.');
}

/**
 * @openapi
 * /api/invitations:
 *   post:
 *     summary: Email a relationship invitation
 *     tags:
 *       - Invitations
 *     security:
 *       - bearerAuth: []
 *     description: >-
 *       proposedRole describes the invitee. A 7-day invitation is emailed. The raw inviteToken is omitted from
 *       the response. If mail delivery fails, the invitation is marked expired.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - inviteeEmail
 *               - relationshipType
 *               - proposedRole
 *             properties:
 *               inviteeEmail:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 254
 *                 description: Trimmed and lowercased; must match /^[^\s@]+@[^\s@]+\.[^\s@]+$/.
 *               relationshipType:
 *                 type: string
 *                 minLength: 1
 *                 maxLength: 255
 *                 description: Nonblank free text, trimmed.
 *               proposedRole:
 *                 type: string
 *                 enum:
 *                   - patient
 *                   - caregiver
 *             additionalProperties: false
 *     responses:
 *       '201':
 *         description: Created invitation without inviteToken or nested inviter.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - invitation
 *                 - message
 *               properties:
 *                 invitation:
 *                   $ref: '#/components/schemas/Invitation'
 *                 message:
 *                   type: string
 *                   enum:
 *                     - Invitation emailed.
 *               additionalProperties: false
 *       '400':
 *         description: >-
 *           A JSON object is required. / Only inviteeEmail, relationshipType and proposedRole are supported. /
 *           Invalid email. / Invalid relationshipType. / Invalid proposedRole. / You cannot invite yourself. /
 *           Invalid JSON.
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
 *                   error: Only inviteeEmail, relationshipType and proposedRole are supported.
 *               error3:
 *                 value:
 *                   error: Invalid email.
 *               error4:
 *                 value:
 *                   error: Invalid relationshipType.
 *               error5:
 *                 value:
 *                   error: Invalid proposedRole.
 *               error6:
 *                 value:
 *                   error: You cannot invite yourself.
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
router.post('/', verifyJWT, async (req, res) => {
  const data = validate.body(req);
  if (Object.keys(data).some((key) => !['inviteeEmail', 'relationshipType', 'proposedRole'].includes(key))) {
    throw new HttpError(400, 'Only inviteeEmail, relationshipType and proposedRole are supported.');
  }
  const inviteeEmail = validate.email(data.inviteeEmail);
  const relationshipType = validate.text(data.relationshipType, 'relationshipType');
  if (!['patient', 'caregiver'].includes(data.proposedRole)) throw new HttpError(400, 'Invalid proposedRole.');
  if (inviteeEmail === req.user.email.toLowerCase()) throw new HttpError(400, 'You cannot invite yourself.');
  const inviteToken = randomBytes(32).toString('hex');
  const invitation = await prisma.invitation.create({ data: {
    inviterUserId: req.user.id, inviteeEmail, relationshipType, proposedRole: data.proposedRole,
    inviteToken, expiresAt: new Date(Date.now() + invitationLifetimeMs),
  } });
  try {
    transporter ??= nodemailer.createTransport({
      host: requiredEnv('SMTP_HOST'), port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: requiredEnv('SMTP_PASS') } } : {}),
    });
    const link = new URL(`/invitations/${inviteToken}`, process.env.CLIENT_ORIGIN || 'http://localhost:5173');
    await transporter.sendMail({ from: requiredEnv('MAIL_FROM'), to: inviteeEmail,
      subject: 'MediTrack relationship invitation',
      text: `${req.user.fullName} invited you as their ${data.proposedRole} (${relationshipType}). Review and accept or decline within 7 days: ${link}`,
    });
  } catch (error) {
    // Invalidate a failed/uncertain delivery so retrying cannot leave a usable stale invite.
    await prisma.invitation.updateMany({ where: { id: invitation.id, status: 'sent' }, data: { status: 'expired' } });
    throw error;
  }
  const { inviteToken: omitted, ...safeInvitation } = invitation;
  res.status(201).json({ invitation: safeInvitation, message: 'Invitation emailed.' });
});

/**
 * @openapi
 * /api/invitations/{token}:
 *   get:
 *     summary: Preview a pending invitation
 *     tags:
 *       - Invitations
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
 *       Public projection of a pending invitation. Does not expose inviteeEmail, inviteToken, or the full
 *       invitation row. Expiry is checked before answered status.
 *     responses:
 *       '200':
 *         description: Pending invitation and inviter identity.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - invitation
 *               properties:
 *                 invitation:
 *                   $ref: '#/components/schemas/InvitationPreview'
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
 *       '404':
 *         description: Invitation not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Invitation not found.
 *       '409':
 *         description: Invitation already answered.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Invitation already answered.
 *       '410':
 *         description: Invitation expired.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Invitation expired.
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *       '415':
 *         $ref: '#/components/responses/UnsupportedBodyEncoding'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/:token', async (req, res) => {
  const invitation = await pendingInvitation(req.params.token);
  res.json({ invitation: {
    relationshipType: invitation.relationshipType, proposedRole: invitation.proposedRole,
    inviter: invitation.inviter, expiresAt: invitation.expiresAt, status: invitation.status,
  } });
});

/**
 * @openapi
 * /api/invitations/{token}/accept:
 *   post:
 *     summary: Accept an invitation or redirect to sign in
 *     tags:
 *       - Invitations
 *     security:
 *       - {}
 *       - bearerAuth: []
 *     parameters:
 *       - name: token
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           pattern: ^[a-f0-9]{64}$
 *         description: Raw 64-character lowercase hexadecimal token from the email.
 *     description: >-
 *       Without a nonempty Authorization header, validates the invitation and redirects to CLIENT_ORIGIN /signup
 *       or /login with inviteToken. With a header, requires a valid bearer JWT and the invited verified email,
 *       then atomically claims the invitation and creates an active view_only link. No request body.
 *       Swagger/browser fetch may follow the 303 automatically.
 *     responses:
 *       '201':
 *         description: Relationship with public patient/caregiver identities and caller perspective.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *                 - relationship
 *               properties:
 *                 relationship:
 *                   $ref: '#/components/schemas/CaregiverPatientLink'
 *               additionalProperties: false
 *       '303':
 *         description: >-
 *           Sign up if the invitee email has no account; otherwise sign in. Default CLIENT_ORIGIN is
 *           http://localhost:5173.
 *         headers:
 *           Location:
 *             schema:
 *               type: string
 *               format: uri
 *             description: CLIENT_ORIGIN/signup?inviteToken=<token> or CLIENT_ORIGIN/login?inviteToken=<token>
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *             example: See Other. Redirecting to http://localhost:5173/login?inviteToken=<token>
 *           text/html:
 *             schema:
 *               type: string
 *       '400':
 *         description: You cannot invite yourself. / Invalid JSON.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: You cannot invite yourself.
 *               invalidJson:
 *                 value:
 *                   error: Invalid JSON.
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         description: Sign in with the verified email this invitation was sent to.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Sign in with the verified email this invitation was sent to.
 *       '404':
 *         description: Invitation not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Invitation not found.
 *       '409':
 *         description: >-
 *           Invitation already answered. / Invitation is no longer available. / An account with this email or
 *           Google identity already exists.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Invitation already answered.
 *               error2:
 *                 value:
 *                   error: Invitation is no longer available.
 *               error3:
 *                 value:
 *                   error: An account with this email or Google identity already exists.
 *       '410':
 *         description: Invitation expired.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Invitation expired.
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *       '415':
 *         $ref: '#/components/responses/UnsupportedBodyEncoding'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/:token/accept', async (req, res, next) => {
  if (req.headers.authorization) return next();
  const invitation = await pendingInvitation(req.params.token);
  const invitee = await prisma.user.findUnique({ where: { email: invitation.inviteeEmail }, select: { id: true } });
  const redirect = new URL(invitee ? '/login' : '/signup', process.env.CLIENT_ORIGIN || 'http://localhost:5173');
  redirect.searchParams.set('inviteToken', req.params.token);
  return res.redirect(303, redirect.toString());
}, verifyJWT, async (req, res) => {
  const relationship = await prisma.$transaction(async (tx) => {
    const invitation = await pendingInvitation(req.params.token, tx);
    requireInvitee(invitation, req.user);
    const now = new Date();
    // Claim the invite conditionally inside the transaction. Concurrent accepts
    // serialize on this row; only one can create a link. Any create failure rolls
    // back the accepted state as well.
    const claimed = await tx.invitation.updateMany({
      where: { id: invitation.id, status: 'sent', expiresAt: { gt: now } },
      data: { status: 'accepted', respondedAt: now },
    });
    if (claimed.count !== 1) throw new HttpError(409, 'Invitation is no longer available.');
    // proposedRole always describes the INVITEE, never a permanent User role.
    return tx.caregiverPatientLink.create({ data: {
      patientId: invitation.proposedRole === 'caregiver' ? invitation.inviterUserId : req.user.id,
      caregiverId: invitation.proposedRole === 'caregiver' ? req.user.id : invitation.inviterUserId,
      invitedByUserId: invitation.inviterUserId, relationshipType: invitation.relationshipType,
      permissionLevel: 'view_only', status: 'active', linkedAt: now,
    }, include: relationshipUsers });
  });
  res.status(201).json({ relationship: withPerspective(relationship, req.user.id) });
});

/**
 * @openapi
 * /api/invitations/{token}/decline:
 *   post:
 *     summary: Decline an invitation
 *     tags:
 *       - Invitations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: token
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *           pattern: ^[a-f0-9]{64}$
 *         description: Raw 64-character lowercase hexadecimal token from the email.
 *     description: Requires the invited verified email and a pending, unexpired invitation. No request body.
 *     responses:
 *       '200':
 *         description: Invitation declined.
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
 *                     - Invitation declined.
 *               additionalProperties: false
 *             example:
 *               message: Invitation declined.
 *       '400':
 *         description: You cannot invite yourself. / Invalid JSON.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: You cannot invite yourself.
 *               invalidJson:
 *                 value:
 *                   error: Invalid JSON.
 *       '401':
 *         $ref: '#/components/responses/Unauthorized'
 *       '403':
 *         description: Sign in with the verified email this invitation was sent to.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Sign in with the verified email this invitation was sent to.
 *       '404':
 *         description: Invitation not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Invitation not found.
 *       '409':
 *         description: Invitation already answered. / Invitation is no longer available.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Invitation already answered.
 *               error2:
 *                 value:
 *                   error: Invitation is no longer available.
 *       '410':
 *         description: Invitation expired.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               error1:
 *                 value:
 *                   error: Invitation expired.
 *       '413':
 *         $ref: '#/components/responses/PayloadTooLarge'
 *       '415':
 *         $ref: '#/components/responses/UnsupportedBodyEncoding'
 *       '500':
 *         $ref: '#/components/responses/ServerError'
 */
router.post('/:token/decline', verifyJWT, async (req, res) => {
  const invitation = await pendingInvitation(req.params.token);
  requireInvitee(invitation, req.user);
  const respondedAt = new Date();
  const changed = await prisma.invitation.updateMany({
    where: { id: invitation.id, status: 'sent', expiresAt: { gt: respondedAt } },
    data: { status: 'declined', respondedAt },
  });
  if (changed.count !== 1) throw new HttpError(409, 'Invitation is no longer available.');
  res.json({ message: 'Invitation declined.' });
});

export default router;
