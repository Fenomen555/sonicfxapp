export default function BottomNav({ tabs, activeTab, onChange }) {
  const renderIcon = (id) => {
    if (id === "news") {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
          <path d="M8 9h8M8 12h8M8 15h5" />
        </svg>
      );
    }
    if (id === "home") {
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 10.5 12 4l8 6.5" />
          <path d="M6.5 9.5V19h11V9.5" />
        </svg>
      );
    }
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.5 19c.9-3.2 3.3-4.8 6.5-4.8s5.6 1.6 6.5 4.8" />
      </svg>
    );
  };

  return (
    <nav className="bottom-nav">
      {tabs.map((item) => (
        <button
          key={item.id}
          className={`bottom-nav-item ${activeTab === item.id ? "active" : ""}`}
          onClick={() => onChange(item.id)}
        >
          <span className="bottom-nav-icon" aria-hidden="true">
            {renderIcon(item.id)}
          </span>
          <span className="bottom-nav-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
