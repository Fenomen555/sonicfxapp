import aiBrainIcon from "../assets/ai-brain.png";
import cameraSourceIcon from "../assets/camera-source.png";
import gallerySourceIcon from "../assets/gallery-source.png";
import indicatorCandlesIcon from "../assets/indicator-candles.png";
import linkSourceIcon from "../assets/link-source.png";
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
  return <img src={gallerySourceIcon} alt="" loading="lazy" {...props} />;
}

export function CameraIcon(props) {
  return <img src={cameraSourceIcon} alt="" loading="lazy" {...props} />;
}

export function LinkIcon(props) {
  return <img src={linkSourceIcon} alt="" loading="lazy" {...props} />;
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
