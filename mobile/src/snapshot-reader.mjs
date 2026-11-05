// Native queries can resolve after a selection change or a recorder command.
// Only the newest request may publish data, errors or its loading state.
export function createSnapshotReader({ load, onSnapshot, onError, onLoading }) {
  let revision = 0, active = null;
  return {
    read(id, { force = false } = {}) {
      if (active?.id === id && !force) return active.promise;
      const request = { id, revision: ++revision, promise: null };
      active = request;
      onLoading(true);
      request.promise = (async () => {
        try {
          const snapshot = await load(id);
          if (request.revision === revision) onSnapshot(snapshot, id);
        } catch (error) {
          if (request.revision === revision) onError(error);
        } finally {
          if (request.revision === revision) { active = null; onLoading(false); }
        }
      })();
      return request.promise;
    },
    invalidate() {
      revision++;
      active = null;
      onLoading(false);
    },
  };
}
