import { useEffect, useRef, useState } from "react";
import lightningCtaIcon from "../assets/cta-lightning.png";
import { getDeviceProfile } from "../lib/device";

export default function AnalyzeCtaAnimation() {
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
        path: "/animations/analyze-cta.json",
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

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimeoutId);
      animationRef.current?.destroy?.();
      animationRef.current = null;
    };
  }, []);

  return (
    <span className="analyze-cta-animation" aria-hidden="true">
      <img
        className={`analyze-cta-fallback ${isReady && !isFallback ? "is-hidden" : ""}`}
        src={lightningCtaIcon}
        alt=""
        loading="lazy"
        draggable="false"
      />
      {!isFallback && (
        <span
          ref={containerRef}
          className={`analyze-cta-lottie ${isReady ? "is-ready" : ""}`}
        />
      )}
    </span>
  );
}
