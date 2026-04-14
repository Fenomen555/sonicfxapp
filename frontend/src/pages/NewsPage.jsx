import { useEffect, useState } from "react";
import { apiFetchJson } from "../lib/api";

export default function NewsPage({ t }) {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState({ total: 0, wins: 0, losses: 0, winrate: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isActive = true;

    async function load() {
      try {
        const [newsRes, dailyStats] = await Promise.all([
          apiFetchJson("/api/news").catch(() => ({ items: [] })),
          apiFetchJson("/api/stats/daily").catch(() => ({ total: 0, wins: 0, losses: 0, winrate: 0 }))
        ]);

        if (!isActive) return;
        setItems(newsRes?.items || []);
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

  return (
    <section className="page page-news">
      <h1 className="page-title">{t.news.title}</h1>
      <div className="stack">
        {loading && <div className="card">Loading...</div>}
        {!loading && items.length === 0 && <div className="card">{t.news.empty}</div>}
        {items.map((item) => (
          <article className="card news-card" key={item.id}>
            <h3>{item.title}</h3>
            {item.summary && <p>{item.summary}</p>}
            <div className="news-meta">
              <span>{item.source_name || "Source"}</span>
              <span>{item.published_at ? new Date(item.published_at).toLocaleString() : ""}</span>
            </div>
          </article>
        ))}
      </div>

      <footer className="daily-footer">
        <div className="daily-footer-title">{t.news.todayStats}</div>
        <div className="daily-grid">
          <span>{t.news.total}: {stats.total}</span>
          <span>{t.news.wins}: {stats.wins}</span>
          <span>{t.news.losses}: {stats.losses}</span>
          <span>{t.news.winrate}: {stats.winrate}%</span>
        </div>
      </footer>
    </section>
  );
}
