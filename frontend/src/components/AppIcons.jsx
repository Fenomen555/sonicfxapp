import aiBrainIcon from "../assets/ai-brain.png";
import indicatorCandlesIcon from "../assets/indicator-candles.png";
import scannerPortraitIcon from "../assets/scanner-portrait.png";

export function SparkIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" {...props}>
      <path
        d="M13.4 2.8 7.7 12h3.9l-1 9.2 5.7-9.2h-3.9l1-9.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function UploadIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 16V7" />
      <path d="m8.5 10.5 3.5-3.5 3.5 3.5" />
      <path d="M6 17.5h12" />
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
    </svg>
  );
}

export function GalleryIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="3.5" />
      <path d="M7.2 14.8 10 11.9l2.3 2.2 2.2-2.4 2.3 2.5" />
      <path d="M8.2 9.2h.01" strokeWidth="2.4" />
      <path d="M3.5 8.5h17" opacity="0.35" />
    </svg>
  );
}

export function CameraIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M8.1 6.2h7.8l1.2 1.9h1.1A2.3 2.3 0 0 1 20.5 10.4v5.9a2.7 2.7 0 0 1-2.7 2.7H6.2a2.7 2.7 0 0 1-2.7-2.7v-5.9a2.3 2.3 0 0 1 2.3-2.3h1.1l1.2-1.9Z" />
      <circle cx="12" cy="13.1" r="3.35" />
      <path d="M17.2 10.7h.01" strokeWidth="2.4" />
    </svg>
  );
}

export function LinkIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9.7 14.3 7.5 16.5a3.2 3.2 0 0 1-4.5-4.5l2.3-2.3A3.2 3.2 0 0 1 9.8 9" />
      <path d="M14.3 9.7 16.5 7.5A3.2 3.2 0 1 1 21 12l-2.3 2.3a3.2 3.2 0 0 1-4.5-.5" />
      <path d="m8.7 15.3 6.6-6.6" />
    </svg>
  );
}

export function ScannerModeIcon(props) {
  return <img src={scannerPortraitIcon} alt="" loading="lazy" {...props} />;
}

export function AutoModeIcon(props) {
  return <img src={aiBrainIcon} alt="" loading="lazy" {...props} />;
}

export function IndicatorModeIcon(props) {
  return <img src={indicatorCandlesIcon} alt="" loading="lazy" {...props} />;
}
