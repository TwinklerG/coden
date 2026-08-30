export function versionMismatch(tag: string, version: string): string | null {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
    return `tag "${tag}" is not a valid semver tag (expected vX.Y.Z)`;
  }
  if (tag !== `v${version}`) {
    return `tag "${tag}" does not match package.json version "${version}"`;
  }
  return null;
}
