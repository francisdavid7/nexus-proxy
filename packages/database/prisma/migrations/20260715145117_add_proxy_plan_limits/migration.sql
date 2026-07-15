-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "connections_per_minute" INTEGER NOT NULL DEFAULT 60,
ADD COLUMN     "max_concurrent_connections" INTEGER NOT NULL DEFAULT 3;
