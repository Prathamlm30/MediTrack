import express from 'express';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { requiredEnv } from '../../config/env.js';
import { HttpError } from '../../services/authErrors.js';

const directory = fileURLToPath(new URL('../../../uploads/prescriptions/', import.meta.url));
const prefix = '/uploads/prescriptions/';
const filenamePattern = /^[a-f0-9-]{36}\.(jpg|png)$/;
const signature = (name, expires) => createHmac('sha256', requiredEnv('JWT_ACCESS_SECRET'))
  .update(`prescription-image:${name}:${expires}`).digest('hex');

// Storage adapter: routes depend only on save/remove/readUrl. Replace this
// implementation with a private S3/Blob adapter without changing the API/schema.
export const storage = {
  async save(bytes, extension) {
    const name = `${randomUUID()}.${extension}`;
    await mkdir(directory, { recursive: true });
    await writeFile(`${directory}/${name}`, bytes, { flag: 'wx' });
    return `${prefix}${name}`;
  },
  async remove(imageUrl) {
    const name = imageUrl.slice(prefix.length);
    if (!imageUrl.startsWith(prefix) || !filenamePattern.test(name)) throw new Error('Invalid image path');
    await unlink(`${directory}/${name}`);
  },
  readUrl(imageUrl) {
    const name = imageUrl.slice(prefix.length);
    if (!imageUrl.startsWith(prefix) || !filenamePattern.test(name)) throw new Error('Invalid image path');
    const expires = String(Math.floor(Date.now() / 1000) + 600);
    const origin = process.env.PRESCRIPTION_IMAGE_ORIGIN || 'http://127.0.0.1:3000';
    const url = new URL(imageUrl, origin);
    url.search = new URLSearchParams({ expires, signature: signature(name, expires) }).toString();
    return url.href;
  },
};

export function installImageStorage(app) {
  app.use(prefix, (req, res, next) => {
    const name = req.path.slice(1);
    const { expires, signature: supplied } = req.query;
    if (!filenamePattern.test(name) || typeof expires !== 'string' || !/^\d{10}$/.test(expires)
      || Number(expires) < Date.now() / 1000 || Number(expires) > Date.now() / 1000 + 601
      || typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)
      || !timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(signature(name, expires), 'hex'))) {
      throw new HttpError(403, 'Image link expired or invalid. Reload the review page.');
    }
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    next();
  }, express.static(directory, { dotfiles: 'deny', index: false, fallthrough: false }));
}
