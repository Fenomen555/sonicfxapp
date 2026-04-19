import { useMemo, useState } from "react";

const FALLBACK_ONBOARDING = {
  skip: "Пропустить",
  close: "Закрыть",
  steps: [
    {
      id: 0,
      icon: "S",
      tone: "scanner",
      overline: "Быстрый старт",
      title: "Выберите удобный способ анализа",
      description: "SonicFX помогает получить сигнал через скриншот, автоматический поток или набор индикаторов.",
      bullets: [
        { label: "Сканер", text: "загрузите график и получите AI-разбор" },
        { label: "Авто режим", text: "пара и рынок ведут live-график" },
        { label: "Индикаторы", text: "сигнал строится по выбранной стратегии" }
      ],
      button: "Продолжить",
      footnote: "Доступ к функциям открывается после активации аккаунта"
    },
    {
      id: 1,
      icon: "AI",
      tone: "auto",
      overline: "Live сценарий",
      title: "Следите за сделкой без лишнего шума",
      description: "Главные данные собраны в одном экране: актив, цена, состояние графика и выбранный режим.",
      bullets: [
        { label: "Live график", text: "котировки обновляются в реальном времени" },
        { label: "Пары и рынки", text: "выбор через удобные карточки" },
        { label: "Без дублей", text: "подписки переключаются аккуратно" }
      ],
      button: "Дальше",
      footnote: "Все результаты фиксируются автоматически"
    },
    {
      id: 2,
      icon: "FX",
      tone: "growth",
      overline: "Контроль прогресса",
      title: "Профиль, новости и история под рукой",
      description: "Переключайте тему, язык, часовой пояс и следите за важными событиями прямо внутри mini app.",
      bullets: [
        { label: "Профиль", text: "статус, баланс и основные данные" },
        { label: "Новости", text: "экономический календарь и рынок" },
        { label: "Адаптивность", text: "аккуратно на телефоне и ПК" }
      ],
      button: "Открыть приложение",
      footnote: "Профиль, история и статистика обновляются в реальном времени"
    }
  ]
};

export default function OnboardingScreen({ t = FALLBACK_ONBOARDING, onFinish }) {
  const [step, setStep] = useState(0);
  const steps = useMemo(() => (Array.isArray(t?.steps) && t.steps.length ? t.steps : FALLBACK_ONBOARDING.steps), [t]);
  const currentStep = useMemo(() => steps[step] || steps[0], [step, steps]);
  const isLastStep = step >= steps.length - 1;

  function handleNext() {
    if (isLastStep) {
      onFinish?.();
      return;
    }
    setStep((prev) => Math.min(prev + 1, steps.length - 1));
  }

  return (
    <section className="onboarding-screen" aria-label="Onboarding">
      <div className="onboarding-scene">
        <div key={currentStep.id} className="onboarding-content">
          <div className="onboarding-hero">
            <div className={`onboarding-visual tone-${currentStep.tone}`} aria-hidden="true">
              <span className="onboarding-visual-mark">{currentStep.icon}</span>
            </div>

            <div className="onboarding-copy">
              <div className="onboarding-overline">{currentStep.overline}</div>
              <h1>{currentStep.title}</h1>
              <p>{currentStep.description}</p>
            </div>
          </div>

          <div className="onboarding-bullets">
            {currentStep.bullets.map((item, index) => (
              <div key={item.label} className="onboarding-bullet">
                <span className="onboarding-bullet-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="onboarding-bullet-copy">
                  <span className="onboarding-bullet-title">
                    <strong>{item.label}</strong>
                    {index === 0 && <span className="onboarding-live-dot" aria-hidden="true" />}
                  </span>
                  <small>{item.text}</small>
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="onboarding-footer">
          <div className="onboarding-progress-wrap">
            <div className="onboarding-progress">
              {steps.map((item, index) => (
                <span
                  key={item.id}
                  className={`onboarding-progress-dot ${index === step ? "active" : ""} ${index < step ? "passed" : ""}`}
                />
              ))}
            </div>
          </div>

          <div className="onboarding-actions">
            <button type="button" className="onboarding-primary-btn" onClick={handleNext}>
              {currentStep.button}
            </button>
            <button type="button" className="onboarding-skip-link" onClick={onFinish}>
              {isLastStep ? (t?.close || FALLBACK_ONBOARDING.close) : (t?.skip || FALLBACK_ONBOARDING.skip)}
            </button>
          </div>

          <div className="onboarding-footnote">{currentStep.footnote}</div>
        </div>
      </div>
    </section>
  );
}
