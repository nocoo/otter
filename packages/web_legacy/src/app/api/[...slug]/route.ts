import { createApp } from "@otter/api";

const app = createApp();
const API_PREFIX = /^\/api\//;

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = new URL(url.toString());
  target.pathname = url.pathname.replace(API_PREFIX, "/v1/");

  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.blob();
  }

  return app.fetch(new Request(target.toString(), init));
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
