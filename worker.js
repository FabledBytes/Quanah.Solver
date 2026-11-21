/* Runs the solver off the main thread so big inventories don't freeze the page. */
importScripts('solver.js');

self.onmessage = (e) => {
  const { id, fn, args } = e.data || {};
  try {
    if (!['solve', 'checkAll'].includes(fn)) throw new Error(`Unknown task ${fn}`);
    self.postMessage({ id, result: self.QuanahSolver[fn](...args) });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
