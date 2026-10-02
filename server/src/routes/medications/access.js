import prisma from '../../prismaClient.js';
import { HttpError } from '../../services/authErrors.js';

export function id(value, name = 'id') {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new HttpError(400, `Invalid ${name}.`);
  return Number(value);
}
export function patientScope(req, res, next) {
  req.patientId = req.method === 'POST' ? req.body?.patientId ?? req.user.id : req.query.patientId ?? req.user.id;
  next();
}
export const canEdit = (req) => req.patientId === req.user.id || req.caregiverPatientLink?.permissionLevel === 'full_access';
export const loadResource = (model) => async (req, res, next) => {
  req.record = await prisma[model].findUnique({ where: { id: id(req.params.id) } });
  if (!req.record) throw new HttpError(404, `${model} not found.`);
  req.patientId = req.record.patientId;
  next();
};
export function bodyFields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'A JSON object is required.');
  const unexpected = Object.keys(body).filter((key) => !allowed.includes(key));
  if (unexpected.length) throw new HttpError(400, `Fields cannot be set: ${unexpected.join(', ')}.`);
  return body;
}
