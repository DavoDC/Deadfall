// Dev-only startup profile (DF: startup freeze). A tiny mark list: each mark
// is a label plus performance.now() (ms since navigation start, so the first
// segment includes download and module evaluation of everything main.js
// imports). report() turns the marks into per-step durations. It is only
// printed on the Vite dev server or with ?bootprofile in the URL, so players
// pay for nothing but a handful of array pushes.

export function createBootTimer(now = () => performance.now()) {
  const marks = [];
  return {
    mark(label) {
      marks.push({ label, t: now() });
    },
    // [{ label, at, ms }]: `at` is the absolute time, `ms` the time since the previous mark
    report() {
      return marks.map((m, i) => ({
        label: m.label,
        at: Math.round(m.t),
        ms: Math.round(i === 0 ? m.t : m.t - marks[i - 1].t),
      }));
    },
  };
}

export function bootProfileEnabled(search = '', dev = false) {
  return dev === true || /(^|[?&])bootprofile(=|&|$)/.test(search);
}
