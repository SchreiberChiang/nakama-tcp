import net from "node:net";
// Keep aligned with server/dev.yml and dev-server.mjs. No automatic port fallback.
export const DEV_PORTS = [54329, 7348, 7349, 7350, 7351];
export async function assertPortsFree(ports = DEV_PORTS) {
  for (const port of ports) {
    await new Promise((resolve, reject) => {
      const probe = net.createServer((socket) => socket.destroy());
      probe.once("error", (error) =>
        reject(
          new Error(
            `Refusing startup: local port 127.0.0.1:${port} is unavailable (${error.code}). ` +
              "Another listener, outbound connection, or OS reservation may own it. " +
              "No existing process will be reused or stopped. Close your previous local test if still running, then retry.",
          ),
        ),
      );
      probe.listen({ host: "127.0.0.1", port, exclusive: true }, () =>
        probe.close(resolve),
      );
    });
  }
}

// Call only after IPC readiness from the child we spawned. Gateway startup may
// transiently return503; ownership must remain valid for every attempted read.
export async function waitForOwnedHealth({
  isAlive,
  url = "http://127.0.0.1:7350/healthcheck",
  timeoutMs = 15000,
  intervalMs = 100,
  fetcher = fetch,
}) {
  const deadline = Date.now() + timeoutMs;
  let last = "no response";
  while (Date.now() < deadline) {
    if (!isAlive())
      throw Error("Owned server exited during health verification");
    try {
      const response = await fetcher(url, {
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(1500, deadline - Date.now())),
        ),
      });
      if (!isAlive())
        throw Error("Owned server exited during health verification");
      if (response.ok) return;
      last = "HTTP " + response.status;
    } catch (error) {
      if (!isAlive())
        throw Error("Owned server exited during health verification");
      last = error.message || String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw Error("Owned server health timeout: " + last);
}
