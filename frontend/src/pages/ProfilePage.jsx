import { useEffect, useMemo, useRef, useState } from "react";
import ReactCountryFlag from "react-country-flag";
import profileFaqIcon from "../assets/profile-faq.png";
import profileHistoryIcon from "../assets/profile-history.png";
import profileNotificationsIcon from "../assets/profile-notifications.png";
import profileSupportIcon from "../assets/profile-support.png";
import { apiFetchJson } from "../lib/api";
import { getIndicatorMeta } from "../lib/indicatorMeta";

const TIMEZONE_OPTIONS = [
  { id: "Europe/Kiev", city: "Kyiv", flag: "UA" },
  { id: "Europe/London", city: "London", flag: "GB" },
  { id: "Europe/Berlin", city: "Berlin", flag: "DE" },
  { id: "Europe/Moscow", city: "Moscow", flag: "RU" },
  { id: "America/New_York", city: "New York", flag: "US" },
  { id: "Asia/Dubai", city: "Dubai", flag: "AE" }
];

const PROFILE_TOP_ACTIONS = [
  { key: "history", fallback: "История", image: profileHistoryIcon },
  { key: "faq", fallback: "FAQ", image: profileFaqIcon }
];

const PROFILE_BOTTOM_ACTIONS = [
  { key: "support", fallback: "Поддержка", image: profileSupportIcon },
  { key: "notifications", fallback: "Уведомления", image: profileNotificationsIcon }
];

const FAQ_INDICATORS = [
  {
    code: "rsi",
    description: "Оценивает скорость и силу движения цены. Помогает замечать перегрев, ослабление импульса и дивергенции, но лучше работает вместе с трендом и уровнями."
  },
  {
    code: "stochastic_oscillator",
    description: "Показывает, где закрытие находится относительно недавнего диапазона. Полезен для поиска разворотов внутри боковика и откатов по тренду."
  },
  {
    code: "cci",
    description: "Сравнивает типичную цену со средней и показывает отклонение от нормального диапазона. Помогает видеть импульс, экстремумы и смену темпа."
  },
  {
    code: "williams_r",
    description: "Быстрый осциллятор перекупленности и перепроданности. Показывает положение закрытия относительно максимумов и минимумов выбранного периода."
  },
  {
    code: "macd",
    description: "Сравнивает быстрые и медленные EMA, чтобы показать трендовый импульс. Важны пересечения, гистограмма и расхождения с ценой."
  },
  {
    code: "ema_9_50_200",
    description: "Набор экспоненциальных средних для чтения короткого, среднего и долгого тренда. Стек EMA помогает понять направление и зоны отката."
  },
  {
    code: "adx",
    description: "Измеряет силу тренда, а не его направление. Вместе с DI+ и DI- помогает отличать трендовый рынок от шума."
  },
  {
    code: "atr",
    description: "Показывает средний реальный диапазон и текущую волатильность. Нужен для фильтра шума, оценки риска и размера защитного буфера."
  },
  {
    code: "bollinger_bands",
    description: "Волатильностный канал вокруг средней. Сжатие часто говорит о накоплении энергии, а касания границ помогают оценивать экстремумы."
  },
  {
    code: "keltner_channel",
    description: "Канал вокруг EMA, построенный через ATR. Хорошо показывает трендовые коридоры, пробои и откаты к средней линии."
  },
  {
    code: "supertrend",
    description: "Трендовый overlay на базе волатильности. Переключение линии помогает быстро видеть смену направления и рабочую сторону рынка."
  },
  {
    code: "parabolic_sar",
    description: "Точки Stop and Reverse помогают сопровождать тренд и видеть потенциальную смену направления. В боковике может давать много ложных сигналов."
  },
  {
    code: "vortex",
    description: "Сравнивает восходящее и нисходящее движение через линии VI+ и VI-. Помогает замечать зарождение или ослабление тренда."
  },
  {
    code: "momentum",
    description: "Показывает скорость изменения цены относительно прошлого значения. Полезен для оценки ускорения, затухания и подтверждения импульса."
  },
  {
    code: "rate_of_change",
    description: "Процентное изменение цены за выбранный период. Помогает видеть силу импульса и моменты, когда движение начинает выдыхаться."
  }
];

function getFaqCopy(lang, t) {
  const modeDisclaimer = t.home?.modeInfoDisclaimer || "Сигнал носит информационный характер и не является гарантией результата сделки.";
  const ru = {
    title: "FAQ",
    subtitle: "Короткие подсказки по SonicFX, режимам, индикаторам и новостям.",
    close: "Закрыть",
    back: "Назад",
    openTour: "Открыть обучение",
    readMore: "Подробнее",
    indicatorList: "Список индикаторов",
    howItHelps: "Как использовать",
    indicatorUseLine: "Фильтрует рыночное состояние и помогает понять, где тренд, импульс или волатильность подтверждают сценарий.",
    riskNote: modeDisclaimer,
    cards: {
      sonic: {
        title: "SonicFX",
        subtitle: "Быстрый тур по приложению",
        body: "Откройте онбординг заново: он покажет основные сценарии, даже если пользователь уже проходил обучение."
      },
      scanner: {
        title: t.home?.scannerInfoTitle || "SonicFX Scanner",
        subtitle: t.home?.signalModeScannerHint || "AI анализ графика",
        body: t.home?.scannerInfoBody || "Добавьте скриншот графика или ссылку на изображение, чтобы алгоритм разобрал структуру цены."
      },
      auto: {
        title: t.home?.autoInfoTitle || "SonicFX Auto",
        subtitle: t.home?.signalModeAutomaticHint || "Поток сигналов Live",
        body: t.home?.autoInfoBody || "Live-график анализируется в реальном времени с учетом текущего движения цены."
      },
      indicators: {
        title: t.home?.indicatorsInfoTitle || "SonicFX Indicators",
        subtitle: t.home?.signalModeIndicatorsHint || "Точные сигналы по индикаторам",
        body: t.home?.indicatorsInfoBody || "Выберите индикатор, тикер и экспирацию, чтобы построить сигнал по выбранной стратегии."
      },
      news: {
        title: "Новости",
        subtitle: "Календарь и рынок",
        body: "Раздел помогает заранее видеть события, которые могут резко усилить волатильность: ставки, инфляцию, занятость, выступления регуляторов и важные рыночные заголовки."
      }
    },
    newsGuide: [
      "Сначала смотрите время события и валюту: новости по USD сильнее влияют на пары с долларом, по EUR - на евро-пары.",
      "Перед важным событием рынок часто становится резким: лучше снижать риск и не открывать сигнал вслепую прямо на публикации.",
      "После выхода новости сравните факт, прогноз и предыдущее значение: сильное отклонение часто дает импульс, но первые минуты могут быть шумными."
    ],
    indicatorGuide: [
      "Индикатор не должен быть единственной причиной входа.",
      "Сильнее всего сигнал, когда индикатор совпадает с трендом, уровнем и поведением свечей.",
      "Если несколько индикаторов показывают одно и то же состояние рынка, уверенность сценария выше."
    ]
  };

  if (lang === "en") {
    return {
      ...ru,
      title: "FAQ",
      subtitle: "Short guides for SonicFX, modes, indicators, and news.",
      close: "Close",
      back: "Back",
      openTour: "Open tour",
      readMore: "Details",
      indicatorList: "Indicator list",
      howItHelps: "How to use it",
      indicatorUseLine: "It filters market state and helps understand where trend, momentum or volatility confirms the scenario.",
      cards: {
        ...ru.cards,
        sonic: { title: "SonicFX", subtitle: "Quick product tour", body: "Open onboarding again without changing the saved completion flag." },
        news: { title: "News", subtitle: "Calendar and market", body: "The section highlights events that may increase volatility: rates, inflation, jobs data, central-bank speeches, and important market headlines." }
      },
      newsGuide: [
        "Check event time and currency first: USD news affects dollar pairs most directly.",
        "Around major releases volatility can spike, so avoid blind entries at the exact publication moment.",
        "Compare actual, forecast and previous values; a strong surprise can create impulse, but the first minutes may be noisy."
      ],
      indicatorGuide: [
        "Do not use a single indicator as the only reason to enter.",
        "Signals are stronger when the indicator agrees with trend, level and candles.",
        "When several tools describe the same market state, the scenario is more reliable."
      ]
    };
  }

  if (lang === "uk") {
    return {
      ...ru,
      title: "FAQ",
      subtitle: "Короткі підказки по SonicFX, режимах, індикаторах і новинах.",
      close: "Закрити",
      back: "Назад",
      openTour: "Відкрити навчання",
      readMore: "Докладніше",
      indicatorList: "Список індикаторів",
      howItHelps: "Як використовувати",
      indicatorUseLine: "Фільтрує ринковий стан і допомагає зрозуміти, де тренд, імпульс або волатильність підтверджують сценарій.",
      cards: {
        ...ru.cards,
        sonic: { title: "SonicFX", subtitle: "Швидкий тур застосунком", body: "Відкрийте онбординг повторно: це не змінює позначку, що навчання вже пройдено." },
        news: { title: "Новини", subtitle: "Календар і ринок", body: "Розділ допомагає бачити події, які можуть різко підсилити волатильність: ставки, інфляцію, зайнятість, виступи регуляторів і важливі ринкові заголовки." }
      },
      newsGuide: [
        "Спочатку дивіться час події та валюту: новини по USD найсильніше впливають на пари з доларом.",
        "Перед важливою публікацією ринок часто стає різким, тому краще зменшувати ризик.",
        "Після виходу порівнюйте факт, прогноз і попереднє значення: сильне відхилення може дати імпульс, але перші хвилини бувають шумними."
      ]
    };
  }

  return ru;
}

function getInitials(user, fallback) {
  const source = [user?.first_name, user?.last_name, user?.tg_username].filter(Boolean).join(" ").trim();
  if (!source) return fallback;
  return source
    .split(/\s+/)
    .map((part) => part[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function getLocale(lang) {
  if (lang === "en") return "en-GB";
  if (lang === "uk") return "uk-UA";
  return "ru-RU";
}

function formatProfileDate(value, lang) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString(getLocale(lang), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatTimezoneNow(timeZone, lang) {
  try {
    return new Intl.DateTimeFormat(getLocale(lang), {
      timeZone,
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date());
  } catch {
    return "--:--";
  }
}

function formatTimezoneOffset(timeZone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset"
    }).formatToParts(new Date());
    const offset = parts.find((part) => part.type === "timeZoneName")?.value || "GMT";
    return offset.replace("GMT", "UTC");
  } catch {
    return "UTC";
  }
}

function getStatusMeta(tier, t) {
  if (tier === "vip") {
    return {
      label: t.profile.tierVip || "VIP",
      tone: "vip"
    };
  }
  if (tier === "pro") {
    return {
      label: t.profile.tierPro || "PRO",
      tone: "pro"
    };
  }
  return {
    label: t.profile.tierTrader || "Trader",
    tone: "trader"
  };
}

export default function ProfilePage({ t, user, notify, onUserUpdate, onThemePreview, onLangPreview, onOpenOnboarding }) {
  const [lang, setLang] = useState(user?.lang || "ru");
  const [theme, setTheme] = useState(user?.theme || "dark");
  const [timezone, setTimezone] = useState(user?.timezone || "Europe/Kiev");
  const [saving, setSaving] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [isTimezoneExpanded, setIsTimezoneExpanded] = useState(false);
  const [faqView, setFaqView] = useState("closed");
  const [selectedFaqIndicator, setSelectedFaqIndicator] = useState("");
  const settingsRequestRef = useRef(0);

  useEffect(() => {
    setLang(user?.lang || "ru");
    setTheme(user?.theme || "dark");
    setTimezone(user?.timezone || "Europe/Kiev");
    setAvatarFailed(false);
    setIsTimezoneExpanded(false);
  }, [user]);

  useEffect(() => {
    if (faqView === "closed") return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [faqView]);

  const profileName = useMemo(() => {
    const full = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
    return full || user?.tg_username || t.profile.nameFallback || "Trader";
  }, [t.profile.nameFallback, user]);

  const statusMeta = useMemo(
    () => getStatusMeta(user?.account_tier || "trader", t),
    [t, user?.account_tier]
  );

  const summaryCards = useMemo(
    () => [
      {
        key: "user_id",
        label: t.profile.userId || "Telegram ID",
        value: user?.user_id || "-"
      },
      {
        key: "username",
        label: t.profile.username || "Username",
        value: user?.tg_username ? `@${user.tg_username}` : "-"
      },
      {
        key: "balance",
        label: t.profile.balanceLabel || "Баланс",
        value: `$${Number(user?.deposit_amount || 0).toFixed(2)}`
      },
      {
        key: "joined",
        label: t.profile.joined || "Регистрация",
        value: formatProfileDate(user?.created_at, lang)
      }
    ],
    [lang, t, user]
  );

  const handleUpgradeStatus = () => {
    notify?.({
      type: "info",
      title: t.profile.upgradeStatus || "Повысить статус",
      message: t.profile.upgradeStatusSoon || "Скоро здесь появится апгрейд статуса."
    });
  };

  const handleProfileAction = (key) => {
    if (key === "faq") {
      setFaqView("home");
      setSelectedFaqIndicator("");
      return;
    }
    notify?.({
      type: "info",
      title: t.profile?.actions?.[key] || key,
      message: t.profile?.actionSoon || "Раздел скоро появится в приложении."
    });
  };

  const languageOptions = useMemo(
    () => [
      { id: "ru", label: t.profile.langRu || "Русский", flag: "RU" },
      { id: "en", label: t.profile.langEn || "English", flag: "GB" },
      { id: "uk", label: t.profile.langUk || "Українська", flag: "UA" }
    ],
    [t.profile.langEn, t.profile.langRu, t.profile.langUk]
  );

  const activeThemeMeta = useMemo(
    () => (
      theme === "light"
        ? { id: "light", symbol: "\u2600" }
        : { id: "dark", symbol: "\u263E" }
    ),
    [theme]
  );

  const timezoneOptions = useMemo(
    () => TIMEZONE_OPTIONS.map((item) => ({
      ...item,
      currentTime: formatTimezoneNow(item.id, lang),
      currentOffset: formatTimezoneOffset(item.id)
    })),
    [lang]
  );

  const selectedTimezoneOption = useMemo(
    () => timezoneOptions.find((item) => item.id === timezone) || timezoneOptions[0] || TIMEZONE_OPTIONS[0],
    [timezone, timezoneOptions]
  );

  const profileActions = useMemo(() => ({
    top: PROFILE_TOP_ACTIONS.map((item) => ({
      ...item,
      label: t.profile?.actions?.[item.key] || item.fallback
    })),
    bottom: PROFILE_BOTTOM_ACTIONS.map((item) => ({
      ...item,
      label: t.profile?.actions?.[item.key] || item.fallback
    }))
  }), [t.profile?.actions]);

  const faqCopy = useMemo(() => getFaqCopy(lang, t), [lang, t]);
  const faqIndicators = useMemo(
    () => FAQ_INDICATORS.map((item) => ({
      ...item,
      meta: getIndicatorMeta(item.code)
    })),
    []
  );
  const selectedIndicatorInfo = useMemo(
    () => faqIndicators.find((item) => item.code === selectedFaqIndicator) || null,
    [faqIndicators, selectedFaqIndicator]
  );
  const faqCards = useMemo(
    () => [
      { id: "sonic", marker: "SF", ...faqCopy.cards.sonic },
      { id: "scanner", marker: "SCN", ...faqCopy.cards.scanner },
      { id: "auto", marker: "AUTO", ...faqCopy.cards.auto },
      { id: "indicators", marker: "IND", ...faqCopy.cards.indicators },
      { id: "news", marker: "NEWS", ...faqCopy.cards.news }
    ],
    [faqCopy]
  );

  const handleFaqCardClick = (id) => {
    if (id === "sonic") {
      onOpenOnboarding?.();
      return;
    }
    if (id === "indicators") {
      setFaqView("indicators");
      setSelectedFaqIndicator("");
      return;
    }
    setFaqView(id);
    setSelectedFaqIndicator("");
  };

  const handleFaqBack = () => {
    if (faqView === "indicator") {
      setFaqView("indicators");
      setSelectedFaqIndicator("");
      return;
    }
    setFaqView("home");
    setSelectedFaqIndicator("");
  };

  const beginSettingsRequest = () => {
    settingsRequestRef.current += 1;
    return settingsRequestRef.current;
  };

  const saveSettings = async (payload, successMessage, requestId = beginSettingsRequest()) => {
    const data = await apiFetchJson("/api/user/settings", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (requestId === settingsRequestRef.current) {
      onUserUpdate?.(data?.user || user);
      notify?.({
        type: "success",
        title: t.profile.saved || "Настройки сохранены",
        message: t.profile.settingsSavedToast || "Изменения применены в приложении."
      });
    }
    return data;
  };

  const handleThemeToggle = async () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    const requestId = beginSettingsRequest();
    setTheme(nextTheme);
    onThemePreview?.(nextTheme);
    try {
      await saveSettings({ theme: nextTheme }, t.profile.saved || "Настройки сохранены", requestId);
    } catch (error) {
      if (requestId === settingsRequestRef.current) {
        setTheme(user?.theme || "dark");
        onThemePreview?.(user?.theme || "dark");
        notify?.({
          type: "error",
          title: t.profile.settingsErrorToast || "Не удалось сохранить настройки",
          message: error.message || "Failed"
        });
      }
    }
  };

  const handleLangSelect = async (nextLang) => {
    if (nextLang === lang) return;
    const requestId = beginSettingsRequest();
    setLang(nextLang);
    onLangPreview?.(nextLang);
    try {
      await saveSettings({ lang: nextLang }, t.profile.saved || "Настройки сохранены", requestId);
    } catch (error) {
      if (requestId === settingsRequestRef.current) {
        setLang(user?.lang || "ru");
        onLangPreview?.(user?.lang || "ru");
        notify?.({
          type: "error",
          title: t.profile.settingsErrorToast || "Не удалось сохранить настройки",
          message: error.message || "Failed"
        });
      }
    }
  };

  const handleSave = async () => {
    const requestId = beginSettingsRequest();
    setSaving(true);
    try {
      await saveSettings({ lang, theme, timezone }, t.profile.saved || "Настройки сохранены", requestId);
    } catch (error) {
      if (requestId === settingsRequestRef.current) {
        notify?.({
          type: "error",
          title: t.profile.settingsErrorToast || "Не удалось сохранить настройки",
          message: error.message || "Failed"
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="page page-profile page-profile-ref">
      <div className="card profile-hero">
        <div className={`profile-ribbon profile-ribbon-${statusMeta.tone}`}>
          <span>{statusMeta.label}</span>
        </div>
        <div className="profile-hero-top">
          <div className="profile-avatar-shell">
            {user?.photo_url && !avatarFailed ? (
              <img
                className="profile-avatar-image"
                src={user.photo_url}
                alt={profileName}
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <div className="profile-avatar-fallback">{getInitials(user, "SF")}</div>
            )}
          </div>

          <div className="profile-hero-copy">
            <h1 className="page-title">{profileName}</h1>
            <p>{user?.tg_username ? `@${user.tg_username}` : (t.profile.noUsername || "@username not set")}</p>
          </div>
        </div>

        <div className="profile-summary-grid compact">
          {summaryCards.map((item) => (
            <article className="profile-summary-card" key={item.key}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </div>

        <button type="button" className="profile-upgrade-btn" onClick={handleUpgradeStatus}>
          {t.profile.upgradeStatus || "Повысить статус"}
        </button>
      </div>

      <div className="profile-action-grid profile-action-grid-top" aria-label={t.profile.quickActions || "Быстрые действия"}>
        {profileActions.top.map((item) => (
          <button type="button" className="profile-action-tile" key={item.key} onClick={() => handleProfileAction(item.key)}>
            <span className="profile-action-icon">
              {item.image ? <img src={item.image} alt="" draggable="false" /> : item.icon}
            </span>
            <strong>{item.label}</strong>
          </button>
        ))}
      </div>

      <div className="profile-action-grid profile-action-grid-bottom" aria-label={t.profile.quickActions || "Быстрые действия"}>
        {profileActions.bottom.map((item) => (
          <button type="button" className="profile-action-tile" key={item.key} onClick={() => handleProfileAction(item.key)}>
            <span className="profile-action-icon">
              {item.image ? <img src={item.image} alt="" draggable="false" /> : item.icon}
            </span>
            <strong>{item.label}</strong>
          </button>
        ))}
      </div>

      {faqView !== "closed" && (
        <div
          className="profile-faq-modal-backdrop"
          role="presentation"
          onClick={() => {
            setFaqView("closed");
            setSelectedFaqIndicator("");
          }}
        >
          <section
            className="card profile-faq-panel profile-faq-modal"
            role="dialog"
            aria-modal="true"
            aria-label={faqCopy.title}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="profile-faq-head">
              <span className="profile-faq-kicker">{faqCopy.title}</span>
              <strong>
                {faqView === "home"
                  ? faqCopy.subtitle
                  : faqView === "indicators"
                  ? faqCopy.indicatorList
                  : faqView === "indicator" && selectedIndicatorInfo
                  ? selectedIndicatorInfo.meta.title
                  : faqCopy.cards[faqView]?.title || faqCopy.title}
              </strong>
              <div className="profile-faq-controls">
                {faqView !== "home" && (
                  <button type="button" className="profile-faq-ghost-btn" onClick={handleFaqBack}>
                    {faqCopy.back}
                  </button>
                )}
                <button
                  type="button"
                  className="profile-faq-ghost-btn"
                  onClick={() => {
                    setFaqView("closed");
                    setSelectedFaqIndicator("");
                  }}
                >
                  {faqCopy.close}
                </button>
              </div>
            </div>

            <div className="profile-faq-modal-scroll">
              {faqView === "home" && (
                <div className="profile-faq-grid">
                  {faqCards.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`profile-faq-card profile-faq-card-${item.id}`}
                      onClick={() => handleFaqCardClick(item.id)}
                    >
                      <span className="profile-faq-marker">{item.marker}</span>
                      <span className="profile-faq-card-copy">
                        <strong>{item.title}</strong>
                        <small>{item.subtitle}</small>
                        <span>{item.body}</span>
                      </span>
                      <em>{item.id === "sonic" ? faqCopy.openTour : faqCopy.readMore}</em>
                    </button>
                  ))}
                </div>
              )}

              {(faqView === "scanner" || faqView === "auto") && (
                <div className="profile-faq-detail">
                  <span className="profile-faq-marker large">{faqView === "scanner" ? "SCN" : "AUTO"}</span>
                  <h3>{faqCopy.cards[faqView].title}</h3>
                  <p>{faqCopy.cards[faqView].body}</p>
                  <div className="profile-faq-warning">{faqCopy.riskNote}</div>
                </div>
              )}

              {faqView === "news" && (
                <div className="profile-faq-detail">
                  <span className="profile-faq-marker large">NEWS</span>
                  <h3>{faqCopy.cards.news.title}</h3>
                  <p>{faqCopy.cards.news.body}</p>
                  <div className="profile-faq-note-list">
                    {faqCopy.newsGuide.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                  <div className="profile-faq-warning">{faqCopy.riskNote}</div>
                </div>
              )}

              {faqView === "indicators" && (
                <div className="profile-faq-indicators">
                  <div className="profile-faq-note-list">
                    {faqCopy.indicatorGuide.map((item) => (
                      <span key={item}>{item}</span>
                    ))}
                  </div>
                  <div className="profile-faq-indicator-grid">
                    {faqIndicators.map((item) => (
                      <button
                        type="button"
                        key={item.code}
                        className="profile-faq-indicator-card"
                        onClick={() => {
                          setSelectedFaqIndicator(item.code);
                          setFaqView("indicator");
                        }}
                      >
                        <span className={`indicator-inline-code tone-${item.meta.tone}`}>{item.meta.short}</span>
                        <strong>{item.meta.title}</strong>
                        <small>{item.description}</small>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {faqView === "indicator" && selectedIndicatorInfo && (
                <div className="profile-faq-detail">
                  <span className={`indicator-inline-code tone-${selectedIndicatorInfo.meta.tone}`}>
                    {selectedIndicatorInfo.meta.short}
                  </span>
                  <h3>{selectedIndicatorInfo.meta.title}</h3>
                  <p>{selectedIndicatorInfo.description}</p>
                  <div className="profile-faq-note-list">
                    <span>{faqCopy.howItHelps}: {faqCopy.indicatorUseLine}</span>
                    <span>{faqCopy.riskNote}</span>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      <div className="card profile-section profile-settings-shell">
        <div className="profile-section-head">
          <strong>{t.profile.settingsTitle || "Настройки"}</strong>
          <span>{t.profile.settingsHint || "Язык, тема и часовой пояс применяются сразу."}</span>
        </div>

        <div className="profile-settings-grid">
          <div className="profile-setting-block profile-setting-block-wide">
            <label className="field-label">{t.profile.timezone || "Часовой пояс"}</label>
            <div className="profile-timezone-selector">
              <button
                type="button"
                className={`profile-timezone-summary ${isTimezoneExpanded ? "expanded" : ""}`}
                onClick={() => setIsTimezoneExpanded((prev) => !prev)}
              >
                <span className="profile-timezone-summary-copy">
                  <span className="profile-timezone-summary-top">
                    <ReactCountryFlag svg countryCode={selectedTimezoneOption.flag} aria-hidden="true" className="profile-timezone-flag" />
                    <strong>{selectedTimezoneOption.city}</strong>
                  </span>
                  <span className="profile-timezone-summary-meta">
                    <span>{selectedTimezoneOption.id}</span>
                    <span>{selectedTimezoneOption.currentOffset} · {selectedTimezoneOption.currentTime}</span>
                  </span>
                </span>
                <span className="profile-timezone-summary-side">
                  <span className="profile-timezone-summary-state">
                    {isTimezoneExpanded
                      ? (t.profile.timezoneCollapse || "Свернуть")
                      : (t.profile.timezoneChoose || "Выбрать")}
                  </span>
                  <span className={`profile-timezone-chevron ${isTimezoneExpanded ? "expanded" : ""}`} aria-hidden="true" />
                </span>
              </button>

              {isTimezoneExpanded && (
                <div className="profile-timezone-grid">
                  {timezoneOptions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`profile-timezone-chip ${timezone === item.id ? "active" : ""}`}
                      onClick={() => {
                        setTimezone(item.id);
                        setIsTimezoneExpanded(false);
                      }}
                    >
                      <span className="profile-timezone-top">
                        <ReactCountryFlag svg countryCode={item.flag} aria-hidden="true" className="profile-timezone-flag" />
                        <span className="profile-timezone-city">{item.city}</span>
                      </span>
                      <span className="profile-timezone-zone">{item.id}</span>
                      <span className="profile-timezone-current-row">
                        <span className="profile-timezone-offset">{item.currentOffset}</span>
                        <span className="profile-timezone-current">
                          {(t.profile.timezoneCurrent || "Сейчас")}: {item.currentTime}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="profile-setting-block profile-setting-block-wide">
            <label className="field-label">{t.profile.lang || "Язык"}</label>
            <div className="profile-chip-group profile-chip-group-languages">
              {languageOptions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`profile-chip profile-chip-language ${lang === item.id ? "active" : ""}`}
                  onClick={() => handleLangSelect(item.id)}
                >
                  <ReactCountryFlag svg countryCode={item.flag} aria-hidden="true" className="profile-chip-flag" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="profile-setting-block profile-setting-block-wide">
            <div className="profile-theme-row">
              <label className="field-label">{t.profile.theme || "Тема"}</label>
              <button
                type="button"
                className={`profile-theme-switch ${theme === "dark" ? "is-dark" : "is-light"}`}
                onClick={handleThemeToggle}
                role="switch"
                aria-checked={theme === "dark"}
                aria-label={t.profile.theme || "Тема"}
              >
                <span className="profile-theme-switch-track">
                  <span className={`profile-theme-thumb ${activeThemeMeta.id}`} aria-hidden="true">
                    <span className={`profile-theme-badge ${activeThemeMeta.id}`}>{activeThemeMeta.symbol}</span>
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>

        <button className="primary-btn profile-save-btn" onClick={handleSave} disabled={saving}>
          {saving ? (t.profile.saving || "Saving...") : (t.profile.save || "Save")}
        </button>
      </div>
    </section>
  );
}
