import bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import prisma from '../prismaClient.js';
import { requiredEnv } from '../config/env.js';
import { HttpError, requireActive } from './authErrors.js';
import { defaultPreferences, publicUser } from './user.service.js';
import { issueTokens, createActionToken, consumeActionToken, revokeSession, verify } from './token.service.js';
import { sendActionEmail } from './mail.service.js';

const google = new OAuth2Client();
const googleOnly = (user) => user.authProvider === 'google' && user.passwordHash === null;
async function session(user) {
  requireActive(user);
  const updated = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() }, include: { preferences: true } });
  return { user: publicUser(updated), ...await issueTokens(user.id) };
}
export async function register(data) {
  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = await prisma.user.create({ data: { fullName: data.fullName, email: data.email,
    phoneNumber: data.phoneNumber, passwordHash, authProvider: 'local', preferences: { create: defaultPreferences } }, include: { preferences: true } });
  await sendActionEmail(user, 'verify', await createActionToken('verify', user.id, 86400));
  return { user: publicUser(user), message: 'Account created. Check your email to verify it.' };
}
export async function login(email, password) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (user && googleOnly(user)) throw new HttpError(400, 'This account uses Google Sign-In. Sign in with Google.');
  if (!user || !user.passwordHash || !await bcrypt.compare(password, user.passwordHash)) throw new HttpError(401, 'Invalid email or password.');
  requireActive(user);
  if (!user.emailVerified) throw new HttpError(403, 'Verify your email before signing in.');
  return session(user);
}
// Serializable resolution and unique constraints prevent concurrent requests from duplicating/linking over accounts.
export async function resolveGoogleAccount(payload) {
  const { sub, email, name, picture, email_verified } = payload;
  if (!sub || typeof email !== 'string' || email_verified !== true) throw new HttpError(401, 'Google must provide a verified email.');
  const normalizedEmail = email.trim().toLowerCase();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const byGoogle = await tx.user.findUnique({ where: { googleId: sub } });
        if (byGoogle) return requireActive(byGoogle); // (a)
        const byEmail = await tx.user.findUnique({ where: { email: normalizedEmail } });
        if (byEmail) {
          requireActive(byEmail);
          if (byEmail.authProvider !== 'local' || (byEmail.googleId && byEmail.googleId !== sub)) throw new HttpError(409, 'Email is already associated with another Google account.');
          return tx.user.update({ where: { id: byEmail.id }, data: { googleId: sub, emailVerified: true } }); // (b): retain local password/provider
        }
        return tx.user.create({ data: { fullName: name || normalizedEmail, email: normalizedEmail,
          googleId: sub, authProvider: 'google', emailVerified: true, passwordHash: null,
          profilePictureUrl: picture || null, preferences: { create: defaultPreferences } } }); // (c)
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (!['P2034', 'P2002'].includes(error.code) || attempt === 2) throw error;
    }
  }
}
export async function googleLogin(idToken) {
  const audience = requiredEnv('GOOGLE_CLIENT_ID');
  let payload;
  try { payload = (await google.verifyIdToken({ idToken, audience })).getPayload(); }
  catch { throw new HttpError(401, 'Invalid or expired Google ID token.'); }
  return session(await resolveGoogleAccount(payload));
}
export async function refresh(token) {
  const claims = verify(token, 'refresh');
  requireActive(await prisma.user.findUnique({ where: { id: Number(claims.sub) } }));
  return issueTokens(Number(claims.sub), token);
}
export async function forgotPassword(email) {
  const user = await prisma.user.findUnique({ where: { email } });
  // Same response for absent and Google-only users; neither receives a reset token or email.
  if (user?.isActive && !googleOnly(user) && user.passwordHash) {
    await sendActionEmail(user, 'reset', await createActionToken('reset', user.id, 900));
  }
  return { message: 'If this email has an eligible password account, a reset link has been sent.' };
}
export async function resetPassword(token, newPassword) {
  const passwordHash = await bcrypt.hash(newPassword, 12);
  const id = await consumeActionToken('reset', token);
  const user = requireActive(await prisma.user.findUnique({ where: { id } }));
  if (googleOnly(user)) throw new HttpError(400, 'This account uses Google Sign-In.');
  await prisma.user.update({ where: { id }, data: { passwordHash } });
  await revokeSession(id);
  return { message: 'Password reset. Sign in with your new password.' };
}
export async function verifyEmail(token) {
  const id = await consumeActionToken('verify', token);
  requireActive(await prisma.user.findUnique({ where: { id } }));
  await prisma.user.update({ where: { id }, data: { emailVerified: true } });
  return { message: 'Email verified. You can now sign in.' };
}
