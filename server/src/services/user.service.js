import prisma from '../prismaClient.js';
export const defaultPreferences = { preferredNotificationChannel: 'email' };
export function publicUser(user) {
  const { passwordHash, ...safe } = user;
  return { ...safe, hasPassword: Boolean(passwordHash) };
}
export const getUser = (id) => prisma.user.findUnique({ where: { id }, include: { preferences: true } });
