import Lottie from "lottie-react";
import tradingLoaderAnimation from "../assets/trading-loader-gray.json";

export default function AppLoader({ label = "Loading...", compact = false }) {
  return (
    <div className={`app-loader ${compact ? "compact" : ""}`} role="status" aria-live="polite">
      <div className="app-loader-lottie" aria-hidden="true">
        <Lottie animationData={tradingLoaderAnimation} loop autoplay />
      </div>
      {label ? <span className="app-loader-label">{label}</span> : null}
    </div>
  );
}
