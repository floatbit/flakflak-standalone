import {
  readDraftFiles,
  writeDraftFiles,
  clearDraftFiles,
} from "./draft-files";
import { api, json, readStored, store, ApiError } from "../../shared/api";
import type {
  Anchor,
  Attachment,
  Comment,
  WidgetSession,
  Page,
  Reply,
  Status,
  Thread,
  Activity,
  Site,
} from "../../shared/types";
import { anchorAt, resolveAnchor } from "./anchors";
import css from "./widget.css?inline";
import {
  preferences,
  themes,
  panelPlacement,
  pageIdentity,
} from "./preferences";
import type { Preferences } from "./preferences";

const script = document.currentScript as HTMLScriptElement | null;
const siteId = script?.dataset.siteId;
const base = script?.dataset.apiUrl || import.meta.env.VITE_API_URL;
if (siteId && base && !document.querySelector("[data-flakflak-root]"))
  start(siteId, base);

function start(siteId: string, base: string) {
  const host = document.createElement("flakflak-widget");
  host.dataset.flakflakRoot = "";
  host.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
  // The page can style a shadow host, so pin only its overlay and native typography.
  for (const [name, value] of Object.entries({
    position: "fixed",
    inset: "0",
    margin: "0",
    padding: "0",
    border: "0",
    background: "transparent",
    "pointer-events": "none",
    "z-index": "2147483646",
    "font-family":
      'var(--ff-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif)',
    "font-size": "var(--ff-font-size, 14px)",
    "font-weight": "400",
    "line-height": "1.5",
    color: "var(--ff-text)",
  }))
    host.style.setProperty(name, value, "important");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  shadow.append(style);
  document.documentElement.append(host);
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text = "",
    cls = "",
  ) => {
    const n = document.createElement(tag);
    n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const button = (text: string, fn: () => void | Promise<void>, cls = "") => {
    const b = el("button", text, cls);
    b.type = "button";
    b.addEventListener("click", () => {
      Promise.resolve(fn()).catch(showError);
    });
    return b;
  };
  const statuses: Status[] = ["open", "review", "content", "closed"];
  const colors: Record<Status, string> = {
    open: "#ffaf99",
    review: "#83d4ff",
    content: "#ddbcff",
    closed: "#9de0b9",
  };
  const preferenceKey = "flakflak:preferences:" + siteId;
  let prefs = preferences(readStored<unknown>(preferenceKey, null));
  function applyPreferences() {
    host.dataset.theme = prefs.theme;
    host.dataset.side = prefs.side;
    host.dataset.size = prefs.size;
    host.dataset.paused = String(prefs.pauseAnimations);
    host.dataset.hideDots = String(prefs.hideDots);
  }
  applyPreferences();
  function setPreference<K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) {
    prefs = preferences({ ...prefs, [key]: value });
    store(preferenceKey, prefs);
    applyPreferences();
    schedule();
  }
  addEventListener("storage", (e) => {
    if (e.key === preferenceKey) {
      prefs = preferences(readStored<unknown>(preferenceKey, null));
      applyPreferences();
      renderSidebar();
      schedule();
    }
  });
  const dotColors: Record<Status, string> = {
    open: "#FF5733",
    review: "#168BD2",
    content: "#9333EA",
    closed: "#3CAE63",
  };
  let siteStatusFilter: Status | null = null;
  const sitePath = "/sites/" + siteId;
  let site: Site | null = null,
    comments: Comment[] = [],
    pages: Page[] = [],
    thread: Thread | null = null;
  const identityKey = "flakflak:member:" + siteId;
  let guest = readStored<WidgetSession | null>(identityKey, null);
  if (
    guest &&
    (typeof guest.id !== "string" ||
      typeof guest.token !== "string" ||
      typeof guest.name !== "string" ||
      !Number.isFinite(Date.parse(guest.expires_at)) ||
      Date.parse(guest.expires_at) <= Date.now())
  )
    guest = null;
  let activeAnchor: Anchor | null = null,
    sidebarOpen =
      readStored<boolean>("flakflak:sidebar-open:" + siteId, false) === true,
    armed = false,
    busy = false,
    revision = 0,
    newId: string = crypto.randomUUID(),
    savedId: number | null = null,
    newBody = "",
    newStatus: "open" | "content" = "open",
    replyId = crypto.randomUUID();
  let siteQuery = "",
    siteSearchPage = 1,
    siteSearchMore = false,
    siteSearchTotal = 0,
    siteSearchRevision = 0;
  let siteResults: {
    id: number;
    body: string;
    name: string;
    title: string;
    url: string;
    status: Status;
  }[] = [];
  let searchTimer: ReturnType<typeof setTimeout> | undefined;
  type PendingUpload = { file: File; id: string; error?: string };
  const threadUploads = new Map<number, PendingUpload[]>();
  const anonymousReadKey = "flakflak:read:" + siteId;
  let anonymousRead = readStored<Record<number, number>>(anonymousReadKey, {});
  let unreadOnly = false,
    activityUnreadOnly = false,
    markingRead = false;
  let reattaching: {
    original: Thread;
    anchor: Anchor | null;
    sidebarWasOpen: boolean;
    banner: HTMLElement;
  } | null = null;
  let cancelDrag: (() => void) | null = null,
    suppressDotClickUntil = 0;
  function isUnread(c: Comment) {
    return (
      !!c.unread &&
      (!!guest || (anonymousRead[c.id] || 0) < (c.latest_activity_id || 0))
    );
  }
  async function markSeen(t: Thread) {
    const id = t.comment.id,
      snapshot = t.latest_activity_id;
    if (guest)
      await request("/read", {
        method: "POST",
        body: json({ items: [{ id, activity_id: snapshot }] }),
      });
    else {
      anonymousRead[id] = Math.max(anonymousRead[id] || 0, snapshot);
      store(anonymousReadKey, anonymousRead);
    }
    for (const comment of comments)
      if (comment.id === id && (comment.latest_activity_id || 0) <= snapshot)
        comment.unread = false;
    for (const event of events)
      if (event.comment_id === id && event.id <= snapshot) event.unread = false;
    renderSidebar();
  }
  let pending: { file: File; id: string; url: string }[] = [];
  let search = "",
    showClosed = readStored("flakflak:closed:" + siteId, false),
    view: "comments" | "activity" | "settings" = "comments";
  let previousView: "comments" | "activity" = "comments";
  let threadRevision = 0;
  let events: Activity[] = [],
    activityBefore: number | null = null,
    activityMore = false,
    previousFocus: HTMLElement | null = null;
  const dots = el("div"),
    sidebar = el("aside", "", "sidebar hide"),
    panel = el("section", "", "panel hide");
  sidebar.setAttribute("aria-label", "FlakFlak sidebar");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Comment");
  const launch = button(
    "FlakFlak · Feedback",
    async () => {
      await ensureMember();
      setSidebarOpen(!sidebarOpen);
    },
    "launcher",
  );
  launch.setAttribute("aria-label", "FlakFlak · Feedback");
  shadow.append(dots, sidebar, panel, launch);
  function request<T>(path: string, options: RequestInit = {}) {
    if (options.method && options.method !== "GET" && site?.feedback_version) {
      const headers = new Headers(options.headers);
      headers.set("X-Feedback-Version", String(site.feedback_version));
      options = { ...options, headers };
    }
    return api<T>(
      base,
      sitePath + path + (path.includes("?") ? "&" : "?") + "reply_limit=2",
      options,
      guest?.token,
    );
  }
  function showError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      error instanceof ApiError &&
      (error.status === 401 || error.status === 403)
    ) {
      guest = null;
      store(identityKey, null);
      comments = [];
      pages = [];
      events = [];
      thread = null;
      activeAnchor = null;
      clearMedia();
      dots.replaceChildren();
      panel.classList.add("hide");
      sidebar.classList.add("hide");
      sidebarOpen = false;
    }
    const box = el("div", message, "float-note");
    box.setAttribute("role", "alert");
    box.append(button("Dismiss", () => box.remove()));
    shadow.append(box);
  }
  function date(value: string) {
    const time = new Date(
      value.includes("T") ? value : value.replace(" ", "T") + "Z",
    ).getTime();
    if (!Number.isFinite(time)) return "";
    const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
    if (seconds < 60) return "just now";
    const units: [number, string][] = [
      [31536000, "year"],
      [2592000, "month"],
      [86400, "day"],
      [3600, "hour"],
      [60, "minute"],
    ];
    for (const [size, label] of units) {
      if (seconds >= size) {
        const count = Math.floor(seconds / size);
        return count + " " + label + (count === 1 ? "" : "s") + " ago";
      }
    }
    return "just now";
  }
  function titlebar(title: string, close: () => void) {
    const h = el("div", "", "titlebar");
    h.append(el("strong", title), button("×", close));
    h.lastElementChild?.setAttribute("aria-label", "Close");
    return h;
  }
  function syncBusyControls() {
    panel
      .querySelectorAll<
        | HTMLButtonElement
        | HTMLInputElement
        | HTMLTextAreaElement
        | HTMLSelectElement
      >("button,input,textarea,select")
      .forEach((control) => {
        if (busy) {
          if (control.dataset.wasDisabled === undefined)
            control.dataset.wasDisabled = String(control.disabled);
          control.disabled = true;
        } else if (control.dataset.wasDisabled !== undefined) {
          control.disabled = control.dataset.wasDisabled === "true";
          delete control.dataset.wasDisabled;
        }
      });
  }
  async function perform(fn: () => Promise<void>) {
    if (busy) return;
    busy = true;
    panel.setAttribute("aria-busy", "true");
    syncBusyControls();
    try {
      await fn();
    } catch (e) {
      showError(e);
    } finally {
      busy = false;
      panel.removeAttribute("aria-busy");
      syncBusyControls();
    }
  }
  let authentication: Promise<void> | null = null;
  const dashboardUrl =
    import.meta.env.VITE_DASHBOARD_URL || "http://app-flakflak.localhost";
  async function ensureMember(): Promise<void> {
    if (guest) return;
    if (authentication) return authentication;
    authentication = new Promise<void>((resolve, reject) => {
      const backdrop = el("div", "", "backdrop"),
        dialog = el("section", "", "name-dialog"),
        body = el("div", "", "body");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-label", "Sign in to FlakFlak");
      let popup: Window | null = null,
        verifier = "",
        state = "",
        complete = false;
      const manual = el("input"),
        message = el(
          "p",
          "Sign in with your invited email. Only site members can view or leave feedback.",
        );
      manual.placeholder = "One-time connection code";
      manual.setAttribute("aria-label", "Connection code");
      const cleanup = () => {
        window.removeEventListener("message", onMessage);
        dialog.remove();
        backdrop.remove();
      };
      const finish = async (code: string) => {
        try {
          if (!verifier)
            throw Error("Open sign-in first to start a secure connection.");
          guest = await api<WidgetSession>(base, sitePath + "/auth/exchange", {
            method: "POST",
            body: json({ code, verifier }),
          });
          store(identityKey, guest);
          await load();
          complete = true;
          cleanup();
          resolve();
        } catch (e) {
          message.textContent = (e as Error).message;
        }
      };
      const onMessage = (event: MessageEvent) => {
        if (
          event.origin !== new URL(dashboardUrl).origin ||
          event.source !== popup ||
          event.data?.type !== "flakflak:authorized" ||
          event.data.state !== state
        )
          return;
        if (typeof event.data.code === "string") void finish(event.data.code);
      };
      window.addEventListener("message", onMessage);
      const open = button(
        "Sign in",
        async () => {
          popup = window.open(
            "about:blank",
            "flakflak-sign-in",
            "popup,width=540,height=740",
          );
          verifier = Array.from(
            crypto.getRandomValues(new Uint8Array(32)),
            (n) => n.toString(16).padStart(2, "0"),
          ).join("");
          state = crypto.randomUUID();
          const hash = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(verifier),
          );
          const challenge = Array.from(new Uint8Array(hash), (n) =>
            n.toString(16).padStart(2, "0"),
          ).join("");
          const url = new URL(dashboardUrl);
          url.searchParams.set("connect", siteId);
          url.searchParams.set("origin", location.origin);
          url.searchParams.set("state", state);
          url.searchParams.set("challenge", challenge);
          if (popup) popup.location.href = url.href;
          fallback.href = url.href;
          fallback.classList.remove("hide");
          message.textContent =
            "Complete email sign-in in the FlakFlak window, then click Connect widget. If the email opens another tab, return to that sign-in window afterwards.";
        },
        "primary",
      );
      const fallback = el("a", "Open sign-in in a new tab", "hide");
      fallback.target = "_blank";
      fallback.rel = "noopener";
      const cancel = () => {
        if (complete) return;
        cleanup();
        reject(Error("Sign-in cancelled."));
      };
      dialog.append(titlebar("Sign in to FlakFlak", cancel), body);
      body.append(
        message,
        open,
        fallback,
        el(
          "p",
          "If your browser blocks the connection, paste the one-time code here.",
        ),
        manual,
        button("Connect", () => finish(manual.value.trim())),
      );
      dialog.onkeydown = (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          cancel();
        }
      };
      shadow.append(backdrop, dialog);
      open.focus();
    });
    try {
      await authentication;
    } finally {
      authentication = null;
    }
  }
  let closeAttachmentViewer: (() => void) | null = null;
  const privateMedia = new Map<string, Promise<string>>();
  function clearMedia() {
    closeAttachmentViewer?.();
    for (const promise of privateMedia.values())
      void promise.then((url) => URL.revokeObjectURL(url)).catch(() => {});
    privateMedia.clear();
  }
  function setMediaSource(
    node: HTMLImageElement | HTMLVideoElement,
    file: Attachment,
  ) {
    const key = (guest?.token || "") + ":" + file.id;
    if (!privateMedia.has(key))
      privateMedia.set(
        key,
        (async () => {
          const response = await fetch(file.url, {
            headers: { Authorization: "Bearer " + guest?.token },
            credentials: "omit",
            cache: "no-store",
          });
          if (!response.ok)
            throw new ApiError(
              "Sign in to view this attachment.",
              response.status,
            );
          return URL.createObjectURL(await response.blob());
        })(),
      );
    void privateMedia
      .get(key)!
      .then((url) => {
        if (node.isConnected) node.src = url;
        else
          queueMicrotask(() => {
            if (node.isConnected) node.src = url;
          });
      })
      .catch(showError);
  }
  async function syncSite() {
    const next = await request<Site>("/config");
    const versionKey = "flakflak:feedback-version:" + siteId,
      previous = readStored<number | null>(versionKey, null);
    if (previous !== null && previous !== next.feedback_version) {
      const prefix = "flakflak:draft:" + siteId + ":";
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key?.startsWith(prefix)) localStorage.removeItem(key);
      }
      await draftFileWrite;
      await clearDraftFiles(prefix);
      pending.forEach((item) => URL.revokeObjectURL(item.url));
      pending = [];
      threadUploads.clear();
      clearMedia();
      thread = null;
      activeAnchor = null;
      panel.classList.add("hide");
      showError(
        Error(
          "Feedback was reset by the site owner. Previous drafts were cleared.",
        ),
      );
    }
    store(versionKey, next.feedback_version || 1);
    site = next;
    if (guest) {
      guest.id = next.participant_id || guest.id;
      guest.role = next.role;
      store(identityKey, guest);
    }
  }
  async function load() {
    if (!guest) return;
    await syncSite();
    const token = ++revision;
    let all: Comment[] = [],
      before: number | null = null;
    do {
      const data: {
        comments: Comment[];
        more: boolean;
        before: number | null;
      } = await request<{
        comments: Comment[];
        more: boolean;
        before: number | null;
      }>(
        "/comments?url=" +
          encodeURIComponent(location.href) +
          (before ? "&before=" + before : ""),
      );
      if (token !== revision) return;
      all.push(...data.comments);
      before = data.more ? data.before : null;
    } while (before);
    const p = await request<Page[]>("/pages");
    if (token !== revision) return;
    comments = all;
    pages = p;
    renderDots();
    renderSidebar();
  }
  function renderDots() {
    dots.replaceChildren();
    for (const c of comments) {
      if (c.status === "closed" && !showClosed) continue;
      const b = button(
        "#" + c.id,
        () => {
          if (performance.now() >= suppressDotClickUntil)
            return openThread(c.id);
        },
        "dot",
      );
      b.addEventListener("pointerdown", (event) => {
        if (event.altKey) startDrag(event, b, c);
      });
      b.textContent = "";
      b.dataset.commentId = String(c.id);
      b.style.setProperty("--status", colors[c.status]);
      b.style.setProperty("--dot-color", dotColors[c.status]);
      b.setAttribute("aria-label", "Open comment #" + c.id + " · " + c.status);
      dots.append(b);
    }
    if (activeAnchor) {
      const b = el("div", "", "dot");
      b.dataset.draft = "true";
      b.tabIndex = 0;
      b.setAttribute("role", "button");
      b.setAttribute("aria-label", "Move new comment dot");
      b.addEventListener("pointerdown", (event) => startDrag(event, b));
      b.addEventListener("keydown", (event) => {
        const offsets: Record<string, [number, number]> = {
          ArrowLeft: [-1, 0],
          ArrowRight: [1, 0],
          ArrowUp: [0, -1],
          ArrowDown: [0, 1],
        };
        const delta = offsets[event.key];
        if (!delta || busy || !activeAnchor) return;
        event.preventDefault();
        const point = resolveAnchor(activeAnchor),
          step = event.shiftKey ? 10 : 2,
          x = Math.max(0, Math.min(innerWidth - 1, point.x + delta[0] * step)),
          y = Math.max(0, Math.min(innerHeight - 1, point.y + delta[1] * step)),
          target = pageTarget(x, y);
        if (!target) return;
        activeAnchor = anchorAt(target, x, y);
        saveNewDraft();
        renderDots();
        position();
        dots.querySelector<HTMLElement>("[data-draft]")?.focus();
      });
      b.style.setProperty("--status", colors[newStatus]);
      b.style.setProperty("--dot-color", dotColors[newStatus]);
      dots.append(b);
    }
    if (reattaching?.anchor) {
      const preview = el("div", "", "dot");
      preview.dataset.preview = "true";
      preview.style.setProperty(
        "--dot-color",
        dotColors[reattaching?.original.comment.status || newStatus],
      );
      preview.style.setProperty(
        "--status",
        colors[reattaching.original.comment.status],
      );
      const point = resolveAnchor(reattaching.anchor);
      preview.style.left = point.x + "px";
      preview.style.top = point.y + "px";
      dots.append(preview);
    }
    position();
  }
  function position() {
    dots.querySelectorAll<HTMLElement>(".dot").forEach((b) => {
      const a = b.dataset.draft
        ? activeAnchor
        : comments.find((c) => c.id === Number(b.dataset.commentId))?.anchor;
      if (!a) return;
      const p = resolveAnchor(a);
      b.style.left = p.x + "px";
      b.style.top = p.y + "px";
      b.style.display =
        p.y < -30 ||
        p.y > innerHeight + 30 ||
        p.x < -30 ||
        p.x > innerWidth + 30
          ? "none"
          : "";
    });
    if (panel.classList.contains("hide")) return;
    const a = activeAnchor || thread?.comment.anchor;
    if (!a) return;
    const p = resolveAnchor(a);
    const placement = panelPlacement(
      p,
      { width: innerWidth, height: innerHeight },
      { width: panel.offsetWidth, height: panel.offsetHeight },
      sidebarOpen
        ? { side: prefs.side, width: sidebar.offsetWidth + 12 }
        : undefined,
    );
    panel.style.left = placement.left + "px";
    panel.style.top = placement.top + "px";
  }
  let frame = 0;
  function schedule() {
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = 0;
        position();
      });
  }
  addEventListener("scroll", schedule, { passive: true, capture: true });
  addEventListener("resize", schedule);
  const observer = new ResizeObserver(schedule);
  observer.observe(document.body);
  const changes = new MutationObserver((records) => {
    if (records.some((r) => r.target !== host && !host.contains(r.target)))
      schedule();
  });
  changes.observe(document.body, { childList: true, subtree: true });
  async function closePanel() {
    if (busy) return;
    if (!thread && activeAnchor) await draftFileWrite;
    threadRevision++;
    panel.classList.add("hide");
    activeAnchor = null;
    thread = null;
    pending.forEach((p) => URL.revokeObjectURL(p.url));
    pending = [];
    renderDots();
    previousFocus?.focus();
  }
  const draftKey = (type: string, id = "new") =>
    "flakflak:draft:" +
    siteId +
    ":" +
    pageIdentity(location.href) +
    ":" +
    (guest?.id || "guest") +
    ":" +
    type +
    ":" +
    id;
  let draftFilesSaving = 0,
    draftFilesError = false;
  let draftFileWrite: Promise<void> = Promise.resolve();
  function persistDraftFiles() {
    const key = draftKey("comment"),
      files = pending.map(({ file, id }) => ({ file, id }));
    draftFilesSaving++;
    draftFilesError = false;
    const write = draftFileWrite.then(() => writeDraftFiles(key, files));
    draftFileWrite = write
      .catch(() => {
        draftFilesError = true;
        showError(
          "Draft attachments could not be saved in this browser. Keep this page open and save your comment before leaving.",
        );
      })
      .finally(() => {
        draftFilesSaving--;
        if (panel.classList.contains("composer") && !savedId) {
          const notice = panel.querySelector(".draft-tools > span");
          if (notice)
            notice.textContent = draftFilesError
              ? "Attachments are not saved in this browser"
              : draftFilesSaving
                ? "Saving draft attachments…"
                : "Draft saved in this browser";
        }
      });
    return write;
  }
  function saveNewDraft() {
    store(draftKey("comment"), {
      body: newBody,
      anchor: activeAnchor,
      status: newStatus,
      client_id: newId,
      saved_id: savedId,
    });
  }
  async function begin(anchor: Anchor, resume = false) {
    if (busy) return;
    await ensureMember();
    previousFocus = shadow.activeElement as HTMLElement | null;
    thread = null;
    activeAnchor = anchor;
    newBody = "";
    newId = crypto.randomUUID();
    savedId = null;
    newStatus = "open";
    pending.forEach((p) => URL.revokeObjectURL(p.url));
    pending = [];
    const draft = readStored<{
      body: string;
      anchor: Anchor;
      status: "open" | "content";
      client_id: string;
      saved_id: number | null;
    } | null>(draftKey("comment"), null);
    if (draft) {
      await draftFileWrite;
      try {
        pending = (await readDraftFiles(draftKey("comment"))).map((item) => ({
          ...item,
          url: URL.createObjectURL(item.file),
        }));
      } catch {
        showError(
          "Saved draft attachments could not be restored in this browser.",
        );
      }
      newBody = draft.body;
      activeAnchor = draft.anchor;
      newStatus = draft.status;
      newId = draft.client_id;
      savedId = draft.saved_id;
      const p = resolveAnchor(activeAnchor);
      if (p.y < 0 || p.y > innerHeight)
        scrollBy({ top: p.y - innerHeight / 3, behavior: "instant" });
    }
    saveNewDraft();
    renderNew();
    renderDots();
    renderSidebar();
  }
  function queueFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      if (
        ![
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/gif",
          "video/mp4",
        ].includes(file.type) ||
        file.size > 10 * 1024 * 1024
      ) {
        showError("Choose JPG, PNG, WebP, GIF or MP4 files up to 10 MB.");
        continue;
      }
      if (pending.length >= 20) {
        showError("Maximum 20 files.");
        break;
      }
      pending.push({
        file,
        id: crypto.randomUUID(),
        url: URL.createObjectURL(file),
      });
    }
    saveNewDraft();
    void persistDraftFiles().catch(() => {});
    renderNew();
  }
  function renderNew() {
    panel.classList.add("composer");
    panel.classList.remove("thread");
    const heading = titlebar("", closePanel),
      headingText = el("div", "", "composer-heading");
    headingText.append(el("span", "FlakFlak"), el("h3", "New comment"));
    heading.firstElementChild?.replaceWith(headingText);
    panel.replaceChildren(heading);
    panel.classList.remove("hide");
    const body = el("div", "", "body");
    const status = el("div", "", "composer-status"),
      choices = el("div", "", "status-grid");
    status.append(el("label", "Choose status"), choices);
    choices.setAttribute("role", "group");
    choices.setAttribute("aria-label", "Choose status");
    for (const value of ["open", "content"] as const) {
      const choice = button(value[0].toUpperCase() + value.slice(1), () => {
        newStatus = value;
        saveNewDraft();
        choices
          .querySelectorAll("button")
          .forEach((b) =>
            b.setAttribute("aria-pressed", String(b.dataset.status === value)),
          );
        renderDots();
      });
      choice.dataset.status = value;
      choice.setAttribute("aria-pressed", String(newStatus === value));
      choice.disabled = !!savedId;
      choices.append(choice);
    }
    const input = el("textarea");
    input.placeholder = "What should change?";
    input.rows = 4;
    input.setAttribute("aria-label", "Comment");
    input.value = newBody;
    input.disabled = !!savedId;
    input.maxLength = 10000;
    input.oninput = () => {
      newBody = input.value;
      saveNewDraft();
    };
    const drop = el("div", "", "drop");
    drop.tabIndex = 0;
    drop.setAttribute("role", "button");
    drop.setAttribute("aria-label", "Browse new comment files");
    const fileInput = el("input");
    fileInput.type = "file";
    fileInput.multiple = true;
    fileInput.accept = "image/png,image/jpeg,image/webp,image/gif,video/mp4";
    fileInput.setAttribute("aria-label", "Attach files");
    fileInput.onchange = () => {
      if (fileInput.files) queueFiles(fileInput.files);
    };
    fileInput.classList.add("native-file");
    drop.textContent =
      "Drop files, click to browse, or paste an image · JPG, PNG, MP4";
    drop.onclick = () => fileInput.click();
    drop.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fileInput.click();
      }
    };
    paste(drop, queueFiles);
    drop.ondragover = (e) => {
      e.preventDefault();
      drop.classList.add("dragover");
    };
    drop.ondragleave = () => drop.classList.remove("dragover");
    drop.ondrop = (e) => {
      e.preventDefault();
      drop.classList.remove("dragover");
      if (e.dataTransfer) queueFiles(e.dataTransfer.files);
    };
    const previews = el("div", "", "files");
    pending.forEach((p, i) => {
      const f = el("div", "", "file");
      if (p.file.type.startsWith("image/")) {
        const img = el("img");
        img.src = p.url;
        img.alt = p.file.name;
        f.append(img);
      } else f.append(el("span", p.file.name));
      f.append(
        button("Remove", () => {
          URL.revokeObjectURL(p.url);
          pending.splice(i, 1);
          void persistDraftFiles().catch(() => {});
          renderNew();
        }),
      );
      const remove = f.lastElementChild as HTMLButtonElement;
      remove.textContent = "×";
      remove.classList.add("file-remove");
      remove.setAttribute("aria-label", "Remove");
      remove.title = "Remove " + p.file.name;
      previews.append(f);
    });
    const save = button(
      savedId ? "Retry attachments" : "Save",
      () =>
        perform(async () => {
          if (!newBody.trim()) throw new Error("Enter a comment first.");
          if (!savedId) {
            const c = await request<Comment>("/comments", {
              method: "POST",
              body: json({
                url: location.href,
                title: document.title.slice(0, 255) || location.hostname,
                body: newBody.trim(),
                status: newStatus,
                client_id: newId,
                anchor: activeAnchor,
              }),
            });
            savedId = c.id;
            saveNewDraft();
          }
          while (pending.length) {
            const p = pending[0],
              data = new FormData();
            data.set("file", p.file);
            data.set("client_id", p.id);
            await request("/comments/" + savedId + "/attachments", {
              method: "POST",
              body: data,
            });
            URL.revokeObjectURL(p.url);
            pending.shift();
            await persistDraftFiles();
          }
          const id = savedId;
          store(draftKey("comment"), null);
          activeAnchor = null;
          await load();
          await openThread(id!);
        }),
      "primary",
    );
    const actions = el("div", "", "actions");
    actions.append(button("Cancel", closePanel), save);
    const draftTools = el("div", "", "draft-tools");
    draftTools.append(
      el(
        "span",
        savedId
          ? "Comment saved. Retry any remaining attachments."
          : draftFilesSaving
            ? "Saving draft attachments…"
            : "Draft saved in this browser",
      ),
    );
    if (!savedId)
      draftTools.append(
        button(
          "Discard draft",
          () => {
            newBody = "";
            pending.forEach((item) => URL.revokeObjectURL(item.url));
            pending = [];
            void persistDraftFiles().catch(() => {});
            newId = crypto.randomUUID();
            store(draftKey("comment"), null);
            renderNew();
            renderSidebar();
          },
          "text-link",
        ),
      );
    const attachmentSection = el("section", "", "composer-attachments"),
      attachmentHeading = el("div", "", "attachments-heading");
    attachmentHeading.append(
      el("span", "Attachments"),
      button("Add files", () => fileInput.click()),
    );
    attachmentSection.append(
      attachmentHeading,
      previews,
      drop,
      fileInput,
      el(
        "p",
        "Files upload after saving. Attachments are saved with your draft in this browser.",
        "hint",
      ),
    );
    body.append(status, input, draftTools, attachmentSection, actions);
    panel.append(body);
    shortcut(input, save);
    paste(input, queueFiles);
    syncBusyControls();
    position();
    if (!savedId && !busy) input.focus();
  }
  function shortcut(input: HTMLTextAreaElement, submit: HTMLButtonElement) {
    input.addEventListener("keydown", (e) => {
      if (
        e.key === "Enter" &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey &&
        !e.isComposing
      ) {
        e.preventDefault();
        if (!e.repeat && !busy && !submit.disabled) submit.click();
      }
    });
  }
  function paste(input: HTMLElement, callback: (files: File[]) => void) {
    input.addEventListener("paste", (e) => {
      const files = Array.from((e as ClipboardEvent).clipboardData?.items || [])
        .filter((i) => i.kind === "file" && i.type.startsWith("image/"))
        .map((i) => i.getAsFile())
        .filter((f): f is File => !!f);
      if (files.length) {
        e.preventDefault();
        callback(files);
      }
    });
  }
  async function openThread(id: number) {
    if (busy && !panel.getAttribute("aria-busy")) return;
    previousFocus = shadow.activeElement as HTMLElement | null;
    activeAnchor = null;
    const token = ++threadRevision;
    const loaded = await request<Thread>("/comments/" + id);
    if (token !== threadRevision) return;
    thread = loaded;
    replyId = crypto.randomUUID();
    renderThread();
    renderDots();
    await markSeen(loaded);
  }
  const collapsedReplies = new WeakSet<Thread>();
  function renderThread() {
    if (!thread) return;
    const t = thread,
      c = t.comment;
    panel.classList.remove("hide", "composer");
    panel.classList.add("thread");
    const header = titlebar("#" + c.id, closePanel);
    header.classList.add("thread-header");
    const stamp = el(
      "span",
      new Date(
        c.created_at.includes("T")
          ? c.created_at
          : c.created_at.replace(" ", "T") + "Z",
      )
        .toLocaleString("en-US", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "numeric",
          minute: "2-digit",
        })
        .replace(",", ""),
      "comment-date",
    );
    header.firstElementChild?.after(stamp);
    panel.replaceChildren(header);
    const body = el("div", "", "body");
    const navigation = el("nav", "", "review-navigation");
    navigation.setAttribute("aria-label", "Review navigation");
    const ordered = comments
      .filter(
        (item) =>
          ((showClosed || item.status !== "closed") &&
            (!unreadOnly || isUnread(item)) &&
            ("#" + item.id + " " + item.body + " " + item.name)
              .toLowerCase()
              .includes(search.toLowerCase())) ||
          item.id === c.id,
      )
      .sort((a, b) => a.id - b.id);
    if (!ordered.some((item) => item.id === c.id)) ordered.push(c);
    const index = ordered.findIndex((item) => item.id === c.id);
    const prev = button("← Previous", () => openThread(ordered[index - 1].id)),
      next = button("Next →", () => openThread(ordered[index + 1].id));
    prev.disabled = index <= 0;
    next.disabled = index >= ordered.length - 1;
    navigation.append(
      prev,
      el("span", index + 1 + " of " + ordered.length, "meta"),
      next,
    );
    panel.append(navigation);
    const tools = el("div", "", "toolbar");
    let copyFeedback: ReturnType<typeof setTimeout> | undefined;
    const copyLink = button("Copy link", async () => {
      const u = new URL(location.href);
      u.hash = "flakflak-comment-" + c.id;
      await navigator.clipboard.writeText(u.href);
      copyLink.textContent = "Copied!";
      clearTimeout(copyFeedback);
      copyFeedback = setTimeout(() => {
        if (copyLink.isConnected) copyLink.textContent = "Copy link";
      }, 2000);
    });
    copyLink.setAttribute("aria-live", "polite");
    tools.append(copyLink);
    tools.append(button("Refresh", () => openThread(c.id)));
    const details = el("div", "", "comment-details hide");
    details.id = "ff-comment-details-" + c.id;
    const toggleDetails = button(
      "",
      () => {
        const open = details.classList.contains("hide");
        details.classList.toggle("hide", !open);
        toggleDetails.setAttribute("aria-expanded", String(open));
        position();
      },
      "details-toggle",
    );
    toggleDetails.setAttribute("aria-label", "Details");
    toggleDetails.title = "Details";
    toggleDetails.setAttribute("aria-expanded", "false");
    toggleDetails.setAttribute("aria-controls", details.id);
    header.insertBefore(toggleDetails, header.lastElementChild);
    const controls = el("div", "", "toolbar");
    controls.append(button("Reposition Dot", () => startReattach(t)));
    if (guest?.role === "owner" || guest?.id === c.participant_id) {
      controls.append(
        button("Edit comment", () => {
          body.querySelector(".comment-editor")?.remove();
          const original = body.querySelector<HTMLElement>(".comment-text");
          const edit = el("textarea");
          edit.maxLength = 10000;
          edit.rows = 4;
          edit.value = readStored<string>(
            draftKey("edit", String(c.id)),
            c.body,
          );
          edit.setAttribute("aria-label", "Edit comment");
          edit.oninput = () =>
            store(draftKey("edit", String(c.id)), edit.value);
          const save = button(
            "Save changes",
            () =>
              perform(async () => {
                thread = await request<Thread>("/comments/" + c.id, {
                  method: "PATCH",
                  body: json({ body: edit.value.trim(), version: c.version }),
                });
                store(draftKey("edit", String(c.id)), null);
                renderThread();
                await load();
              }),
            "primary",
          );
          const editor = el("div", "", "comment-editor");
          editor.append(
            edit,
            save,
            button("Cancel edit", () => {
              editor.remove();
              original?.classList.remove("hide");
              position();
            }),
          );
          original?.classList.add("hide");
          if (original) original.before(editor);
          else body.append(editor);
          shortcut(edit, save);
          position();
          edit.focus();
        }),
      );
    }
    const copy = tools.firstElementChild as HTMLButtonElement,
      refresh = tools.lastElementChild as HTMLButtonElement;
    copy.classList.add("copy-link");
    header.insertBefore(copy, header.lastElementChild);
    controls.prepend(refresh);
    details.append(controls);
    const author = el("div", "", "author-row");
    author.append(el("strong", c.name));
    const pencil = Array.from(controls.querySelectorAll("button")).find(
      (b) => b.textContent === "Edit comment",
    );
    if (pencil) {
      pencil.textContent = "✎";
      pencil.setAttribute("aria-label", "Edit comment");
      pencil.title = "Edit comment";
      pencil.classList.add("edit-pencil");
      author.append(pencil);
    }
    panel.insertBefore(details, navigation);
    const commentText = historyText(c.body, false);
    commentText.classList.add("comment-text");
    body.append(author, commentText);
    if (resolveAnchor(c.anchor).missing)
      body.append(
        el(
          "p",
          "The original target changed. The dot uses its saved page position.",
          "hint",
        ),
      );
    if (t.reply_count) {
      body.append(
        el(
          "div",
          t.reply_count + " " + (t.reply_count === 1 ? "reply" : "replies"),
          "meta",
        ),
      );
      const collapsed = collapsedReplies.has(t);
      if (collapsed || t.reply_before)
        body.append(
          button(
            "Show earlier replies (" +
              (t.reply_count - (collapsed ? 2 : t.replies.length)) +
              ")",
            () =>
              perform(async () => {
                if (collapsed) {
                  collapsedReplies.delete(t);
                  renderThread();
                  return;
                }
                const older = await request<{
                  replies: Reply[];
                  more: boolean;
                  before: number | null;
                }>("/comments/" + c.id + "/replies?before=" + t.reply_before);
                t.replies = [...older.replies, ...t.replies];
                t.reply_before = older.more ? older.before : null;
                renderThread();
              }),
            "earlier-replies",
          ),
        );
      if (!collapsed && t.replies.length > 2) {
        const hide = button(
          "Hide earlier replies",
          () => {
            collapsedReplies.add(t);
            renderThread();
          },
          "earlier-replies",
        );
        hide.setAttribute("aria-expanded", "true");
        body.append(hide);
      }
      for (const reply of collapsed ? t.replies.slice(-2) : t.replies) {
        const row = el("div", "", "reply");
        const replyHeader = el("div", "", "reply-header"),
          replyMeta = el("div", "", "reply-meta");
        replyMeta.append(el("span", date(reply.created_at), "meta reply-time"));
        replyHeader.append(el("strong", reply.name), replyMeta);
        row.append(
          replyHeader,
          historyText(reply.body, reply.kind === "status"),
        );
        if (
          (guest?.role === "owner" || guest?.id === reply.participant_id) &&
          reply.kind === "reply"
        )
          replyMeta.append(
            button(
              "×",
              () =>
                perform(async () => {
                  if (!confirm("Delete this reply?")) return;
                  thread = await request<Thread>(
                    "/comments/" + c.id + "/replies/" + reply.id,
                    { method: "DELETE" },
                  );
                  renderThread();
                  await load();
                }),
              "reply-trash",
            ),
          );
        const trash = replyMeta.querySelector("button");
        if (trash) {
          trash.setAttribute("aria-label", "Delete reply");
          trash.title = "Delete reply";
        }
        body.append(row);
      }
    }
    const input = el("textarea");
    input.placeholder = "Write a reply…";
    input.setAttribute("aria-label", "Reply");
    input.maxLength = 10000;
    input.value = readStored<string>(draftKey("reply", String(c.id)), "");
    input.oninput = () => store(draftKey("reply", String(c.id)), input.value);
    const send = button(
      "Reply",
      () =>
        perform(async () => {
          if (!input.value.trim()) throw new Error("Enter a reply first.");
          await ensureMember();
          thread = await request<Thread>("/comments/" + c.id + "/replies", {
            method: "POST",
            body: json({ body: input.value.trim(), client_id: replyId }),
          });
          store(draftKey("reply", String(c.id)), null);
          replyId = crypto.randomUUID();
          renderThread();
        }),
      "primary",
    );
    body.append(input);
    const actions = el("div", "", "actions");
    const replyDraft = el("div", "", "draft-tools"),
      discardReply = button(
        "Discard draft",
        () => {
          input.value = "";
          store(draftKey("reply", String(c.id)), null);
          syncReplyDraft();
          input.focus();
        },
        "text-link",
      );
    discardReply.setAttribute("aria-label", "Discard reply draft");
    replyDraft.append(el("span", "Draft saved in this browser"), discardReply);
    function syncReplyDraft() {
      replyDraft.classList.toggle("hide", !input.value.trim());
    }
    input.oninput = () => {
      store(draftKey("reply", String(c.id)), input.value);
      syncReplyDraft();
    };
    syncReplyDraft();
    actions.append(send);
    body.append(replyDraft, actions);
    shortcut(input, send);
    const attachments = el("div", "", "files");
    t.attachments.forEach((a, i) => {
      const file = el("div", "", "file");
      const b = button(a.name, () => gallery(t.attachments, i));
      if (a.mime.startsWith("image/")) {
        const img = el("img");
        setMediaSource(img, a);
        img.alt = a.name;
        b.replaceChildren(img);
      }
      file.append(b);
      if (guest?.role === "owner" || guest?.id === a.participant_id)
        file.append(
          button("Remove file", () =>
            perform(async () => {
              thread = await request<Thread>(
                "/comments/" + c.id + "/attachments/" + a.id,
                { method: "DELETE" },
              );
              renderThread();
            }),
          ),
        );
      const remove = Array.from(file.querySelectorAll("button")).find(
        (button) => button.textContent === "Remove file",
      );
      if (remove) {
        remove.textContent = "×";
        remove.classList.add("file-remove");
        remove.setAttribute("aria-label", "Remove file");
        remove.title = "Remove " + a.name;
      }
      attachments.append(file);
    });
    const upload = el("input");
    upload.type = "file";
    upload.multiple = true;
    upload.accept = "image/png,image/jpeg,image/webp,image/gif,video/mp4";
    upload.setAttribute("aria-label", "Add attachments");
    async function flushUploads() {
      await perform(async () => {
        await ensureMember();
        const queue = threadUploads.get(c.id) || [];
        try {
          while (queue.length) {
            const pending = queue[0],
              form = new FormData();
            form.set("file", pending.file);
            form.set("client_id", pending.id);
            try {
              thread = await request<Thread>(
                "/comments/" + c.id + "/attachments",
                { method: "POST", body: form },
              );
              queue.shift();
            } catch (error) {
              pending.error = (error as Error).message;
              throw error;
            }
          }
        } finally {
          renderThread();
        }
      });
    }
    async function uploadFiles(files: File[]) {
      if (busy) return;
      const queue = threadUploads.get(c.id) || [];
      for (const file of files) {
        if (
          ![
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/gif",
            "video/mp4",
          ].includes(file.type) ||
          file.size > 10 * 1024 * 1024
        ) {
          showError("Choose JPG, PNG, WebP, GIF or MP4 files up to 10 MB.");
          continue;
        }
        queue.push({ file, id: crypto.randomUUID() });
      }
      threadUploads.set(c.id, queue);
      await flushUploads();
    }
    const pendingList = el("div", "", "pending-uploads");
    for (const pending of threadUploads.get(c.id) || []) {
      const row = el("div", "", "reply");
      row.append(
        el("strong", pending.file.name),
        el(
          "p",
          pending.error || "Waiting to upload…",
          pending.error ? "error" : "hint",
        ),
        button("Retry upload", flushUploads),
        button("Remove queued file", () => {
          const queue = threadUploads.get(c.id) || [];
          threadUploads.set(
            c.id,
            queue.filter((item) => item !== pending),
          );
          renderThread();
        }),
      );
      pendingList.append(row);
    }
    upload.onchange = () => {
      if (upload.files) uploadFiles(Array.from(upload.files));
    };
    paste(input, uploadFiles);
    const attachmentDrop = el("div", "", "drop");
    upload.classList.add("native-file");
    attachmentDrop.textContent =
      "Drop files or paste an image here (JPG, PNG, MP4)";
    attachmentDrop.tabIndex = 0;
    attachmentDrop.setAttribute("role", "button");
    attachmentDrop.setAttribute("aria-label", "Browse attachment files");
    attachmentDrop.onclick = () => upload.click();
    attachmentDrop.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        upload.click();
      }
    };
    paste(attachmentDrop, uploadFiles);
    attachmentDrop.ondragover = (e) => {
      e.preventDefault();
      if (!busy) attachmentDrop.classList.add("dragover");
    };
    attachmentDrop.ondragleave = () =>
      attachmentDrop.classList.remove("dragover");
    attachmentDrop.ondrop = (e) => {
      e.preventDefault();
      attachmentDrop.classList.remove("dragover");
      if (e.dataTransfer && !busy)
        uploadFiles(Array.from(e.dataTransfer.files));
    };
    const attachmentSection = el("section", "", "attachments-section"),
      attachmentHeading = el("div", "", "attachments-heading");
    attachmentHeading.append(
      el("span", "Attachments"),
      button("Add Files", () => upload.click()),
    );
    attachmentSection.append(
      attachmentHeading,
      attachments,
      pendingList,
      attachmentDrop,
      upload,
    );
    const statusSection = el("section", "", "status-section");
    statusSection.append(el("label", "Change status"));
    const statusGrid = el("div", "", "status-grid");
    for (const s of statuses) {
      const b = button(s[0].toUpperCase() + s.slice(1), async () => {
        if (s === c.status) return;
        await ensureMember();
        if (s === "closed") {
          showResolution();
          return;
        }
        await changeStatus(s);
      });
      b.dataset.status = s;
      b.style.setProperty("--status", colors[s]);
      b.setAttribute("aria-pressed", String(s === c.status));
      statusGrid.append(b);
    }
    statusSection.append(statusGrid);
    panel.append(body, attachmentSection, statusSection);
    syncBusyControls();
    position();
    function showResolution() {
      const old = panel.querySelector(".resolution");
      old?.remove();
      const form = el("div", "", "resolution");
      form.append(
        el("hr", "", "separator"),
        el("label", "Resolution note (optional)"),
      );
      const note = el("textarea");
      note.placeholder = "What changed?";
      note.setAttribute("aria-label", "Resolution note");
      note.value = readStored<string>(draftKey("resolution", String(c.id)), "");
      note.oninput = () =>
        store(draftKey("resolution", String(c.id)), note.value);
      const submit = button(
        "Close comment",
        () => changeStatus("closed", note.value),
        "primary",
      );
      const discard = button(
        "Discard draft",
        () => {
          note.value = "";
          store(draftKey("resolution", String(c.id)), null);
          note.focus();
        },
        "text-link",
      );
      discard.setAttribute("aria-label", "Discard resolution draft");
      const actions = el("div", "", "resolution-actions"),
        buttons = el("div", "", "resolution-buttons");
      buttons.append(
        button("Cancel", () => form.remove()),
        submit,
      );
      actions.append(discard, buttons);
      form.append(note, actions);
      statusSection.append(form);
      shortcut(note, submit);
      note.focus();
      position();
    }
    async function changeStatus(status: Status, note = "") {
      await perform(async () => {
        thread = await request<Thread>("/comments/" + c.id + "/status", {
          method: "PATCH",
          body: json({ status, note, version: c.version }),
        });
        store(draftKey("resolution", String(c.id)), null);
        renderThread();
        await load();
      });
    }
  }
  function gallery(files: Attachment[], index: number) {
    if (!files.length) return;
    closeAttachmentViewer?.();
    const g = el("section", "", "gallery");
    g.setAttribute("role", "dialog");
    g.setAttribute("aria-modal", "true");
    g.setAttribute("aria-label", "Attachments");
    const focus = shadow.activeElement as HTMLElement | null;
    const savedOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const close = () => {
      closeAttachmentViewer = null;
      g.querySelectorAll("video").forEach((v) => v.pause());
      g.remove();
      window.removeEventListener("keydown", escapeGallery, true);
      document.documentElement.style.overflow = savedOverflow;
      focus?.focus();
    };
    closeAttachmentViewer = close;
    function escapeGallery(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
    }
    window.addEventListener("keydown", escapeGallery, true);
    function render() {
      g.querySelectorAll("video").forEach((v) => v.pause());
      g.replaceChildren(titlebar(files[index].name, close));
      const media = el("div", "", "gallery-media"),
        file = files[index];
      if (file.mime.startsWith("image/")) {
        const img = el("img");
        setMediaSource(img, file);
        img.alt = file.name;
        media.append(img);
      } else {
        const v = el("video");
        setMediaSource(v, file);
        v.controls = true;
        media.append(v);
      }
      const foot = el("footer"),
        prev = button("← Previous", () => {
          index = (index - 1 + files.length) % files.length;
          render();
        }),
        next = button("Next →", () => {
          index = (index + 1) % files.length;
          render();
        });
      prev.disabled = files.length < 2;
      next.disabled = files.length < 2;
      foot.append(prev, el("span", index + 1 + " / " + files.length), next);
      g.append(media, foot);
      g.querySelector("button")?.focus();
    }
    g.onkeydown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        index = (index + 1) % files.length;
        render();
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        index = (index - 1 + files.length) % files.length;
        render();
      }
      if (e.key === "Tab") {
        const list = Array.from(
          g.querySelectorAll<HTMLElement>("button:not(:disabled),video"),
        );
        const i = list.indexOf(shadow.activeElement as HTMLElement);
        e.preventDefault();
        list[(i + (e.shiftKey ? -1 : 1) + list.length) % list.length]?.focus();
      }
    };
    shadow.append(g);
    render();
  }
  function setSidebarOpen(open: boolean) {
    sidebarOpen = open;
    store("flakflak:sidebar-open:" + siteId, open);
    renderSidebar();
  }
  function renderSidebar() {
    sidebar.classList.toggle("hide", !sidebarOpen);
    host.dataset.sidebarOpen = String(sidebarOpen);
    launch.textContent = sidebarOpen
      ? prefs.side === "right"
        ? "›"
        : "‹"
      : prefs.side === "right"
        ? "‹"
        : "›";
    schedule();
    launch.setAttribute("aria-expanded", String(sidebarOpen));
    if (!sidebarOpen || !guest) return;
    const header = titlebar("FlakFlak", () => {
      setSidebarOpen(false);
    });
    const gear = button("⚙", () => {
      if (view === "settings") view = previousView;
      else {
        previousView = view;
        view = "settings";
      }
      renderSidebar();
    });
    const headerIcon = (paths: string) =>
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      paths +
      "</svg>";
    gear.innerHTML = headerIcon(
      '<path d="m9.5 3-.6 2.1-1.6.9-2.1-.5-2 3.5 1.5 1.6v1.8L3.2 14l2 3.5 2.1-.5 1.6.9.6 2.1h4l.6-2.1 1.6-.9 2.1.5 2-3.5-1.5-1.6v-1.8l1.5-1.6-2-3.5-2.1.5-1.6-.9L13.5 3Z"/><circle cx="11.5" cy="11.5" r="3"/>',
    );
    const closeButton = header.lastElementChild as HTMLButtonElement;
    closeButton.innerHTML = headerIcon('<path d="m6 6 12 12M18 6 6 18"/>');
    gear.title = "Settings";
    gear.setAttribute("aria-label", "Settings");
    gear.setAttribute("aria-expanded", String(view === "settings"));
    gear.setAttribute("aria-controls", "ff-settings");
    header.insertBefore(gear, header.lastElementChild);
    sidebar.replaceChildren(header);
    const body = el("div", "", "body sidebar-scroll"),
      tabs = el("div", "", "header-view-icons");
    for (const v of ["comments", "activity"] as const) {
      const b = button(v[0].toUpperCase() + v.slice(1), async () => {
        view = v;
        if (v === "activity") await loadActivity(true);
        else await load();
        renderSidebar();
      });
      const label = v[0].toUpperCase() + v.slice(1);
      b.setAttribute("aria-label", label);
      b.title = label;
      b.innerHTML =
        v === "comments"
          ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 15a3 3 0 0 1-3 3H8l-5 3V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3Z"/><path d="M7 8h9M7 12h6"/></svg>'
          : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>';
      b.setAttribute("aria-pressed", String(view === v));
      tabs.append(b);
    }
    header.insertBefore(tabs, gear);
    sidebar.append(
      el("h2", view[0].toUpperCase() + view.slice(1), "sidebar-view-title"),
    );
    if (view === "settings") {
      body.id = "ff-settings";
      body.append(
        button("Sign out of this site", () =>
          perform(async () => {
            await request("/auth/logout", { method: "POST" });
            guest = null;
            store(identityKey, null);
            comments = [];
            pages = [];
            events = [];
            thread = null;
            activeAnchor = null;
            clearMedia();
            dots.replaceChildren();
            panel.classList.add("hide");
            setSidebarOpen(false);
          }),
        ),
      );
      body.append(
        el(
          "p",
          guest ? "Reviewing as " + guest.name : "No name entered yet.",
          "meta",
        ),
      );
      const choices = <K extends keyof Preferences>(
        legend: string,
        key: K,
        options: { label: string; value: Preferences[K] }[],
      ) => {
        const group = el("fieldset", "", "setting-block"),
          heading = el("legend", legend),
          grid = el("div", "", "setting-choices");
        if (key === "theme") grid.classList.add("theme-choices");
        group.append(heading, grid);
        for (const option of options) {
          const b = button("", () => {
            setPreference(key, option.value);
            grid
              .querySelectorAll("button")
              .forEach((n) =>
                n.setAttribute(
                  "aria-pressed",
                  String(n.dataset.value === String(option.value)),
                ),
              );
          });
          b.dataset.value = String(option.value);
          b.setAttribute("aria-pressed", String(prefs[key] === option.value));
          if (key === "theme") {
            const swatch = el("span", "", "theme-swatch");
            swatch.dataset.theme = String(option.value);
            swatch.setAttribute("aria-hidden", "true");
            b.append(swatch);
          }
          b.append(el("span", option.label));
          grid.append(b);
        }
        body.append(group);
      };
      choices("Sidebar position", "side", [
        { label: "Left", value: "left" },
        { label: "Right", value: "right" },
      ]);
      choices(
        "Appearance",
        "theme",
        themes.map((theme) => ({
          label:
            (
              {
                windows311: "Windows 3.11",
                windowsxp: "Windows XP",
                macos9: "Mac OS 9",
                gameboy: "Game Boy",
                commodore64: "C64",
                nes: "NES",
                pipboy: "Pip-Boy",
                synthwave: "Neon",
              } as Record<string, string>
            )[theme] || theme[0].toUpperCase() + theme.slice(1),
          value: theme,
        })),
      );
      choices("Interface size", "size", [
        { label: "Standard", value: "standard" },
        { label: "Large", value: "large" },
      ]);
      const toggles = el("fieldset", "", "setting-block");
      toggles.append(el("legend", "Display"));
      const toggle = (
        labelText: string,
        checked: boolean,
        change: (value: boolean) => void,
      ) => {
        const label = el("label", labelText, "setting-toggle"),
          check = el("input");
        check.type = "checkbox";
        check.checked = checked;
        check.onchange = () => change(check.checked);
        label.prepend(check);
        toggles.append(label);
      };
      toggle("Pause dot animations", prefs.pauseAnimations, (value) =>
        setPreference("pauseAnimations", value),
      );
      toggle("Hide dots", prefs.hideDots, (value) =>
        setPreference("hideDots", value),
      );
      toggle("Show closed comments", showClosed, (value) => {
        showClosed = value;
        store("flakflak:closed:" + siteId, showClosed);
        renderDots();
      });
      toggles.append(
        el(
          "p",
          "Hidden dots remain accessible through the comment list.",
          "hint",
        ),
      );
      body.append(toggles);
      const shortcuts = el("section", "", "setting-block");
      shortcuts.setAttribute("aria-label", "Keyboard shortcuts");
      shortcuts.append(
        el("strong", "Keyboard shortcuts"),
        el(
          "p",
          "Shift + click · New comment\nCmd/Ctrl + Enter · Save, reply, or resolve\nControl · Toggle sidebar\nEscape · Close comment box",
          "hint",
        ),
      );
      body.append(shortcuts);
      sidebar.append(body);
      return;
    }
    if (view === "activity") {
      const controls = el("div", "", "toolbar");
      const activityFilter = button("Unread only", async () => {
        activityUnreadOnly = !activityUnreadOnly;
        await loadActivity(true);
        renderSidebar();
      });
      activityFilter.setAttribute("aria-pressed", String(activityUnreadOnly));
      controls.append(activityFilter);
      controls.append(
        button("Refresh", async () => {
          await loadActivity(true);
          renderSidebar();
        }),
      );
      body.append(
        controls,
        el("p", "Recent activity across this site.", "hint"),
      );
      const visibleEvents = events.filter(
        (event) =>
          !activityUnreadOnly ||
          (event.unread &&
            (!!guest || event.id > (anonymousRead[event.comment_id] || 0))),
      );
      if (!visibleEvents.length)
        body.append(
          el(
            "p",
            activityUnreadOnly
              ? "No unread activity."
              : "No activity recorded yet.",
            "empty",
          ),
        );
      let lastGroup = "";
      for (const event of visibleEvents) {
        const timestamp = new Date(
          event.created_at.includes("T")
            ? event.created_at
            : event.created_at.replace(" ", "T") + "Z",
        );
        const now = new Date(),
          yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        const group =
          timestamp.toDateString() === now.toDateString()
            ? "Today"
            : timestamp.toDateString() === yesterday.toDateString()
              ? "Yesterday"
              : "Earlier";
        if (group !== lastGroup) {
          body.append(el("h4", group, "meta activity-group"));
          lastGroup = group;
        }
        const status = event.summary.match(
          /Status updated to (open|review|content|closed)/,
        )?.[1];
        const action =
          event.type === "comment"
            ? "added"
            : event.type === "reply"
              ? "replied to"
              : event.type === "resolution"
                ? "resolved"
                : event.type === "status"
                  ? "changed"
                  : event.type === "move"
                    ? "moved"
                    : "edited";
        const heading =
          event.name +
          " " +
          action +
          " #" +
          event.comment_id +
          (event.type === "resolution"
            ? " with a note"
            : event.type === "status" && status
              ? " to " + status
              : "");
        const b = button(
          "",
          () => {
            const u = new URL(event.url);
            u.hash = "flakflak-comment-" + event.comment_id;
            if (u.origin + u.pathname === location.origin + location.pathname)
              openThread(event.comment_id).catch(showError);
            else location.href = u.href;
          },
          "row activity-card",
        );
        b.append(
          el("strong", heading),
          el(
            "span",
            event.title + " · " + date(event.created_at),
            "activity-time",
          ),
        );
        const preview =
          event.type === "comment"
            ? event.comment_body
            : ["reply", "status", "resolution"].includes(event.type)
              ? event.summary
              : "";
        if (preview) b.append(el("p", preview, "activity-preview"));
        if (
          event.unread &&
          (guest || event.id > (anonymousRead[event.comment_id] || 0))
        )
          b.append(el("span", "Unread", "unread-badge"));
        body.append(b);
      }
      if (activityMore)
        body.append(
          button("Load more", async () => {
            await loadActivity(false);
            renderSidebar();
          }),
        );
      sidebar.append(body);
      return;
    }
    const pageLabel = el("div", "Current page", "current-page-label"),
      pageTitle = el(
        "h2",
        document.title || location.hostname,
        "sidebar-page-title",
      ),
      pageTotal = el(
        "div",
        comments.length +
          " " +
          (comments.length === 1 ? "comment" : "comments"),
        "meta sidebar-total",
      );
    body.append(pageLabel, pageTitle);
    const add = button(armed ? "Cancel placement" : "＋ Add comment", () => {
      armed = !armed;
      renderSidebar();
      if (armed) {
        sidebarOpen = false;
        renderSidebar();
        showPlacementHint();
      }
    });
    add.classList.add("new-comment-action");
    body.append(pageTotal, add);
    const draft = readStored<{ anchor: Anchor } | null>(
      draftKey("comment"),
      null,
    );
    if (draft?.anchor)
      body.append(
        button(
          "Resume new comment draft",
          () => begin(draft.anchor, true),
          "row resume-draft",
        ),
      );
    const unreadTools = el("div", "", "toolbar"),
      unreadCount = comments.filter(isUnread).length;
    const filter = button("Unread · " + unreadCount, () => {
      unreadOnly = !unreadOnly;
      if (unreadOnly) {
        for (const status of statuses) {
          store(
            "flakflak:group:" +
              siteId +
              ":" +
              pageIdentity(location.href) +
              ":" +
              status,
            true,
          );
        }
      }
      renderSidebar();
    });
    filter.setAttribute("aria-pressed", String(unreadOnly));
    unreadTools.append(filter);
    if (unreadCount) {
      const mark = button("Mark all as read", async () => {
        if (markingRead) return;
        markingRead = true;
        mark.disabled = true;
        try {
          const items = comments
            .filter(isUnread)
            .map((c) => ({ id: c.id, activity_id: c.latest_activity_id || 0 }));
          if (guest) {
            for (let i = 0; i < items.length; i += 100)
              await request("/read", {
                method: "POST",
                body: json({ items: items.slice(i, i + 100) }),
              });
          } else {
            for (const item of items)
              anonymousRead[item.id] = Math.max(
                anonymousRead[item.id] || 0,
                item.activity_id,
              );
            store(anonymousReadKey, anonymousRead);
          }
          for (const c of comments)
            if (
              items.some(
                (item) =>
                  item.id === c.id &&
                  item.activity_id >= (c.latest_activity_id || 0),
              )
            )
              c.unread = false;
          for (const event of events)
            if (
              items.some(
                (item) =>
                  item.id === event.comment_id && item.activity_id >= event.id,
              )
            )
              event.unread = false;
          renderSidebar();
        } finally {
          markingRead = false;
          mark.disabled = false;
        }
      });
      unreadTools.append(mark);
    }
    body.append(unreadTools);
    const input = el("input");
    input.type = "search";
    input.placeholder = "Search comments, authors, or #";
    input.setAttribute("aria-label", "Search this page");
    input.value = search;
    input.oninput = () => {
      search = input.value;
      renderList();
    };
    body.append(input);
    const groupToggle = button("Collapse all", () => {
      const groups = Array.from(list.querySelectorAll("details"));
      const open = groups.every((group) => !group.open);
      for (const group of groups) {
        group.open = open;
        if (group.dataset.status)
          store(
            "flakflak:group:" +
              siteId +
              ":" +
              pageIdentity(location.href) +
              ":" +
              group.dataset.status,
            open,
          );
      }
      syncGroupToggle();
    });
    function syncGroupToggle() {
      const groups = Array.from(list.querySelectorAll("details"));
      groupToggle.textContent = groups.every((group) => !group.open)
        ? "Expand all"
        : "Collapse all";
      groupToggle.disabled = !groups.length;
    }
    groupToggle.classList.add("group-toggle");
    const localHeader = el("div", "", "sidebar-page-header");
    localHeader.append(
      pageLabel,
      pageTitle,
      pageTotal,
      input,
      unreadTools,
      add,
    );
    const resume = body.querySelector(".resume-draft");
    if (resume) localHeader.append(resume);
    sidebar.append(localHeader);
    body.append(groupToggle);
    const list = el("div");
    body.append(list);
    function renderList() {
      list.replaceChildren();
      const shown = comments.filter(
        (c) =>
          (showClosed || c.status !== "closed") &&
          (!unreadOnly || isUnread(c)) &&
          ("#" + c.id + " " + c.body + " " + c.name)
            .toLowerCase()
            .includes(search.toLowerCase()),
      );
      for (const s of statuses) {
        const group = shown.filter((c) => c.status === s);
        if (!group.length) continue;
        const details = el("details");
        details.dataset.status = s;
        details.open = readStored(
          "flakflak:group:" +
            siteId +
            ":" +
            pageIdentity(location.href) +
            ":" +
            s,
          true,
        );
        const summary = el("summary"),
          count = el("span", String(group.length), "status-count");
        count.dataset.status = s;
        summary.append(el("span", s[0].toUpperCase() + s.slice(1)), count);
        details.append(summary);
        details.ontoggle = () => {
          store(
            "flakflak:group:" +
              siteId +
              ":" +
              pageIdentity(location.href) +
              ":" +
              s,
            details.open,
          );
          syncGroupToggle();
        };
        for (const c of group) {
          const b = button("", () => openThread(c.id), "row comment-row");
          b.dataset.status = s;
          b.style.setProperty("--dot-color", dotColors[s]);
          b.setAttribute("aria-pressed", String(thread?.comment.id === c.id));
          b.append(
            el("strong", "#" + c.id + " · " + c.name),
            el("span", c.body),
          );
          if (isUnread(c)) {
            const badge = el("span", "", "unread-dot");
            badge.setAttribute("role", "img");
            badge.setAttribute("aria-label", "Unread");
            badge.title = "Unread";
            b.querySelector("strong")?.append(badge);
          }
          details.append(b);
        }
        list.append(details);
      }
      if (!shown.length) list.append(el("p", "No matching comments.", "empty"));
      syncGroupToggle();
    }
    renderList();
    body.append(
      el("hr", "", "separator"),
      el("h3", "All pages", "all-pages-title"),
    );
    const globalInput = el("input");
    globalInput.type = "search";
    globalInput.placeholder = "Search all pages...";
    globalInput.setAttribute("aria-label", "Search all pages");
    globalInput.value = siteQuery;
    const globalResults = el("div");
    globalResults.setAttribute("aria-live", "polite");
    function renderGlobal() {
      globalResults.replaceChildren();
      if (!siteQuery.trim()) return;
      globalResults.append(
        el("p", siteSearchTotal + " matching comments", "meta"),
      );
      for (const result of siteResults) {
        const b = button(
          "",
          () => {
            const u = new URL(result.url);
            u.hash = "flakflak-comment-" + result.id;
            if (
              u.origin + u.pathname + u.search ===
              location.origin + location.pathname + location.search
            )
              openThread(result.id).catch(showError);
            else location.href = u.href;
          },
          "row",
        );
        b.append(
          el("strong", "#" + result.id + " · " + result.title),
          el("span", result.body),
        );
        globalResults.append(b);
      }
      if (siteSearchMore)
        globalResults.append(
          button("More search results", () => runGlobal(false)),
        );
    }
    async function runGlobal(reset: boolean) {
      const query = siteQuery.trim(),
        token = ++siteSearchRevision;
      if (!query) {
        siteResults = [];
        siteSearchTotal = 0;
        renderGlobal();
        return;
      }
      globalResults.setAttribute("aria-busy", "true");
      if (reset) {
        siteSearchPage = 1;
        globalResults.textContent = "Searching…";
      }
      try {
        const data = await request<{
          results: typeof siteResults;
          total: number;
          more: boolean;
        }>(
          "/search?query=" +
            encodeURIComponent(query) +
            "&page=" +
            siteSearchPage,
        );
        if (token !== siteSearchRevision) return;
        siteResults = reset ? data.results : [...siteResults, ...data.results];
        siteSearchMore = data.more;
        siteSearchTotal = data.total;
        siteSearchPage++;
        renderGlobal();
      } catch (error) {
        if (token === siteSearchRevision) {
          globalResults.replaceChildren(
            el("p", (error as Error).message, "error"),
            button("Retry search", () => runGlobal(reset)),
          );
        }
      } finally {
        if (token === siteSearchRevision)
          globalResults.removeAttribute("aria-busy");
      }
    }
    globalInput.oninput = () => {
      siteQuery = globalInput.value;
      siteSearchRevision++;
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => runGlobal(true), 350);
    };
    body.append(globalInput, globalResults);
    renderGlobal();
    let total = 0,
      closed = 0;
    for (const p of pages) {
      for (const [status, count] of Object.entries(p.counts)) {
        total += Number(count);
        if (status === "closed") closed += Number(count);
      }
    }
    const totals = el("div", "", "site-totals");
    for (const status of ["open", "review", "content"] as const) {
      const count = pages.reduce(
        (sum, page) => sum + Number(page.counts[status] || 0),
        0,
      );
      const card = button(
        "",
        () => {
          siteStatusFilter = siteStatusFilter === status ? null : status;
          renderSidebar();
        },
        "site-total",
      );
      card.dataset.status = status;
      card.setAttribute("aria-pressed", String(siteStatusFilter === status));
      card.append(
        el("strong", String(count)),
        el("span", status[0].toUpperCase() + status.slice(1)),
      );
      totals.append(card);
    }
    body.append(totals);
    const activePages = pages.filter((page) =>
      Object.entries(page.counts).some(
        ([status, count]) => status !== "closed" && Number(count) > 0,
      ),
    ).length;
    const percent = total ? Math.round((closed / total) * 100) : 0;
    body.append(
      el(
        "p",
        total -
          closed +
          " active · " +
          activePages +
          " " +
          (activePages === 1 ? "page" : "pages"),
        "meta site-caption",
      ),
      el("strong", percent + "% finished"),
    );
    const progress = el("progress");
    progress.max = 100;
    progress.value = percent;
    progress.setAttribute("aria-label", "Feedback finished");
    body.append(
      progress,
      el(
        "p",
        closed + " closed · " + (total - closed) + " remaining",
        "meta progress-caption",
      ),
    );
    const siteSearch = el("label", "Search all pages", "site-search-label");
    siteSearch.append(globalInput);
    body.append(siteSearch, globalResults);
    for (const p of pages) {
      if (siteStatusFilter && !p.counts[siteStatusFilter]) continue;
      if (
        !showClosed &&
        !Object.entries(p.counts).some(
          ([status, count]) => status !== "closed" && Number(count) > 0,
        )
      )
        continue;
      const a = el("a", "", "row page-row");
      a.href = p.url;
      const heading = el("div", "", "page-row-heading");
      heading.append(el("strong", p.title));
      if (pageIdentity(p.url) === pageIdentity(location.href)) {
        a.setAttribute("aria-current", "page");
        heading.append(el("span", "Current", "current-badge"));
      }
      const counts = el("div", "", "page-counts");
      for (const status of statuses) {
        const count = Number(p.counts[status] || 0);
        if (!count || (status === "closed" && !showClosed)) continue;
        const label = el(
          "span",
          count + " " + status[0].toUpperCase() + status.slice(1),
        );
        label.style.color = colors[status];
        counts.append(label);
      }
      a.append(heading, counts);
      body.append(a);
    }
    sidebar.append(body);
  }
  async function loadActivity(reset: boolean) {
    const params = new URLSearchParams();
    if (!reset && activityBefore) params.set("before", String(activityBefore));
    if (activityUnreadOnly) params.set("unread_only", "true");
    const data = await request<{
      events: Activity[];
      more: boolean;
      before: number | null;
    }>("/activity?" + params.toString());
    events = reset ? data.events : [...events, ...data.events];
    activityBefore = data.before;
    activityMore = data.more;
  }

  function appendLinkedText(parent: HTMLElement, text: string) {
    const urls = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
    let cursor = 0;
    for (const match of text.matchAll(urls)) {
      const start = match.index!;
      let url = match[0].replace(/[.,!?;:]+$/, "");
      while (
        url.endsWith(")") &&
        (url.match(/\)/g)?.length || 0) > (url.match(/\(/g)?.length || 0)
      )
        url = url.slice(0, -1);
      parent.append(document.createTextNode(text.slice(cursor, start)));
      try {
        const parsed = new URL(url.startsWith("www.") ? "https://" + url : url);
        if (!["http:", "https:"].includes(parsed.protocol))
          throw new Error("Unsupported URL");
        const link = el("a", url, "comment-link");
        link.href = parsed.href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        parent.append(link);
      } catch {
        parent.append(document.createTextNode(url));
      }
      parent.append(document.createTextNode(match[0].slice(url.length)));
      cursor = start + match[0].length;
    }
    parent.append(document.createTextNode(text.slice(cursor)));
  }
  function historyText(text: string, statusHistory: boolean) {
    const p = el("p");
    const match = statusHistory
      ? text.match(/^Status updated to (open|review|content|closed)([\s\S]*)$/)
      : null;
    if (!match) {
      appendLinkedText(p, text);
      return p;
    }
    p.append(document.createTextNode("Status updated to "));
    const strong = el("strong", match[1]);
    strong.classList.add("history-status");
    strong.dataset.status = match[1];
    strong.style.color =
      "var(--ff-status-" + match[1] + ", " + colors[match[1] as Status] + ")";
    p.append(strong);
    appendLinkedText(p, match[2]);
    return p;
  }
  async function startReattach(original: Thread) {
    if (busy || reattaching) return;
    await ensureMember();
    const banner = el("div", "", "float-note");
    const sidebarWasOpen = sidebarOpen;
    reattaching = { original, anchor: null, sidebarWasOpen, banner };
    sidebarOpen = false;
    panel.classList.add("hide");
    host.dataset.reattaching = "true";
    renderSidebar();
    shadow.append(banner);
    renderReattachBanner();
    renderDots();
  }
  function renderReattachBanner() {
    if (!reattaching) return;
    const current = reattaching;
    current.banner.replaceChildren(
      el(
        "span",
        current.anchor
          ? "Preview for #" +
              current.original.comment.id +
              ". Click another position or confirm."
          : "Select a new target for #" +
              current.original.comment.id +
              ". Escape to cancel.",
      ),
    );
    if (current.anchor)
      current.banner.append(
        button(
          "Confirm placement",
          () =>
            perform(async () => {
              const updated = await request<Thread>(
                "/comments/" + current.original.comment.id + "/anchor",
                {
                  method: "PATCH",
                  body: json({
                    anchor: current.anchor,
                    version: current.original.comment.version,
                  }),
                },
              );
              current.banner.remove();
              reattaching = null;
              delete host.dataset.reattaching;
              thread = updated;
              renderThread();
              await load();
            }),
          "primary",
        ),
      );
    current.banner.append(button("Cancel", cancelReattach));
  }
  function cancelReattach() {
    if (!reattaching || busy) return;
    const current = reattaching;
    reattaching = null;
    current.banner.remove();
    delete host.dataset.reattaching;
    thread = current.original;
    sidebarOpen = current.sidebarWasOpen;
    renderThread();
    renderSidebar();
    renderDots();
  }
  function pageTarget(x: number, y: number) {
    const display = host.style.display;
    host.style.display = "none";
    let target: Element | null;
    try {
      target = document.elementFromPoint(x, y);
    } finally {
      host.style.display = display;
    }
    return target;
  }
  function startDrag(
    event: PointerEvent,
    node: HTMLElement,
    comment?: Comment,
  ) {
    if (busy || reattaching || event.button !== 0 || cancelDrag) return;
    if (comment && !guest) {
      event.preventDefault();
      event.stopPropagation();
      openThread(comment.id)
        .then(() => {
          if (thread) return startReattach(thread);
        })
        .catch(showError);
      return;
    }
    const draft = !comment;
    if (draft && !activeAnchor) return;
    event.preventDefault();
    event.stopPropagation();
    const controller = new AbortController(),
      preview = el("div", "", "dot");
    preview.dataset.preview = "true";
    preview.style.setProperty("--status", colors[comment?.status || newStatus]);
    preview.style.setProperty(
      "--dot-color",
      dotColors[comment?.status || newStatus],
    );
    preview.style.pointerEvents = "none";
    shadow.append(preview);
    let x = event.clientX,
      y = event.clientY,
      moved = false;
    node.style.visibility = "hidden";
    draggingCursor = true;
    syncPageCursor();
    const draw = () => {
      preview.style.left = x + "px";
      preview.style.top = y + "px";
    };
    draw();
    const cleanup = () => {
      controller.abort();
      draggingCursor = false;
      syncPageCursor();
      preview.remove();
      node.style.visibility = "";
      cancelDrag = null;
      suppressDotClickUntil = performance.now() + 400;
    };
    cancelDrag = () => {
      cleanup();
      renderDots();
    };
    document.addEventListener(
      "pointermove",
      (e) => {
        if (e.pointerId !== event.pointerId) return;
        x = e.clientX;
        y = e.clientY;
        moved = moved || Math.hypot(x - event.clientX, y - event.clientY) > 4;
        draw();
      },
      { signal: controller.signal },
    );
    document.addEventListener("pointercancel", () => cancelDrag?.(), {
      signal: controller.signal,
    });
    addEventListener("blur", () => cancelDrag?.(), {
      signal: controller.signal,
    });
    document.addEventListener(
      "pointerup",
      (e) => {
        if (e.pointerId !== event.pointerId) return;
        const target = pageTarget(x, y);
        cleanup();
        if (!moved || !target) {
          renderDots();
          return;
        }
        const anchor = anchorAt(target, x, y);
        if (draft) {
          activeAnchor = anchor;
          saveNewDraft();
          renderNew();
          renderDots();
          return;
        }
        perform(async () => {
          const updated = await request<Thread>(
            "/comments/" + comment!.id + "/anchor",
            {
              method: "PATCH",
              body: json({ anchor, version: comment!.version }),
            },
          );
          if (thread?.comment.id === comment!.id) {
            thread = updated;
            renderThread();
          }
          await load();
        }).finally(renderDots);
      },
      { signal: controller.signal },
    );
  }

  function showPlacementHint() {
    const note = el(
      "div",
      "Click the page to place a new comment. Escape to cancel.",
      "float-note",
    );
    note.append(
      button("Cancel", () => {
        armed = false;
        note.remove();
      }),
    );
    shadow.append(note);
    const timer = setInterval(() => {
      if (!armed) {
        clearInterval(timer);
        note.remove();
      }
    }, 200);
  }
  document.addEventListener(
    "click",
    (e) => {
      if (reattaching && !e.composedPath().includes(host)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (busy || !(e.target instanceof Element)) return;
        reattaching.anchor = anchorAt(e.target, e.clientX, e.clientY);
        renderReattachBanner();
        renderDots();
        return;
      }
      if (e.composedPath().includes(host) || (!e.shiftKey && !armed) || busy)
        return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      armed = false;
      begin(anchorAt(target, e.clientX, e.clientY)).catch(showError);
    },
    true,
  );
  shadow.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Escape") {
      e.stopPropagation();
      if (cancelDrag) {
        cancelDrag();
        return;
      }
      if (reattaching) {
        cancelReattach();
        return;
      }
      closePanel();
    }
  });
  let shiftPlacementCursor = false,
    draggingCursor = false;
  const pageCursorStyle = document.createElement("style");
  pageCursorStyle.dataset.flakflakCursor = "";
  document.documentElement.append(pageCursorStyle);
  function syncPageCursor() {
    const cursor = draggingCursor
      ? "grabbing"
      : shiftPlacementCursor
        ? "crosshair"
        : "";
    pageCursorStyle.textContent = cursor
      ? "html, body, body * { cursor: " + cursor + " !important; }"
      : "";
    host.dataset.dragging = String(draggingCursor);
  }
  let controlOnly = false;
  document.addEventListener("keydown", (e) => {
    const editing = e
      .composedPath()
      .some(
        (node) =>
          node instanceof Element &&
          node.matches('input,textarea,select,[contenteditable="true"]'),
      );
    if (e.key === "Shift" && !editing && !e.composedPath().includes(host)) {
      shiftPlacementCursor = true;
      syncPageCursor();
    }
    host.dataset.altHeld = String(e.altKey);
    if (
      e.key === "Control" &&
      !e.repeat &&
      !editing &&
      !e.shiftKey &&
      !e.altKey &&
      !e.metaKey
    )
      controlOnly = true;
    else if (e.key !== "Control") controlOnly = false;
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === "Shift") {
      shiftPlacementCursor = false;
      syncPageCursor();
    }
    host.dataset.altHeld = String(e.altKey);
    if (e.key === "Control") {
      if (controlOnly) {
        void ensureMember()
          .then(() => setSidebarOpen(!sidebarOpen))
          .catch(showError);
      }
      controlOnly = false;
    }
  });
  addEventListener("blur", () => {
    controlOnly = false;
    shiftPlacementCursor = false;
    draggingCursor = false;
    host.dataset.altHeld = "false";
    syncPageCursor();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (cancelDrag) {
        cancelDrag();
        return;
      }
      if (reattaching) {
        cancelReattach();
        return;
      }
      armed = false;
      closePanel();
    }
  });
  addEventListener("focus", () => {
    if (!busy && !armed && !reattaching) {
      load()
        .then(async () => {
          if (view === "activity") {
            await loadActivity(true);
            renderSidebar();
          }
        })
        .catch(showError);
    }
  });
  let lastUrl = location.href;
  const navigation = setInterval(() => {
    if (location.href !== lastUrl) {
      const previous = lastUrl;
      lastUrl = location.href;
      if (
        new URL(previous).pathname + new URL(previous).search !==
        location.pathname + location.search
      ) {
        closePanel();
        load().then(openHash).catch(showError);
      } else openHash();
    }
  }, 700);
  addEventListener("pagehide", () => {
    pageCursorStyle.remove();
    clearInterval(navigation);
    observer.disconnect();
    changes.disconnect();
  });
  function openHash() {
    const match = location.hash.match(/^#flakflak-comment-(\d+)$/);
    if (match && thread?.comment.id !== Number(match[1]))
      openThread(Number(match[1]))
        .then(() => {
          const a = thread?.comment.anchor;
          if (a) {
            const p = resolveAnchor(a);
            if (p.y < 0 || p.y > innerHeight)
              scrollBy({ top: p.y - innerHeight / 3, behavior: "smooth" });
          }
        })
        .catch(showError);
  }
  if (guest)
    void load()
      .then(() => {
        launch.title = site?.name || "FlakFlak";
        openHash();
      })
      .catch(showError);
}
