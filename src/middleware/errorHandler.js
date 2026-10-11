export function notFoundHandler(_req, res) {
  res.status(404).json({
    status: 'ERROR',
    code: 404,
    message: 'Resource was not found',
    data: null,
  });
}

export function errorHandler(error, _req, res, _next) {
  if (error?.type === 'entity.too.large') {
    res.status(413).json({
      status: 'ERROR',
      code: 413,
      message: 'Request body is too large',
      data: null,
    });
    return;
  }

  if (error?.type === 'entity.parse.failed' || (error instanceof SyntaxError && error.status === 400)) {
    res.status(400).json({
      status: 'ERROR',
      code: 400,
      message: 'Request body must be valid JSON',
      data: null,
    });
    return;
  }

  console.error('Unhandled API error', { code: error?.code ?? 'UNKNOWN' });
  res.status(500).json({
    status: 'ERROR',
    code: 500,
    message: 'Request could not be completed',
    data: null,
  });
}
