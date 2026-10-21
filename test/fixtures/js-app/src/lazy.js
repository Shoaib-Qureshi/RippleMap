export async function load() {
  const m = await import('./lib/index');
  return m;
}
