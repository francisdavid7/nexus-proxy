import {
  NodeStatus,
} from "@nexus/database";

import {
  runSerializableTransaction,
} from "@/lib/database/transaction";

import {
  getNodeStaleCutoff,
} from "@/lib/nodes/settings";

export async function reconcileStaleNodes():
  Promise<number> {
  return runSerializableTransaction(
    async (transaction) => {
      const cutoff =
        getNodeStaleCutoff();

      const staleNodes =
        await transaction.proxyNode
          .findMany({
            where: {
              status: {
                in: [
                  NodeStatus.ONLINE,
                  NodeStatus.DEGRADED,
                ],
              },

              OR: [
                {
                  lastHeartbeatAt: null,
                },
                {
                  lastHeartbeatAt: {
                    lt: cutoff,
                  },
                },
              ],
            },

            select: {
              id: true,
              name: true,
              status: true,
              lastHeartbeatAt: true,
            },
          });

      if (staleNodes.length === 0) {
        return 0;
      }

      await transaction.proxyNode
        .updateMany({
          where: {
            id: {
              in: staleNodes.map(
                (node) => node.id,
              ),
            },
          },

          data: {
            status:
              NodeStatus.OFFLINE,
          },
        });

      await transaction.auditLog
        .createMany({
          data: staleNodes.map(
            (node) => ({
              action:
                "proxy_node.marked_offline",

              resourceType:
                "ProxyNode",

              resourceId:
                node.id,

              metadata: {
                nodeName:
                  node.name,

                previousStatus:
                  node.status,

                lastHeartbeatAt:
                  node.lastHeartbeatAt
                    ?.toISOString() ??
                  null,

                staleCutoff:
                  cutoff.toISOString(),
              },
            }),
          ),
        });

      return staleNodes.length;
    },
  );
}
