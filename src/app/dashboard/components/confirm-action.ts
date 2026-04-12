export async function runConfirmedAction<T>(
  pendingValue: T | null,
  action: (value: T) => Promise<void> | void,
): Promise<boolean> {
  if (pendingValue === null) {
    return false
  }

  await action(pendingValue)
  return true
}
