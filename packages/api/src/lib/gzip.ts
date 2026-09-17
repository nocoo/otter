// Decompress a request body when Content-Encoding is gzip.
// Uses the DecompressionStream API — available in Cloudflare Workers,
// modern browsers, and Node.js 18+.

export interface DecompressResult {
  json: string;
  error?: string;
}

export async function readMaybeGzip(request: Request): Promise<DecompressResult> {
  try {
    const rawBody = await readBounded(request.body);
    const contentEncoding = request.headers.get("content-encoding");

    if (contentEncoding === "gzip") {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(rawBody));
          controller.close();
        },
      });
      const decompressedStream = stream.pipeThrough(new DecompressionStream("gzip"));
      const decompressedBuffer = await readBounded(decompressedStream);
      return { json: new TextDecoder().decode(decompressedBuffer) };
    }

    return { json: new TextDecoder().decode(rawBody) };
  } catch (error) {
    return {
      json: "",
      error: error instanceof RangeError ? error.message : "Failed to decompress request body",
    };
  }
}

async function readBounded(
  stream: ReadableStream<Uint8Array> | null,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      // biome-ignore lint/performance/noAwaitInLoops: bounded streaming decompression prevents zip bombs
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 64 * 1024 * 1024) {
        await reader.cancel();
        throw new RangeError("Snapshot exceeds 64 MiB decompressed limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
