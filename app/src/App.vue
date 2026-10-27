<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { api, json, readStored, store, ApiError } from "../../shared/api";
import type { Site } from "../../shared/types";
type User = { id: number; name: string; email: string };
type Person = User & { role: string; accepted_at: string };
type Invitation = {
  id: string;
  email: string;
  status: string;
  url: string;
  created_at: string;
};
const base = import.meta.env.VITE_API_URL;
const sessionKey = "flakflak:account";
const token = ref(
  readStored<{ token: string; expires_at: string } | null>(sessionKey, null)
    ?.token || "",
);
const user = ref<User | null>(null),
  sites = ref<Site[]>([]),
  selected = ref<Site | null>(null);
const busy = ref(false),
  error = ref(""),
  notice = ref(""),
  email = ref(""),
  displayName = ref("");
const editingProfile = ref(false);
const name = ref(""),
  origins = ref(""),
  editing = ref(false),
  editName = ref(""),
  editOrigins = ref("");
const inviteEmail = ref(""),
  members = ref<Person[]>([]),
  invitations = ref<Invitation[]>([]),
  counts = ref({ comments: 0, files: 0 }),
  confirmation = ref("");
const fragment = new URLSearchParams(location.hash.slice(1));
const magic = ref(fragment.get("magic") || "");
const invitation = ref(
  fragment.get("invitation") ||
    sessionStorage.getItem("flakflak:invitation") ||
    "",
);
if (invitation.value)
  sessionStorage.setItem("flakflak:invitation", invitation.value);
// Never leave magic-link or invitation tokens in browser history/referrers.
if (fragment.has("magic") || fragment.has("invitation"))
  history.replaceState(null, "", location.pathname + location.search);
const query = new URLSearchParams(location.search);
const connection = query.has("connect")
  ? {
      site: query.get("connect")!,
      origin: query.get("origin") || "",
      state: query.get("state") || "",
      challenge: query.get("challenge") || "",
    }
  : null;
const invitationInfo = ref<{
    site_name: string;
    email: string;
    accepted: boolean;
  } | null>(null),
  handoffCode = ref("");
const isOwner = computed(() => selected.value?.role === "owner");
const snippet = computed(() =>
  selected.value
    ? '<script src="' +
      selected.value.embed_url +
      '" data-site-id="' +
      selected.value.id +
      '" defer><' +
      "/script>"
    : "",
);
async function request<T>(path: string, options: RequestInit = {}) {
  return api<T>(base, path, options, token.value);
}
async function act(fn: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  notice.value = "";
  try {
    await fn();
  } catch (e) {
    error.value = (e as Error).message;
    if (e instanceof ApiError && e.status === 401) {
      token.value = "";
      user.value = null;
      store(sessionKey, null);
    }
  } finally {
    busy.value = false;
  }
}
async function refreshSites() {
  sites.value = await request<Site[]>("/sites");
  if (selected.value)
    selected.value =
      sites.value.find((s) => s.id === selected.value?.id) || null;
}
async function loadAccount() {
  if (!token.value) return;
  try {
    user.value = (await request<{ user: User }>("/auth/me")).user;
    displayName.value = user.value.name;
    await refreshSites();
  } catch (e) {
    token.value = "";
    user.value = null;
    store(sessionKey, null);
    error.value = (e as Error).message;
  }
}
async function sendLink() {
  await act(async () => {
    await api(base, "/auth/email", {
      method: "POST",
      body: json({
        email: email.value,
        invitation: invitation.value || undefined,
      }),
    });
    notice.value =
      "Check your email. Open the sign-in link, then confirm sign-in.";
  });
}
async function confirmLogin() {
  await act(async () => {
    const result = await api<{ token: string; expires_at: string; user: User }>(
      base,
      "/auth/verify",
      { method: "POST", body: json({ token: magic.value }) },
    );
    token.value = result.token;
    user.value = result.user;
    store(sessionKey, { token: result.token, expires_at: result.expires_at });
    magic.value = "";
    await refreshSites();
    notice.value =
      "Signed in. If you started from a website, return to its FlakFlak sign-in window to connect.";
  });
}
async function saveProfile() {
  await act(async () => {
    user.value = (
      await request<{ user: User }>("/auth/profile", {
        method: "PATCH",
        body: json({ name: displayName.value }),
      })
    ).user;
    editingProfile.value = false;
  });
}
async function signOut() {
  await act(async () => {
    await request("/auth/logout", { method: "POST" });
    store(sessionKey, null);
    token.value = "";
    user.value = null;
    sites.value = [];
    selected.value = null;
    notice.value = "Signed out on all devices and connected websites.";
  });
}
async function accept() {
  await act(async () => {
    const accepted = await request<{ site_id: string }>("/invitations/accept", {
      method: "POST",
      body: json({ token: invitation.value }),
    });
    invitation.value = "";
    invitationInfo.value = null;
    sessionStorage.removeItem("flakflak:invitation");
    await refreshSites();
    await selectSite(sites.value.find((s) => s.id === accepted.site_id)!);
    notice.value = "Invitation accepted. You now have access to this site.";
  });
}
async function connectWidget() {
  await act(async () => {
    if (!connection) return;
    const origin = new URL(connection.origin).origin;
    if (
      origin !== connection.origin ||
      !["http:", "https:"].includes(new URL(origin).protocol)
    )
      throw Error("Invalid requesting website.");
    const result = await request<{ code: string }>("/auth/handoff", {
      method: "POST",
      body: json({
        site: connection.site,
        origin,
        challenge: connection.challenge,
      }),
    });
    if (window.opener) {
      window.opener.postMessage(
        {
          type: "flakflak:authorized",
          code: result.code,
          state: connection.state,
        },
        origin,
      );
      notice.value = "Connected. You can close this window.";
      window.close();
    } else {
      handoffCode.value = result.code;
      notice.value =
        "Copy this one-time code into the website’s FlakFlak sign-in dialog within two minutes.";
    }
  });
}
async function selectSite(site: Site) {
  if (!site) return;
  selected.value = site;
  editing.value = false;
  confirmation.value = "";
  members.value = [];
  invitations.value = [];
  if (site.role === "owner") await loadMembers();
}
async function loadMembers() {
  if (!selected.value) return;
  const siteId = selected.value.id;
  const result = await request<{
    members: Person[];
    invitations: Invitation[];
    counts: { comments: number; files: number };
  }>("/sites/" + selected.value.id + "/members");
  if (selected.value?.id !== siteId) return;
  members.value = result.members;
  invitations.value = result.invitations;
  counts.value = result.counts;
}
async function create() {
  await act(async () => {
    const site = await request<Site>("/sites", {
      method: "POST",
      body: json({
        name: name.value,
        origins: origins.value
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    });
    sites.value.unshift(site);
    await selectSite(site);
    name.value = "";
    origins.value = "";
    notice.value = "Site created.";
  });
}
function edit() {
  if (!selected.value) return;
  editing.value = true;
  editName.value = selected.value.name;
  editOrigins.value = selected.value.origins.join("\n");
}
async function saveSettings() {
  await act(async () => {
    if (!selected.value) return;
    const updated = await request<Site>("/sites/" + selected.value.id, {
      method: "PATCH",
      body: json({
        name: editName.value,
        origins: editOrigins.value
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
      }),
    });
    selected.value = updated;
    await refreshSites();
    editing.value = false;
    notice.value = "Site settings saved.";
  });
}
async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    notice.value = "Copied!";
  } catch {
    error.value =
      "Clipboard unavailable. Select and copy the link shown below.";
  }
}
async function invite(address: string) {
  await act(async () => {
    if (!selected.value) return;
    try {
      await request("/sites/" + selected.value.id + "/invitations", {
        method: "POST",
        body: json({ email: address }),
      });
      inviteEmail.value = "";
      notice.value = "Invitation sent. You can also copy its link below.";
    } finally {
      await loadMembers();
    }
  });
}
async function deleteInvitation(id: string) {
  await act(async () => {
    await request("/sites/" + selected.value!.id + "/invitations/" + id, {
      method: "DELETE",
    });
    await loadMembers();
    notice.value = "Invitation deleted. Its link no longer works.";
  });
}
async function removeMember(id: number) {
  if (!confirm("Remove this member’s access to this site?")) return;
  await act(async () => {
    await request("/sites/" + selected.value!.id + "/members/" + id, {
      method: "DELETE",
    });
    await loadMembers();
    notice.value = "Member access removed.";
  });
}
async function reset() {
  await act(async () => {
    await request("/sites/" + selected.value!.id + "/reset-feedback", {
      method: "POST",
      body: json({ confirmation: confirmation.value }),
    });
    confirmation.value = "";
    await loadMembers();
    notice.value =
      "Feedback reset. Comments, replies, files, activity and read tracking have been removed.";
  });
}
onMounted(async () => {
  await loadAccount();
  if (invitation.value) {
    try {
      invitationInfo.value = await api(base, "/invitations/preview", {
        method: "POST",
        body: json({ token: invitation.value }),
      });
      email.value = invitationInfo.value!.email;
    } catch (e) {
      error.value = (e as Error).message;
    }
  }
});
window.addEventListener("storage", (event) => {
  if (event.key !== sessionKey) return;
  token.value =
    readStored<{ token: string } | null>(sessionKey, null)?.token || "";
  if (token.value) void loadAccount();
  else {
    user.value = null;
    sites.value = [];
    selected.value = null;
  }
});
</script>
<template>
  <div class="shell">
    <header>
      <a class="brand" href="/">FlakFlak<span class="brand-dot"></span></a
      ><span class="workspace">Your feedback workspace</span
      ><button
        v-if="user && user.name"
        class="quiet"
        @click="
          editingProfile = true;
          displayName = user.name;
        "
        :disabled="busy"
      >
        Profile</button
      ><button v-if="user" class="quiet" @click="signOut" :disabled="busy">
        Sign out
      </button>
    </header>
    <main>
      <div class="eyebrow">YOUR FEEDBACK, IN ONE PLACE</div>
      <h1>{{ connection ? "Connect" : "Sites" }}<span>.</span></h1>
      <p class="intro">
        Private feedback for your team. Sign in by email and access the sites
        you’ve been invited to.
      </p>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <p v-if="notice" role="status" class="notice">{{ notice }}</p>
      <section v-if="invitationInfo" class="card">
        <h2>Invitation to {{ invitationInfo.site_name }}</h2>
        <p>Invited email: {{ invitationInfo.email }}</p>
        <p>Sign in with this email, then accept to gain site access.</p>
        <button v-if="user && user.name" @click="accept" :disabled="busy">
          Accept invitation
        </button>
        <p v-if="user && user.email !== invitationInfo.email">
          You’re signed in as {{ user.email }}. Sign out and use the invited
          email.
        </p>
      </section>
      <section v-if="magic" class="card access">
        <h2>Confirm email sign-in</h2>
        <p>This link works once. Confirm only if you requested it.</p>
        <button @click="confirmLogin" :disabled="busy">Confirm sign-in</button>
      </section>
      <section v-else-if="!user" class="card access">
        <h2>Sign in or register</h2>
        <p>
          We’ll email you a sign-in link. No password needed. A site invitation
          is required to view feedback.
        </p>
        <form @submit.prevent="sendLink">
          <label for="email">Email address</label
          ><input
            id="email"
            v-model="email"
            type="email"
            autocomplete="email"
            required
            maxlength="254"
          /><button :disabled="busy">Email me a sign-in link</button>
        </form>
      </section>
      <section v-else-if="!user.name || editingProfile" class="card">
        <h2>Your profile</h2>
        <p>Signed in as {{ user.email }}</p>
        <form @submit.prevent="saveProfile">
          <label for="display-name">Display name</label
          ><input
            id="display-name"
            v-model="displayName"
            required
            maxlength="100"
            autocomplete="name"
          /><button :disabled="busy">Save profile</button
          ><button
            v-if="user.name"
            type="button"
            class="quiet"
            @click="editingProfile = false"
          >
            Cancel
          </button>
        </form>
      </section>
      <template v-else>
        <section v-if="connection" class="card">
          <h2>Connect to website</h2>
          <p>{{ connection.origin }}</p>
          <p>
            Your session will be limited to the requested site. You must be a
            member.
          </p>
          <button @click="connectWidget" :disabled="busy">Connect widget</button
          ><label v-if="handoffCode"
            >One-time connection code<input
              :value="handoffCode"
              readonly
              @focus="($event.target as HTMLInputElement).select()"
          /></label>
        </section>
        <div v-else class="columns">
          <section class="card">
            <div class="section-heading">
              <h2>Your sites</h2>
              <span class="pill">{{ sites.length }}</span>
            </div>
            <p v-if="!sites.length">
              No sites yet. Accept an invitation or create your own site.
            </p>
            <button
              class="site-row"
              v-for="site in sites"
              :key="site.id"
              :data-site-id="site.id"
              :class="{ selected: selected?.id === site.id }"
              @click="selectSite(site).catch((e) => (error = e.message))"
            >
              <span class="site-icon">{{
                site.name.slice(0, 1).toUpperCase()
              }}</span
              ><span
                ><strong>{{ site.name }}</strong
                ><small>{{
                  site.role === "owner" ? "Owner" : "Member"
                }}</small></span
              >
            </button>
          </section>
          <section class="card">
            <h2>Add a site</h2>
            <form @submit.prevent="create">
              <label for="name">Site name</label
              ><input id="name" v-model="name" required maxlength="100" /><label
                for="origins"
                >Allowed website addresses</label
              ><textarea
                id="origins"
                v-model="origins"
                required
                rows="3"
                placeholder="https://mysite.com"
              ></textarea
              ><small
                >One origin per line, including http/https and any port.</small
              ><button :disabled="busy">Create site</button>
            </form>
          </section>
          <section v-if="selected" class="card installation">
            <div class="section-heading">
              <h2>{{ selected.name }}</h2>
              <button v-if="isOwner" @click="copy(snippet)">
                Copy embed code
              </button>
            </div>
            <template v-if="isOwner"
              ><button class="quiet" @click="edit">Edit site settings</button>
              <form v-if="editing" @submit.prevent="saveSettings">
                <label
                  >Site name<input
                    v-model="editName"
                    required
                    maxlength="100" /></label
                ><label
                  >Allowed origins<textarea
                    v-model="editOrigins"
                    required
                    rows="3"
                  ></textarea></label
                ><button :disabled="busy">Save settings</button
                ><button type="button" class="quiet" @click="editing = false">
                  Cancel
                </button>
              </form>
              <p>Add this script before your website’s closing body tag.</p>
              <pre tabindex="0">{{ snippet }}</pre>
            </template>
            <div class="demo-links">
              <a
                :href="'/demo.html?site=' + selected.id"
                target="_blank"
                rel="noopener"
                >Open demo ↗</a
              ><span
                >The dashboard’s origin must be allowed to connect the
                demo.</span
              >
            </div>
            <template v-if="isOwner"
              ><h2>Members</h2>
              <p>Invitations grant access to this site only.</p>
              <form @submit.prevent="invite(inviteEmail)">
                <label for="invite-email">Invite by email</label
                ><input
                  id="invite-email"
                  v-model="inviteEmail"
                  type="email"
                  required
                /><button :disabled="busy">Send invitation</button>
              </form>
              <div
                v-for="person in members"
                :key="person.id"
                class="member-row"
              >
                <div>
                  <strong>{{ person.name || person.email }}</strong
                  ><small
                    >{{ person.email }} ·
                    {{ person.role === "owner" ? "Owner" : "Member" }} ·
                    Accepted
                    {{
                      new Date(person.accepted_at).toLocaleDateString()
                    }}</small
                  >
                </div>
                <button
                  v-if="person.role !== 'owner'"
                  class="quiet"
                  @click="removeMember(person.id)"
                  :disabled="busy"
                >
                  Remove member
                </button>
              </div>
              <div
                v-for="item in invitations"
                :key="item.id"
                class="member-row"
              >
                <div>
                  <strong>{{ item.email }}</strong
                  ><small
                    >Pending · Invited
                    {{ new Date(item.created_at).toLocaleDateString() }}</small
                  >
                </div>
                <div class="toolbar">
                  <button @click="copy(item.url)">Copy invitation link</button
                  ><button
                    class="quiet"
                    @click="invite(item.email)"
                    :disabled="busy"
                  >
                    Resend</button
                  ><button
                    class="quiet"
                    @click="deleteInvitation(item.id)"
                    :disabled="busy"
                  >
                    Delete invitation
                  </button>
                </div>
                <input
                  :value="item.url"
                  readonly
                  aria-label="Invitation link"
                  @focus="($event.target as HTMLInputElement).select()"
                />
              </div>
              <section class="danger-zone">
                <h2>Reset feedback</h2>
                <p>
                  Permanently delete {{ counts.comments }} comments, all replies
                  and status history, {{ counts.files }} attachment files,
                  activity and read tracking. Existing browser drafts will be
                  cleared on their next connection. Site settings and members
                  remain.
                </p>
                <p>Backups retain their copies until they expire.</p>
                <form @submit.prevent="reset">
                  <label
                    >Type {{ selected.name }} to confirm<input
                      v-model="confirmation"
                      autocomplete="off"
                      required /></label
                  ><button :disabled="busy || confirmation !== selected.name">
                    Reset feedback permanently
                  </button>
                </form>
              </section>
            </template>
          </section>
        </div></template
      >
    </main>
    <footer>FlakFlak · Private, invitation-only website feedback.</footer>
  </div>
</template>
