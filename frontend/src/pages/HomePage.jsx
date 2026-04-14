import { useEffect, useMemo, useState } from "react";
import { CameraIcon, GalleryIcon, LinkIcon, SparkIcon } from "../components/AppIcons";
import UploadScanAnimation from "../components/UploadScanAnimation";
import { apiFetchJson } from "../lib/api";

const MODE_OPTIONS = [
  { id: "otc", label: "OTC" },
  { id: "forex", label: "Forex" }
];

const FALLBACK_EXPIRATIONS = [
  { value: "5s", label: "5s" },
  { value: "15s", label: "15s" },
  { value: "1m", label: "1m" },
  { value: "5m", label: "5m" },
  { value: "15m", label: "15m" },
  { value: "1h", label: "1h" }
];

export default function HomePage({ t }) {
  const [kind, setKind] = useState("forex");
  const [pairs, setPairs] = useState([]);
  const [expirations, setExpirations] = useState(FALLBACK_EXPIRATIONS);
  const [asset, setAsset] = useState("");
  const [expiration, setExpiration] = useState("5m");
  const [isLoading, setIsLoading] = useState(false);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    let isActive = true;

    async function loadOptions() {
      setIsLoading(true);
      setErrorText("");

      try {
        const data = await apiFetchJson(`/api/market/options?kind=${kind}`);
        if (!isActive) return;

        const nextPairs = Array.isArray(data?.pairs) ? data.pairs : [];
        const nextExp = Array.isArray(data?.expirations) && data.expirations.length > 0
          ? data.expirations
          : FALLBACK_EXPIRATIONS;

        setPairs(nextPairs);
        setExpirations(nextExp);

        setAsset((prev) => {
          if (prev && nextPairs.some((item) => item?.pair === prev)) return prev;
          return nextPairs[0]?.pair || "";
        });

        setExpiration((prev) => {
          if (prev && nextExp.some((item) => item?.value === prev)) return prev;
          return nextExp[0]?.value || "5m";
        });
      } catch (error) {
        if (!isActive) return;
        setPairs([]);
        setExpirations(FALLBACK_EXPIRATIONS);
        setErrorText(error.message || "Failed to load market data");
      } finally {
        if (isActive) setIsLoading(false);
      }
    }

    loadOptions();

    return () => {
      isActive = false;
    };
  }, [kind]);

  const quickExpirations = useMemo(() => expirations.slice(0, 6), [expirations]);
  const quickActions = [
    { id: "gallery", label: t.home.gallery || "Gallery", icon: GalleryIcon },
    { id: "camera", label: t.home.camera || "Camera", icon: CameraIcon },
    { id: "link", label: t.home.link || "Link", icon: LinkIcon }
  ];

  return (
    <section className="page page-home-ref">
      <div className="home-quota">
        <div className="quota-left">
          <SparkIcon className="quota-left-icon" aria-hidden="true" />
          <span>{t.home.quota || "Analyses: 3 / 3"}</span>
        </div>
        <button className="quota-btn" type="button">
          {t.home.pro || "Get PRO"}
        </button>
      </div>

      <h1 className="home-title">{t.home.title || "Upload chart screenshot"}</h1>
      <p className="home-subtitle">{t.home.sub || "AI analysis in 30 seconds"}</p>

      <button className="upload-zone" type="button">
        <span className="frame-corner tl" />
        <span className="frame-corner tr" />
        <span className="frame-corner bl" />
        <span className="frame-corner br" />

        <div className="upload-icon" aria-hidden="true">
          <UploadScanAnimation />
        </div>
        <div className="upload-title">{t.home.upload || "Upload chart"}</div>
        <div className="upload-hint">{t.home.uploadHint || "JPG, PNG or HEIC"}</div>
      </button>

      <div className="quick-actions">
        {quickActions.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.id} className="quick-action" type="button">
              <span className="quick-action-icon" aria-hidden="true">
                <Icon />
              </span>
              <em>{item.label}</em>
            </button>
          );
        })}
      </div>

      <div className="card form-card ref-form-card">
        <label className="field-label">{t.home.mode || "Analysis mode"}</label>
        <div className="mode-toggle">
          {MODE_OPTIONS.map((item) => (
            <button
              key={item.id}
              className={`mode-btn ${kind === item.id ? "active" : ""}`}
              onClick={() => setKind(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="field-row">
          <div className="field-grow">
            <label className="field-label">{t.home.asset || "Symbol"}</label>
            <select
              value={asset}
              onChange={(e) => setAsset(e.target.value)}
              className="field-input ref-input"
              disabled={isLoading || pairs.length === 0}
            >
              {pairs.length === 0 && (
                <option value="">
                  {isLoading ? (t.home.loading || "Loading...") : (t.home.emptyPairs || "No pairs available")}
                </option>
              )}
              {pairs.map((item) => (
                <option key={item.pair} value={item.pair}>
                  {item.pair}{typeof item.payout === "number" ? ` (${item.payout}%)` : ""}
                </option>
              ))}
            </select>
          </div>

          <div className="field-mini">
            <label className="field-label">{t.home.expiration || "Expiration"}</label>
            <select
              value={expiration}
              onChange={(e) => setExpiration(e.target.value)}
              className="field-input ref-input"
            >
              {expirations.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="tf-chip-row">
          {quickExpirations.map((item) => (
            <button
              key={item.value}
              className={`tf-chip ${expiration === item.value ? "active" : ""}`}
              onClick={() => setExpiration(item.value)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>

        {errorText && <div className="form-error">{errorText}</div>}

        <button className="primary-btn ref-primary" type="button">
          <SparkIcon className="primary-btn-icon" aria-hidden="true" />
          <span>{t.home.analyze || "Analyze"}</span>
        </button>
      </div>
    </section>
  );
}
