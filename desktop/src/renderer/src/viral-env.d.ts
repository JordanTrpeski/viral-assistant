export {};

declare global {
  interface Window {
    viralDaemon?: { httpBase: string; wsBase: string };
  }
}
