import { useEffect, useRef, useState } from "react";
import { UploadIcon } from "./AppIcons";
import { getDeviceProfile } from "../lib/device";

export default function UploadScanAnimation() {
  const containerRef = useRef(null);
  const animationRef = useRef(null);
  const [isFallback, setIsFallback] = useState(() => getDeviceProfile().useLiteAnimations);

  useEffect(() => {
    if (getDeviceProfile().useLiteAnimations) {
      setIsFallback(true);
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
        path: "/animations/upload-scan.json",
        rendererSettings: {
          preserveAspectRatio: "xMidYMid meet"
        }
      });
    };

    mountAnimation();
    const fallbackTimeoutId = window.setTimeout(() => {
      if (!window.lottie && !animationRef.current) setIsFallback(true);
    }, 1600);

    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimeoutId);
      animationRef.current?.destroy?.();
      animationRef.current = null;
    };
  }, []);

  if (isFallback) {
    return (
      <div className="upload-animation-fallback" aria-hidden="true">
        <UploadIcon />
      </div>
    );
  }

  return <div ref={containerRef} className="upload-animation" aria-hidden="true" />;
}
