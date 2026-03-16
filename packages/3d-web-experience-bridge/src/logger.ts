const debugEnabled = !!process.env.DEBUG;

export function debug(...args: any[]): void {
  if (debugEnabled) {
    console.log(...args);
  }
}

export function warn(...args: any[]): void {
  console.warn(...args);
}
