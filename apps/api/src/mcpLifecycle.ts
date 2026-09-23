import type { Server } from "node:http";
import type { McpManager } from "@agenter/mcp";

type SignalSource = {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
};

export function registerMcpShutdownHandlers(
  server: Pick<Server, "close">,
  manager: Pick<McpManager, "stop">,
  signals: SignalSource = process
): () => Promise<void> {
  let shutdownPromise: Promise<void> | undefined;

  const shutdown = (): Promise<void> => {
    shutdownPromise ??= (async () => {
      const results = await Promise.allSettled([
        new Promise<void>((resolve, reject) => {
          try {
            server.close((error) => error ? reject(error) : resolve());
          } catch (error) {
            reject(error);
          }
        }),
        new Promise<void>((resolve, reject) => {
          try {
            Promise.resolve(manager.stop()).then(resolve, reject);
          } catch (error) {
            reject(error);
          }
        }),
      ]);
      const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
      if (errors.length > 0) throw new AggregateError(errors, "Failed to shut down API resources.");
    })();
    return shutdownPromise;
  };

  const handleSignal = (): void => {
    void shutdown().catch(() => undefined);
  };
  signals.once("SIGINT", handleSignal);
  signals.once("SIGTERM", handleSignal);

  return shutdown;
}
