import prisma from '../prismaClient.js';
import { publicUser, defaultPreferences } from '../services/user.service.js';
import * as validate from '../middleware/validation.js';

export function me(req, res) { res.json({ user: req.user }); }
export async function edit(req, res) {
  const user = await prisma.user.update({ where: { id: req.user.id }, data: validate.profile(validate.body(req)), include: { preferences: true } });
  res.json({ user: publicUser(user) });
}
export async function preferences(req, res) {
  const data = validate.preferences(validate.body(req));
  const preferences = await prisma.userPreference.upsert({ where: { userId: req.user.id },
    create: { userId: req.user.id, ...defaultPreferences, ...data }, update: data });
  res.json({ preferences });
}
