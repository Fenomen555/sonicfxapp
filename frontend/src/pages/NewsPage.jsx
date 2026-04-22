import { useEffect, useState } from "react";
import ReactCountryFlag from "react-country-flag";
import { apiFetchJson } from "../lib/api";

function getImpactLabel(impact, t) {
  if (impact === "high") return t.news.impactHigh || "Высокий";
  if (impact === "low") return t.news.impactLow || "Низкий";
  return t.news.impactMedium || "Средний";
}

function getLocale(lang) {
  if (lang === "uk") return "uk-UA";
  if (lang === "en") return "en-US";
  return "ru-RU";
}

function formatUpdateTime(value, lang = "ru", timezone = "") {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const options = {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  };
  if (timezone) {
    options.timeZone = timezone;
  }
  try {
    return new Intl.DateTimeFormat(getLocale(lang), options).format(date);
  } catch {
    return date.toLocaleString(getLocale(lang), {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }
}

function hasCountryFlag(countryCode) {
  return /^[A-Z]{2}$/.test(String(countryCode || "").trim().toUpperCase());
}

function normalizeEconomicTitle(title, t) {
  return String(title || "")
    .replace(/\bm\/m\b/gi, `(${t.news.momShort || "м/м"})`)
    .replace(/\by\/y\b/gi, `(${t.news.yoyShort || "г/г"})`)
    .replace(/\bq\/q\b/gi, `(${t.news.qoqShort || "к/к"})`)
    .replace(/\bMoM\b/g, `(${t.news.momShort || "м/м"})`)
    .replace(/\bYoY\b/g, `(${t.news.yoyShort || "г/г"})`)
    .replace(/\bQoQ\b/g, `(${t.news.qoqShort || "к/к"})`);
}

function getMarketCategoryLabel(category, t) {
  const key = String(category || "all").toLowerCase();
  const map = {
    all: t.news.categoryAll || "Все",
    general: t.news.categoryGeneral || "Общие",
    business: t.news.categoryBusiness || "Бизнес",
    company: t.news.categoryCompany || "Компании",
    economy: t.news.categoryEconomy || "Экономика",
    politics: t.news.categoryPolitics || "Политика",
    "top news": t.news.categoryTopNews || "Главное",
    forex: t.news.categoryForex || "Forex",
    crypto: t.news.categoryCrypto || "Crypto",
    merger: t.news.categoryMerger || "Сделки"
  };
  if (map[key]) return map[key];
  return key
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function FlagBadge({ countryCode, fallback = "🌐", title = "Global" }) {
  const code = String(countryCode || "").trim().toUpperCase();
  if (!hasCountryFlag(code)) {
    return <span className="news-flag-fallback">{fallback}</span>;
  }
  return (
    <ReactCountryFlag
      countryCode={code}
      svg
      aria-label={title}
      title={title}
      className="news-flag-svg"
      style={{ width: "100%", height: "100%", display: "block" }}
    />
  );
}

function MarketNewsMedia({ src, alt }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) return null;

  return (
    <div className="news-market-media">
      <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />
    </div>
  );
}

function EconomicSection({ title, items, t }) {
  if (!items.length) return null;
  return (
    <section className="news-block">
      <div className="news-block-head">
        <strong>{title}</strong>
        <span>{items.length}</span>
      </div>
      <div className="news-card-grid">
        {items.map((item) => (
          <article className={`card news-card news-card-economic impact-${item.impact || "medium"}`} key={item.id}>
            <div className="news-card-top">
              <div className="news-card-tags">
                <span className="news-flag-chip" title={item.country_code || item.currency || "Global"}>
                  <FlagBadge countryCode={item.country_code} title={item.country_code || item.currency || "Global"} />
                </span>
                <span className="news-currency-chip">{item.currency || "ALL"}</span>
                <span className={`news-impact-chip impact-${item.impact || "medium"}`}>
                  {getImpactLabel(item.impact, t)}
                </span>
              </div>
              <span className="news-time-chip">{item.time_label || "--:--"}</span>
            </div>

            <div className="news-card-copy">
              <h3>{normalizeEconomicTitle(item.title, t)}</h3>
              <p>{[item.country_code || item.currency || "ALL", item.source_name || "Finnhub"].join(" · ")}</p>
            </div>

            <div className="news-stat-row compact">
              <div className="news-stat-box">
                <span>{t.news.actual || "Actual"}</span>
                <strong>{item.actual || "-"}</strong>
              </div>
              <div className="news-stat-box">
                <span>{t.news.forecast || "Forecast"}</span>
                <strong>{item.forecast || "-"}</strong>
              </div>
              <div className="news-stat-box">
                <span>{t.news.previous || "Previous"}</span>
                <strong>{item.previous || "-"}</strong>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function MarketSection({ items, categories, selectedCategory, onSelectCategory, t, lang, timezone }) {
  return (
    <section className="news-block">
      <div className="news-category-strip" role="tablist" aria-label={t.news.marketCategories || "Категории"}>
        {categories.map((category) => {
          const isActive = selectedCategory === category.key;
          return (
            <button
              key={category.key}
              type="button"
              className={`news-category-chip ${isActive ? "active" : ""}`}
              onClick={() => onSelectCategory(category.key)}
            >
              <span>{getMarketCategoryLabel(category.key, t)}</span>
              <strong>{category.count}</strong>
            </button>
          );
        })}
      </div>

      {!items.length && <div className="card news-empty-card">{t.news.marketEmpty || t.news.empty}</div>}

      <div className="news-card-grid news-card-grid-market">
        {items.map((item) => (
          <article className="card news-card news-card-market" key={item.id}>
            <div className="news-card-top">
              <div className="news-card-tags">
                <span className="news-flag-chip" title={item.country_code || "Global"}>
                  <FlagBadge countryCode={item.country_code} title={item.country_code || "Global"} />
                </span>
                <span className="news-currency-chip">{getMarketCategoryLabel(item.category, t)}</span>
              </div>
              <span className="news-time-chip">{formatUpdateTime(item.published_at, lang, timezone).split(", ").pop() || item.time_label || "--:--"}</span>
            </div>

            <MarketNewsMedia src={item.image_url} alt={item.title} />

            <div className="news-card-copy compact-copy market-copy">
              <h3>{item.title}</h3>
              <p>{item.source_name || "Finnhub"}</p>
            </div>

            {!!item.related && (
              <div className="news-related-row">
                {String(item.related || "")
                  .split(",")
                  .map((part) => part.trim())
                  .filter(Boolean)
                  .slice(0, 4)
                  .map((part) => (
                    <span className="news-related-chip" key={part}>{part}</span>
                  ))}
              </div>
            )}

            {!!item.summary && <p className="news-market-summary">{item.summary}</p>}

            {!!item.source_url && (
              <a className="news-open-link" href={item.source_url} target="_blank" rel="noreferrer">
                {t.news.openNews || "Открыть"}
              </a>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

export default function NewsPage({ t, lang = "ru", timezone = "" }) {
  const [feed, setFeed] = useState("economic");
  const [marketCategory, setMarketCategory] = useState("all");
  const [newsData, setNewsData] = useState({
    feed: "economic",
    items: [],
    today_items: [],
    tomorrow_items: [],
    categories: [],
    updated_at: ""
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    async function load() {
      setLoading(true);
      try {
        const qs = new URLSearchParams({
          feed,
          category: feed === "market" ? marketCategory : "all",
          limit: feed === "market" ? "24" : "16"
        });
        const response = await apiFetchJson(`/api/news?${qs.toString()}`).catch(() => ({
          feed,
          items: [],
          today_items: [],
          tomorrow_items: [],
          categories: [],
          updated_at: ""
        }));
        if (!isActive) return;
        const nextCategories = Array.isArray(response?.categories) && response.categories.length
          ? response.categories
          : [{ key: "all", count: Number(response?.items?.length || 0) }];
        setNewsData({
          feed,
          items: response?.items || [],
          today_items: response?.today_items || [],
          tomorrow_items: response?.tomorrow_items || [],
          categories: nextCategories,
          updated_at: response?.updated_at || ""
        });
        if (feed === "market" && marketCategory !== "all" && !nextCategories.some((item) => item.key === marketCategory)) {
          setMarketCategory("all");
        }
      } finally {
        if (isActive) setLoading(false);
      }
    }

    load();
    return () => {
      isActive = false;
    };
  }, [feed, marketCategory]);

  const hasItems = newsData.items.length > 0;

  return (
    <section className="page page-news news-page-ref">
      <div className="news-shell card">
        <div className="news-switcher" role="tablist" aria-label={t.news.switcherLabel || "Переключатель новостей"}>
          <button
            type="button"
            className={`news-switcher-btn ${feed === "economic" ? "active" : ""}`}
            onClick={() => setFeed("economic")}
          >
            {t.news.switchEconomic || "Экономический календарь"}
          </button>
          <button
            type="button"
            className={`news-switcher-btn ${feed === "market" ? "active" : ""}`}
            onClick={() => setFeed("market")}
          >
            {t.news.switchMarket || "Общерыночные новости"}
          </button>
        </div>
      </div>

      {loading && <div className="card news-empty-card">{t.news.loading || "Загружаем события..."}</div>}

      {!loading && !hasItems && <div className="card news-empty-card">{t.news.empty}</div>}

      {!loading && feed === "economic" && (
        <>
          <EconomicSection title={t.news.today || "Сегодня"} items={newsData.today_items || []} t={t} />
          <EconomicSection title={t.news.tomorrow || "Завтра"} items={newsData.tomorrow_items || []} t={t} />
        </>
      )}

      {!loading && feed === "market" && (
        <MarketSection
          items={newsData.items || []}
          categories={newsData.categories || [{ key: "all", count: newsData.items.length }]}
          selectedCategory={marketCategory}
          onSelectCategory={setMarketCategory}
          t={t}
          lang={lang}
          timezone={timezone}
        />
      )}
    </section>
  );
}
