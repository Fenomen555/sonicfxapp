import { useEffect, useMemo, useRef, useState } from "react";
import ReactCountryFlag from "react-country-flag";
import profileFaqIcon from "../assets/profile-faq.png";
import profileHistoryIcon from "../assets/profile-history.png";
import profileNotificationsIcon from "../assets/profile-notifications.png";
import profileSupportIcon from "../assets/profile-support.png";
import { apiFetch, apiFetchJson } from "../lib/api";
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

const SUPPORT_LINK_DEFAULTS = {
  channel_url: "https://t.me/+TthmjdpAkv5hNjdi",
  support_url: "https://t.me/WaySonic"
};

const NEWS_NOTIFICATION_DEFAULTS = {
  news_enabled: 0,
  economic_enabled: 1,
  market_enabled: 1,
  impact_high_enabled: 1,
  impact_medium_enabled: 1,
  impact_low_enabled: 1,
  lead_minutes: 15,
  lead_options: [5, 15, 30, 60]
};

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
    subtitle: "Выберите раздел",
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
      subtitle: "Choose a section",
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
      subtitle: "Оберіть розділ",
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

function getSupportCopy(lang) {
  const ru = {
    title: "Поддержка",
    subtitle: "Поможем быстро разобраться",
    faqLine: "Все ответы можно найти в FAQ.",
    channelLine: "Также загляните в наш Telegram-канал: там публикуем обновления, подсказки и важные новости по SonicFX.",
    contactLine: "Если остались вопросы, пишите нам напрямую.",
    channelButton: "Открыть канал",
    supportButton: "Написать в поддержку",
    close: "Закрыть"
  };
  if (lang === "en") {
    return {
      ...ru,
      title: "Support",
      subtitle: "Fast help when something is unclear",
      faqLine: "Most answers are available in FAQ.",
      channelLine: "You can also join our Telegram channel for updates, tips and important SonicFX news.",
      contactLine: "If you still have questions, message us directly.",
      channelButton: "Open channel",
      supportButton: "Message support",
      close: "Close"
    };
  }
  if (lang === "uk") {
    return {
      ...ru,
      title: "Підтримка",
      subtitle: "Допоможемо швидко розібратися",
      faqLine: "Всі відповіді можна знайти у FAQ.",
      channelLine: "Також відкрийте наш Telegram-канал: там публікуємо оновлення, підказки та важливі новини SonicFX.",
      contactLine: "Якщо питання залишились, напишіть нам напряму.",
      channelButton: "Відкрити канал",
      supportButton: "Написати в підтримку",
      close: "Закрити"
    };
  }
  return ru;
}

function normalizeSupportLinks(data) {
  return {
    channel_url: data?.channel_url || SUPPORT_LINK_DEFAULTS.channel_url,
    support_url: data?.support_url || SUPPORT_LINK_DEFAULTS.support_url
  };
}

function getNotificationsCopy(lang) {
  const ru = {
    title: "Уведомления",
    subtitle: "Новости в Telegram-боте",
    intro: "Включите напоминания, чтобы бот заранее присылал важные события экономического календаря и свежие рыночные новости.",
    masterOn: "Уведомления включены",
    masterOff: "Уведомления выключены",
    economic: "Экономический календарь",
    economicHint: "Ставки, инфляция, занятость и выступления регуляторов.",
    market: "Общерыночные новости",
    marketHint: "Свежие заголовки рынка по факту появления.",
    impactTitle: "Важность экономических новостей",
    impactHint: "Фильтр применяется к календарю. Для рыночных новостей важность не ограничивается.",
    impactHigh: "Высокая",
    impactMedium: "Средняя",
    impactLow: "Низкая",
    leadTitle: "Напоминать за",
    leadSuffix: "мин",
    leadHour: "1 час",
    save: "Сохранить",
    saving: "Сохраняем...",
    close: "Закрыть",
    saved: "Уведомления сохранены",
    savedMessage: "Бот будет использовать новые настройки.",
    error: "Не удалось сохранить уведомления",
    botHint: "Если бот еще не писал вам, откройте его и нажмите /start."
  };
  if (lang === "en") {
    return {
      ...ru,
      title: "Notifications",
      subtitle: "News in the Telegram bot",
      intro: "Enable reminders so the bot can send economic events in advance and fresh market headlines as they appear.",
      masterOn: "Notifications enabled",
      masterOff: "Notifications disabled",
      economic: "Economic calendar",
      economicHint: "Rates, inflation, employment and regulator speeches.",
      market: "Market news",
      marketHint: "Fresh market headlines as soon as they appear.",
      impactTitle: "Economic news impact",
      impactHint: "This filter applies to the calendar. Market news are sent without impact filtering.",
      impactHigh: "High",
      impactMedium: "Medium",
      impactLow: "Low",
      leadTitle: "Remind before",
      leadSuffix: "min",
      leadHour: "1 hour",
      save: "Save",
      saving: "Saving...",
      close: "Close",
      saved: "Notifications saved",
      savedMessage: "The bot will use the new settings.",
      error: "Could not save notifications",
      botHint: "If the bot has not messaged you yet, open it and tap /start."
    };
  }
  if (lang === "uk") {
    return {
      ...ru,
      title: "Сповіщення",
      subtitle: "Новини в Telegram-боті",
      intro: "Увімкніть нагадування, щоб бот завчасно надсилав важливі події економічного календаря та свіжі ринкові новини.",
      masterOn: "Сповіщення увімкнені",
      masterOff: "Сповіщення вимкнені",
      economic: "Економічний календар",
      economicHint: "Ставки, інфляція, зайнятість і виступи регуляторів.",
      market: "Загальноринкові новини",
      marketHint: "Свіжі ринкові заголовки одразу після появи.",
      impactTitle: "Важливість економічних новин",
      impactHint: "Фільтр працює для календаря. Ринкові новини надходять без обмеження за важливістю.",
      impactHigh: "Висока",
      impactMedium: "Середня",
      impactLow: "Низька",
      leadTitle: "Нагадувати за",
      leadSuffix: "хв",
      leadHour: "1 година",
      save: "Зберегти",
      saving: "Зберігаємо...",
      close: "Закрити",
      saved: "Сповіщення збережено",
      savedMessage: "Бот використовуватиме нові налаштування.",
      error: "Не вдалося зберегти сповіщення",
      botHint: "Якщо бот ще не писав вам, відкрийте його та натисніть /start."
    };
  }
  return ru;
}

function normalizeNewsNotificationSettings(data) {
  const leadOptions = Array.isArray(data?.lead_options) && data.lead_options.length
    ? data.lead_options.map((item) => Number(item)).filter(Boolean)
    : NEWS_NOTIFICATION_DEFAULTS.lead_options;
  const lead = leadOptions.includes(Number(data?.lead_minutes))
    ? Number(data.lead_minutes)
    : NEWS_NOTIFICATION_DEFAULTS.lead_minutes;
  return {
    news_enabled: Number(data?.news_enabled) === 1 ? 1 : 0,
    economic_enabled: data?.economic_enabled === undefined || Number(data.economic_enabled) === 1 ? 1 : 0,
    market_enabled: data?.market_enabled === undefined || Number(data.market_enabled) === 1 ? 1 : 0,
    impact_high_enabled: data?.impact_high_enabled === undefined || Number(data.impact_high_enabled) === 1 ? 1 : 0,
    impact_medium_enabled: data?.impact_medium_enabled === undefined || Number(data.impact_medium_enabled) === 1 ? 1 : 0,
    impact_low_enabled: data?.impact_low_enabled === undefined || Number(data.impact_low_enabled) === 1 ? 1 : 0,
    lead_minutes: lead,
    lead_options: leadOptions
  };
}

function openExternalLink(url) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
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
  const [isSupportOpen, setIsSupportOpen] = useState(false);
  const [supportLinks, setSupportLinks] = useState(SUPPORT_LINK_DEFAULTS);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [notificationSettings, setNotificationSettings] = useState(NEWS_NOTIFICATION_DEFAULTS);
  const [notificationDraft, setNotificationDraft] = useState(NEWS_NOTIFICATION_DEFAULTS);
  const [notificationsSaving, setNotificationsSaving] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState([]);
  const [historyStatus, setHistoryStatus] = useState("idle");
  const [historyPreviewUrls, setHistoryPreviewUrls] = useState({});
  const settingsRequestRef = useRef(0);

  useEffect(() => {
    setLang(user?.lang || "ru");
    setTheme(user?.theme || "dark");
    setTimezone(user?.timezone || "Europe/Kiev");
    setAvatarFailed(false);
    setIsTimezoneExpanded(false);
  }, [user]);

  useEffect(() => {
    if (faqView === "closed" && !isSupportOpen && !isNotificationsOpen && !isHistoryOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [faqView, isSupportOpen, isNotificationsOpen, isHistoryOpen]);

  useEffect(() => {
    let isActive = true;
    apiFetchJson("/api/support/links")
      .then((data) => {
        if (isActive) setSupportLinks(normalizeSupportLinks(data));
      })
      .catch(() => {
        if (isActive) setSupportLinks(SUPPORT_LINK_DEFAULTS);
      });
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;
    apiFetchJson("/api/user/news-notifications")
      .then((data) => {
        if (!isActive) return;
        const nextSettings = normalizeNewsNotificationSettings(data);
        setNotificationSettings(nextSettings);
        setNotificationDraft(nextSettings);
      })
      .catch(() => {
        if (!isActive) return;
        setNotificationSettings(NEWS_NOTIFICATION_DEFAULTS);
        setNotificationDraft(NEWS_NOTIFICATION_DEFAULTS);
      });
    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!isHistoryOpen) return undefined;
    let isActive = true;
    const objectUrls = [];

    async function loadHistory() {
      setHistoryStatus("loading");
      setHistoryPreviewUrls((prev) => {
        Object.values(prev).forEach((url) => URL.revokeObjectURL(url));
        return {};
      });
      try {
        const data = await apiFetchJson("/api/analysis/history?limit=20");
        if (!isActive) return;
        const items = Array.isArray(data?.items) ? data.items.filter(Boolean) : [];
        setHistoryItems(items);
        setHistoryStatus("ready");

        const previews = {};
        await Promise.all(items.map(async (item) => {
          if (!item?.preview_path || !item?.upload_id) return;
          try {
            const response = await apiFetch(item.preview_path);
            if (!response.ok) return;
            const blob = await response.blob();
            if (!isActive) return;
            const objectUrl = URL.createObjectURL(blob);
            objectUrls.push(objectUrl);
            previews[item.id] = objectUrl;
          } catch {
            // Archived or missing previews are rendered as compact placeholders.
          }
        }));
        if (isActive) {
          setHistoryPreviewUrls(previews);
        }
      } catch {
        if (!isActive) return;
        setHistoryItems([]);
        setHistoryStatus("error");
      }
    }

    loadHistory();

    return () => {
      isActive = false;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [isHistoryOpen]);

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
        key: "trader_id",
        label: t.profile.traderId || "Trader ID",
        value: user?.trader_id || "-"
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
    if (key === "history") {
      setIsHistoryOpen(true);
      return;
    }
    if (key === "faq") {
      setFaqView("home");
      setSelectedFaqIndicator("");
      return;
    }
    if (key === "support") {
      setIsSupportOpen(true);
      return;
    }
    if (key === "notifications") {
      setNotificationDraft(notificationSettings);
      setIsNotificationsOpen(true);
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
  const supportCopy = useMemo(() => getSupportCopy(lang), [lang]);
  const notificationsCopy = useMemo(() => getNotificationsCopy(lang), [lang]);
  const historyCopy = useMemo(() => getHistoryCopy(lang), [lang]);
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

  const handleNotificationDraftChange = (key, value) => {
    setNotificationDraft((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const handleSaveNotifications = async () => {
    setNotificationsSaving(true);
    try {
      const data = await apiFetchJson("/api/user/news-notifications", {
        method: "POST",
        body: JSON.stringify({
          news_enabled: notificationDraft.news_enabled,
          economic_enabled: notificationDraft.economic_enabled,
          market_enabled: notificationDraft.market_enabled,
          impact_high_enabled: notificationDraft.impact_high_enabled,
          impact_medium_enabled: notificationDraft.impact_medium_enabled,
          impact_low_enabled: notificationDraft.impact_low_enabled,
          lead_minutes: notificationDraft.lead_minutes
        })
      });
      const nextSettings = normalizeNewsNotificationSettings(data?.settings || data);
      setNotificationSettings(nextSettings);
      setNotificationDraft(nextSettings);
      notify?.({
        type: "success",
        title: notificationsCopy.saved,
        message: notificationsCopy.savedMessage
      });
    } catch (error) {
      notify?.({
        type: "error",
        title: notificationsCopy.error,
        message: error.message || "Failed"
      });
    } finally {
      setNotificationsSaving(false);
    }
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

      {isHistoryOpen && (
        <div
          className="profile-faq-modal-backdrop"
          role="presentation"
          onClick={() => setIsHistoryOpen(false)}
        >
          <section
            className="card profile-faq-panel profile-faq-modal profile-history-modal"
            role="dialog"
            aria-modal="true"
            aria-label={historyCopy.title}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="profile-faq-head profile-history-head">
              <span className="profile-faq-kicker">{historyCopy.title}</span>
              <strong>{historyCopy.subtitle}</strong>
            </div>

            <div className="profile-history-list profile-faq-modal-scroll">
              {historyStatus === "loading" && (
                <div className="profile-history-empty">{historyCopy.loading}</div>
              )}
              {historyStatus === "error" && (
                <div className="profile-history-empty error">{historyCopy.error}</div>
              )}
              {historyStatus === "ready" && historyItems.length === 0 && (
                <div className="profile-history-empty">
                  <strong>{historyCopy.empty}</strong>
                  <span>{historyCopy.emptyHint}</span>
                </div>
              )}
              {historyItems.map((item) => {
                const tone = getHistorySignalTone(item.signal);
                const previewUrl = historyPreviewUrls[item.id];
                return (
                  <article className={`profile-history-card tone-${tone}`} key={item.id}>
                    <div className="profile-history-media">
                      {previewUrl ? (
                        <img src={previewUrl} alt="" />
                      ) : (
                        <span>{item.is_archived ? historyCopy.archived : historyCopy.noPreview}</span>
                      )}
                    </div>
                    <div className="profile-history-main">
                      <div className="profile-history-topline">
                        <span className="profile-history-source">
                          {item.source_type === "auto" ? historyCopy.auto : historyCopy.scanner}
                        </span>
                        <span className={`profile-history-signal signal-${tone}`}>
                          {item.signal || "NO TRADE"}
                        </span>
                      </div>
                      <strong>{formatHistoryAsset(item.asset, item.market_mode)}</strong>
                      <p>{item.comment || item.result?.comment || "—"}</p>
                      <div className="profile-history-meta-grid">
                        <span>
                          <small>{historyCopy.price}</small>
                          <b>{formatHistoryPrice(item.entry_price)}</b>
                        </span>
                        <span>
                          <small>{historyCopy.confidence}</small>
                          <b>{Number(item.confidence || 0)}%</b>
                        </span>
                        <span>
                          <small>{historyCopy.expiration}</small>
                          <b>{item.selected_expiration || "—"}</b>
                          {Number(item.expiration_minutes || 0) > 0 ? (
                            <em>{historyCopy.aiExpiration}: {item.expiration_minutes} мин</em>
                          ) : null}
                        </span>
                      </div>
                      <time>{formatProfileDate(item.created_at, lang)}</time>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="profile-faq-controls profile-faq-footer">
              <button type="button" className="profile-faq-ghost-btn" onClick={() => setIsHistoryOpen(false)}>
                {historyCopy.close}
              </button>
            </div>
          </section>
        </div>
      )}

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
                      <span className="profile-faq-card-copy">
                        <strong>{item.title}</strong>
                        <small>{item.subtitle}</small>
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

            <div className="profile-faq-controls profile-faq-footer">
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
          </section>
        </div>
      )}

      {isSupportOpen && (
        <div
          className="profile-faq-modal-backdrop"
          role="presentation"
          onClick={() => setIsSupportOpen(false)}
        >
          <section
            className="card profile-faq-panel profile-faq-modal profile-support-modal"
            role="dialog"
            aria-modal="true"
            aria-label={supportCopy.title}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="profile-faq-head profile-support-head">
              <span className="profile-faq-kicker">{supportCopy.title}</span>
              <strong>{supportCopy.subtitle}</strong>
            </div>

            <div className="profile-support-body">
              <p>{supportCopy.faqLine}</p>
              <p>{supportCopy.channelLine}</p>
              <button
                type="button"
                className="profile-support-link-button primary"
                onClick={() => openExternalLink(supportLinks.channel_url)}
              >
                {supportCopy.channelButton}
              </button>
              <p>{supportCopy.contactLine}</p>
              <button
                type="button"
                className="profile-support-link-button"
                onClick={() => openExternalLink(supportLinks.support_url)}
              >
                {supportCopy.supportButton}
              </button>
            </div>

            <div className="profile-faq-controls profile-faq-footer">
              <button type="button" className="profile-faq-ghost-btn" onClick={() => setIsSupportOpen(false)}>
                {supportCopy.close}
              </button>
            </div>
          </section>
        </div>
      )}

      {isNotificationsOpen && (
        <div
          className="profile-faq-modal-backdrop"
          role="presentation"
          onClick={() => setIsNotificationsOpen(false)}
        >
          <section
            className="card profile-faq-panel profile-faq-modal profile-notifications-modal"
            role="dialog"
            aria-modal="true"
            aria-label={notificationsCopy.title}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="profile-faq-head profile-notifications-head">
              <span className="profile-faq-kicker">{notificationsCopy.title}</span>
              <strong>{notificationsCopy.subtitle}</strong>
            </div>

            <div className="profile-notifications-body profile-faq-modal-scroll">
              <p>{notificationsCopy.intro}</p>

              <button
                type="button"
                className={`profile-notification-master ${notificationDraft.news_enabled ? "active" : ""}`}
                onClick={() => handleNotificationDraftChange("news_enabled", notificationDraft.news_enabled ? 0 : 1)}
                role="switch"
                aria-checked={notificationDraft.news_enabled === 1}
              >
                <span>
                  <strong>{notificationDraft.news_enabled ? notificationsCopy.masterOn : notificationsCopy.masterOff}</strong>
                  <small>{notificationsCopy.botHint}</small>
                </span>
                <i aria-hidden="true" />
              </button>

              <div className="profile-notification-feed-grid">
                {[
                  {
                    key: "economic_enabled",
                    title: notificationsCopy.economic,
                    hint: notificationsCopy.economicHint
                  },
                  {
                    key: "market_enabled",
                    title: notificationsCopy.market,
                    hint: notificationsCopy.marketHint
                  }
                ].map((item) => (
                  <button
                    type="button"
                    key={item.key}
                    className={`profile-notification-feed ${notificationDraft[item.key] ? "active" : ""}`}
                    onClick={() => handleNotificationDraftChange(item.key, notificationDraft[item.key] ? 0 : 1)}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.hint}</span>
                  </button>
                ))}
              </div>

              {notificationDraft.economic_enabled === 1 && (
                <div className="profile-notification-impact">
                  <span>{notificationsCopy.impactTitle}</span>
                  <small>{notificationsCopy.impactHint}</small>
                  <div className="profile-notification-impact-grid">
                    {[
                      { key: "impact_high_enabled", label: notificationsCopy.impactHigh, tone: "high" },
                      { key: "impact_medium_enabled", label: notificationsCopy.impactMedium, tone: "medium" },
                      { key: "impact_low_enabled", label: notificationsCopy.impactLow, tone: "low" }
                    ].map((item) => (
                      <button
                        type="button"
                        key={item.key}
                        className={`profile-notification-impact-chip tone-${item.tone} ${notificationDraft[item.key] ? "active" : ""}`}
                        onClick={() => handleNotificationDraftChange(item.key, notificationDraft[item.key] ? 0 : 1)}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="profile-notification-lead">
                <span>{notificationsCopy.leadTitle}</span>
                <div className="profile-notification-lead-grid">
                  {(notificationDraft.lead_options || NEWS_NOTIFICATION_DEFAULTS.lead_options).map((minutes) => (
                    <button
                      type="button"
                      key={minutes}
                      className={notificationDraft.lead_minutes === minutes ? "active" : ""}
                      onClick={() => handleNotificationDraftChange("lead_minutes", minutes)}
                    >
                      {minutes === 60 ? notificationsCopy.leadHour : `${minutes} ${notificationsCopy.leadSuffix}`}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="profile-faq-controls profile-faq-footer">
              <button
                type="button"
                className="profile-support-link-button primary profile-notifications-save"
                onClick={handleSaveNotifications}
                disabled={notificationsSaving}
              >
                {notificationsSaving ? notificationsCopy.saving : notificationsCopy.save}
              </button>
              <button type="button" className="profile-faq-ghost-btn" onClick={() => setIsNotificationsOpen(false)}>
                {notificationsCopy.close}
              </button>
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

function formatHistoryPrice(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "—";
  return numeric.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

function formatHistoryAsset(asset, marketMode) {
  const normalizedAsset = String(asset || "").trim() || "не определен";
  const normalizedMode = String(marketMode || "").trim().toUpperCase();
  if (normalizedAsset === "не определен") return normalizedAsset;
  if (normalizedMode === "OTC" && !/\bOTC\b/i.test(normalizedAsset)) return `${normalizedAsset} OTC`;
  return normalizedAsset;
}

function getHistorySignalTone(signal) {
  const value = String(signal || "").trim().toLowerCase();
  if (value === "buy") return "buy";
  if (value === "sell") return "sell";
  return "neutral";
}

function getHistoryCopy(lang) {
  const ru = {
    title: "История",
    subtitle: "Последние 20 анализов",
    empty: "История пока пустая",
    emptyHint: "Запустите анализ скрина или live-графика, и сделка появится здесь.",
    loading: "Загружаем историю...",
    error: "Не удалось загрузить историю",
    close: "Закрыть",
    archived: "Файл в архиве",
    noPreview: "Превью недоступно",
    price: "Цена",
    confidence: "Уверенность",
    expiration: "Экспирация",
    userExpiration: "выбрано",
    aiExpiration: "ИИ",
    scanner: "Скрин",
    auto: "Live"
  };
  if (lang === "en") {
    return {
      ...ru,
      title: "History",
      subtitle: "Last 20 analyses",
      empty: "History is empty",
      emptyHint: "Run a screenshot or live chart analysis and it will appear here.",
      loading: "Loading history...",
      error: "Could not load history",
      close: "Close",
      archived: "File archived",
      noPreview: "Preview unavailable",
      price: "Price",
      confidence: "Confidence",
      expiration: "Expiration",
      userExpiration: "selected",
      aiExpiration: "AI",
      scanner: "Screenshot",
      auto: "Live"
    };
  }
  if (lang === "uk") {
    return {
      ...ru,
      title: "Історія",
      subtitle: "Останні 20 аналізів",
      empty: "Історія поки порожня",
      emptyHint: "Запустіть аналіз скрина або live-графіка, і угода з'явиться тут.",
      loading: "Завантажуємо історію...",
      error: "Не вдалося завантажити історію",
      close: "Закрити",
      archived: "Файл в архіві",
      noPreview: "Прев'ю недоступне",
      price: "Ціна",
      confidence: "Впевненість",
      expiration: "Експірація",
      userExpiration: "обрано",
      aiExpiration: "ШІ",
      scanner: "Скрин",
      auto: "Live"
    };
  }
  return ru;
}
