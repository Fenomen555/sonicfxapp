import { useEffect, useRef, useState } from "react";
import { UploadIcon } from "./AppIcons";
import { getDeviceProfile } from "../lib/device";

export default function UploadScanAnimation() {
  const containerRef = useRef(null);
  const animationRef = useRef(null);
  const [isFallback, setIsFallback] = useState(() => getDeviceProfile().useLiteAnimations);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (getDeviceProfile().useLiteAnimations) {
      setIsFallback(true);
      setIsReady(false);
      return undefined;
    }

    let cancelled = false;
    let readinessTimeoutId = 0;

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
        path: "/animations/upload-scan.json",
        rendererSettings: {
          preserveAspectRatio: "xMidYMid meet"
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
    const fallbackTimeoutId = window.setTimeout(() => {
      if (!window.lottie && !animationRef.current) {
        setIsFallback(true);
        setIsReady(false);
      }
    }, 1600);
    readinessTimeoutId = window.setTimeout(() => {
      if (!cancelled && (!containerRef.current || containerRef.current.childElementCount === 0)) {
        setIsFallback(true);
        setIsReady(false);
      }
    }, 2200);

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimeoutId);
      window.clearTimeout(readinessTimeoutId);
      animationRef.current?.destroy?.();
      animationRef.current = null;
    };
  }, []);

  return (
    <div className="upload-animation-shell" aria-hidden="true">
      <div className={`upload-animation-fallback ${isReady && !isFallback ? "is-hidden" : ""}`}>
        <UploadIcon />
      </div>
      {!isFallback && (
        <div
          ref={containerRef}
          className={`upload-animation ${isReady ? "is-ready" : ""}`}
        />
      )}
    </div>
  );
}
