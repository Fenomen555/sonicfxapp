export const initTelegramApp = async () => {
  const tg = window.Telegram?.WebApp;
  if (!tg) {
    throw new Error("Telegram SDK not found");
  }

  tg.ready();
  tg.expand();

  const platform = (tg.platform || "").toLowerCase();
  const isMobile = platform === "android" || platform === "ios";
  const canFullscreen =
    typeof tg.requestFullscreen === "function" &&
    (typeof tg.isVersionAtLeast !== "function" || tg.isVersionAtLeast("8.0"));

  if (isMobile && canFullscreen) {
    try {
      await tg.requestFullscreen();
    } catch (error) {
      console.warn("requestFullscreen failed", error);
    }
  }

  return tg;
};
