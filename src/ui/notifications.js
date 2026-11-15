export function requestDesktopPermission() {
  const perms = globalThis.chrome?.permissions;
  if (!perms || typeof perms.request !== 'function') return Promise.resolve(false);
  let req;
  try {
    req = perms.request({ permissions: ['notifications'] });
  } catch {
    return Promise.resolve(false);
  }
  return Promise.resolve(req).then((granted) => granted === true).catch(() => false);
}
