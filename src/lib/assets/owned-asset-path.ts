export function isOwnedAssetPath(path: string, ownerId: string | null, parentId: string): boolean {
  return (
    ownerId !== null &&
    path.startsWith(`${ownerId}/${parentId}/`) &&
    path === path.trim() &&
    !/[%?#\\\p{Cc}]/u.test(path) &&
    path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  )
}
