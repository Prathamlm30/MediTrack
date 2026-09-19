export default function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  if (error.code === 'P2002') return res.status(409).json({ error: 'An account with this email or Google identity already exists.' });
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  const status = error.status || 500;
  if (status >= 500) console.error('Request failed:', error.code || error.name);
  res.status(status).json({ error: status >= 500 ? 'Unable to complete request. Please try again.' : error.message });
}
