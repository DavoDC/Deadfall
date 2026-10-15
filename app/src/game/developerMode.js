// Client side of DF-144: the developer flag comes from the dev server
// (GET /api/config, which reads config/launcher.json). Anything other than a
// real true, including a failed request, means developer mode is off.

export function parseDeveloperMode(json) {
  return !!json && json.developerMode === true;
}

export async function loadDeveloperMode(fetchFn) {
  try {
    const res = await fetchFn('/api/config', { cache: 'no-store' });
    if (!res.ok) return false;
    return parseDeveloperMode(await res.json());
  } catch {
    return false;
  }
}
