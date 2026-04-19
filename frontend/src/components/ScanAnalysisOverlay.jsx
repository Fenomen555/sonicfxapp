import { useEffect, useRef, useState } from "react";
import { getDeviceProfile } from "../lib/device";

export default function ScanAnalysisOverlay({ isActive, label = "Scanning chart" }) {
  const containerRef = useRef(null);
  const animationRef = useRef(null);
  const [isFallback, setIsFallback] = useState(() => getDeviceProfile().useLiteAnimations);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!isActive) {
      animationRef.current?.destroy?.();
      animationRef.current = null;
      setIsReady(false);
      return undefined;
    }

    if (getDeviceProfile().useLiteAnimations) {
      setIsFallback(true);
      setIsReady(false);
      return undefined;
    }

    let cancelled = false;
    let fallbackTimeoutId = 0;

    const mountAnimation = () => {
      if (cancelled) return;
      const lottie = window.lottie;
      if (!lottie || !containerRef.current) {
        window.setTimeout(mountAnimation, 120);
        return;
      }

      setIsFallback(false);
      animationRef.current = lottie.loadAnimation({
        container: containerRef.current,
        renderer: "svg",
        loop: true,
        autoplay: true,
        path: "/animations/scanner.json",
        rendererSettings: {
          preserveAspectRatio: "none"
        }
      });

      animationRef.current?.addEventListener?.("DOMLoaded", () => {
        if (cancelled) return;
        setIsReady(true);
      });
      animationRef.current?.addEventListener?.("data_failed", () => {
        if (cancelled) return;
        setIsFallback(true);
        setIsReady(false);
      });
    };

    mountAnimation();
    fallbackTimeoutId = window.setTimeout(() => {
      if (!window.lottie && !animationRef.current) {
        setIsFallback(true);
        setIsReady(false);
      }
    }, 1400);

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimeoutId);
      animationRef.current?.destroy?.();
      animationRef.current = null;
    };
  }, [isActive]);

  if (!isActive) return null;

  return (
    <div className="scan-analysis-overlay" aria-label={label} role="status">
      {!isFallback && (
        <div
          ref={containerRef}
          className={`scan-analysis-lottie ${isReady ? "is-ready" : ""}`}
        />
      )}
      <div className={`scan-analysis-fallback ${isReady && !isFallback ? "is-hidden" : ""}`} aria-hidden="true">
        <span />
      </div>
    </div>
  );
}
