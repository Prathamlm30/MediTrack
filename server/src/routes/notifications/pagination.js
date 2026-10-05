import { HttpError } from '../../services/authErrors.js';

export function positiveId(value, name = 'id') {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new HttpError(400, `Invalid ${name}.`);
  }
  return Number(value);
}

export function pagination(query) {
  const limit = query.limit === undefined ? 20 : Math.min(positiveId(query.limit, 'limit'), 100);
  const cursor = query.cursor === undefined ? undefined : positiveId(query.cursor, 'cursor');
  return { limit, cursor };
}
