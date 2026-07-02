// Decompress a request body when Content-Encoding is gzip.
// Uses the DecompressionStream API — available in Cloudflare Workers,
// modern browsers, and Node.js 18+.

export interface DecompressResult {
  json: string;
  error?: string;
}

export async function readMaybeGzip(request: Request): Promise<DecompressResult> {
  try {
    const rawBody = await request.arrayBuffer();
    const contentEncoding = request.headers.get("content-encoding");

    if (contentEncoding === "gzip") {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(rawBody));
          controller.close();
        },
      });
      const decompressedStream = stream.pipeThrough(new DecompressionStream("gzip"));
      const decompressedBuffer = await new Response(decompressedStream).arrayBuffer();
      return { json: new TextDecoder().decode(decompressedBuffer) };
    }

    return { json: new TextDecoder().decode(rawBody) };
  } catch {
    return { json: "", error: "Failed to decompress request body" };
  }
}
