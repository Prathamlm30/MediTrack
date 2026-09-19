import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import redis from '../config/redis.js';
import { requiredEnv } from '../config/env.js';
import { HttpError } from './authErrors.js';

const refreshTTL = 7 * 24 * 60 * 60;
export const digest = (value) => createHash('sha256').update(value).digest('hex');
const sessionKey = (id) => `auth:refresh:${id}`;
function sign(userId, kind, expiresIn) {
  return jwt.sign({ kind }, requiredEnv(`JWT_${kind.toUpperCase()}_SECRET`), {
    algorithm: 'HS256', subject: String(userId), jwtid: randomUUID(),
    issuer: 'meditrack', audience: 'meditrack', expiresIn,
  });
}
export function verify(token, kind) {
  const secret = requiredEnv(`JWT_${kind.toUpperCase()}_SECRET`);
  try {
    const claims = jwt.verify(token, secret, { algorithms: ['HS256'], issuer: 'meditrack', audience: 'meditrack' });
    if (claims.kind !== kind || !/^[1-9]\d*$/.test(claims.sub)) throw new Error();
    return claims;
  } catch { throw new HttpError(401, `Invalid or expired ${kind} token.`); }
}
export async function issueTokens(id, previousToken) {
  const tokens = { accessToken: sign(id, 'access', '15m'), refreshToken: sign(id, 'refresh', '7d'), tokenType: 'Bearer', expiresIn: 900 };
  if (previousToken) {
    const changed = await redis.eval(`
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3]); return 1
      end
      return 0`, 1, sessionKey(id), digest(previousToken), digest(tokens.refreshToken), refreshTTL);
    if (!changed) throw new HttpError(401, 'Refresh token revoked or already used.');
  } else await redis.set(sessionKey(id), digest(tokens.refreshToken), 'EX', refreshTTL);
  return tokens;
}
export const revokeSession = (id) => redis.del(sessionKey(id));
export async function createActionToken(kind, id, ttl) {
  const token = randomBytes(32).toString('hex');
  await redis.set(`auth:${kind}:${digest(token)}`, String(id), 'EX', ttl);
  return token;
}
export async function consumeActionToken(kind, token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new HttpError(400, 'Invalid or expired token.');
  const id = await redis.getdel(`auth:${kind}:${digest(token)}`);
  if (!id) throw new HttpError(400, 'Invalid or expired token.');
  return Number(id);
}
