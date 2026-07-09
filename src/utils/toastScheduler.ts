export function createToastId(): number {
  return Date.now() + Math.floor(Math.random() * 1000);
}

export function scheduleToastRemoval(remove: () => void, delayMs = 3000): void {
  setTimeout(remove, delayMs);
}
