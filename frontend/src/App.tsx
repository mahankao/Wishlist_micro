import { FormEvent, useEffect, useMemo, useState } from "react";
import { apiRequest, clearToken, getToken, setToken } from "./api";

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
  imageUrl?: string | null;
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
  occurredAtUtc: string;
  receivedAtUtc: string;
};

type ConversationTarget = {
  wishlistId: string;
  itemId: string;
  shareToken: string;
  title: string;
};

const defaultPhoto =
  "https://images.unsplash.com/photo-1513201099705-a9746e1e201f?auto=format&fit=crop&w=900&q=80";

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
    month: "long",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function getRouteShareToken(): string {
  const match = window.location.pathname.match(/^\/wishlist\/([^/]+)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

function getTokenFromLink(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return url.pathname.split("/").filter(Boolean).at(-1) || "";
  } catch {
    return trimmed.split("/").filter(Boolean).at(-1) || trimmed;
  }
}

function GiftImage({ item }: { item: Pick<WishlistItem, "title" | "imageUrl"> }) {
  return (
    <div className="gift-image">
      <img src={item.imageUrl || defaultPhoto} alt={item.title} />
    </div>
  );
}

function App() {
  const routeShareToken = useMemo(getRouteShareToken, []);
  const isPublicRoute = Boolean(routeShareToken);

  const [token, setTokenState] = useState(getToken());
  const [me, setMe] = useState<UserDto | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerDisplayName, setRegisterDisplayName] = useState("");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [wishlistTitle, setWishlistTitle] = useState("");
  const [wishlistDescription, setWishlistDescription] = useState("");
  const [createdWishlist, setCreatedWishlist] = useState<WishlistResponse | null>(null);
  const [wishlistMessage, setWishlistMessage] = useState("");
  const [wishlistError, setWishlistError] = useState("");

  const [itemTitle, setItemTitle] = useState("");
  const [itemUrl, setItemUrl] = useState("");
  const [itemImageUrl, setItemImageUrl] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [itemComment, setItemComment] = useState("");

  const [openLinkValue, setOpenLinkValue] = useState("");
  const [publicShareToken, setPublicShareToken] = useState(routeShareToken);
  const [publicWishlist, setPublicWishlist] = useState<PublicWishlistResponse | null>(null);
  const [selectedPublicItemId, setSelectedPublicItemId] = useState("");
  const [publicMessage, setPublicMessage] = useState("");
  const [publicError, setPublicError] = useState("");

  const [reservations, setReservations] = useState<MyReservation[]>([]);
  const [inboxEvents, setInboxEvents] = useState<NotificationInboxEvent[]>([]);

  const [conversation, setConversation] = useState<ConversationTarget | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [chatMessage, setChatMessage] = useState("");
  const [chatError, setChatError] = useState("");

  const publicLink = useMemo(() => {
    if (!createdWishlist?.shareToken) return "";
    return `${window.location.origin}/wishlist/${createdWishlist.shareToken}`;
  }, [createdWishlist]);

  const selectedPublicItem = useMemo(() => {
    return publicWishlist?.items.find((item) => item.id === selectedPublicItemId) ?? null;
  }, [publicWishlist, selectedPublicItemId]);

  useEffect(() => {
    if (token) {
      loadMe().catch(() => {
        clearToken();
        setTokenState("");
        setMe(null);
      });
    } else {
      setMe(null);
    }
  }, [token]);

  useEffect(() => {
    if (routeShareToken) {
      loadPublicWishlist(routeShareToken).catch(() => void 0);
    }
  }, [routeShareToken]);

  useEffect(() => {
    if (me && !isPublicRoute) {
      loadReservations().catch(() => void 0);
      loadInbox().catch(() => void 0);
    }
  }, [me, isPublicRoute]);

  async function loadMe() {
    const response = await apiRequest<UserDto>("/users/me");
    setMe(response);
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault();
    setAuthError("");
    setAuthMessage("");
    try {
      await apiRequest<UserDto>("/auth/register", {
        method: "POST",
        auth: false,
        body: { email: registerEmail, password: registerPassword, displayName: registerDisplayName }
      });
      setAuthMode("login");
      setLoginEmail(registerEmail);
      setAuthMessage("Аккаунт создан. Теперь войдите.");
    } catch (error) {
      setAuthError((error as Error).message);
    }
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setAuthError("");
    setAuthMessage("");
    try {
      const response = await apiRequest<AuthResponse>("/auth/login", {
        method: "POST",
        auth: false,
        body: { email: loginEmail, password: loginPassword }
      });
      setToken(response.accessToken);
      setTokenState(response.accessToken);
      setMe(response.user);
      setAuthMessage("Вы вошли.");
    } catch (error) {
      setAuthError((error as Error).message);
    }
  }

  function handleLogout() {
    clearToken();
    setTokenState("");
    setMe(null);
    setAuthMessage("");
    setAuthError("");
  }

  async function handleCreateWishlist(e: FormEvent) {
    e.preventDefault();
    setWishlistError("");
    setWishlistMessage("");
    try {
      const response = await apiRequest<WishlistResponse>("/wishlists", {
        method: "POST",
        body: {
          title: wishlistTitle || "Мой wishlist",
          description: wishlistDescription || null
        }
      });
      setCreatedWishlist(response);
      setWishlistMessage("Wishlist готов. Добавьте подарки и отправьте ссылку друзьям.");
    } catch (error) {
      setWishlistError((error as Error).message);
    }
  }

  async function handleAddItem(e: FormEvent) {
    e.preventDefault();
    if (!createdWishlist) {
      setWishlistError("Сначала создайте wishlist.");
      return;
    }

    setWishlistError("");
    setWishlistMessage("");
    try {
      await apiRequest<WishlistItem>(`/wishlists/${createdWishlist.id}/items`, {
        method: "POST",
        body: {
          title: itemTitle,
          url: itemUrl || null,
          imageUrl: itemImageUrl || null,
          price: itemPrice ? Number(itemPrice) : null,
          comment: itemComment || null
        }
      });
      await loadMyWishlist(createdWishlist.id);
      setItemTitle("");
      setItemUrl("");
      setItemImageUrl("");
      setItemPrice("");
      setItemComment("");
      setWishlistMessage("Подарок добавлен.");
    } catch (error) {
      setWishlistError((error as Error).message);
    }
  }

  async function loadMyWishlist(wishlistId: string) {
    const response = await apiRequest<WishlistResponse>(`/wishlists/${wishlistId}`);
    setCreatedWishlist(response);
  }

  async function copyPublicLink() {
    if (!publicLink) return;
    await navigator.clipboard.writeText(publicLink);
    setWishlistMessage("Ссылка скопирована.");
  }

  function openWishlistFromInput(e: FormEvent) {
    e.preventDefault();
    const shareToken = getTokenFromLink(openLinkValue);
    if (!shareToken) return;
    window.history.pushState(null, "", `/wishlist/${shareToken}`);
    setPublicShareToken(shareToken);
    loadPublicWishlist(shareToken).catch(() => void 0);
  }

  async function loadPublicWishlist(shareToken = publicShareToken) {
    if (!shareToken) return;
    setPublicError("");
    setPublicMessage("");
    setPublicShareToken(shareToken);
    try {
      const response = await apiRequest<PublicWishlistResponse>(`/wishlists/public/${shareToken}`, { auth: false });
      setPublicWishlist(response);
      const firstAvailable = response.items.find((item) => !item.isReserved) ?? response.items[0];
      setSelectedPublicItemId(firstAvailable?.id || "");
    } catch (error) {
      setPublicError((error as Error).message);
    }
  }

  async function reserveItem(itemId: string) {
    if (!publicWishlist) return;
    if (!token) {
      setPublicError("Войдите или зарегистрируйтесь, чтобы забронировать подарок.");
      return;
    }

    setPublicError("");
    setPublicMessage("");
    try {
      await apiRequest<WishlistItem>(`/wishlists/${publicWishlist.id}/items/${itemId}/reserve`, { method: "POST" });
      setPublicMessage("Подарок забронирован. Спасибо, что предупредили остальных.");
      await loadPublicWishlist(publicShareToken);
      await loadReservations();
    } catch (error) {
      setPublicError((error as Error).message);
    }
  }

  async function loadReservations() {
    if (!token) return;
    const response = await apiRequest<MyReservation[]>("/wishlists/reservations/me");
    setReservations(response);
  }

  async function loadInbox() {
    const response = await apiRequest<NotificationInboxEvent[]>("/notifications/inbox", { auth: false });
    setInboxEvents(response);
  }

  function startPublicConversation(item: WishlistItem) {
    if (!publicWishlist) return;
    setConversation({
      wishlistId: publicWishlist.id,
      itemId: item.id,
      shareToken: publicShareToken,
      title: item.title
    });
    loadChatMessages(publicWishlist.id, item.id, publicShareToken).catch(() => void 0);
  }

  function startOwnerConversation(item: WishlistItem) {
    if (!createdWishlist) return;
    setConversation({
      wishlistId: createdWishlist.id,
      itemId: item.id,
      shareToken: createdWishlist.shareToken,
      title: item.title
    });
    loadChatMessages(createdWishlist.id, item.id, createdWishlist.shareToken).catch(() => void 0);
  }

  async function loadChatMessages(wishlistId: string, itemId: string, shareToken: string) {
    if (!token) {
      setChatMessages([]);
      return;
    }
    setChatError("");
    try {
      const query = new URLSearchParams({ wishlistId, itemId, shareToken });
      const response = await apiRequest<ChatMessage[]>(`/chat/messages?${query.toString()}`);
      setChatMessages(response);
    } catch (error) {
      setChatError((error as Error).message);
    }
  }

  async function sendChatMessage(e: FormEvent) {
    e.preventDefault();
    if (!conversation) return;
    if (!token) {
      setChatError("Войдите, чтобы задать вопрос или ответить.");
      return;
    }

    setChatError("");
    setChatMessage("");
    try {
      const response = await apiRequest<ChatMessage>("/chat/messages", {
        method: "POST",
        body: {
          wishlistId: conversation.wishlistId,
          itemId: conversation.itemId,
          shareToken: conversation.shareToken,
          text: chatText
        }
      });
      setChatMessages((prev) => [...prev, response]);
      setChatText("");
      setChatMessage("Сообщение отправлено.");
      await loadInbox();
    } catch (error) {
      setChatError((error as Error).message);
    }
  }

  const authPanel = (
    <section className="auth-card" id="auth">
      <div>
        <p className="eyebrow">Аккаунт</p>
        <h2>{authMode === "login" ? "Войти" : "Создать аккаунт"}</h2>
        <p className="muted">
          {authMode === "login"
            ? "Авторизация нужна для создания wishlist, бронирования и вопросов."
            : "После регистрации вы сможете создать wishlist и поделиться им."}
        </p>
      </div>

      {authMode === "login" ? (
        <form className="stack-form" onSubmit={handleLogin}>
          <label>
            Email
            <input value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <label>
            Пароль
            <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} placeholder="Ваш пароль" />
          </label>
          <button type="submit">Войти</button>
        </form>
      ) : (
        <form className="stack-form" onSubmit={handleRegister}>
          <label>
            Имя
            <input value={registerDisplayName} onChange={(e) => setRegisterDisplayName(e.target.value)} placeholder="Мария" />
          </label>
          <label>
            Email
            <input value={registerEmail} onChange={(e) => setRegisterEmail(e.target.value)} placeholder="you@example.com" />
          </label>
          <label>
            Пароль
            <input type="password" value={registerPassword} onChange={(e) => setRegisterPassword(e.target.value)} placeholder="Минимум 8 символов" />
          </label>
          <button type="submit">Зарегистрироваться</button>
        </form>
      )}

      <button className="text-button" onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}>
        {authMode === "login" ? "Нет аккаунта? Зарегистрироваться" : "Уже есть аккаунт? Войти"}
      </button>

      {(authMessage || authError) && <p className={authError ? "notice error" : "notice ok"}>{authError || authMessage}</p>}
    </section>
  );

  const chatPanel = conversation && (
    <section className="panel conversation-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Вопросы по подарку</p>
          <h2>{conversation.title}</h2>
        </div>
        <button className="secondary" onClick={() => setConversation(null)}>Закрыть</button>
      </div>

      {!token && <p className="notice error">Войдите, чтобы писать сообщения.</p>}

      <div className="messages">
        {chatMessages.map((message) => (
          <article className={message.isMine ? "message mine" : "message"} key={message.id}>
            <span>{message.isMine ? "Вы" : message.senderDisplayName || message.author}</span>
            <p>{message.text}</p>
            <time>{formatDate(message.createdAtUtc)}</time>
          </article>
        ))}
        {chatMessages.length === 0 && <p className="empty">Пока нет сообщений. Начните диалог первым вопросом.</p>}
      </div>

      <form className="message-form" onSubmit={sendChatMessage}>
        <input value={chatText} onChange={(e) => setChatText(e.target.value)} placeholder="Например: какой цвет лучше выбрать?" />
        <button type="submit">Отправить</button>
      </form>
      {(chatMessage || chatError) && <p className={chatError ? "notice error" : "notice ok"}>{chatError || chatMessage}</p>}
    </section>
  );

  if (isPublicRoute || publicWishlist) {
    return (
      <div className="app-shell public-page">
        <header className="topbar">
          <a className="brand" href="/">WishNest</a>
          <div className="topbar-actions">
            {me ? <span className="user-pill">{me.displayName || me.email}</span> : <a className="secondary-link" href="#auth">Войти</a>}
            {me && <button className="secondary small" onClick={handleLogout}>Выйти</button>}
          </div>
        </header>

        <main className="page">
          {!publicWishlist && (
            <section className="panel center-panel">
              <h1>Wishlist не найден</h1>
              <p className="muted">{publicError || "Проверьте публичную ссылку и попробуйте снова."}</p>
            </section>
          )}

          {publicWishlist && (
            <>
              <section className="public-hero">
                <p className="eyebrow">Публичный wishlist</p>
                <h1>{publicWishlist.title}</h1>
                <p>{publicWishlist.description || "Автор собрал здесь идеи подарков, которые точно пригодятся."}</p>
              </section>

              <section className="gift-grid">
                {publicWishlist.items.map((item) => (
                  <article className="product-card" key={item.id}>
                    <GiftImage item={item} />
                    <div className="product-content">
                      <div className="product-title">
                        <h3>{item.title}</h3>
                        <span className={item.isReserved ? "status-pill reserved" : "status-pill"}>{item.isReserved ? "Забронировано" : "Свободно"}</span>
                      </div>
                      <p>{item.comment || "Если нужны детали, можно задать вопрос владельцу."}</p>
                      <div className="product-meta">
                        <strong>{formatPrice(item.price)}</strong>
                        {item.url && <a href={item.url} target="_blank" rel="noreferrer">Открыть магазин</a>}
                      </div>
                      <div className="card-actions">
                        <button disabled={item.isReserved} onClick={() => reserveItem(item.id)}>
                          {item.isReserved ? "Уже занято" : "Забронировать"}
                        </button>
                        <button className="secondary" onClick={() => startPublicConversation(item)}>Задать вопрос</button>
                      </div>
                    </div>
                  </article>
                ))}
              </section>

              {(publicMessage || publicError) && <p className={publicError ? "notice error" : "notice ok"}>{publicError || publicMessage}</p>}
              {chatPanel}
              {!me && authPanel}
            </>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/">WishNest</a>
        <nav>
          <a href="#create">Создать wishlist</a>
          <a href="#open">Открыть ссылку</a>
          <a href="#questions">Вопросы</a>
        </nav>
        <div className="topbar-actions">
          {me ? <span className="user-pill">{me.displayName || me.email}</span> : <a className="secondary-link" href="#auth">Войти</a>}
          {me && <button className="secondary small" onClick={handleLogout}>Выйти</button>}
        </div>
      </header>

      <main className="page">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Gift-сервис для точных подарков</p>
            <h1>Wishlist, которым удобно делиться</h1>
            <p>
              Создайте список желаний, добавьте фото, ссылки и детали подарков. Друзья откроют ссылку, выберут подарок и зададут вопрос, если нужно уточнение.
            </p>
            <div className="hero-actions">
              <a className="button" href={me ? "#create" : "#auth"}>{me ? "Создать wishlist" : "Начать"}</a>
              <a className="button secondary" href="#open">Открыть публичную ссылку</a>
            </div>
          </div>
          <div className="hero-card">
            <img src={createdWishlist?.items[0]?.imageUrl || defaultPhoto} alt="Пример подарка" />
            <div>
              <span className="status-pill">Свободно</span>
              <h3>{createdWishlist?.items[0]?.title || "Подарок мечты"}</h3>
              <p>{createdWishlist?.items[0]?.comment || "Фото, магазин, цена и комментарии собраны в одной карточке."}</p>
            </div>
          </div>
        </section>

        {!me && authPanel}

        <section id="open" className="panel open-panel">
          <div>
            <p className="eyebrow">Для гостей</p>
            <h2>Открыть wishlist по ссылке</h2>
            <p className="muted">Вставьте публичную ссылку, которую прислал владелец списка.</p>
          </div>
          <form onSubmit={openWishlistFromInput}>
            <input value={openLinkValue} onChange={(e) => setOpenLinkValue(e.target.value)} placeholder="https://.../wishlist/..." />
            <button type="submit">Открыть</button>
          </form>
        </section>

        {me && (
          <section id="create" className="dashboard">
            <div className="dashboard-main">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Мой wishlist</p>
                    <h2>{createdWishlist ? createdWishlist.title : "Создайте новый список"}</h2>
                    <p className="muted">
                      {createdWishlist
                        ? createdWishlist.description || "Описание можно оставить пустым."
                        : "Название и описание помогут друзьям понять настроение списка."}
                    </p>
                  </div>
                  {createdWishlist && <button className="secondary" onClick={copyPublicLink}>Скопировать ссылку</button>}
                </div>

                {!createdWishlist ? (
                  <form className="stack-form" onSubmit={handleCreateWishlist}>
                    <label>
                      Название
                      <input value={wishlistTitle} onChange={(e) => setWishlistTitle(e.target.value)} placeholder="Например, День рождения" />
                    </label>
                    <label>
                      Описание
                      <input value={wishlistDescription} onChange={(e) => setWishlistDescription(e.target.value)} placeholder="Пара слов для друзей" />
                    </label>
                    <button type="submit">Создать wishlist</button>
                  </form>
                ) : (
                  <div className="share-preview">
                    <span>Публичная ссылка</span>
                    <strong>{publicLink}</strong>
                  </div>
                )}

                {(wishlistMessage || wishlistError) && <p className={wishlistError ? "notice error" : "notice ok"}>{wishlistError || wishlistMessage}</p>}
              </section>

              {createdWishlist && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">Новый подарок</p>
                      <h2>Добавить хотелку</h2>
                    </div>
                  </div>
                  <form className="item-form" onSubmit={handleAddItem}>
                    <label>
                      Название
                      <input value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} placeholder="Наушники, книга, сертификат..." />
                    </label>
                    <label>
                      Фото
                      <input value={itemImageUrl} onChange={(e) => setItemImageUrl(e.target.value)} placeholder="Ссылка на изображение" />
                    </label>
                    <label>
                      Магазин
                      <input value={itemUrl} onChange={(e) => setItemUrl(e.target.value)} placeholder="Ссылка на товар" />
                    </label>
                    <label>
                      Цена
                      <input value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} inputMode="decimal" placeholder="12990" />
                    </label>
                    <label className="wide">
                      Комментарий
                      <input value={itemComment} onChange={(e) => setItemComment(e.target.value)} placeholder="Размер, цвет, важные детали" />
                    </label>
                    <button type="submit">Добавить подарок</button>
                  </form>
                </section>
              )}

              {createdWishlist && (
                <section className="gift-grid owner-grid">
                  {createdWishlist.items.map((item) => (
                    <article className="product-card" key={item.id}>
                      <GiftImage item={item} />
                      <div className="product-content">
                        <div className="product-title">
                          <h3>{item.title}</h3>
                          <span className={item.isReserved ? "status-pill reserved" : "status-pill"}>{item.isReserved ? "Забронировано" : "Свободно"}</span>
                        </div>
                        <p>{item.comment || "Комментарий не добавлен."}</p>
                        <div className="product-meta">
                          <strong>{formatPrice(item.price)}</strong>
                          {item.url && <a href={item.url} target="_blank" rel="noreferrer">Магазин</a>}
                        </div>
                        <button className="secondary" onClick={() => startOwnerConversation(item)}>Открыть вопросы</button>
                      </div>
                    </article>
                  ))}
                  {createdWishlist.items.length === 0 && <p className="empty">Пока нет подарков. Добавьте первую хотелку.</p>}
                </section>
              )}
            </div>

            <aside className="side-column">
              <section className="panel">
                <p className="eyebrow">Мои брони</p>
                <h2>Выбранные подарки</h2>
                <div className="compact-list">
                  {reservations.map((reservation) => (
                    <article key={reservation.itemId}>
                      <strong>{reservation.itemTitle}</strong>
                      <span>{reservation.wishlistTitle}</span>
                    </article>
                  ))}
                  {reservations.length === 0 && <p className="empty">Вы пока ничего не бронировали.</p>}
                </div>
              </section>

              <section id="questions" className="panel">
                <p className="eyebrow">Уведомления</p>
                <h2>События</h2>
                <div className="compact-list">
                  {inboxEvents.map((event) => (
                    <article key={event.eventId}>
                      <strong>{event.eventType}</strong>
                      <span>{formatDate(event.occurredAtUtc || event.receivedAtUtc)}</span>
                    </article>
                  ))}
                  {inboxEvents.length === 0 && <p className="empty">Новых событий пока нет.</p>}
                </div>
              </section>
            </aside>
          </section>
        )}

        {chatPanel}
      </main>
    </div>
  );
}

export default App;
