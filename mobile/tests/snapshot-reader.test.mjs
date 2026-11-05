import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotReader } from '../src/snapshot-reader.mjs';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture() {
  const calls = [], snapshots = [], errors = [], loading = [];
  const reader = createSnapshotReader({
    load: id => { const pending = deferred(); calls.push({ id, ...pending }); return pending.promise; },
    onSnapshot: (snapshot, id) => snapshots.push({ snapshot, id }),
    onError: error => errors.push(error),
    onLoading: state => loading.push(state),
  });
  return { reader, calls, snapshots, errors, loading };
}

test('selection changes reject stale snapshots without unlocking export during the newer query', async () => {
  const f = fixture();
  const first = f.reader.read(null);
  const second = f.reader.read('historical');
  f.calls[0].resolve({ id: 'current', events: [] });
  await first;
  assert.deepEqual(f.snapshots, []);
  assert.deepEqual(f.loading, [true, true]);
  f.calls[1].resolve({ id: 'historical', events: [] });
  await second;
  assert.equal(f.snapshots[0].id, 'historical');
  assert.equal(f.snapshots[0].snapshot.id, 'historical');
  assert.deepEqual(f.loading, [true, true, false]);
});

test('returning to current run cannot publish an older historical response or error', async () => {
  const f = fixture();
  const first = f.reader.read('historical');
  const second = f.reader.read(null);
  f.calls[1].resolve({ id: 'current', events: ['running'] });
  await second;
  f.calls[0].reject(new Error('old read failed'));
  await first;
  assert.equal(f.snapshots.length, 1);
  assert.equal(f.snapshots[0].snapshot.id, 'current');
  assert.deepEqual(f.errors, []);
  assert.deepEqual(f.loading, [true, true, false]);
});

test('command invalidation requires a fresh query and discards the pre-command result', async () => {
  const f = fixture();
  const first = f.reader.read(null);
  f.reader.invalidate();
  const second = f.reader.read(null, { force: true });
  f.calls[1].resolve({ events: ['start', 'stop'] });
  await second;
  f.calls[0].resolve({ events: ['start'] });
  await first;
  assert.deepEqual(f.snapshots.map(entry => entry.snapshot.events), [['start', 'stop']]);
});

test('polling the same selection joins its pending request without starving it', async () => {
  const f = fixture();
  const first = f.reader.read(null);
  const second = f.reader.read(null);
  assert.equal(first, second);
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve({ events: [] });
  await second;
  assert.deepEqual(f.loading, [true, false]);
});

test('latest query failures are surfaced and release the loading state', async () => {
  const f = fixture();
  const pending = f.reader.read(null);
  const error = new Error('storage read failed');
  f.calls[0].reject(error);
  await pending;
  assert.deepEqual(f.errors, [error]);
  assert.deepEqual(f.loading, [true, false]);
  assert.deepEqual(f.snapshots, []);
});
