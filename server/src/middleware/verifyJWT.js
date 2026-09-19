import { verify } from '../services/token.service.js';
import { getUser, publicUser } from '../services/user.service.js';
import { HttpError, requireActive } from '../services/authErrors.js';

export default async function verifyJWT(req, res, next) {
  const match = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
  if (!match) throw new HttpError(401, 'Bearer access token required.');
  const claims = verify(match[1], 'access');
  req.user = publicUser(requireActive(await getUser(Number(claims.sub))));
  next();
}
