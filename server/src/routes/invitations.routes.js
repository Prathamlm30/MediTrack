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

router.get('/:token', async (req, res) => {
  const invitation = await pendingInvitation(req.params.token);
  res.json({ invitation: {
    relationshipType: invitation.relationshipType, proposedRole: invitation.proposedRole,
    inviter: invitation.inviter, expiresAt: invitation.expiresAt, status: invitation.status,
  } });
});

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
