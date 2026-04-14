import { useEffect, useMemo, useState } from "react";
import { apiFetchJson } from "../lib/api";

function getImpactLabel(impact, t) {
  if (impact === "high") return t.news.impactHigh || "Высокий";
  if (impact === "low") return t.news.impactLow || "Низкий";
  return t.news.impactMedium || "Средний";
}

function formatUpdateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function NewsSection({ title, subtitle, items, t }) {
  return (
    <section className="news-section">
      <div className="news-section-head">
        <div>
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <span className="news-section-count">{items.length}</span>
      </div>

      <div className="news-event-grid">
        {items.map((item) => (
          <article className={`card news-event-card impact-${item.impact || "medium"}`} key={item.id}>
            <div className="news-event-top">
              <div className="news-event-tags">
                <span className="news-currency-chip">{item.currency || "ALL"}</span>
                <span className={`news-impact-chip impact-${item.impact || "medium"}`}>
                  {getImpactLabel(item.impact, t)}
                </span>
              </div>
              <span className="news-time-chip">{item.time_label || "--:--"}</span>
            </div>

            <div className="news-event-copy">
              <h3>{item.title}</h3>
              <p>{item.country || "ALL"} · {item.source_name || "Finnhub"}</p>
            </div>

            <div className="news-stat-row">
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

export default function NewsPage({ t }) {
  const [items, setItems] = useState([]);
  const [todayItems, setTodayItems] = useState([]);
  const [tomorrowItems, setTomorrowItems] = useState([]);
  const [updatedAt, setUpdatedAt] = useState("");
  const [stats, setStats] = useState({ total: 0, wins: 0, losses: 0, winrate: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    async function load() {
      try {
        const [newsRes, dailyStats] = await Promise.all([
          apiFetchJson("/api/news").catch(() => ({ items: [], today_items: [], tomorrow_items: [], updated_at: "" })),
          apiFetchJson("/api/stats/daily").catch(() => ({ total: 0, wins: 0, losses: 0, winrate: 0 }))
        ]);

        if (!isActive) return;
        setItems(newsRes?.items || []);
        setTodayItems(newsRes?.today_items || []);
        setTomorrowItems(newsRes?.tomorrow_items || []);
        setUpdatedAt(newsRes?.updated_at || "");
        setStats({
          total: Number(dailyStats?.total || 0),
          wins: Number(dailyStats?.wins || 0),
          losses: Number(dailyStats?.losses || 0),
          winrate: Number(dailyStats?.winrate || 0)
        });
      } finally {
        if (isActive) setLoading(false);
      }
    }

    load();
    return () => {
      isActive = false;
    };
  }, []);

  const summaryCards = useMemo(
    () => [
      {
        key: "today",
        label: t.news.today || "Сегодня",
        value: todayItems.length
      },
      {
        key: "tomorrow",
        label: t.news.tomorrow || "Завтра",
        value: tomorrowItems.length
      },
      {
        key: "winrate",
        label: t.news.winrate || "Winrate",
        value: `${stats.winrate}%`
      }
    ],
    [stats.winrate, t.news.today, t.news.tomorrow, t.news.winrate, todayItems.length, tomorrowItems.length]
  );

  return (
    <section className="page page-news news-page-ref">
      <div className="news-hero card">
        <div className="news-hero-copy">
          <span className="news-kicker">{t.news.kicker || "Economic calendar"}</span>
          <h1 className="page-title">{t.news.title}</h1>
          <p>{t.news.subtitle || "Высоковолатильные события по экономическому календарю на сегодня и завтра."}</p>
        </div>

        <div className="news-summary-grid">
          {summaryCards.map((item) => (
            <article className="news-summary-card" key={item.key}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </div>

        <div className="news-hero-footer">
          <span>{t.news.updated || "Обновлено"}: {formatUpdateTime(updatedAt)}</span>
          <span>{t.news.totalEvents || "Событий"}: {items.length}</span>
        </div>
      </div>

      {loading && <div className="card news-empty-card">{t.news.loading || "Загружаем события..."}</div>}

      {!loading && items.length === 0 && <div className="card news-empty-card">{t.news.empty}</div>}

      {!loading && todayItems.length > 0 && (
        <NewsSection
          title={t.news.today || "Сегодня"}
          subtitle={t.news.todaySubtitle || "События начиная от последних двух часов и дальше по дню."}
          items={todayItems}
          t={t}
        />
      )}

      {!loading && tomorrowItems.length > 0 && (
        <NewsSection
          title={t.news.tomorrow || "Завтра"}
          subtitle={t.news.tomorrowSubtitle || "Запланированные события следующего дня."}
          items={tomorrowItems}
          t={t}
        />
      )}

      <section className="news-performance card">
        <div className="news-performance-head">
          <strong>{t.news.todayStats}</strong>
          <span>{t.news.performanceHint || "Статистика текущих сигналов за день."}</span>
        </div>
        <div className="news-performance-grid">
          <div className="news-performance-item">
            <span>{t.news.total}</span>
            <strong>{stats.total}</strong>
          </div>
          <div className="news-performance-item">
            <span>{t.news.wins}</span>
            <strong>{stats.wins}</strong>
          </div>
          <div className="news-performance-item">
            <span>{t.news.losses}</span>
            <strong>{stats.losses}</strong>
          </div>
          <div className="news-performance-item">
            <span>{t.news.winrate}</span>
            <strong>{stats.winrate}%</strong>
          </div>
        </div>
      </section>
    </section>
  );
}
