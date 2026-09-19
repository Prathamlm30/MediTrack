import * as auth from '../services/auth.service.js';
import * as validate from '../middleware/validation.js';
import { revokeSession } from '../services/token.service.js';

export async function register(req, res) {
  const data = validate.body(req);
  res.status(201).json(await auth.register({ fullName: validate.text(data.fullName, 'fullName'),
    email: validate.email(data.email), password: validate.password(data.password),
    phoneNumber: data.phoneNumber == null ? null : validate.text(data.phoneNumber, 'phoneNumber', 40) }));
}
export async function login(req, res) {
  const data = validate.body(req);
  res.json(await auth.login(validate.email(data.email), validate.password(data.password)));
}
export async function google(req, res) {
  res.json(await auth.googleLogin(validate.text(validate.body(req).idToken, 'idToken', 10000)));
}
export async function refresh(req, res) {
  res.json(await auth.refresh(validate.text(validate.body(req).refreshToken, 'refreshToken', 4096)));
}
export async function logout(req, res) { await revokeSession(req.user.id); res.json({ message: 'Logged out.' }); }
export async function forgotPassword(req, res) { res.json(await auth.forgotPassword(validate.email(validate.body(req).email))); }
export async function resetPassword(req, res) {
  const data = validate.body(req);
  res.json(await auth.resetPassword(validate.text(data.token, 'token', 64), validate.password(data.newPassword)));
}
export async function verifyEmail(req, res) { res.json(await auth.verifyEmail(req.params.token)); }
