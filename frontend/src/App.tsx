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
    <div className="page">
      <h1>WishList Demo Frontend</h1>
      <p className="subtle">API base: {API_BASE_URL}</p>

      <section>
        <h2>1. Auth</h2>
        <div className="grid">
          <form onSubmit={handleRegister}>
            <h3>Register</h3>
            <input placeholder="email" value={registerEmail} onChange={(e) => setRegisterEmail(e.target.value)} />
            <input placeholder="password" type="password" value={registerPassword} onChange={(e) => setRegisterPassword(e.target.value)} />
            <input placeholder="displayName" value={registerDisplayName} onChange={(e) => setRegisterDisplayName(e.target.value)} />
            <button type="submit">Register</button>
          </form>

          <form onSubmit={handleLogin}>
            <h3>Login</h3>
            <input placeholder="email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} />
            <input placeholder="password" type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} />
            <button type="submit">Login</button>
            <button type="button" className="secondary" onClick={handleLogout}>Logout</button>
          </form>
        </div>
        <div className="status ok">{authSuccess}</div>
        <div className="status error">{authError}</div>
        <div className="status">Current user: {me ? `${me.displayName} (${me.email})` : "not logged in"}</div>
        <pre>{pretty(authDebug)}</pre>
      </section>

      <section>
        <h2>2. My Wishlist</h2>
        <form onSubmit={handleCreateWishlist}>
          <input placeholder="title" value={wishlistTitle} onChange={(e) => setWishlistTitle(e.target.value)} />
          <input placeholder="description" value={wishlistDescription} onChange={(e) => setWishlistDescription(e.target.value)} />
          <button type="submit">Create Wishlist</button>
        </form>

        <form onSubmit={handleAddItem}>
          <h3>Add Item</h3>
          <input placeholder="title" value={itemTitle} onChange={(e) => setItemTitle(e.target.value)} />
          <input placeholder="url" value={itemUrl} onChange={(e) => setItemUrl(e.target.value)} />
          <input placeholder="price" value={itemPrice} onChange={(e) => setItemPrice(e.target.value)} />
          <input placeholder="comment" value={itemComment} onChange={(e) => setItemComment(e.target.value)} />
          <button type="submit">Add Item</button>
        </form>

        <div className="row">
          <input
            placeholder="wishlistId for GET /wishlists/{id}"
            value={wishlistLookupId}
            onChange={(e) => setWishlistLookupId(e.target.value)}
          />
          <button onClick={() => loadMyWishlist()}>Load My Wishlist</button>
        </div>

        {createdWishlist && (
          <div className="info">
            <div><b>id:</b> {createdWishlist.id}</div>
            <div><b>title:</b> {createdWishlist.title}</div>
            <div><b>shareToken:</b> {createdWishlist.shareToken}</div>
            <div><b>public link:</b> {publicLink}</div>
          </div>
        )}

        <div className="status ok">{wishlistSectionSuccess}</div>
        <div className="status error">{wishlistSectionError}</div>
        <pre>{pretty(wishlistDebug)}</pre>
      </section>

      <section>
        <h2>3. Public Wishlist + Reserve</h2>
        <div className="row">
          <input placeholder="share token" value={publicShareToken} onChange={(e) => setPublicShareToken(e.target.value)} />
          <button onClick={loadPublicWishlist}>Load Public Wishlist</button>
        </div>

        {publicWishlist && (
          <div>
            <div className="info">
              <div><b>wishlistId:</b> {publicWishlist.id}</div>
              <div><b>title:</b> {publicWishlist.title}</div>
            </div>
            <select value={selectedPublicItemId} onChange={(e) => setSelectedPublicItemId(e.target.value)}>
              <option value="">Select item</option>
              {publicWishlist.items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title} | reserved: {String(item.isReserved)}
                </option>
              ))}
            </select>
            <div className="row">
              <button onClick={reserveSelectedItem}>Reserve Selected Item</button>
              <button onClick={unreserveSelectedItem}>Unreserve Selected Item</button>
            </div>
          </div>
        )}

        <div className="status ok">{publicSuccess}</div>
        <div className="status error">{publicError}</div>
        <pre>{pretty(publicDebug)}</pre>
      </section>

      <section>
        <h2>4. My Reservations</h2>
        <button onClick={loadReservations}>Load My Reservations</button>
        <div className="status ok">{reservationsSuccess}</div>
        <div className="status error">{reservationsError}</div>
        <pre>{pretty(reservationsDebug)}</pre>
        {reservations.length > 0 && (
          <ul>
            {reservations.map((x) => (
              <li key={x.itemId}>
                {x.itemTitle} | wishlist: {x.wishlistTitle} ({x.wishlistId}) | reservedAt: {x.reservedAtUtc}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>5. Chat</h2>
        <div className="grid chat-grid">
          <input placeholder="wishlistId" value={chatWishlistId} onChange={(e) => setChatWishlistId(e.target.value)} />
          <input placeholder="itemId" value={chatItemId} onChange={(e) => setChatItemId(e.target.value)} />
          <input placeholder="shareToken" value={chatShareToken} onChange={(e) => setChatShareToken(e.target.value)} />
        </div>
        <div className="row">
          <button onClick={loadChatMessages}>Load Chat History (REST)</button>
          <button onClick={connectChatWebSocket}>{wsConnected ? "Reconnect WS" : "Connect WS"}</button>
          <button onClick={disconnectChatWebSocket}>Disconnect WS</button>
          <span className={wsConnected ? "status ok inline" : "status inline"}>ws: {wsConnected ? "connected" : "disconnected"}</span>
        </div>
        <form onSubmit={sendChatMessage}>
          <input placeholder="chat text" value={chatText} onChange={(e) => setChatText(e.target.value)} />
          <button type="submit">Send Message (REST)</button>
        </form>
        <div className="status ok">{chatSuccess}</div>
        <div className="status error">{chatError}</div>
        <pre>{pretty(chatDebug)}</pre>
        {chatMessages.length > 0 && (
          <ul>
            {chatMessages.map((m) => (
              <li key={m.id}>
                {m.createdAtUtc} | {m.isMine ? "me" : (m.senderDisplayName || m.author)}: {m.text}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>6. Notifications / Inbox</h2>
        <button onClick={loadInbox}>Load /notifications/inbox</button>
        <div className="status ok">{inboxSuccess}</div>
        <div className="status error">{inboxError}</div>
        <pre>{pretty(inboxDebug)}</pre>
        {inboxEvents.length > 0 && (
          <ul>
            {inboxEvents.map((evt) => (
              <li key={evt.eventId}>
                {evt.eventType} | eventId: {evt.eventId} | occurred: {evt.occurredAtUtc} | received: {evt.receivedAtUtc}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default App;
