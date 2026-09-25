export function buzz(): void {
  try {
    navigator.vibrate?.(12);
  } catch {
    // Vibration is a nicety; some browsers throw outside a user gesture.
  }
}
