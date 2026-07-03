async function streamToBuffer(stream) {
  if (Buffer.isBuffer(stream)) {
    return stream;
  }
  if (stream instanceof Uint8Array) {
    return Buffer.from(stream);
  }
  if (stream instanceof ArrayBuffer) {
    return Buffer.from(stream);
  }
  if (typeof stream === 'string') {
    return Buffer.from(stream);
  }

  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

module.exports = {
  streamToBuffer,
};
