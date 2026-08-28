export interface PackageInstallRequest {
  cwd: string;
  frozenLockfile: boolean;
  allowScripts: boolean;
  signal?: AbortSignal;
}

export interface PackageManager {
  install(request: PackageInstallRequest): Promise<void>;
}
