// Test transport: each request owns a fresh worker, even when requests overlap.
export async function runWorkerRequests(workerPath, requests, {
  concurrency = 2, timeout = 10000, WorkerClass = globalThis.Worker,
} = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new RangeError('Browser concurrency must be an integer from 1 to 8.');
  }
  if (!Number.isFinite(timeout) || timeout <= 0) throw new RangeError('Invalid worker timeout.');
  const results = new Array(requests.length);
  const active = new Set();
  let next = 0, failed = false;
  const run = request => new Promise((resolve, reject) => {
    let worker, timer;
    const cleanup = () => {
      clearTimeout(timer);
      active.delete(cleanup);
      if (worker) {
        worker.onmessage = worker.onerror = worker.onmessageerror = null;
        worker.terminate();
      }
    };
    const fail = error => {
      failed = true;
      cleanup();
      for (const close of active) close();
      reject(new Error(`Conformance worker ${request.id}: ${error.message}`, {cause: error}));
    };
    try {
      worker = new WorkerClass(workerPath, {type: 'module'});
      active.add(cleanup);
      timer = setTimeout(() => fail(new Error(`timed out after ${timeout}ms`)), timeout);
      worker.onmessage = event => {
        cleanup();
        resolve({...event.data, id: request.id});
      };
      worker.onerror = event => fail(new Error(event.message));
      worker.onmessageerror = () => fail(new Error('could not deserialize response'));
      worker.postMessage(request);
    } catch (error) {
      fail(error);
    }
  });
  await Promise.all(Array.from({length: Math.min(concurrency, requests.length)}, async () => {
    while (!failed && next < requests.length) {
      const index = next++;
      results[index] = await run(requests[index]);
    }
  }));
  return results;
}
