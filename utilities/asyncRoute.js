// Express 4 does not forward rejected promises from async handlers to its
// error middleware. This wrapper passes those rejections to next so the
// existing error handler can answer the request.
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { asyncRoute };
