import assert from 'node:assert/strict';
import test from 'node:test';
import {runWorkerRequests} from './browser-pool.mjs';

function workers() {
  const instances = [];
  let live = 0, peak = 0;
  class FakeWorker {
    constructor(path, options) {
      assert.equal(path, '/fixture.mjs');
      assert.deepEqual(options, {type: 'module'});
      instances.push(this);
      peak = Math.max(peak, ++live);
    }
    postMessage(request) {
      this.request = request;
      if (request.throw) throw new Error('post failed');
      if (request.hang) return;
      this.timer = setTimeout(() => {
        if (request.error) this.onerror?.({message: 'worker failed'});
        else if (request.messageerror) this.onmessageerror?.();
        else this.onmessage?.({data: {ok: true, value: request.id}});
      }, request.delay ?? 1);
    }
    terminate() {
      assert.equal(this.closed, undefined, 'worker terminated once');
      this.closed = true;
      clearTimeout(this.timer);
      live--;
    }
  }
  return {WorkerClass: FakeWorker, instances, live: () => live, peak: () => peak};
}

test('bounded fresh workers preserve input order despite out-of-order completion', async () => {
  for (const concurrency of [1, 2, 4, 8]) {
    const fixture = workers();
    const requests = Array.from({length: 12}, (_, id) => ({id, delay: id === 0 ? 20 : 1}));
    const results = await runWorkerRequests('/fixture.mjs', requests, {...fixture, concurrency});
    assert.deepEqual(results, requests.map(({id}) => ({id, ok: true, value: id})));
    assert.equal(fixture.instances.length, requests.length);
    assert.equal(fixture.peak(), concurrency);
    assert.equal(fixture.live(), 0);
  }
});

test('errors, serialization failures and per-case deadlines close all workers and stop scheduling', async () => {
  for (const failure of [{error: true}, {messageerror: true}, {throw: true}, {hang: true}]) {
    const fixture = workers();
    const requests = [{id: 'blocked', hang: true}, {id: 'fails', ...failure}, {id: 'never'}];
    await assert.rejects(runWorkerRequests('/fixture.mjs', requests,
      {...fixture, concurrency: 2, timeout: 25}), /Conformance worker (fails|blocked):/);
    assert.equal(fixture.live(), 0);
    assert.equal(fixture.instances.length, 2);
  }
});

test('worker construction failure is reported and invalid bounds are rejected', async () => {
  await assert.rejects(runWorkerRequests('/fixture.mjs', [{id: 'one'}], {
    WorkerClass: class {constructor() {throw new Error('construction failed');}},
  }), /one: construction failed/);
  for (const concurrency of [0, 9, 1.5, NaN]) {
    await assert.rejects(runWorkerRequests('', [], {concurrency}), RangeError);
  }
  for (const timeout of [0, -1, Infinity]) {
    await assert.rejects(runWorkerRequests('', [], {timeout}), RangeError);
  }
  assert.deepEqual(await runWorkerRequests('', []), []);
});
