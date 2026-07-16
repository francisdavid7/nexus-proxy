import {
  Prisma,
  prisma,
} from "@nexus/database";

const MAX_TRANSACTION_ATTEMPTS = 4;

function isWriteConflict(
  error: unknown,
): boolean {
  return (
    error instanceof
      Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function delay(
  milliseconds: number,
): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export async function runSerializableTransaction<T>(
  operation: (
    transaction: Prisma.TransactionClient,
  ) => Promise<T>,
): Promise<T> {
  for (
    let attempt = 1;
    attempt <= MAX_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await prisma.$transaction(
        operation,
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel
              .Serializable,

          maxWait: 5_000,
          timeout: 15_000,
        },
      );
    } catch (error) {
      if (
        !isWriteConflict(error) ||
        attempt === MAX_TRANSACTION_ATTEMPTS
      ) {
        throw error;
      }

      await delay(attempt * 50);
    }
  }

  throw new Error(
    "Transaction retry limit reached.",
  );
}
