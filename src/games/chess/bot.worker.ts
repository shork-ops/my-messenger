/**
 * The worker entry point.
 *
 * Vite needs a real module to hand to `new Worker(new URL(...), { type: "module" })`, so this file
 * exists only to call the installer in the worker's own global scope. The logic lives in
 * `worker.ts`, where it can be imported and tested without a worker.
 */

import { installBotWorker, type WorkerRequest, type WorkerResponse } from "./worker";

// `self` is the worker global. It is cast rather than typed through the DOM or webworker library,
// so this project keeps one TypeScript configuration for app, worker and tests.
installBotWorker(
  self as unknown as {
    onmessage: ((event: { data: WorkerRequest }) => void) | null;
    postMessage: (message: WorkerResponse) => void;
  }
);
