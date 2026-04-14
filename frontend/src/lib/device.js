const DESKTOP_PLATFORMS = new Set(["macos", "tdesktop", "web", "weba", "webk", "webz"]);
const MOBILE_PLATFORMS = new Set(["android", "ios"]);

function getTelegramPerformanceClass() {
  const ua = navigator.userAgent || "";
  const match = ua.match(/Telegram-Android\/[^\s]+\s+\([^)]*;\s*(LOW|AVERAGE|HIGH)\)/i);
  return match?.[1]?.toUpperCase() || "";
}

export function getDeviceProfile() {
  const tg = window.Telegram?.WebApp;
  const platform = (tg?.platform || "").toLowerCase();
  const width = Math.max(window.innerWidth || 0, document.documentElement?.clientWidth || 0);
  const stableHeight = Math.round(tg?.viewportStableHeight || tg?.viewportHeight || window.innerHeight || 0);
  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
  const performanceClass = getTelegramPerformanceClass();

  const desktopByPlatform = DESKTOP_PLATFORMS.has(platform);
  const mobileByPlatform = MOBILE_PLATFORMS.has(platform);
  const widthSuggestsDesktop = width >= 900;
  const isDesktop = desktopByPlatform || (!mobileByPlatform && widthSuggestsDesktop && !coarsePointer);
  const isPhone = !isDesktop && width <= 560;
  const isCompactPhone = isPhone && width <= 390;
  const useLiteAnimations = prefersReducedMotion || performanceClass === "LOW";

  return {
    platform,
    width,
    stableHeight,
    isDesktop,
    isPhone,
    isCompactPhone,
    isMobilePlatform: mobileByPlatform,
    performanceClass,
    prefersReducedMotion,
    useLiteAnimations
  };
}
