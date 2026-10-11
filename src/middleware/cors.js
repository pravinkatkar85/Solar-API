export const flutterWebOrigin = 'http://localhost:8090';

const allowedMethods = 'POST, OPTIONS';
const allowedHeaders = 'Content-Type';

export function localFlutterWebCors(req, res, next) {
  if (req.get('origin') === flutterWebOrigin) {
    res.setHeader('Access-Control-Allow-Origin', flutterWebOrigin);
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
