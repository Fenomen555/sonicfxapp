import { useEffect, useMemo, useState } from "react";

const ONBOARDING_STEPS = [
  {
    id: 0,
    emoji: "⚡",
    title: "Умные сигналы для точных решений",
    description: "Три режима анализа в одном пространстве: сканер по скриншоту, автоматический AI-анализ и сигналы по индикаторам.",
    bullets: [
      "📸 Сканер по вашему скриншоту",
      "🤖 Автоматический AI-режим",
      "📊 Анализ по выбранным индикаторам"
    ],
    button: "✨ Открыть возможности",
    footnote: "Доступ к функциям открывается после активации аккаунта"
  },
  {
    id: 1,
    emoji: "⏱",
    title: "Контроль сделки в реальном времени",
    description: "Следите за сигналами без лишней нагрузки. Всё важное видно сразу и в одном экране.",
    bullets: [
      "📍 До 3 сигналов одновременно",
      "📍 Таймер до закрытия позиции",
      "📍 Наглядная шкала прогресса и итог сделки"
    ],
    button: "✨ Продолжить",
    footnote: "Все результаты фиксируются автоматически"
  },
  {
    id: 2,
    emoji: "📈",
    title: "Статистика, история и рост",
    description: "Контролируйте прогресс и принимайте решения на основе своей реальной торговой эффективности.",
    bullets: [
      "👤 Профиль трейдера и статус",
      "📊 Винрейт и основная статистика",
      "📅 История сделок за последние 7 дней"
    ],
    button: "🚀 Перейти к сигналам",
    footnote: "Профиль, история и статистика обновляются в реальном времени"
  }
];

export default function OnboardingScreen({ onFinish }) {
  const [step, setStep] = useState(0);
  const [transitionStage, setTransitionStage] = useState("enter");

  useEffect(() => {
    const timer = window.setTimeout(() => setTransitionStage("active"), 40);
    return () => window.clearTimeout(timer);
  }, []);

  const currentStep = useMemo(() => ONBOARDING_STEPS[step] || ONBOARDING_STEPS[0], [step]);

  function handleNext() {
    if (step >= ONBOARDING_STEPS.length - 1) {
      onFinish?.();
      return;
    }

    setTransitionStage("exit");
    window.setTimeout(() => {
      setStep((prev) => Math.min(prev + 1, ONBOARDING_STEPS.length - 1));
      setTransitionStage("enter");
      window.setTimeout(() => setTransitionStage("active"), 24);
    }, 240);
  }

  return (
    <section className="onboarding-shell">
      <div className="onboarding-surface">
        <div className={`onboarding-scene stage-${transitionStage}`}>
          <div className="onboarding-orbit orbit-a" aria-hidden="true" />
          <div className="onboarding-orbit orbit-b" aria-hidden="true" />
          <div className="onboarding-orbit orbit-c" aria-hidden="true" />

          <div className="onboarding-brand-pill">
            <span className="onboarding-brand-main">Sonic</span>
            <span className="onboarding-brand-fx">fx</span>
          </div>

          <div className="onboarding-hero">
            <div className="onboarding-emoji-wrap" aria-hidden="true">
              <span className="onboarding-emoji-core">{currentStep.emoji}</span>
              <span className="onboarding-glow-ring ring-1" />
              <span className="onboarding-glow-ring ring-2" />
            </div>

            <div className="onboarding-copy">
              <div className="onboarding-overline">Premium trading assistant</div>
              <h1>{currentStep.title}</h1>
              <p>{currentStep.description}</p>
            </div>
          </div>

          <div className="onboarding-bullets">
            {currentStep.bullets.map((item) => (
              <div key={item} className="onboarding-bullet">
                <span>{item}</span>
              </div>
            ))}
          </div>

          <div className="onboarding-progress">
            {ONBOARDING_STEPS.map((item, index) => (
              <span
                key={item.id}
                className={`onboarding-progress-dot ${index === step ? "active" : ""} ${index < step ? "passed" : ""}`}
              />
            ))}
          </div>

          <button type="button" className="onboarding-primary-btn" onClick={handleNext}>
            {currentStep.button}
          </button>

          <div className="onboarding-footnote">{currentStep.footnote}</div>
        </div>
      </div>
    </section>
  );
}
