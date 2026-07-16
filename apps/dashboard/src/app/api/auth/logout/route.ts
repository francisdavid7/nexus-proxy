import {
  revokeCurrentSession,
} from "@/lib/auth/session";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  await revokeCurrentSession();

  return new Response(null, {
    status: 204,
  });
}
