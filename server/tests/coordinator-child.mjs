import { startLocalCoordinator } from "../ai/coordinator.js";

try {
  const server = await startLocalCoordinator({
    port: Number(process.argv[2]),
    queueOptions: { marker: process.argv[3] }
  });
  console.log("READY " + server.address().port);
  process.on("SIGTERM", () => server.close(() => process.exit(0)));
} catch (error) {
  console.error(error.code || error.message);
  process.exitCode = 1;
}
