export default function ActivationPage({ t }) {
  return (
    <div className="activation-screen">
      <div className="card activation-card">
        <h2>{t.activation.title}</h2>
        <p>{t.activation.text}</p>
      </div>
    </div>
  );
}
