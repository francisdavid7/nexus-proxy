import {
  getCurrentUser,
} from "@/lib/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const user = await getCurrentUser();

  if (!user) {
    return Response.json(
      {
        message:
          "Authentication is required.",
      },
      {
        status: 401,
      },
    );
  }

  return Response.json(
    {
      user,
    },
    {
      status: 200,
    },
  );
}
