import { api, json, readStored, store, ApiError } from "../../shared/api";
import type {
  Anchor,
  Attachment,
  Comment,
  Guest,
  Page,
  Status,
  Thread,
  Activity,
  Site,
} from "../../shared/types";
import { anchorAt, resolveAnchor } from "./anchors";
import css from "./widget.css?inline";

const script = document.currentScript as HTMLScriptElement | null;
const siteId = script?.dataset.siteId;
const base = script?.dataset.apiUrl || import.meta.env.VITE_API_URL;
if (siteId && base && !document.querySelector("[data-flakflak-root]"))
  start(siteId, base);

function start(siteId: string, base: string) {
  const host = document.createElement("div");
  host.dataset.flakflakRoot = "";
  host.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483646;";
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
    open: "#ffad96",
    review: "#b4c7ff",
    content: "#ddbbff",
    closed: "#9bdfb7",
  };
  const sitePath = "/sites/" + siteId;
  let site: Site | null = null,
    comments: Comment[] = [],
    pages: Page[] = [],
    thread: Thread | null = null;
  const identityKey = "flakflak:guest:" + siteId;
  let guest = readStored<Guest | null>(identityKey, null);
  if (guest && Date.parse(guest.expires_at) <= Date.now()) guest = null;
  let activeAnchor: Anchor | null = null,
    sidebarOpen = false,
    armed = false,
    busy = false,
    revision = 0,
    newId: string = crypto.randomUUID(),
    savedId: number | null = null,
    newBody = "",
    newStatus: "open" | "content" = "open",
    replyId = crypto.randomUUID(),
    expandedReplies = false;
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
  let pending: { file: File; id: string; url: string }[] = [];
  let search = "",
    showClosed = readStored("flakflak:closed:" + siteId, false),
    view: "comments" | "activity" | "settings" = "comments";
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
    () => {
      sidebarOpen = !sidebarOpen;
      renderSidebar();
    },
    "launcher",
  );
  shadow.append(dots, sidebar, panel, launch);
  function request<T>(path: string, options: RequestInit = {}) {
    return api<T>(base, sitePath + path, options, guest?.token);
  }
  function showError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof ApiError && error.status === 401) {
      guest = null;
      store(identityKey, null);
    }
    const box = el("div", message, "float-note");
    box.setAttribute("role", "alert");
    box.append(button("Dismiss", () => box.remove()));
    shadow.append(box);
  }
  function date(value: string) {
    return new Date(
      value.includes("T") ? value : value.replace(" ", "T") + "Z",
    ).toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
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
  async function ensureGuest() {
    if (guest) return;
    await new Promise<void>((resolve, reject) => {
      const backdrop = el("div", "", "backdrop"),
        dialog = el("form", "", "name-dialog");
      dialog.setAttribute("role", "dialog");
      dialog.setAttribute("aria-modal", "true");
      dialog.setAttribute("aria-label", "Your name");
      const body = el("div", "", "body"),
        input = el("input");
      input.required = true;
      input.maxLength = 100;
      input.autocomplete = "name";
      input.id = "ff-name";
      const label = el("label", "Your name");
      label.htmlFor = input.id;
      const submit = el("button", "Continue", "primary");
      submit.type = "submit";
      const close = () => {
        backdrop.remove();
        dialog.remove();
      };
      body.append(
        el("p", "Enter your name to leave feedback. No account needed."),
        label,
        input,
        submit,
      );
      dialog.append(
        titlebar("Welcome to FlakFlak", () => {
          close();
          reject(new Error("Name entry cancelled."));
        }),
        body,
      );
      shadow.append(backdrop, dialog);
      input.focus();
      dialog.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!input.value.trim()) return;
        submit.disabled = true;
        try {
          guest = await request<Guest>("/guests", {
            method: "POST",
            body: json({ name: input.value.trim() }),
          });
          const persisted = store(identityKey, guest);
          if (!persisted)
            showError(
              "Browser storage is unavailable. Your guest identity will last only for this page visit.",
            );
          close();
          resolve();
        } catch (err) {
          submit.disabled = false;
          showError(err);
        }
      });
      dialog.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
          reject(new Error("Name entry cancelled."));
        }
        if (e.key === "Tab") {
          const focusable = Array.from(
            dialog.querySelectorAll<HTMLElement>("button,input"),
          );
          const first = focusable[0],
            last = focusable.at(-1);
          if (e.shiftKey && shadow.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && shadow.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      });
    });
  }
  async function load() {
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
      const b = button("#" + c.id, () => openThread(c.id), "dot");
      b.textContent = "";
      b.dataset.commentId = String(c.id);
      b.style.setProperty("--status", colors[c.status]);
      b.setAttribute("aria-label", "Open comment #" + c.id + " · " + c.status);
      dots.append(b);
    }
    if (activeAnchor) {
      const b = el("div", "", "dot");
      b.dataset.draft = "true";
      b.style.setProperty("--status", colors[newStatus]);
      b.setAttribute("aria-hidden", "true");
      dots.append(b);
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
    const width = Math.min(370, innerWidth - 24);
    let left = Math.max(12, Math.min(innerWidth - width - 12, p.x + 16)),
      top = Math.max(12, Math.min(innerHeight - 140, p.y + 16));
    if (left + width > innerWidth - 12) left = innerWidth - width - 12;
    if (sidebarOpen && innerWidth > 760 && left < 364) left = 364;
    top = Math.min(top, Math.max(12, innerHeight - panel.offsetHeight - 12));
    panel.style.left = left + "px";
    panel.style.top = top + "px";
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
  function closePanel() {
    if (busy) return;
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
    location.origin +
    location.pathname +
    ":" +
    (guest?.id || "guest") +
    ":" +
    type +
    ":" +
    id;
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
    await ensureGuest();
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
      newBody = draft.body;
      if (resume || draft.saved_id) activeAnchor = draft.anchor;
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
    renderNew();
  }
  function renderNew() {
    panel.replaceChildren(titlebar("New comment", closePanel));
    panel.classList.remove("hide");
    const body = el("div", "", "body");
    const status = el("select");
    status.setAttribute("aria-label", "New comment status");
    for (const s of ["open", "content"]) {
      const o = el("option", s[0].toUpperCase() + s.slice(1));
      o.value = s;
      status.append(o);
    }
    status.value = newStatus;
    status.disabled = !!savedId;
    status.onchange = () => {
      newStatus = status.value as "open" | "content";
      saveNewDraft();
      renderDots();
    };
    const input = el("textarea");
    input.placeholder = "What should change?";
    input.setAttribute("aria-label", "Comment");
    input.value = newBody;
    input.disabled = !!savedId;
    input.maxLength = 10000;
    input.oninput = () => {
      newBody = input.value;
      saveNewDraft();
    };
    const drop = el("div", "", "drop");
    const fileInput = el("input");
    fileInput.type = "file";
    fileInput.multiple = true;
    fileInput.accept = "image/png,image/jpeg,image/webp,image/gif,video/mp4";
    fileInput.setAttribute("aria-label", "Attach files");
    fileInput.onchange = () => {
      if (fileInput.files) queueFiles(fileInput.files);
    };
    drop.append(el("label", "Attach files · drop or paste images"), fileInput);
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
          renderNew();
        }),
      );
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
    body.append(
      status,
      input,
      el(
        "p",
        savedId
          ? "Comment saved. Retry any remaining attachments."
          : "Draft saved in this browser. Files must be reselected after reload.",
        "hint",
      ),
      previews,
      drop,
      actions,
    );
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
    thread = await request<Thread>("/comments/" + id);
    expandedReplies = false;
    replyId = crypto.randomUUID();
    renderThread();
    renderDots();
  }
  function renderThread() {
    if (!thread) return;
    const t = thread,
      c = t.comment;
    panel.classList.remove("hide");
    panel.replaceChildren(
      titlebar("#" + c.id + " · " + date(c.created_at), closePanel),
    );
    const body = el("div", "", "body");
    const tools = el("div", "", "toolbar");
    tools.append(
      button("Copy link", async () => {
        const u = new URL(location.href);
        u.hash = "flakflak-comment-" + c.id;
        await navigator.clipboard.writeText(u.href);
      }),
    );
    body.append(tools, el("strong", c.name), el("p", c.body));
    if (resolveAnchor(c.anchor).missing)
      body.append(
        el(
          "p",
          "The original target changed. The dot uses its saved page position.",
          "hint",
        ),
      );
    if (t.replies.length) {
      body.append(
        el(
          "div",
          t.replies.length +
            " " +
            (t.replies.length === 1 ? "reply" : "replies"),
          "meta",
        ),
      );
      if (t.replies.length > 2 && !expandedReplies)
        body.append(
          button(
            "Show earlier replies (" + (t.replies.length - 2) + ")",
            () => {
              expandedReplies = true;
              renderThread();
            },
          ),
        );
      for (const r of expandedReplies ? t.replies : t.replies.slice(-2)) {
        const row = el("div", "", "reply");
        row.append(
          el("strong", r.name),
          el("div", date(r.created_at), "meta"),
          el("p", r.body),
        );
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
          await ensureGuest();
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
    actions.append(send);
    body.append(actions);
    shortcut(input, send);
    const attachments = el("div", "", "files");
    t.attachments.forEach((a, i) => {
      const file = el("div", "", "file");
      const b = button(a.name, () => gallery(t.attachments, i));
      if (a.mime.startsWith("image/")) {
        const img = el("img");
        img.src = a.url;
        img.alt = a.name;
        b.replaceChildren(img);
      }
      file.append(b);
      attachments.append(file);
    });
    const upload = el("input");
    upload.type = "file";
    upload.multiple = true;
    upload.accept = "image/png,image/jpeg,image/webp,image/gif,video/mp4";
    upload.setAttribute("aria-label", "Add attachments");
    async function uploadFiles(files: File[]) {
      await perform(async () => {
        await ensureGuest();
        for (const file of files) {
          const form = new FormData();
          form.set("file", file);
          form.set("client_id", crypto.randomUUID());
          thread = await request<Thread>("/comments/" + c.id + "/attachments", {
            method: "POST",
            body: form,
          });
        }
        renderThread();
      });
    }
    upload.onchange = () => {
      if (upload.files) uploadFiles(Array.from(upload.files));
    };
    paste(input, uploadFiles);
    body.append(
      el("hr", "", "separator"),
      el("label", "Attachments"),
      attachments,
      upload,
      el("hr", "", "separator"),
      el("label", "Change status · click to update"),
    );
    const statusGrid = el("div", "", "status-grid");
    for (const s of statuses) {
      const b = button(s[0].toUpperCase() + s.slice(1), async () => {
        if (s === c.status) return;
        await ensureGuest();
        if (s === "closed") {
          showResolution();
          return;
        }
        await changeStatus(s);
      });
      b.style.setProperty("--status", colors[s]);
      b.setAttribute("aria-pressed", String(s === c.status));
      statusGrid.append(b);
    }
    body.append(statusGrid);
    panel.append(body);
    syncBusyControls();
    position();
    function showResolution() {
      const old = body.querySelector(".resolution");
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
      form.append(
        note,
        submit,
        button("Cancel", () => form.remove()),
      );
      body.append(form);
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
    const g = el("section", "", "gallery");
    g.setAttribute("role", "dialog");
    g.setAttribute("aria-modal", "true");
    g.setAttribute("aria-label", "Attachments");
    const focus = shadow.activeElement as HTMLElement | null;
    const savedOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    const close = () => {
      g.querySelectorAll("video").forEach((v) => v.pause());
      g.remove();
      document.documentElement.style.overflow = savedOverflow;
      focus?.focus();
    };
    function render() {
      g.querySelectorAll("video").forEach((v) => v.pause());
      g.replaceChildren(titlebar(files[index].name, close));
      const media = el("div", "", "gallery-media"),
        file = files[index];
      if (file.mime.startsWith("image/")) {
        const img = el("img");
        img.src = file.url;
        img.alt = file.name;
        media.append(img);
      } else {
        const v = el("video");
        v.src = file.url;
        v.controls = true;
        media.append(v);
      }
      const foot = el("footer"),
        prev = button("← Previous", () => {
          index--;
          render();
        }),
        next = button("Next →", () => {
          index++;
          render();
        });
      prev.disabled = index === 0;
      next.disabled = index === files.length - 1;
      foot.append(prev, el("span", index + 1 + " / " + files.length), next);
      g.append(media, foot);
      g.querySelector("button")?.focus();
    }
    g.onkeydown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
      if (e.key === "ArrowRight" && index < files.length - 1) {
        index++;
        render();
      }
      if (e.key === "ArrowLeft" && index > 0) {
        index--;
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
  function renderSidebar() {
    sidebar.classList.toggle("hide", !sidebarOpen);
    launch.setAttribute("aria-expanded", String(sidebarOpen));
    if (!sidebarOpen) return;
    sidebar.replaceChildren(
      titlebar("FlakFlak", () => {
        sidebarOpen = false;
        renderSidebar();
      }),
    );
    const body = el("div", "", "body"),
      tabs = el("div", "", "toolbar");
    for (const v of ["comments", "activity", "settings"] as const) {
      const b = button(v[0].toUpperCase() + v.slice(1), async () => {
        view = v;
        if (v === "activity") await loadActivity(true);
        renderSidebar();
      });
      b.setAttribute("aria-pressed", String(view === v));
      tabs.append(b);
    }
    body.append(tabs);
    if (view === "settings") {
      body.append(
        el("strong", "Settings"),
        el(
          "p",
          guest ? "Reviewing as " + guest.name : "No name entered yet.",
          "meta",
        ),
      );
      const label = el("label", "Show closed comments"),
        check = el("input");
      check.type = "checkbox";
      check.checked = showClosed;
      check.style.width = "auto";
      check.onchange = () => {
        showClosed = check.checked;
        store("flakflak:closed:" + siteId, showClosed);
        renderDots();
      };
      label.prepend(check);
      body.append(
        label,
        el("hr", "", "separator"),
        el("strong", "Keyboard shortcuts"),
        el(
          "p",
          "Shift + click · New comment\nCmd/Ctrl + Enter · Save, reply, or resolve\nEscape · Close comment box",
          "hint",
        ),
      );
      sidebar.append(body);
      return;
    }
    if (view === "activity") {
      const controls = el("div", "", "toolbar");
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
      if (!events.length)
        body.append(el("p", "No activity recorded yet.", "empty"));
      let lastGroup = "";
      for (const event of events) {
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
          body.append(el("h4", group, "meta"));
          lastGroup = group;
        }
        const b = button(
          event.name + " · " + event.summary,
          () => {
            const u = new URL(event.url);
            u.hash = "flakflak-comment-" + event.comment_id;
            if (u.origin + u.pathname === location.origin + location.pathname)
              openThread(event.comment_id).catch(showError);
            else location.href = u.href;
          },
          "row",
        );
        b.append(el("span", event.title + " · " + date(event.created_at)));
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
    body.append(
      el("div", "Current page", "meta"),
      el("strong", document.title || location.hostname),
    );
    const add = button(armed ? "Cancel placement" : "＋ Add comment", () => {
      armed = !armed;
      renderSidebar();
      if (armed) {
        sidebarOpen = false;
        renderSidebar();
        showPlacementHint();
      }
    });
    body.append(el("div", comments.length + " comments", "meta"), add);
    const draft = readStored<{ anchor: Anchor } | null>(
      draftKey("comment"),
      null,
    );
    if (draft?.anchor)
      body.append(
        button(
          "Resume new comment draft",
          () => begin(draft.anchor, true),
          "row",
        ),
      );
    const input = el("input");
    input.type = "search";
    input.placeholder = "Search this page";
    input.setAttribute("aria-label", "Search this page");
    input.value = search;
    input.oninput = () => {
      search = input.value;
      renderList();
    };
    body.append(input);
    const list = el("div");
    body.append(list);
    function renderList() {
      list.replaceChildren();
      const shown = comments.filter(
        (c) =>
          (showClosed || c.status !== "closed") &&
          ("#" + c.id + " " + c.body + " " + c.name)
            .toLowerCase()
            .includes(search.toLowerCase()),
      );
      for (const s of statuses) {
        const group = shown.filter((c) => c.status === s);
        if (!group.length) continue;
        const details = el("details");
        details.open = readStored(
          "flakflak:group:" + siteId + ":" + location.pathname + ":" + s,
          true,
        );
        const summary = el(
          "summary",
          s[0].toUpperCase() + s.slice(1) + " · " + group.length,
        );
        summary.style.color = colors[s];
        summary.style.margin = "14px 0 8px";
        summary.style.cursor = "pointer";
        details.append(summary);
        details.ontoggle = () =>
          store(
            "flakflak:group:" + siteId + ":" + location.pathname + ":" + s,
            details.open,
          );
        for (const c of group) {
          const b = button("", () => openThread(c.id), "row");
          b.append(
            el("strong", "#" + c.id + " · " + c.name),
            el("span", c.body),
          );
          details.append(b);
        }
        list.append(details);
      }
      if (!shown.length) list.append(el("p", "No matching comments.", "empty"));
    }
    renderList();
    body.append(el("hr", "", "separator"), el("strong", "All pages"));
    const globalInput = el("input");
    globalInput.type = "search";
    globalInput.placeholder = "Search all pages";
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
    const percent = total ? Math.round((closed / total) * 100) : 0;
    body.append(
      el("p", total - closed + " active · " + pages.length + " pages", "meta"),
      el("strong", percent + "% finished"),
    );
    const progress = el("progress");
    progress.max = 100;
    progress.value = percent;
    progress.setAttribute("aria-label", "Feedback finished");
    body.append(progress);
    for (const p of pages) {
      const a = el("a", p.title, "row");
      a.href = p.url;
      const current = new URL(p.url);
      if (
        current.origin + current.pathname ===
        location.origin + location.pathname
      )
        a.append(el("span", "Current"));
      a.append(
        el(
          "span",
          Object.entries(p.counts)
            .map(([s, n]) => n + " " + s)
            .join(" · "),
        ),
      );
      body.append(a);
    }
    sidebar.append(body);
  }
  async function loadActivity(reset: boolean) {
    const data = await request<{
      events: Activity[];
      more: boolean;
      before: number | null;
    }>(
      "/activity" +
        (!reset && activityBefore ? "?before=" + activityBefore : ""),
    );
    events = reset ? data.events : [...events, ...data.events];
    activityBefore = data.before;
    activityMore = data.more;
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
      closePanel();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      armed = false;
      closePanel();
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
  request<Site>("/config")
    .then(async (s) => {
      site = s;
      launch.title = s.name;
      await load();
      openHash();
    })
    .catch((e) => {
      launch.textContent = "FlakFlak · Setup needed";
      launch.onclick = () => showError(e);
      showError(e);
    });
}
