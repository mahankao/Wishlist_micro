import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { API_BASE_URL, apiRequest, buildWsUrl, clearToken, getToken, setToken } from "./api";

type UserDto = {
  id: string;
  email: string;
  displayName: string;
  createdAtUtc: string;
};

type AuthResponse = {
  accessToken: string;
  expiresAtUtc: string;
  user: UserDto;
};

type WishlistItem = {
  id: string;
  title: string;
  url?: string | null;
  price?: number | null;
  comment?: string | null;
  isReserved: boolean;
  reservedAtUtc?: string | null;
  createdAtUtc: string;
};

type WishlistResponse = {
  id: string;
  ownerUserId: string;
  title: string;
  description?: string | null;
  shareToken: string;
  createdAtUtc: string;
  items: WishlistItem[];
};

type PublicWishlistResponse = {
  id: string;
  title: string;
  description?: string | null;
  items: WishlistItem[];
};

type MyReservation = {
  wishlistId: string;
  wishlistTitle: string;
  itemId: string;
  itemTitle: string;
  reservedAtUtc: string;
};

type ChatMessage = {
  id: string;
  senderUserId: string;
  senderDisplayName: string;
  author: string;
  text: string;
  createdAtUtc: string;
  isMine: boolean;
};

type NotificationInboxEvent = {
  eventId: string;
  eventType: string;
  wishlistId: string;
  itemId: string;
  ownerUserId: string;
  actorUserId: string;
  occurredAtUtc: string;
  receivedAtUtc: string;
};

function pretty(value: unknown): string {
  // Debug-блоки в UI показывают сырой ответ backend-а, чтобы на защите было видно, что вернул API.
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatPrice(value?: number | null): string {
  if (value === null || value === undefined) return "Цена не указана";
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency: "RUB",
    maximumFractionDigits: 0
  }).format(value);
}

function formatDate(value?: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function App() {
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerDisplayName, setRegisterDisplayName] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [me, setMe] = useState<UserDto | null>(null);
  const [token, setTokenState] = useState(getToken());
  const [authSuccess, setAuthSuccess] = useState("");
  const [authError, setAuthError] = useState("");
  const [authDebug, setAuthDebug] = useState<unknown>(null);

  const [wishlistTitle, setWishlistTitle] = useState("Birthday");
  const [wishlistDescription, setWishlistDescription] = useState("Demo wishlist");
  const [createdWishlist, setCreatedWishlist] = useState<WishlistResponse | null>(null);
  const [wishlistLookupId, setWishlistLookupId] = useState("");
  const [wishlistSectionSuccess, setWishlistSectionSuccess] = useState("");
  const [wishlistSectionError, setWishlistSectionError] = useState("");
  const [wishlistDebug, setWishlistDebug] = useState<unknown>(null);

  const [itemTitle, setItemTitle] = useState("LEGO Set");
  const [itemUrl, setItemUrl] = useState("https://example.com/lego");
  const [itemPrice, setItemPrice] = useState("99.99");
  const [itemComment, setItemComment] = useState("Any color");

  const [publicShareToken, setPublicShareToken] = useState("");
  const [publicWishlist, setPublicWishlist] = useState<PublicWishlistResponse | null>(null);
  const [selectedPublicItemId, setSelectedPublicItemId] = useState("");
  const [publicSuccess, setPublicSuccess] = useState("");
  const [publicError, setPublicError] = useState("");
  const [publicDebug, setPublicDebug] = useState<unknown>(null);

  const [reservations, setReservations] = useState<MyReservation[]>([]);
  const [reservationsSuccess, setReservationsSuccess] = useState("");
  const [reservationsError, setReservationsError] = useState("");
  const [reservationsDebug, setReservationsDebug] = useState<unknown>(null);

  const [chatWishlistId, setChatWishlistId] = useState("");
  const [chatItemId, setChatItemId] = useState("");
  const [chatShareToken, setChatShareToken] = useState("");
  const [chatText, setChatText] = useState("Hello from demo UI");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatSuccess, setChatSuccess] = useState("");
  const [chatError, setChatError] = useState("");
  const [chatDebug, setChatDebug] = useState<unknown>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const [inboxEvents, setInboxEvents] = useState<NotificationInboxEvent[]>([]);
  const [inboxSuccess, setInboxSuccess] = useState("");
  const [inboxError, setInboxError] = useState("");
  const [inboxDebug, setInboxDebug] = useState<unknown>(null);

  const publicLink = useMemo(() => {
    // Public link удобен для копирования, а shareToken отдельно нужен форме публичного wishlist.
    if (!createdWishlist?.shareToken) return "";
    return `${API_BASE_URL.replace(/\/$/, "")}/wishlists/public/${createdWishlist.shareToken}`;
  }, [createdWishlist]);

  const selectedPublicItem = useMemo(() => {
    return publicWishlist?.items.find((item) => item.id === selectedPublicItemId) ?? null;
  }, [publicWishlist, selectedPublicItemId]);

  const selectedChatItem = useMemo(() => {
    return publicWishlist?.items.find((item) => item.id === chatItemId)
      ?? createdWishlist?.items.find((item) => item.id === chatItemId)
      ?? null;
  }, [createdWishlist, publicWishlist, chatItemId]);

  async function copyPublicLink() {
    if (!publicLink) return;
    await navigator.clipboard.writeText(publicLink);
    setWishlistSectionSuccess("Публичная ссылка скопирована.");
  }

  useEffect(() => {
    // Если токен уже есть в localStorage, при открытии страницы сразу подгружаем текущего пользователя.
    if (token) {
      loadMe().catch(() => void 0);
    } else {
      setMe(null);
    }
  }, [token]);

  async function loadMe() {
    const response = await apiRequest<UserDto>("/users/me");
    setMe(response);
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setAuthError("");
    setAuthSuccess("");
    try {
      const response = await apiRequest<UserDto>("/auth/register", {
        method: "POST",
        auth: false,
        body: { email: registerEmail, password: registerPassword, displayName: registerDisplayName }
      });
      setAuthSuccess("User registered.");
      setAuthDebug(response);
    } catch (error) {
      setAuthError((error as Error).message);
      setAuthDebug(error);
    }
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setAuthError("");
    setAuthSuccess("");
    try {
      const response = await apiRequest<AuthResponse>("/auth/login", {
        method: "POST",
        auth: false,
        body: { email: loginEmail, password: loginPassword }
      });
      setToken(response.accessToken);
      setTokenState(response.accessToken);
      setMe(response.user);
      setAuthSuccess("Logged in.");
      setAuthDebug(response);
    } catch (error) {
      setAuthError((error as Error).message);
      setAuthDebug(error);
    }
  }

  function handleLogout() {
    clearToken();
    setTokenState("");
    setMe(null);
    setAuthSuccess("Logged out.");
    setAuthError("");
    setAuthDebug(null);
  }

  async function handleCreateWishlist(e: FormEvent) {
    e.preventDefault();
    setWishlistSectionError("");
    setWishlistSectionSuccess("");
    try {
      const response = await apiRequest<WishlistResponse>("/wishlists", {
        method: "POST",
        body: { title: wishlistTitle, description: wishlistDescription || null }
      });
      setCreatedWishlist(response);
      // После создания wishlist сразу заполняем связанные поля для публичного доступа и чата.
      setWishlistLookupId(response.id);
      setPublicShareToken(response.shareToken);
      setChatWishlistId(response.id);
      setChatShareToken(response.shareToken);
      setWishlistSectionSuccess("Wishlist created.");
      setWishlistDebug(response);
    } catch (error) {
      setWishlistSectionError((error as Error).message);
      setWishlistDebug(error);
    }
  }

  async function handleAddItem(e: FormEvent) {
    e.preventDefault();
    const targetWishlistId = createdWishlist?.id || wishlistLookupId;
    if (!targetWishlistId) {
      setWishlistSectionError("Create or load wishlist first.");
      return;
    }

    setWishlistSectionError("");
    setWishlistSectionSuccess("");
    try {
      const response = await apiRequest<WishlistItem>(`/wishlists/${targetWishlistId}/items`, {
        method: "POST",
        body: {
          title: itemTitle,
          url: itemUrl || null,
          price: itemPrice ? Number(itemPrice) : null,
          comment: itemComment || null
        }
      });
      setWishlistSectionSuccess("Item added.");
      setWishlistDebug(response);
      await loadMyWishlist(targetWishlistId);
    } catch (error) {
      setWishlistSectionError((error as Error).message);
      setWishlistDebug(error);
    }
  }

  async function loadMyWishlist(id?: string) {
    const targetId = id || wishlistLookupId;
    if (!targetId) {
      setWishlistSectionError("Wishlist id is required.");
      return;
    }

    setWishlistSectionError("");
    setWishlistSectionSuccess("");
    try {
      const response = await apiRequest<WishlistResponse>(`/wishlists/${targetId}`);
      setCreatedWishlist(response);
      setPublicShareToken(response.shareToken);
      setChatWishlistId(response.id);
      setChatShareToken(response.shareToken);
      setWishlistSectionSuccess("Wishlist loaded.");
      setWishlistDebug(response);
    } catch (error) {
      setWishlistSectionError((error as Error).message);
      setWishlistDebug(error);
    }
  }

  async function loadPublicWishlist() {
    if (!publicShareToken) {
      setPublicError("Share token is required.");
      return;
    }

    setPublicError("");
    setPublicSuccess("");
    try {
      const response = await apiRequest<PublicWishlistResponse>(`/wishlists/public/${publicShareToken}`, { auth: false });
      setPublicWishlist(response);
      setPublicSuccess("Public wishlist loaded.");
      setPublicDebug(response);
      const first = response.items[0];
      if (first?.id) {
        // Первый item автоматически выбирается для сценариев reserve и chat.
        setSelectedPublicItemId(first.id);
        setChatItemId(first.id);
      }
    } catch (error) {
      setPublicError((error as Error).message);
      setPublicDebug(error);
    }
  }

  async function reserveSelectedItem() {
    if (!publicWishlist?.id || !selectedPublicItemId) {
      setPublicError("Load public wishlist and select item.");
      return;
    }

    setPublicError("");
    setPublicSuccess("");
    try {
      const response = await apiRequest<WishlistItem>(
        `/wishlists/${publicWishlist.id}/items/${selectedPublicItemId}/reserve`,
        { method: "POST" }
      );
      setPublicSuccess("Item reserved.");
      setPublicDebug(response);
      await loadPublicWishlist();
    } catch (error) {
      setPublicError((error as Error).message);
      setPublicDebug(error);
    }
  }

  async function unreserveSelectedItem() {
    if (!publicWishlist?.id || !selectedPublicItemId) {
      setPublicError("Load public wishlist and select item.");
      return;
    }

    setPublicError("");
    setPublicSuccess("");
    try {
      const response = await apiRequest<WishlistItem>(
        `/wishlists/${publicWishlist.id}/items/${selectedPublicItemId}/unreserve`,
        { method: "POST" }
      );
      setPublicSuccess("Item unreserved.");
      setPublicDebug(response);
      await loadPublicWishlist();
    } catch (error) {
      setPublicError((error as Error).message);
      setPublicDebug(error);
    }
  }

  async function loadReservations() {
    setReservationsError("");
    setReservationsSuccess("");
    try {
      const response = await apiRequest<MyReservation[]>("/wishlists/reservations/me");
      setReservations(response);
      setReservationsSuccess("Reservations loaded.");
      setReservationsDebug(response);
    } catch (error) {
      setReservationsError((error as Error).message);
      setReservationsDebug(error);
    }
  }

  async function loadChatMessages() {
    if (!chatWishlistId || !chatItemId || !chatShareToken) {
      setChatError("wishlistId, itemId and shareToken are required.");
      return;
    }

    setChatError("");
    setChatSuccess("");
    try {
      const query = new URLSearchParams({
        wishlistId: chatWishlistId,
        itemId: chatItemId,
        shareToken: chatShareToken
      });
      const response = await apiRequest<ChatMessage[]>(`/chat/messages?${query.toString()}`);
      setChatMessages(response);
      setChatSuccess("Chat history loaded.");
      setChatDebug(response);
    } catch (error) {
      setChatError((error as Error).message);
      setChatDebug(error);
    }
  }

  async function sendChatMessage(e: FormEvent) {
    e.preventDefault();
    if (!chatWishlistId || !chatItemId || !chatShareToken) {
      setChatError("wishlistId, itemId and shareToken are required.");
      return;
    }

    setChatError("");
    setChatSuccess("");
    try {
      const response = await apiRequest<ChatMessage>("/chat/messages", {
        method: "POST",
        body: {
          wishlistId: chatWishlistId,
          itemId: chatItemId,
          shareToken: chatShareToken,
          text: chatText
        }
      });
      setChatMessages((prev) => [...prev, response]);
      setChatSuccess("Message sent via REST.");
      setChatDebug(response);
    } catch (error) {
      setChatError((error as Error).message);
      setChatDebug(error);
    }
  }

  function connectChatWebSocket() {
    const tokenValue = getToken();
    if (!tokenValue) {
      setChatError("Login first to open WebSocket.");
      return;
    }
    if (!chatWishlistId || !chatItemId || !chatShareToken) {
      setChatError("wishlistId, itemId and shareToken are required.");
      return;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    const wsUrl = buildWsUrl("/chat/ws", {
      wishlistId: chatWishlistId,
      itemId: chatItemId,
      shareToken: chatShareToken,
      access_token: tokenValue
    });

    // WebSocket нужен для live-чата; REST-отправка оставлена рядом как запасной и проверочный сценарий.
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setWsConnected(true);
      setChatSuccess("WebSocket connected.");
      setChatError("");
    };
    ws.onclose = () => {
      setWsConnected(false);
    };
    ws.onerror = () => {
      setChatError("WebSocket error. REST chat still works.");
    };
    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ChatMessage;
        setChatMessages((prev) => [...prev, message]);
      } catch {
        // Некорректные WebSocket-сообщения игнорируются, чтобы UI не падал из-за одного плохого payload.
      }
    };
  }

  function disconnectChatWebSocket() {
    wsRef.current?.close();
    wsRef.current = null;
    setWsConnected(false);
  }

  async function loadInbox() {
    setInboxError("");
    setInboxSuccess("");
    try {
      const response = await apiRequest<NotificationInboxEvent[]>("/notifications/inbox", { auth: false });
      setInboxEvents(response);
      setInboxSuccess("Notification inbox loaded.");
      setInboxDebug(response);
    } catch (error) {
      setInboxError((error as Error).message);
      setInboxDebug(error);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="Wishlist home">
          <span className="brand-mark">W</span>
          WishNest
        </a>
        <nav className="nav-links" aria-label="Основная навигация">
          <a href="#create">Создать</a>
          <a href="#public">Публичный список</a>
          <a href="#chat">Вопросы</a>
        </nav>
        <div className="user-chip">
          {me ? `${me.displayName || "Пользователь"} · ${me.email}` : "Гость"}
        </div>
      </header>

      <main id="home" className="page">
        <section className="hero-section">
          <div className="hero-copy">
            <p className="eyebrow">Онлайн-вишлист для подарков</p>
            <h1>Соберите желания в один аккуратный список</h1>
            <p className="hero-text">
              Создавайте wishlist, добавляйте ссылки и цены, отправляйте публичную ссылку друзьям и получайте только нужные подарки.
            </p>
            <div className="hero-actions">
              <a className="button primary" href="#create">Создать wishlist</a>
              <a className="button ghost" href="#public">Открыть по ссылке</a>
            </div>
          </div>
          <div className="hero-preview" aria-label="Пример wishlist">
            <div className="preview-card large">
              <span className="preview-badge">Birthday wishlist</span>
              <h3>{createdWishlist?.title || "Подарки на день рождения"}</h3>
              <p>{createdWishlist?.description || "Все идеи, ссылки и пожелания в одном месте."}</p>
            </div>
            <div className="preview-card small top">
              <span className="gift-visual">01</span>
              <div>
                <strong>{createdWishlist?.items[0]?.title || "Наушники"}</strong>
                <span>{formatPrice(createdWishlist?.items[0]?.price ?? 12990)}</span>
              </div>
            </div>
            <div className="preview-card small bottom">
              <span className="gift-visual">02</span>
              <div>
                <strong>{createdWishlist?.items[1]?.title || "LEGO Set"}</strong>
                <span>Можно забронировать</span>
              </div>
            </div>
          </div>
        </section>

        <section className="panel auth-panel">
          <div className="section-heading">
            <p className="eyebrow">Аккаунт</p>
            <h2>Войдите, чтобы создавать и бронировать подарки</h2>
          </div>
          <div className="auth-grid">
            <form className="form-card" onSubmit={handleRegister}>
              <h3>Регистрация</h3>
              <label>
                Email
                <input placeholder="you@example.com" value={registerEmail} onChange={(e) => setRegisterEmail(e.target.value)} />
              </label>
              <label>
                Пароль
                <input placeholder="Минимум 4 символа" type="password" value={registerPassword} onChange={(e) => setRegisterPassword(e.target.value)} />
              </label>
              <label>
                Имя
                <input placeholder="Как вас показать друзьям" value={registerDisplayName} onChange={(e) => setRegisterDisplayName(e.target.value)} />
              </label>
              <button type="submit">Зарегистрироваться</button>
            </form>

            <form className="form-card" onSubmit={handleLogin}>
              <h3>Вход</h3>
              <label>
                Email
                <input placeholder="you@example.com" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
              </label>
              <label>
                Пароль
                <input placeholder="Ваш пароль" type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} />
              </label>
              <div className="button-row">
                <button type="submit">Войти</button>
                <button type="button" className="secondary" onClick={handleLogout}>Выйти</button>
              </div>
              <p className="helper-text">
                Сейчас: {me ? `${me.displayName || me.email}` : "вы не авторизованы"}
              </p>
            </form>
          </div>
          {(authSuccess || authError) && (
            <div className={authError ? "notice error" : "notice ok"}>{authError || authSuccess}</div>
          )}
          <details className="debug">
            <summary>Ответ авторизации</summary>
            <pre>{pretty(authDebug)}</pre>
          </details>
        </section>

        <section id="create" className="workspace">
          <div className="workspace-main">
            <div className="section-heading">
              <p className="eyebrow">Сценарий владельца</p>
              <h2>Создайте wishlist и наполните его подарками</h2>
            </div>

            <form className="panel wishlist-form" onSubmit={handleCreateWishlist}>
              <div className="form-grid two-columns">
                <label>
                  Название wishlist
                  <input placeholder="Например, День рождения" value={wishlistTitle} onChange={(e) => setWishlistTitle(e.target.value)} />
                </label>
                <label>
                  Описание
                  <input placeholder="Коротко для друзей" value={wishlistDescription} onChange={(e) => setWishlistDescription(e.target.value)} />
                </label>
              </div>
              <button type="submit">Создать wishlist</button>
            </form>

            <form className="panel wishlist-form" onSubmit={handleAddItem}>
              <div className="section-heading compact">
                <h3>Новая хотелка</h3>
                <p>Название обязательно, остальные поля можно оставить пустыми.</p>
              </div>
              <div className="form-grid">
                <label>
                  Название
                  <input placeholder="LEGO Set" value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} />
                </label>
                <label>
                  Ссылка на магазин
                  <input placeholder="https://..." value={itemUrl} onChange={(e) => setItemUrl(e.target.value)} />
                </label>
                <label>
                  Примерная цена
                  <input placeholder="9990" inputMode="decimal" value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} />
                </label>
                <label>
                  Комментарий
                  <input placeholder="Размер, цвет, важные детали" value={itemComment} onChange={(e) => setItemComment(e.target.value)} />
                </label>
              </div>
              <button type="submit">Добавить в wishlist</button>
            </form>

            <div className="panel load-panel">
              <label>
                Загрузить мой wishlist по ID
                <input
                  placeholder="wishlistId"
                  value={wishlistLookupId}
                  onChange={(e) => setWishlistLookupId(e.target.value)}
                />
              </label>
              <button onClick={() => loadMyWishlist()}>Загрузить</button>
            </div>

            {(wishlistSectionSuccess || wishlistSectionError) && (
              <div className={wishlistSectionError ? "notice error" : "notice ok"}>
                {wishlistSectionError || wishlistSectionSuccess}
              </div>
            )}
          </div>

          <aside className="wishlist-summary">
            <div className="panel sticky-panel">
              <div className="section-heading compact">
                <p className="eyebrow">Ваш список</p>
                <h3>{createdWishlist?.title || "Wishlist ещё не создан"}</h3>
                <p>{createdWishlist?.description || "После создания здесь появятся подарки и публичная ссылка."}</p>
              </div>

              {createdWishlist && (
                <div className="share-box">
                  <span>Публичная ссылка</span>
                  <code>{publicLink}</code>
                  <button className="secondary" onClick={copyPublicLink}>Скопировать ссылку</button>
                </div>
              )}

              <div className="items-list">
                {(createdWishlist?.items ?? []).map((item) => (
                  <article className="gift-card" key={item.id}>
                    <div className="gift-thumb">{item.title.slice(0, 1).toUpperCase()}</div>
                    <div className="gift-content">
                      <div className="gift-title-row">
                        <h4>{item.title}</h4>
                        <span className={item.isReserved ? "pill reserved" : "pill available"}>
                          {item.isReserved ? "Забронировано" : "Свободно"}
                        </span>
                      </div>
                      <p>{item.comment || "Без дополнительного описания"}</p>
                      <div className="gift-meta">
                        <span>{formatPrice(item.price)}</span>
                        {item.url && <a href={item.url} target="_blank" rel="noreferrer">Магазин</a>}
                      </div>
                    </div>
                  </article>
                ))}
                {createdWishlist && createdWishlist.items.length === 0 && (
                  <p className="empty-state">Добавьте первый подарок, чтобы список стал полезным для друзей.</p>
                )}
              </div>

              <details className="debug">
                <summary>Ответ wishlist API</summary>
                <pre>{pretty(wishlistDebug)}</pre>
              </details>
            </div>
          </aside>
        </section>

        <section id="public" className="panel public-section">
          <div className="section-heading">
            <p className="eyebrow">Сценарий друга</p>
            <h2>Откройте публичный wishlist и забронируйте подарок</h2>
          </div>
          <div className="load-panel">
            <label>
              Share token
              <input placeholder="Вставьте token из публичной ссылки" value={publicShareToken} onChange={(e) => setPublicShareToken(e.target.value)} />
            </label>
            <button onClick={loadPublicWishlist}>Открыть wishlist</button>
          </div>

          {publicWishlist && (
            <div className="public-layout">
              <div className="public-header">
                <div>
                  <p className="eyebrow">Публичный список</p>
                  <h3>{publicWishlist.title}</h3>
                  <p>{publicWishlist.description || "Автор не добавил описание."}</p>
                </div>
                <span className="counter">{publicWishlist.items.length} подарков</span>
              </div>

              <div className="public-items">
                {publicWishlist.items.map((item) => (
                  <button
                    type="button"
                    className={selectedPublicItemId === item.id ? "gift-card selectable active" : "gift-card selectable"}
                    key={item.id}
                    onClick={() => {
                      setSelectedPublicItemId(item.id);
                      setChatItemId(item.id);
                    }}
                  >
                    <div className="gift-thumb">{item.title.slice(0, 1).toUpperCase()}</div>
                    <div className="gift-content">
                      <div className="gift-title-row">
                        <h4>{item.title}</h4>
                        <span className={item.isReserved ? "pill reserved" : "pill available"}>
                          {item.isReserved ? "Забронировано" : "Можно выбрать"}
                        </span>
                      </div>
                      <p>{item.comment || "Детали можно уточнить в вопросах."}</p>
                      <div className="gift-meta">
                        <span>{formatPrice(item.price)}</span>
                        {item.url && <span>Есть ссылка</span>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              <div className="reserve-panel">
                <h3>{selectedPublicItem?.title || "Выберите подарок"}</h3>
                <p>
                  {selectedPublicItem
                    ? selectedPublicItem.isReserved
                      ? "Этот подарок уже забронирован. Если это ваша бронь, можно снять её."
                      : "После бронирования владелец и другие гости увидят, что подарок уже занят."
                    : "Нажмите на карточку подарка в списке."}
                </p>
                <div className="button-row">
                  <button onClick={reserveSelectedItem}>Забронировать</button>
                  <button className="secondary" onClick={unreserveSelectedItem}>Снять бронь</button>
                </div>
              </div>
            </div>
          )}

          {(publicSuccess || publicError) && (
            <div className={publicError ? "notice error" : "notice ok"}>{publicError || publicSuccess}</div>
          )}
          <details className="debug">
            <summary>Ответ public wishlist API</summary>
            <pre>{pretty(publicDebug)}</pre>
          </details>
        </section>

        <section className="panel reservations-section">
          <div className="section-heading">
            <p className="eyebrow">Мои брони</p>
            <h2>Подарки, которые вы уже выбрали</h2>
          </div>
          <button onClick={loadReservations}>Обновить мои брони</button>
          {(reservationsSuccess || reservationsError) && (
            <div className={reservationsError ? "notice error" : "notice ok"}>
              {reservationsError || reservationsSuccess}
            </div>
          )}
          <div className="reservation-list">
            {reservations.map((x) => (
              <article className="reservation-card" key={x.itemId}>
                <strong>{x.itemTitle}</strong>
                <span>{x.wishlistTitle}</span>
                <time>{formatDate(x.reservedAtUtc)}</time>
              </article>
            ))}
            {reservations.length === 0 && <p className="empty-state">Здесь появятся ваши забронированные подарки.</p>}
          </div>
          <details className="debug">
            <summary>Ответ reservations API</summary>
            <pre>{pretty(reservationsDebug)}</pre>
          </details>
        </section>

        <section id="chat" className="panel chat-section">
          <div className="section-heading">
            <p className="eyebrow">Уточняющие вопросы</p>
            <h2>Обсудите размер, цвет или важные детали подарка</h2>
          </div>

          <div className="form-grid chat-grid">
            <label>
              Wishlist ID
              <input placeholder="wishlistId" value={chatWishlistId} onChange={(e) => setChatWishlistId(e.target.value)} />
            </label>
            <label>
              Item ID
              <input placeholder="itemId" value={chatItemId} onChange={(e) => setChatItemId(e.target.value)} />
            </label>
            <label>
              Share token
              <input placeholder="shareToken" value={chatShareToken} onChange={(e) => setChatShareToken(e.target.value)} />
            </label>
          </div>

          <div className="chat-window">
            <div className="chat-toolbar">
              <div>
                <strong>{selectedChatItem?.title || "Выберите подарок для вопроса"}</strong>
                <span className={wsConnected ? "connection on" : "connection"}>{wsConnected ? "Live подключен" : "Live выключен"}</span>
              </div>
              <div className="button-row">
                <button className="secondary" onClick={loadChatMessages}>История</button>
                <button className="secondary" onClick={connectChatWebSocket}>{wsConnected ? "Переподключить" : "Live"}</button>
                <button className="secondary" onClick={disconnectChatWebSocket}>Отключить</button>
              </div>
            </div>

            <div className="messages">
              {chatMessages.map((m) => (
                <article className={m.isMine ? "message mine" : "message"} key={m.id}>
                  <span>{m.isMine ? "Вы" : (m.senderDisplayName || m.author)}</span>
                  <p>{m.text}</p>
                  <time>{formatDate(m.createdAtUtc)}</time>
                </article>
              ))}
              {chatMessages.length === 0 && <p className="empty-state">Сообщений пока нет. Задайте первый вопрос по подарку.</p>}
            </div>

            <form className="message-form" onSubmit={sendChatMessage}>
              <input placeholder="Например: какой размер нужен?" value={chatText} onChange={(e) => setChatText(e.target.value)} />
              <button type="submit">Отправить</button>
            </form>
          </div>

          {(chatSuccess || chatError) && (
            <div className={chatError ? "notice error" : "notice ok"}>{chatError || chatSuccess}</div>
          )}
          <details className="debug">
            <summary>Ответ chat API</summary>
            <pre>{pretty(chatDebug)}</pre>
          </details>
        </section>

        <section className="panel notifications-section">
          <div className="section-heading">
            <p className="eyebrow">Уведомления</p>
            <h2>Вопросы и события по вашим подаркам</h2>
          </div>
          <button onClick={loadInbox}>Обновить уведомления</button>
          {(inboxSuccess || inboxError) && (
            <div className={inboxError ? "notice error" : "notice ok"}>{inboxError || inboxSuccess}</div>
          )}
          <div className="notification-list">
            {inboxEvents.map((evt) => (
              <article className="notification-card" key={evt.eventId}>
                <strong>{evt.eventType}</strong>
                <span>Wishlist: {evt.wishlistId}</span>
                <time>{formatDate(evt.occurredAtUtc || evt.receivedAtUtc)}</time>
              </article>
            ))}
            {inboxEvents.length === 0 && <p className="empty-state">Новых уведомлений пока нет.</p>}
          </div>
          <details className="debug">
            <summary>Ответ notifications API</summary>
            <pre>{pretty(inboxDebug)}</pre>
          </details>
        </section>
      </main>
    </div>
  );
}

export default App;
