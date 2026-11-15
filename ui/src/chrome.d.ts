interface ChromeRuntimeLike {
  id?: string;
  getURL?: (path: string) => string;
}
interface ChromePermissionsLike {
  request?: (options: { permissions: string[] }) => Promise<boolean>;
}
interface ChromeStorageListener {
  (changes: unknown, areaName: string): void;
}
interface ChromeStorageLike {
  onChanged?: {
    addListener?: (fn: ChromeStorageListener) => void;
    removeListener?: (fn: ChromeStorageListener) => void;
  };
}
interface ChromeLike {
  runtime?: ChromeRuntimeLike;
  permissions?: ChromePermissionsLike;
  storage?: ChromeStorageLike;
}

declare global {
  // eslint-disable-next-line no-var
  var chrome: ChromeLike | undefined;
}

export {};
