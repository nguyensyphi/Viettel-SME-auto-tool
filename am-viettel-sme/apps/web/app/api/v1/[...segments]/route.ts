import { handleApiRequest } from "../../../../src/server/http-api";
import { getApiServices } from "../../../../src/server/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ segments: string[] }> };

async function dispatch(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { segments } = await context.params;
  return handleApiRequest(
    request,
    ["api", "v1", ...segments],
    getApiServices(),
  );
}

export const GET = dispatch;
export const POST = dispatch;
export const PUT = dispatch;
export const PATCH = dispatch;
export const DELETE = dispatch;
