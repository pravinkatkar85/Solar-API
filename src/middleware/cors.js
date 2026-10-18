const flutterWebOrigins = new Set([
  'http://localhost:8090',
  'http://127.0.0.1:8090',
]);

export const flutterWebOrigin = 'http://localhost:8090';

const allowedMethods = 'GET, POST, OPTIONS';
const allowedHeaders = 'Accept, Content-Type, Authorization';

export function localFlutterWebCors(req, res, next) {
  const origin = req.get('origin');
  if (origin && flutterWebOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', allowedMethods);
    res.setHeader('Access-Control-Allow-Headers', allowedHeaders);
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
  }

  next();
}
