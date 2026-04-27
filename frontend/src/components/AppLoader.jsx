import { useEffect, useMemo, useState } from "react";
import Lottie from "lottie-react";
import tradingLoaderAnimation from "../assets/trading-loader-gray.json";

export default function AppLoader({ label = "Loading...", compact = false }) {
  const labels = useMemo(() => {
    if (Array.isArray(label)) return label.filter(Boolean);
    return label ? [label] : [];
  }, [label]);
  const [activeLabelIndex, setActiveLabelIndex] = useState(0);

  useEffect(() => {
    setActiveLabelIndex(0);
    if (labels.length < 2) return undefined;
    const timerId = window.setInterval(() => {
      setActiveLabelIndex((value) => (value + 1) % labels.length);
    }, 900);
    return () => window.clearInterval(timerId);
  }, [labels]);

  const activeLabel = labels[activeLabelIndex] || "";

  return (
    <div className={`app-loader ${compact ? "compact" : ""}`} role="status" aria-live="polite">
      <div className="app-loader-lottie" aria-hidden="true">
        <Lottie animationData={tradingLoaderAnimation} loop autoplay />
      </div>
      {activeLabel ? <span className="app-loader-label" key={activeLabel}>{activeLabel}</span> : null}
    </div>
  );
}
