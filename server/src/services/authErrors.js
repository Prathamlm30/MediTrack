export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export function requireActive(user) {
  if (!user || !user.isActive) throw new HttpError(401, 'Account unavailable.');
  return user;
}
