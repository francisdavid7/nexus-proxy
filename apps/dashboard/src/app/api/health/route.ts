import { prisma } from "@nexus/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return Response.json({
      service: "nexus-control-plane",
      database: "connected",
      status: "healthy",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error(
      "Control-plane health check failed:",
      error,
    );

    return Response.json(
      {
        service: "nexus-control-plane",
        database: "unavailable",
        status: "unhealthy",
        timestamp: new Date().toISOString(),
      },
      {
        status: 503,
      },
    );
  }
}
