import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiRequest, buildWsUrl, clearToken, getToken, setToken } from "./api";

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
  reservedByUserId?: string | null;
  reservedAtUtc?: string | null;
  createdAtUtc: string;
};

type WishlistResponse = {
  id: string;
  ownerUserId: string;
  ownerDisplayName?: string | null;
  title: string;
  description?: string | null;
  shareToken: string;
  createdAtUtc: string;
  expiresAtUtc: string;
  items: WishlistItem[];
};

type WishlistSummary = WishlistResponse;

type PublicWishlistResponse = {
  id: string;
  ownerUserId: string;
  ownerDisplayName?: string | null;
  title: string;
  description?: string | null;
  expiresAtUtc: string;
  items: WishlistItem[];
};

type MyReservation = {
  wishlistId: string;
  shareToken: string;
  wishlistTitle: string;
  ownerUserId: string;
  ownerDisplayName?: string | null;
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

type WishlistReservationRealtimeEvent = {
  type: "wishlist.item.reservation.changed";
  eventType: "wishlist.item.reserved" | "wishlist.item.unreserved";
  wishlistId: string;
  itemId: string;
  actorUserId: string;
  isReserved: boolean;
  occurredAtUtc: string;
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

type ConversationTarget = {
  wishlistId: string;
  itemId: string;
  shareToken: string;
  title: string;
};

type MessageNotification = {
  wishlistId: string;
  shareToken: string;
  itemId: string;
  wishlistTitle: string;
  itemTitle: string;
  senderName: string;
  text: string;
  createdAtUtc: string;
};

type TimelineNotification =
  | { id: string; kind: "message"; timestamp: string; message: MessageNotification }
  | { id: string; kind: "event"; timestamp: string; event: NotificationInboxEvent };

type ToastNotification = {
  id: string;
  title: string;
  description: string;
  action?: TimelineNotification;
};

type PublicGiftFilter = "all" | "available" | "reservedByMe";

const defaultPhoto =
  "https://images.unsplash.com/photo-1513201099705-a9746e1e201f?auto=format&fit=crop&w=900&q=80";
const MAX_GIFTS_PER_WISHLIST = 100;

function explainError(error: unknown, fallback = "Не получилось выполнить действие. Попробуйте ещё раз."): string {
  const rawMessage = error instanceof Error ? error.message : String(error || "");
  if (!rawMessage) return fallback;
  if (rawMessage.includes("Failed to fetch")) return "Сервис временно недоступен. Проверьте, что backend запущен, и попробуйте снова.";
  if (rawMessage.includes("401") || rawMessage.includes("Unauthorized")) return "Войдите в аккаунт, чтобы выполнить это действие.";
  if (rawMessage.includes("403") || rawMessage.includes("Forbidden")) return "У вас нет доступа к этому действию.";
  if (rawMessage.includes("already reserved")) return "Этот подарок уже забронирован другим пользователем.";
  if (rawMessage.includes("Invalid registration payload")) return "Проверьте имя, email и пароль. Пароль должен быть не короче 8 символов.";
  if (rawMessage.includes("Invalid login payload")) return "Введите email и пароль.";
  if (rawMessage.includes("Invalid credentials")) return "Неверный email или пароль.";
  if (rawMessage.includes("Wishlist not found")) return "Wishlist не найден. Проверьте ссылку.";
  if (rawMessage.includes("410") || rawMessage.includes("Gone")) return "Срок действия wishlist закончился.";
  if (rawMessage.includes("expiration date is required")) return "Выберите дату, до которой будет доступен wishlist.";
  if (rawMessage.includes("expiration date must be in the future")) return "Дата wishlist должна быть в будущем.";
  if (rawMessage.includes("Wishlist can contain maximum 100 gifts")) return "В один wishlist можно добавить максимум 100 подарков.";
  if (rawMessage.includes("Title is required")) return "Введите название подарка. Оно обязательно.";
  if (rawMessage.includes("Url must") || rawMessage.includes("ImageUrl must")) return "Ссылка должна начинаться с http:// или https://.";
  return rawMessage;
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
    month: "long",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatDateOnly(value?: string | null): string {
  if (!value) return "";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(new Date(value));
}

function getDateInputValue(value?: string | null): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function getDefaultExpiryDateInput(): string {
  const date = new Date();
  date.setDate(date.getDate() + 30);
  return date.toISOString().slice(0, 10);
}

function dateInputToEndOfDayUtc(value: string): string | null {
  if (!value) return null;
  return new Date(`${value}T23:59:59`).toISOString();
}

function getTime(value?: string | null): number {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function sortByNewest<T>(items: T[], getTimestamp: (item: T) => string | null | undefined): T[] {
  return [...items].sort((a, b) => getTime(getTimestamp(b)) - getTime(getTimestamp(a)));
}

function sortChatMessages(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => getTime(a.createdAtUtc) - getTime(b.createdAtUtc));
}

function mergeChatMessage(messages: ChatMessage[], next: ChatMessage): ChatMessage[] {
  const existingIndex = messages.findIndex((message) => message.id === next.id);
  if (existingIndex >= 0) {
    const copy = [...messages];
    copy[existingIndex] = next;
    return sortChatMessages(copy);
  }

  return sortChatMessages([...messages, next]);
}

function scrollToElement(id: string, block: ScrollLogicalPosition = "center", delay = 120) {
  window.setTimeout(() => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block });
  }, delay);
}

function normalizeDisplayText(value?: string | null): string {
  return (value ?? "").replace(/\\u00a0/gi, " ").replace(/\u00a0/g, " ");
}

function notificationTitle(eventType: string): string {
  if (eventType === "wishlist.item.reserved") return "Подарок забронирован";
  if (eventType === "wishlist.item.unreserved") return "Бронь подарка снята";
  return "Новое событие";
}

function notificationDescription(event: NotificationInboxEvent): string {
  if (event.eventType === "wishlist.item.reserved") return "Кто-то выбрал подарок из вашего wishlist.";
  if (event.eventType === "wishlist.item.unreserved") return "Подарок снова доступен для выбора.";
  return `Событие по wishlist ${event.wishlistId}`;
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
  const chatSocketRef = useRef<WebSocket | null>(null);
  const chatNotificationsSocketRef = useRef<WebSocket | null>(null);
  const wishlistSocketRef = useRef<WebSocket | null>(null);
  const myWishlistsRef = useRef<WishlistSummary[]>([]);
  const accountSessionVersionRef = useRef(0);
  const seenTimelineNotificationIdsRef = useRef<Set<string>>(new Set());
  const hasInitializedToastStackRef = useRef(false);

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
  const [wishlistExpiresAt, setWishlistExpiresAt] = useState(getDefaultExpiryDateInput);
  const [createdWishlist, setCreatedWishlist] = useState<WishlistResponse | null>(null);
  const [myWishlists, setMyWishlists] = useState<WishlistSummary[]>([]);
  const [libraryTab, setLibraryTab] = useState<"created" | "giving">("created");
  const [wishlistMessage, setWishlistMessage] = useState("");
  const [wishlistError, setWishlistError] = useState("");
  const [isEditingWishlist, setIsEditingWishlist] = useState(false);
  const [isWishlistActionsOpen, setIsWishlistActionsOpen] = useState(false);
  const [editWishlistTitle, setEditWishlistTitle] = useState("");
  const [editWishlistDescription, setEditWishlistDescription] = useState("");
  const [editWishlistExpiresAt, setEditWishlistExpiresAt] = useState("");

  const [itemTitle, setItemTitle] = useState("");
  const [itemUrl, setItemUrl] = useState("");
  const [itemImageUrl, setItemImageUrl] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [itemComment, setItemComment] = useState("");
  const [editingItemId, setEditingItemId] = useState("");
  const [editItemTitle, setEditItemTitle] = useState("");
  const [editItemUrl, setEditItemUrl] = useState("");
  const [editItemImageUrl, setEditItemImageUrl] = useState("");
  const [editItemPrice, setEditItemPrice] = useState("");
  const [editItemComment, setEditItemComment] = useState("");

  const [openLinkValue, setOpenLinkValue] = useState("");
  const [publicShareToken, setPublicShareToken] = useState(routeShareToken);
  const [publicWishlist, setPublicWishlist] = useState<PublicWishlistResponse | null>(null);
  const [isPublicWishlistExpired, setIsPublicWishlistExpired] = useState(false);
  const [publicGiftFilter, setPublicGiftFilter] = useState<PublicGiftFilter>("all");
  const [selectedPublicItemId, setSelectedPublicItemId] = useState("");
  const [publicMessage, setPublicMessage] = useState("");
  const [publicError, setPublicError] = useState("");

  const [reservations, setReservations] = useState<MyReservation[]>([]);
  const [inboxEvents, setInboxEvents] = useState<NotificationInboxEvent[]>([]);
  const [messageNotifications, setMessageNotifications] = useState<MessageNotification[]>([]);

  const [conversation, setConversation] = useState<ConversationTarget | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatText, setChatText] = useState("");
  const [chatMessage, setChatMessage] = useState("");
  const [chatError, setChatError] = useState("");
  const [toastNotifications, setToastNotifications] = useState<ToastNotification[]>([]);

  const publicLink = useMemo(() => {
    if (!createdWishlist?.shareToken) return "";
    return `${window.location.origin}/wishlist/${createdWishlist.shareToken}`;
  }, [createdWishlist]);

  const isPublicRoute = Boolean(publicShareToken);

  const visibleInboxEvents = useMemo(() => {
    if (!me) return [];
    const ownedWishlistIds = new Set(myWishlists.map((wishlist) => wishlist.id));
    const visible = inboxEvents.filter((event) => event.ownerUserId === me.id || ownedWishlistIds.has(event.wishlistId));
    return sortByNewest(visible, (event) => event.occurredAtUtc || event.receivedAtUtc);
  }, [inboxEvents, me, myWishlists]);

  const timelineNotifications = useMemo<TimelineNotification[]>(() => {
    const messages = messageNotifications.map<TimelineNotification>((message) => ({
      id: `message-${message.itemId}-${message.createdAtUtc}`,
      kind: "message",
      timestamp: message.createdAtUtc,
      message
    }));
    const events = visibleInboxEvents.map<TimelineNotification>((event) => ({
      id: `event-${event.eventId}`,
      kind: "event",
      timestamp: event.occurredAtUtc || event.receivedAtUtc,
      event
    }));

    return sortByNewest([...messages, ...events], (item) => item.timestamp);
  }, [messageNotifications, visibleInboxEvents]);

  const selectedPublicItem = useMemo(() => {
    return publicWishlist?.items.find((item) => item.id === selectedPublicItemId) ?? null;
  }, [publicWishlist, selectedPublicItemId]);

  const isOwnPublicWishlist = Boolean(me && publicWishlist?.ownerUserId === me.id);

  const conversationOwnerUserId = conversation && publicWishlist && conversation.wishlistId === publicWishlist.id
    ? publicWishlist.ownerUserId
    : conversation && createdWishlist && conversation.wishlistId === createdWishlist.id
      ? createdWishlist.ownerUserId
      : null;

  const reservedByMe = useMemo(() => {
    if (!publicWishlist) return new Set<string>();
    return new Set(
      reservations
        .filter((reservation) => reservation.wishlistId === publicWishlist.id)
        .map((reservation) => reservation.itemId)
    );
  }, [publicWishlist, reservations]);

  const publicGiftItems = useMemo(() => {
    if (!publicWishlist) return [];
    return [...publicWishlist.items]
      .sort((a, b) => Number(a.isReserved) - Number(b.isReserved) || getTime(a.createdAtUtc) - getTime(b.createdAtUtc))
      .filter((item) => {
        if (publicGiftFilter === "available") return !item.isReserved;
        if (publicGiftFilter === "reservedByMe") return reservedByMe.has(item.id);
        return true;
      });
  }, [publicWishlist, publicGiftFilter, reservedByMe]);

  useEffect(() => {
    myWishlistsRef.current = myWishlists;
  }, [myWishlists]);

  function pushToast(title: string, description: string, action?: TimelineNotification) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToastNotifications((prev) => [{ id, title, description, action }, ...prev].slice(0, 5));
    window.setTimeout(() => {
      setToastNotifications((prev) => prev.filter((toast) => toast.id !== id));
    }, 7000);
  }

  function showTemporaryChatMessage(message: string) {
    setChatMessage(message);
    window.setTimeout(() => {
      setChatMessage((current) => current === message ? "" : current);
    }, 2400);
  }

  function resetPrivateAccountState() {
    accountSessionVersionRef.current += 1;
    myWishlistsRef.current = [];
    seenTimelineNotificationIdsRef.current = new Set();
    hasInitializedToastStackRef.current = false;
    setCreatedWishlist(null);
    setMyWishlists([]);
    setLibraryTab("created");
    setWishlistTitle("");
    setWishlistDescription("");
    setWishlistExpiresAt(getDefaultExpiryDateInput());
    setWishlistMessage("");
    setWishlistError("");
    setIsEditingWishlist(false);
    setIsWishlistActionsOpen(false);
    setEditWishlistTitle("");
    setEditWishlistDescription("");
    setEditWishlistExpiresAt("");
    setItemTitle("");
    setItemUrl("");
    setItemImageUrl("");
    setItemPrice("");
    setItemComment("");
    setEditingItemId("");
    setEditItemTitle("");
    setEditItemUrl("");
    setEditItemImageUrl("");
    setEditItemPrice("");
    setEditItemComment("");
    setReservations([]);
    setInboxEvents([]);
    setMessageNotifications([]);
    setConversation(null);
    setChatMessages([]);
    setChatText("");
    setChatMessage("");
    setChatError("");
    setToastNotifications([]);
  }

  useEffect(() => {
    const seenIds = seenTimelineNotificationIdsRef.current;
    if (!hasInitializedToastStackRef.current) {
      timelineNotifications.forEach((item) => seenIds.add(item.id));
      hasInitializedToastStackRef.current = true;
      return;
    }

    const freshItems = timelineNotifications.filter((item) => !seenIds.has(item.id));
    freshItems.forEach((item) => {
      seenIds.add(item.id);
      if (item.kind === "message") {
        pushToast("Новый вопрос по подарку", `${item.message.senderName}: ${item.message.text}`, item);
      } else {
        pushToast(notificationTitle(item.event.eventType), notificationDescription(item.event), item);
      }
    });
  }, [timelineNotifications]);

  useEffect(() => {
    if (token) {
      loadMe().catch(() => {
        clearToken();
        setTokenState("");
        setMe(null);
        resetPrivateAccountState();
      });
    } else {
      setMe(null);
      resetPrivateAccountState();
    }
  }, [token]);

  useEffect(() => {
    if (routeShareToken) {
      loadPublicWishlist(routeShareToken).catch(() => void 0);
    }
  }, [routeShareToken]);

  useEffect(() => {
    if (!publicWishlist || !publicShareToken) return;

    const intervalId = window.setInterval(() => {
      refreshPublicWishlist(publicShareToken).catch(() => void 0);
      if (token) loadReservations().catch(() => void 0);
    }, 2500);

    return () => window.clearInterval(intervalId);
  }, [publicWishlist?.id, publicShareToken, token]);

  useEffect(() => {
    wishlistSocketRef.current?.close();
    wishlistSocketRef.current = null;

    if (!publicWishlist || !publicShareToken) return;

    const socket = new WebSocket(buildWsUrl("/chat/wishlist/ws", { shareToken: publicShareToken }));
    wishlistSocketRef.current = socket;

    socket.onmessage = (event) => {
      try {
        const incoming = JSON.parse(event.data) as WishlistReservationRealtimeEvent;
        if (incoming.type !== "wishlist.item.reservation.changed" || incoming.wishlistId !== publicWishlist.id) return;

        setPublicWishlist((current) => current?.id === incoming.wishlistId
          ? {
              ...current,
              items: current.items.map((item) => item.id === incoming.itemId
                ? {
                    ...item,
                    isReserved: incoming.isReserved,
                    reservedByUserId: incoming.isReserved ? incoming.actorUserId : null,
                    reservedAtUtc: incoming.isReserved ? incoming.occurredAtUtc : null
                  }
                : item)
            }
          : current
        );

        if (token) {
          loadReservations().catch(() => void 0);
        }
      } catch {
        // Ignore malformed WebSocket messages and keep the wishlist subscription open.
      }
    };

    socket.onerror = () => {
      setPublicError((current) => current || "Не удалось подключиться к обновлениям wishlist в реальном времени.");
    };

    return () => {
      socket.close();
      if (wishlistSocketRef.current === socket) {
        wishlistSocketRef.current = null;
      }
    };
  }, [publicWishlist?.id, publicShareToken, token]);

  useEffect(() => {
    if (me && !isPublicRoute) {
      loadMyWishlists().catch(() => void 0);
      loadReservations().catch(() => void 0);
      loadInbox().catch(() => void 0);
    }
  }, [me, isPublicRoute]);

  useEffect(() => {
    if (!me || isPublicRoute) return;

    const refreshNotifications = () => {
      loadInbox().catch(() => void 0);
      loadReservations().catch(() => void 0);
      if (myWishlists.length > 0) {
        loadMessageNotifications(myWishlists).catch(() => void 0);
      }
    };

    const intervalId = window.setInterval(refreshNotifications, 3000);
    return () => window.clearInterval(intervalId);
  }, [me, isPublicRoute, myWishlists]);

  useEffect(() => {
    chatNotificationsSocketRef.current?.close();
    chatNotificationsSocketRef.current = null;

    if (!token || !me || isPublicRoute) return;

    const socket = new WebSocket(buildWsUrl("/chat/notifications/ws", { access_token: token }));
    chatNotificationsSocketRef.current = socket;

    socket.onmessage = () => {
      const currentWishlists = myWishlistsRef.current;
      if (currentWishlists.length > 0) {
        loadMessageNotifications(currentWishlists).catch(() => void 0);
      }
      loadInbox().catch(() => void 0);
    };

    return () => {
      socket.close();
      if (chatNotificationsSocketRef.current === socket) {
        chatNotificationsSocketRef.current = null;
      }
    };
  }, [token, me?.id, isPublicRoute]);

  useEffect(() => {
    if (me && isPublicRoute) {
      loadReservations().catch(() => void 0);
    }
  }, [me, isPublicRoute]);

  useEffect(() => {
    if (!publicWishlist || !conversation || conversation.wishlistId !== publicWishlist.id) return;

    const item = publicWishlist.items.find((entry) => entry.id === conversation.itemId);
    if (item?.isReserved && !reservedByMe.has(item.id) && !isOwnPublicWishlist) {
      setConversation(null);
      setChatMessages([]);
      setPublicError("Этот подарок уже забронирован, переписка доступна только владельцу wishlist и тому, кто его забронировал.");
    }
  }, [publicWishlist, conversation?.wishlistId, conversation?.itemId, reservedByMe, isOwnPublicWishlist]);

  useEffect(() => {
    if (token && conversation) {
      loadChatMessages(conversation.wishlistId, conversation.itemId, conversation.shareToken).catch(() => void 0);
    }
  }, [token, conversation?.wishlistId, conversation?.itemId]);

  useEffect(() => {
    chatSocketRef.current?.close();
    chatSocketRef.current = null;

    if (!token || !conversation) return;

    const socket = new WebSocket(buildWsUrl("/chat/ws", {
      wishlistId: conversation.wishlistId,
      itemId: conversation.itemId,
      shareToken: conversation.shareToken,
      access_token: token
    }));
    chatSocketRef.current = socket;

    socket.onopen = () => {
      setChatError((current) =>
        current === "Не удалось подключиться к чату в реальном времени. Сообщения будут обновляться после отправки."
          ? ""
          : current
      );
    };

    socket.onmessage = (event) => {
      try {
        const incoming = JSON.parse(event.data) as ChatMessage;
        const normalized = {
          ...incoming,
          isMine: me ? incoming.senderUserId === me.id : incoming.isMine
        };
        setChatMessages((prev) => mergeChatMessage(prev, normalized));
        loadInbox().catch(() => void 0);
        const currentWishlists = myWishlistsRef.current;
        if (currentWishlists.length > 0) loadMessageNotifications(currentWishlists).catch(() => void 0);
      } catch {
        // Ignore malformed WebSocket messages and keep the chat open.
      }
    };

    socket.onerror = () => {
      setChatError("Не удалось подключиться к чату в реальном времени. Сообщения будут обновляться после отправки.");
    };

    return () => {
      socket.close();
      if (chatSocketRef.current === socket) {
        chatSocketRef.current = null;
      }
    };
  }, [token, conversation?.wishlistId, conversation?.itemId, conversation?.shareToken, me?.id]);

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
      const response = await apiRequest<AuthResponse>("/auth/login", {
        method: "POST",
        auth: false,
        body: { email: registerEmail, password: registerPassword }
      });
      resetPrivateAccountState();
      setToken(response.accessToken);
      setTokenState(response.accessToken);
      setMe(response.user);
      setLoginEmail(registerEmail);
      setAuthMode("login");
      setAuthMessage("Аккаунт создан, вы уже вошли.");
    } catch (error) {
      setAuthError(explainError(error));
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
      resetPrivateAccountState();
      setToken(response.accessToken);
      setTokenState(response.accessToken);
      setMe(response.user);
      setAuthMessage("Вы вошли.");
    } catch (error) {
      setAuthError(explainError(error));
    }
  }

  function handleLogout() {
    clearToken();
    setTokenState("");
    setMe(null);
    resetPrivateAccountState();
    setAuthMessage("");
    setAuthError("");
  }

  async function showDashboard() {
    window.history.pushState(null, "", "/");
    setPublicWishlist(null);
    setIsPublicWishlistExpired(false);
    setPublicShareToken("");
    setOpenLinkValue("");
    setPublicMessage("");
    setPublicError("");
    setSelectedPublicItemId("");
    setPublicGiftFilter("all");
    setConversation(null);
    loadMyWishlists().catch(() => void 0);
    const nextReservations = await loadReservations();
    setLibraryTab(nextReservations.length > 0 ? "giving" : "created");
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
          description: wishlistDescription || null,
          expiresAtUtc: dateInputToEndOfDayUtc(wishlistExpiresAt)
        }
      });
      setCreatedWishlist(response);
      setWishlistExpiresAt(getDefaultExpiryDateInput());
      setMyWishlists((prev) => [response, ...prev.filter((wishlist) => wishlist.id !== response.id)]);
      setWishlistMessage("Wishlist готов. Добавьте подарки и отправьте ссылку друзьям.");
    } catch (error) {
      setWishlistError(explainError(error));
    }
  }

  async function handleAddItem(e: FormEvent) {
    e.preventDefault();
    if (!createdWishlist) {
      setWishlistError("Сначала создайте wishlist.");
      return;
    }
    if (createdWishlist.items.length >= MAX_GIFTS_PER_WISHLIST) {
      setWishlistError("В один wishlist можно добавить максимум 100 подарков.");
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
      setWishlistError(explainError(error));
    }
  }

  async function loadMyWishlist(wishlistId: string) {
    const response = await apiRequest<WishlistResponse>(`/wishlists/${wishlistId}`);
    setCreatedWishlist(response);
    setMyWishlists((prev) => prev.map((wishlist) => wishlist.id === response.id ? response : wishlist));
  }

  async function loadMyWishlists() {
    const sessionVersion = accountSessionVersionRef.current;
    const response = await apiRequest<WishlistSummary[]>("/wishlists");
    if (sessionVersion !== accountSessionVersionRef.current) return;
    setMyWishlists(response);
    setCreatedWishlist((current) => {
      if (!current) return response[0] ?? null;
      return response.find((wishlist) => wishlist.id === current.id) ?? response[0] ?? null;
    });
    await loadMessageNotifications(response);
  }

  function beginNewWishlist() {
    setCreatedWishlist(null);
    setWishlistTitle("");
    setWishlistDescription("");
    setWishlistExpiresAt(getDefaultExpiryDateInput());
    setWishlistMessage("");
    setWishlistError("");
    setIsEditingWishlist(false);
    setIsWishlistActionsOpen(false);
    setConversation(null);
  }

  function beginEditWishlist() {
    if (!createdWishlist) return;
    setEditWishlistTitle(createdWishlist.title);
    setEditWishlistDescription(createdWishlist.description || "");
    setEditWishlistExpiresAt(getDateInputValue(createdWishlist.expiresAtUtc));
    setIsEditingWishlist(true);
    setIsWishlistActionsOpen(false);
    setWishlistMessage("");
    setWishlistError("");
  }

  async function updateWishlist(e: FormEvent) {
    e.preventDefault();
    if (!createdWishlist) return;

    setWishlistError("");
    setWishlistMessage("");
    try {
      const response = await apiRequest<WishlistResponse>(`/wishlists/${createdWishlist.id}`, {
        method: "PUT",
        body: {
          title: editWishlistTitle,
          description: editWishlistDescription || null,
          expiresAtUtc: dateInputToEndOfDayUtc(editWishlistExpiresAt)
        }
      });
      setCreatedWishlist(response);
      setMyWishlists((prev) => prev.map((wishlist) => wishlist.id === response.id ? response : wishlist));
      setIsEditingWishlist(false);
      setWishlistMessage("Wishlist обновлен.");
      pushToast("Wishlist обновлен", response.title);
    } catch (error) {
      setWishlistError(explainError(error, "Не получилось обновить wishlist."));
    }
  }

  async function deleteWishlist() {
    if (!createdWishlist) return;
    if (!window.confirm("Удалить wishlist вместе со всеми подарками?")) return;

    const wishlistId = createdWishlist.id;
    setWishlistError("");
    setWishlistMessage("");
    try {
      await apiRequest<void>(`/wishlists/${wishlistId}`, { method: "DELETE" });
      const nextWishlists = myWishlists.filter((wishlist) => wishlist.id !== wishlistId);
      setMyWishlists(nextWishlists);
      setCreatedWishlist(nextWishlists[0] ?? null);
      setConversation(null);
      setIsEditingWishlist(false);
      setIsWishlistActionsOpen(false);
      setWishlistMessage("Wishlist удален.");
      pushToast("Wishlist удален", "Список больше не доступен гостям.");
    } catch (error) {
      setWishlistError(explainError(error, "Не получилось удалить wishlist."));
    }
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
    setIsPublicWishlistExpired(false);
    setPublicShareToken(shareToken);
    try {
      const response = await apiRequest<PublicWishlistResponse>(`/wishlists/public/${shareToken}`, { auth: false });
      applyPublicWishlist(response);
    } catch (error) {
      if (error instanceof ApiError && error.status === 410) {
        setPublicWishlist(null);
        setIsPublicWishlistExpired(true);
        setPublicError("Wishlist больше недоступен: срок действия публичной ссылки закончился.");
        return;
      }
      setPublicError(explainError(error));
    }
  }

  async function refreshPublicWishlist(shareToken = publicShareToken) {
    if (!shareToken) return;
    try {
      const response = await apiRequest<PublicWishlistResponse>(`/wishlists/public/${shareToken}`, { auth: false });
      applyPublicWishlist(response);
    } catch (error) {
      if (error instanceof ApiError && error.status === 410) {
        setPublicWishlist(null);
        setIsPublicWishlistExpired(true);
        setPublicError("Wishlist больше недоступен: срок действия публичной ссылки закончился.");
      }
    }
  }

  function applyPublicWishlist(response: PublicWishlistResponse) {
    setIsPublicWishlistExpired(false);
    setPublicWishlist(response);
    setSelectedPublicItemId((current) => {
      if (response.items.some((item) => item.id === current)) return current;
      const firstAvailable = response.items.find((item) => !item.isReserved) ?? response.items[0];
      return firstAvailable?.id || "";
    });
  }

  async function reserveItem(itemId: string) {
    if (!publicWishlist) return;
    if (!token) {
      setPublicError("Войдите или зарегистрируйтесь, чтобы забронировать подарок. Так владелец увидит, что подарок уже выбран.");
      return;
    }
    if (isOwnPublicWishlist) {
      setPublicError("Это ваш wishlist. Чтобы проверить бронирование, выйдите из аккаунта владельца и войдите под аккаунтом друга.");
      return;
    }

    setPublicError("");
    setPublicMessage("");
    try {
      await apiRequest<WishlistItem>(`/wishlists/${publicWishlist.id}/items/${itemId}/reserve`, { method: "POST", body: {} });
      setPublicMessage("Подарок забронирован. Спасибо, что предупредили остальных.");
      pushToast("Подарок забронирован", "Бронь сохранена в вашем списке выбранных подарков.");
      await loadPublicWishlist(publicShareToken);
      await loadReservations();
      setLibraryTab("giving");
    } catch (error) {
      setPublicError(explainError(error, "Не получилось забронировать подарок."));
    }
  }

  async function unreserveItem(itemId: string) {
    if (!publicWishlist) return;
    if (!token) {
      setPublicError("Войдите или зарегистрируйтесь, чтобы отменить бронь.");
      return;
    }

    setPublicError("");
    setPublicMessage("");
    try {
      await apiRequest<WishlistItem>(`/wishlists/${publicWishlist.id}/items/${itemId}/unreserve`, { method: "POST", body: {} });
      setPublicMessage("Бронь снята. Подарок снова доступен для других.");
      pushToast("Бронь отменена", "Подарок снова свободен.");
      await loadPublicWishlist(publicShareToken);
      await loadReservations();
    } catch (error) {
      setPublicError(explainError(error, "Не получилось отменить бронь."));
    }
  }

  async function loadReservations() {
    if (!token) {
      setReservations([]);
      return [];
    }
    const sessionVersion = accountSessionVersionRef.current;
    const response = await apiRequest<MyReservation[]>("/wishlists/reservations/me");
    if (sessionVersion !== accountSessionVersionRef.current) return [];
    setReservations(response);
    return response;
  }

  async function loadInbox() {
    if (!token) {
      setInboxEvents([]);
      return;
    }
    const sessionVersion = accountSessionVersionRef.current;
    const response = await apiRequest<NotificationInboxEvent[]>("/notifications/inbox");
    if (sessionVersion !== accountSessionVersionRef.current) return;
    setInboxEvents(sortByNewest(response, (event) => event.occurredAtUtc || event.receivedAtUtc));
  }

  async function loadMessageNotifications(wishlists: WishlistSummary[]) {
    if (!token) return;
    const sessionVersion = accountSessionVersionRef.current;
    const next: MessageNotification[] = [];
    for (const wishlist of wishlists) {
      if (sessionVersion !== accountSessionVersionRef.current) return;
      for (const item of wishlist.items) {
        if (sessionVersion !== accountSessionVersionRef.current) return;
        try {
          const query = new URLSearchParams({
            wishlistId: wishlist.id,
            itemId: item.id,
            shareToken: wishlist.shareToken
          });
          const messages = await apiRequest<ChatMessage[]>(`/chat/messages?${query.toString()}`);
          const incomingMessages = messages.filter((message) => !message.isMine);
          for (const incoming of incomingMessages) {
            next.push({
              wishlistId: wishlist.id,
              shareToken: wishlist.shareToken,
              itemId: item.id,
              wishlistTitle: wishlist.title,
              itemTitle: item.title,
              senderName: incoming.senderDisplayName || incoming.author || "Гость",
              text: incoming.text,
              createdAtUtc: incoming.createdAtUtc
            });
          }
        } catch {
          // Если отдельная переписка недоступна, остальные уведомления всё равно должны загрузиться.
        }
      }
    }
    if (sessionVersion !== accountSessionVersionRef.current) return;
    setMessageNotifications(sortByNewest(next, (message) => message.createdAtUtc));
  }

  function startPublicConversation(item: WishlistItem) {
    if (!publicWishlist) return;
    if (item.isReserved && !reservedByMe.has(item.id) && !isOwnPublicWishlist) {
      setPublicError("Этот подарок уже забронирован, переписка доступна только владельцу wishlist и тому, кто его забронировал.");
      return;
    }
    setConversation({
      wishlistId: publicWishlist.id,
      itemId: item.id,
      shareToken: publicShareToken,
      title: item.title
    });
    setSelectedPublicItemId(item.id);
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

  function beginEditItem(item: WishlistItem) {
    setEditingItemId(item.id);
    setEditItemTitle(item.title);
    setEditItemUrl(item.url || "");
    setEditItemImageUrl(item.imageUrl || "");
    setEditItemPrice(item.price === null || item.price === undefined ? "" : String(item.price));
    setEditItemComment(item.comment || "");
    setWishlistMessage("");
    setWishlistError("");
  }

  function cancelEditItem() {
    setEditingItemId("");
    setEditItemTitle("");
    setEditItemUrl("");
    setEditItemImageUrl("");
    setEditItemPrice("");
    setEditItemComment("");
  }

  async function updateItem(e: FormEvent) {
    e.preventDefault();
    if (!createdWishlist || !editingItemId) return;

    setWishlistError("");
    setWishlistMessage("");
    try {
      await apiRequest<WishlistItem>(`/wishlists/${createdWishlist.id}/items/${editingItemId}`, {
        method: "PUT",
        body: {
          title: editItemTitle,
          url: editItemUrl || null,
          imageUrl: editItemImageUrl || null,
          price: editItemPrice ? Number(editItemPrice) : null,
          comment: editItemComment || null
        }
      });
      await loadMyWishlist(createdWishlist.id);
      cancelEditItem();
      setWishlistMessage("Подарок обновлен.");
      pushToast("Подарок обновлен", editItemTitle);
    } catch (error) {
      setWishlistError(explainError(error, "Не получилось обновить подарок."));
    }
  }

  async function deleteItem(item: WishlistItem) {
    if (!createdWishlist) return;
    if (!window.confirm(`Удалить подарок "${item.title}"?`)) return;

    setWishlistError("");
    setWishlistMessage("");
    try {
      await apiRequest<void>(`/wishlists/${createdWishlist.id}/items/${item.id}`, { method: "DELETE" });
      await loadMyWishlist(createdWishlist.id);
      if (editingItemId === item.id) cancelEditItem();
      setWishlistMessage("Подарок удален.");
      pushToast("Подарок удален", item.title);
    } catch (error) {
      setWishlistError(explainError(error, "Не получилось удалить подарок."));
    }
  }

  async function openTimelineNotification(item: TimelineNotification) {
    if (item.kind === "message") {
      let wishlist = myWishlists.find((entry) => entry.id === item.message.wishlistId) ?? null;
      if (!wishlist) {
        wishlist = await apiRequest<WishlistResponse>(`/wishlists/${item.message.wishlistId}`).catch(() => null);
      }
      if (wishlist) {
        setCreatedWishlist(wishlist);
      }
      setConversation({
        wishlistId: item.message.wishlistId,
        itemId: item.message.itemId,
        shareToken: item.message.shareToken,
        title: item.message.itemTitle
      });
      loadChatMessages(item.message.wishlistId, item.message.itemId, item.message.shareToken).catch(() => void 0);
      scrollToElement(`conversation-${item.message.itemId}`, "start", 220);
      return;
    }

    let wishlist = myWishlists.find((entry) => entry.id === item.event.wishlistId) ?? null;
    if (!wishlist) {
      wishlist = await apiRequest<WishlistResponse>(`/wishlists/${item.event.wishlistId}`).catch(() => null);
    }
    if (wishlist) {
      setCreatedWishlist(wishlist);
    }
    setConversation(null);
    scrollToElement(`owner-item-${item.event.itemId}`);
  }

  async function loadChatMessages(wishlistId: string, itemId: string, shareToken: string) {
    if (!token) {
      setChatMessages([]);
      return;
    }
    const sessionVersion = accountSessionVersionRef.current;
    setChatError("");
    try {
      const query = new URLSearchParams({ wishlistId, itemId, shareToken });
      const response = await apiRequest<ChatMessage[]>(`/chat/messages?${query.toString()}`);
      if (sessionVersion !== accountSessionVersionRef.current) return;
      setChatMessages(sortChatMessages(response));
    } catch (error) {
      if (sessionVersion !== accountSessionVersionRef.current) return;
      setChatError(explainError(error, "Не получилось загрузить сообщения."));
    }
  }

  async function sendChatMessage(e: FormEvent) {
    e.preventDefault();
    if (!conversation) return;
    if (!token) {
      setChatError("Войдите или зарегистрируйтесь, чтобы задать вопрос по подарку.");
      return;
    }

    const text = chatText.trim();
    if (!text) {
      setChatError("Введите сообщение.");
      return;
    }

    setChatError("");
    setChatMessage("");
    try {
      const socket = chatSocketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ text }));
        setChatText("");
        showTemporaryChatMessage("Сообщение отправлено.");
        return;
      }

      const response = await apiRequest<ChatMessage>("/chat/messages", {
        method: "POST",
        body: {
          wishlistId: conversation.wishlistId,
          itemId: conversation.itemId,
          shareToken: conversation.shareToken,
          text
        }
      });
      setChatMessages((prev) => mergeChatMessage(prev, response));
      setChatText("");
      showTemporaryChatMessage("Сообщение отправлено.");
      await loadInbox();
      if (myWishlists.length > 0) await loadMessageNotifications(myWishlists);
    } catch (error) {
      setChatError(explainError(error, "Не получилось отправить сообщение."));
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
            : "После регистрации вы сразу попадёте в аккаунт."}
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
    <div className="chat-drawer-backdrop" onClick={() => setConversation(null)}>
      <aside className="chat-drawer" id={`conversation-${conversation.itemId}`} onClick={(event) => event.stopPropagation()}>
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
          <article
            className={[
              "message",
              message.isMine ? "mine" : "",
              message.senderUserId === conversationOwnerUserId ? "owner-message" : ""
            ].filter(Boolean).join(" ")}
            key={message.id}
          >
            <span>
              {message.isMine
                ? "Вы"
                : message.senderUserId === conversationOwnerUserId
                  ? `Владелец wishlist · ${normalizeDisplayText(message.senderDisplayName || message.author)}`
                  : normalizeDisplayText(message.senderDisplayName || message.author)}
            </span>
            <p>{normalizeDisplayText(message.text)}</p>
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
      </aside>
    </div>
  );

  const notificationStack = (
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toastNotifications.map((toast) => (
        <article
          className={toast.action ? "toast clickable-toast" : "toast"}
          key={toast.id}
          onClick={() => toast.action && openTimelineNotification(toast.action)}
          onKeyDown={(event) => {
            if (toast.action && (event.key === "Enter" || event.key === " ")) openTimelineNotification(toast.action);
          }}
          tabIndex={toast.action ? 0 : undefined}
        >
          <strong>{normalizeDisplayText(toast.title)}</strong>
          <span>{normalizeDisplayText(toast.description)}</span>
        </article>
      ))}
    </div>
  );

  if (isPublicRoute || publicWishlist) {
    return (
      <div className="app-shell public-page">
        <header className="topbar">
          <button className="brand brand-button" type="button" onClick={showDashboard}>wishlist service</button>
          <div className="topbar-actions">
            {me ? <span className="user-pill">{me.displayName || me.email}</span> : <a className="secondary-link" href="#auth">Войти</a>}
            {me && <button className="secondary small" onClick={showDashboard}>Мои вишлисты</button>}
            {me && <button className="secondary small" onClick={handleLogout}>Выйти</button>}
          </div>
        </header>
        {notificationStack}

        <main className="page">
          {!publicWishlist && (
            <section className="panel center-panel">
              <h1>{isPublicWishlistExpired ? "Wishlist больше недоступен" : "Wishlist не найден"}</h1>
              <p className="muted">
                {isPublicWishlistExpired
                  ? "Срок действия публичной ссылки закончился. Попросите владельца создать новый wishlist или продлить текущий."
                  : publicError || "Проверьте публичную ссылку и попробуйте снова."}
              </p>
            </section>
          )}

          {publicWishlist && (
            <>
              <section className="public-hero">
                <p className="eyebrow">Публичный wishlist</p>
                <h1>{publicWishlist.title}</h1>
                <p>{publicWishlist.description || "Автор собрал здесь идеи подарков, которые точно пригодятся."}</p>
                <p className="gift-recipient">Подарок для: {normalizeDisplayText(publicWishlist.ownerDisplayName) || "владельца wishlist"}</p>
                <p className="muted">Доступен до {formatDateOnly(publicWishlist.expiresAtUtc)}</p>
              </section>

              <section className="public-toolbar" aria-label="Фильтр подарков">
                <div>
                  <strong>{publicWishlist.items.filter((item) => !item.isReserved).length} свободно</strong>
                  <span>{publicWishlist.items.length} всего</span>
                </div>
                <div className="segmented-control">
                  <button className={publicGiftFilter === "all" ? "active" : ""} type="button" onClick={() => setPublicGiftFilter("all")}>Все</button>
                  <button className={publicGiftFilter === "available" ? "active" : ""} type="button" onClick={() => setPublicGiftFilter("available")}>Свободные</button>
                  <button className={publicGiftFilter === "reservedByMe" ? "active" : ""} type="button" onClick={() => setPublicGiftFilter("reservedByMe")}>Забронированы мной</button>
                </div>
              </section>

              <section className="gift-grid">
                {publicGiftItems.map((item) => (
                  <article
                    className={[
                      "product-card",
                      item.isReserved && !reservedByMe.has(item.id) ? "reserved-card" : "",
                      reservedByMe.has(item.id) ? "reserved-by-me-card" : "",
                      selectedPublicItem?.id === item.id ? "selected-card" : ""
                    ].filter(Boolean).join(" ")}
                    id={`public-item-${item.id}`}
                    key={item.id}
                  >
                    <GiftImage item={item} />
                    <div className="product-content">
                      <div className="product-title">
                        <h3>{item.title}</h3>
                        <span className={item.isReserved ? "status-pill reserved" : "status-pill"}>
                          {reservedByMe.has(item.id) ? "Я забронировал" : item.isReserved ? "Забронировано" : "Свободно"}
                        </span>
                      </div>
                      <p>{item.comment || "Если нужны детали, можно задать вопрос владельцу."}</p>
                      <div className="product-meta">
                        <strong>{formatPrice(item.price)}</strong>
                        {item.url && <a href={item.url} target="_blank" rel="noreferrer">Открыть магазин</a>}
                      </div>
                      <div className="card-actions">
                        {!me ? (
                          <a className="button" href="#auth">Войти, чтобы забронировать</a>
                        ) : reservedByMe.has(item.id) ? (
                          <button className="secondary" onClick={() => unreserveItem(item.id)}>Отменить бронь</button>
                        ) : (
                          <button disabled={item.isReserved || isOwnPublicWishlist} onClick={() => reserveItem(item.id)}>
                            {isOwnPublicWishlist ? "Ваш wishlist" : item.isReserved ? "Уже занято" : "Забронировать"}
                          </button>
                        )}
                        <button
                          className="secondary"
                          disabled={item.isReserved && !reservedByMe.has(item.id) && !isOwnPublicWishlist}
                          onClick={() => startPublicConversation(item)}
                        >
                          {item.isReserved && !reservedByMe.has(item.id) && !isOwnPublicWishlist ? "Вопросы недоступны" : "Задать вопрос"}
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
                {publicGiftItems.length === 0 && (
                  <p className="empty">В этом фильтре нет подарков. Переключитесь на “Все”, чтобы посмотреть весь wishlist.</p>
                )}
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
        <a className="brand" href="/">wishlist service</a>
        <div className="topbar-actions">
          {me ? <span className="user-pill">{me.displayName || me.email}</span> : <a className="secondary-link" href="#auth">Войти</a>}
          {me && (
            <a
              className="button secondary small"
              href="#my-wishlists"
              onClick={async () => {
                loadMyWishlists().catch(() => void 0);
                const nextReservations = await loadReservations();
                if (nextReservations.length > 0) setLibraryTab("giving");
              }}
            >
              Мои вишлисты
            </a>
          )}
          {me && <button className="secondary small" onClick={handleLogout}>Выйти</button>}
        </div>
      </header>
      {notificationStack}

      <main className="page">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">wishlist service</p>
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
              <section id="my-wishlists" className="panel library-panel">
                <div className="panel-heading">
                  <div>
                    <p className="eyebrow">Мои вишлисты</p>
                    <h2>Ваши списки и подарки</h2>
                  </div>
                  <div className="segmented-control" aria-label="Разделы моих вишлистов">
                    <button
                      className={libraryTab === "created" ? "active" : ""}
                      onClick={() => setLibraryTab("created")}
                      type="button"
                    >
                      Я создал
                    </button>
                    <button
                      className={libraryTab === "giving" ? "active" : ""}
                      onClick={() => setLibraryTab("giving")}
                      type="button"
                    >
                      Я дарю
                    </button>
                  </div>
                </div>

                {libraryTab === "created" ? (
                  <div className="compact-list">
                    {myWishlists.map((wishlist) => (
                      <article key={wishlist.id}>
                        <div>
                          <strong>{wishlist.title}</strong>
                          <span>{wishlist.items.length} подарков · до {formatDateOnly(wishlist.expiresAtUtc)}</span>
                        </div>
                        <button className="secondary small" onClick={() => setCreatedWishlist(wishlist)}>Открыть</button>
                      </article>
                    ))}
                    {myWishlists.length === 0 && <p className="empty">Вы ещё не создавали wishlist. Создайте первый список ниже и добавьте подарки.</p>}
                    <button className="secondary full-width-action" type="button" onClick={beginNewWishlist}>Создать ещё один wishlist</button>
                  </div>
                ) : (
                  <div className="compact-list">
                    {reservations.map((reservation) => (
                      <article key={reservation.itemId}>
                        <div>
                          <strong>{reservation.itemTitle}</strong>
                          <span>{reservation.wishlistTitle}</span>
                          <span>Подарок для: {normalizeDisplayText(reservation.ownerDisplayName) || "владельца wishlist"}</span>
                        </div>
                        <a className="button secondary small" href={`/wishlist/${reservation.shareToken}`}>Открыть</a>
                      </article>
                    ))}
                    {reservations.length === 0 && <p className="empty">Вы пока не выбрали подарки для друзей. Откройте ссылку друга, чтобы выбрать подарок.</p>}
                  </div>
                )}
              </section>

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
                    {createdWishlist && (
                      <div className="meta-row">
                        <p className="gift-recipient">Подарок для: {normalizeDisplayText(createdWishlist.ownerDisplayName || me?.displayName) || "меня"}</p>
                        <p className="gift-recipient">Доступен до {formatDateOnly(createdWishlist.expiresAtUtc)}</p>
                      </div>
                    )}
                  </div>
                  {createdWishlist && (
                    <div className="button-column">
                      <button className="secondary" onClick={copyPublicLink}>Скопировать ссылку</button>
                      <button className="secondary" type="button" onClick={() => setIsWishlistActionsOpen((current) => !current)}>
                        {isWishlistActionsOpen ? "Скрыть действия" : "Ещё действия"}
                      </button>
                      {isWishlistActionsOpen && (
                        <div className="action-menu">
                          <button className="secondary" onClick={beginEditWishlist}>Редактировать</button>
                          <button className="secondary danger" onClick={deleteWishlist}>Удалить</button>
                        </div>
                      )}
                    </div>
                  )}
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
                    <label>
                      Доступен до
                      <input type="date" value={wishlistExpiresAt} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setWishlistExpiresAt(e.target.value)} />
                    </label>
                    <button type="submit">Создать wishlist</button>
                  </form>
                ) : (
                  <>
                    {isEditingWishlist && (
                      <form className="stack-form edit-form" onSubmit={updateWishlist}>
                        <label>
                          Название
                          <input value={editWishlistTitle} onChange={(e) => setEditWishlistTitle(e.target.value)} />
                        </label>
                        <label>
                          Описание
                          <input value={editWishlistDescription} onChange={(e) => setEditWishlistDescription(e.target.value)} />
                        </label>
                        <label>
                          Доступен до
                          <input type="date" value={editWishlistExpiresAt} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setEditWishlistExpiresAt(e.target.value)} />
                        </label>
                        <div className="form-actions">
                          <button type="submit">Сохранить</button>
                          <button className="secondary" type="button" onClick={() => setIsEditingWishlist(false)}>Отмена</button>
                        </div>
                      </form>
                    )}
                    <div className="share-preview">
                      <span>Публичная ссылка</span>
                      <strong>{publicLink}</strong>
                    </div>
                  </>
                )}

                {(wishlistMessage || wishlistError) && <p className={wishlistError ? "notice error" : "notice ok"}>{wishlistError || wishlistMessage}</p>}
              </section>

              {createdWishlist && (
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <p className="eyebrow">Новый подарок</p>
                      <h2>Добавить подарок</h2>
                      {createdWishlist.items.length >= MAX_GIFTS_PER_WISHLIST && (
                        <p className="muted">В этом wishlist уже 100 подарков.</p>
                      )}
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
                    <button type="submit" disabled={createdWishlist.items.length >= MAX_GIFTS_PER_WISHLIST}>Добавить подарок</button>
                  </form>
                </section>
              )}

              {createdWishlist && (
                <section className="gift-grid owner-grid">
                  {createdWishlist.items.map((item) => (
                    <article className="product-card" id={`owner-item-${item.id}`} key={item.id}>
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
                        {editingItemId === item.id && (
                          <form className="item-form edit-item-form" onSubmit={updateItem}>
                            <label>
                              Название
                              <input value={editItemTitle} onChange={(e) => setEditItemTitle(e.target.value)} />
                            </label>
                            <label>
                              Фото
                              <input value={editItemImageUrl} onChange={(e) => setEditItemImageUrl(e.target.value)} />
                            </label>
                            <label>
                              Магазин
                              <input value={editItemUrl} onChange={(e) => setEditItemUrl(e.target.value)} />
                            </label>
                            <label>
                              Цена
                              <input value={editItemPrice} onChange={(e) => setEditItemPrice(e.target.value)} inputMode="decimal" />
                            </label>
                            <label className="wide">
                              Комментарий
                              <input value={editItemComment} onChange={(e) => setEditItemComment(e.target.value)} />
                            </label>
                            <div className="form-actions wide">
                              <button type="submit">Сохранить</button>
                              <button className="secondary" type="button" onClick={cancelEditItem}>Отмена</button>
                            </div>
                          </form>
                        )}
                        <div className="card-actions">
                          <button className="secondary" onClick={() => startOwnerConversation(item)}>Открыть вопросы</button>
                          <button className="secondary" onClick={() => beginEditItem(item)}>Редактировать</button>
                          <button className="secondary danger" onClick={() => deleteItem(item)}>Удалить</button>
                        </div>
                      </div>
                    </article>
                  ))}
                  {createdWishlist.items.length === 0 && <p className="empty">Пока нет подарков. Добавьте первую хотелку выше.</p>}
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
                      <div>
                        <strong>{reservation.itemTitle}</strong>
                        <span>{reservation.wishlistTitle}</span>
                        <span>Подарок для: {normalizeDisplayText(reservation.ownerDisplayName) || "владельца wishlist"}</span>
                      </div>
                      <a className="button secondary small" href={`/wishlist/${reservation.shareToken}`}>Открыть</a>
                    </article>
                  ))}
                  {reservations.length === 0 && <p className="empty">Вы пока ничего не бронировали. Откройте ссылку друга, чтобы выбрать подарок.</p>}
                </div>
              </section>

              <section id="questions" className="panel notification-panel">
                <p className="eyebrow">Уведомления</p>
                <h2>События</h2>
                <div className="notification-scroll">
                  <div className="compact-list notification-list">
                    {timelineNotifications.map((item) => (
                      item.kind === "message" ? (
                        <article
                          key={item.id}
                          className="clickable-list-item"
                          onClick={() => openTimelineNotification(item)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") openTimelineNotification(item);
                          }}
                          tabIndex={0}
                        >
                          <div>
                            <strong>Новый вопрос по подарку</strong>
                            <span>{normalizeDisplayText(item.message.senderName)}: {normalizeDisplayText(item.message.text)}</span>
                            <span>{normalizeDisplayText(item.message.wishlistTitle)} · {normalizeDisplayText(item.message.itemTitle)} · {formatDate(item.message.createdAtUtc)}</span>
                          </div>
                        </article>
                      ) : (
                        <article
                          key={item.id}
                          className="clickable-list-item"
                          onClick={() => openTimelineNotification(item)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") openTimelineNotification(item);
                          }}
                          tabIndex={0}
                        >
                          <div>
                            <strong>{notificationTitle(item.event.eventType)}</strong>
                            <span>{normalizeDisplayText(notificationDescription(item.event))}</span>
                            <span>{formatDate(item.event.occurredAtUtc || item.event.receivedAtUtc)}</span>
                          </div>
                        </article>
                      )
                    ))}
                  </div>
                  {timelineNotifications.length === 0 && <p className="empty">Новых событий пока нет. Когда кто-то забронирует подарок или задаст вопрос, событие появится здесь.</p>}
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
