import notificationIcon from "../assets/toast-bell.gif";

export default function AppToasts({ items = [], onDismiss }) {
  if (!items.length) return null;

  return (
    <div className="app-toast-stack" aria-live="polite" aria-atomic="false">
      {items.map((item) => (
        <article className={`app-toast app-toast-${item.type || "info"}`} key={item.id}>
          <span className="app-toast-icon" aria-hidden="true">
            <img src={notificationIcon} alt="" />
          </span>
          <span className="app-toast-copy">
            <strong>{item.title}</strong>
            {item.message ? <small>{item.message}</small> : null}
          </span>
          <button
            className="app-toast-close"
            type="button"
            onClick={() => onDismiss?.(item.id)}
            aria-label="Close notification"
          >
            x
          </button>
        </article>
      ))}
    </div>
  );
}
