-- CreateEnum
CREATE TYPE "NodeAgentKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');

-- CreateTable
CREATE TABLE "node_agent_keys" (
    "id" UUID NOT NULL,
    "node_id" UUID NOT NULL,
    "key_id" VARCHAR(80) NOT NULL,
    "public_key_pem" TEXT NOT NULL,
    "status" "NodeAgentKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_used_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "node_agent_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "node_agent_keys_key_id_key" ON "node_agent_keys"("key_id");

-- CreateIndex
CREATE INDEX "node_agent_keys_node_id_status_idx" ON "node_agent_keys"("node_id", "status");

-- AddForeignKey
ALTER TABLE "node_agent_keys" ADD CONSTRAINT "node_agent_keys_node_id_fkey" FOREIGN KEY ("node_id") REFERENCES "proxy_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
