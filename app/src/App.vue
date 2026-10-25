<script setup lang="ts">
import { ref, computed } from "vue";
import { api, json } from "../../shared/api";
import type { Site } from "../../shared/types";
const base = import.meta.env.VITE_API_URL;
const editing = ref(false),
  editName = ref(""),
  editOrigins = ref("");
const key = ref(""),
  sites = ref<Site[]>([]),
  connected = ref(false),
  busy = ref(false),
  error = ref(""),
  notice = ref(""),
  name = ref(""),
  origins = ref(""),
  selected = ref<Site | null>(null);
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
async function connect() {
  busy.value = true;
  error.value = "";
  try {
    sites.value = await api<Site[]>(base, "/sites", {}, key.value);
    connected.value = true;
  } catch (e) {
    error.value = String((e as Error).message);
  } finally {
    busy.value = false;
  }
}
async function create() {
  busy.value = true;
  error.value = "";
  try {
    const site = await api<Site>(
      base,
      "/sites",
      {
        method: "POST",
        body: json({
          name: name.value,
          origins: origins.value
            .split(/[,\n]/)
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      },
      key.value,
    );
    sites.value.unshift(site);
    selected.value = site;
    name.value = "";
    origins.value = "";
    notice.value = "Site created. Copy its embed code below.";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
function edit() {
  if (!selected.value) return;
  editName.value = selected.value.name;
  editOrigins.value = selected.value.origins.join("\n");
  editing.value = true;
}
async function saveSettings() {
  if (!selected.value) return;
  busy.value = true;
  error.value = "";
  try {
    const updated = await api<Site>(
      base,
      "/sites/" + selected.value.id,
      {
        method: "PATCH",
        body: json({
          name: editName.value,
          origins: editOrigins.value
            .split(/[,\n]/)
            .map((s) => s.trim())
            .filter(Boolean),
        }),
      },
      key.value,
    );
    sites.value = sites.value.map((s) => (s.id === updated.id ? updated : s));
    selected.value = updated;
    editing.value = false;
    notice.value = "Site settings saved.";
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(snippet.value);
    notice.value = "Embed code copied.";
  } catch {
    notice.value = "Select and copy the embed code below.";
  }
}
function lock() {
  key.value = "";
  connected.value = false;
  sites.value = [];
  selected.value = null;
}
</script>
<template>
  <div class="shell">
    <header>
      <a class="brand" href="#/">FlakFlak<span class="brand-dot"></span></a
      ><span class="workspace">Standalone workspace</span
      ><button v-if="connected" class="quiet" @click="lock">
        Lock dashboard
      </button>
    </header>
    <main>
      <div class="eyebrow">YOUR FEEDBACK, IN ONE PLACE</div>
      <h1>Sites<span>.</span></h1>
      <p class="intro">
        Bring feedback to any website. Add a site, install one script, and start
        a conversation.
      </p>
      <p v-if="error" role="alert" class="error">{{ error }}</p>
      <p v-if="notice" role="status" class="notice">{{ notice }}</p>
      <section v-if="!connected" class="card access">
        <div>
          <h2>Open your workspace</h2>
          <p>
            Enter the private owner key from the API environment file. Reviewers
            only need their name.
          </p>
        </div>
        <form @submit.prevent="connect">
          <label for="owner">Owner key</label
          ><input
            id="owner"
            type="password"
            v-model="key"
            required
            autocomplete="off"
            placeholder="Private owner key"
          /><button :disabled="busy">
            {{ busy ? "Connecting…" : "Open dashboard →" }}
          </button>
        </form>
        <small
          >The key stays in this tab’s memory. Never put it in embed
          code.</small
        >
      </section>
      <div v-else class="columns">
        <section class="card">
          <div class="section-heading">
            <h2>Your sites</h2>
            <span class="pill">{{ sites.length }}</span>
          </div>
          <p v-if="!sites.length" class="empty">
            Your first site starts here. Create one alongside.
          </p>
          <button
            class="site-row"
            v-for="site in sites"
            :key="site.id"
            :class="{ selected: selected?.id === site.id }"
            @click="selected = site"
          >
            <span class="site-icon">{{
              site.name.slice(0, 1).toUpperCase()
            }}</span
            ><span
              ><strong>{{ site.name }}</strong
              ><small>{{ site.origins.join(", ") }}</small></span
            ><span class="arrow">↗</span>
          </button>
        </section>
        <section class="card">
          <h2>Add a site</h2>
          <form @submit.prevent="create">
            <label for="name">Site name</label
            ><input
              id="name"
              v-model="name"
              maxlength="100"
              placeholder="My client website"
              required
            /><label for="origins">Allowed website addresses</label
            ><textarea
              id="origins"
              v-model="origins"
              rows="3"
              placeholder="https://mysite.com"
              required
            ></textarea
            ><small
              >One origin per line, including http/https and any port. Add both
              local demo origins to test across sites.</small
            ><button :disabled="busy">
              {{ busy ? "Creating…" : "+ Create site" }}
            </button>
          </form>
        </section>
        <section v-if="selected" class="card installation">
          <div class="section-heading">
            <div>
              <div class="eyebrow">INSTALLATION</div>
              <h2>{{ selected.name }}</h2>
            </div>
            <button @click="copy">Copy embed code</button>
          </div>
          <div class="toolbar">
            <button class="quiet" @click="edit">Edit site settings</button>
          </div>
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
              ></textarea>
            </label>
            <div>
              <button :disabled="busy">Save settings</button>
              <button type="button" class="quiet" @click="editing = false">
                Cancel
              </button>
            </div>
          </form>
          <p>Add this script before your website’s closing body tag.</p>
          <pre tabindex="0">{{ snippet }}</pre>
          <div class="demo-links">
            <a
              :href="'/demo.html?site=' + selected.id"
              target="_blank"
              rel="noopener"
              >Open local demo ↗</a
            ><span>Allow this dashboard’s origin first.</span>
          </div>
          <p class="muted">
            Public site ID: {{ selected.id }} · Keep the owner key private.
          </p>
        </section>
      </div>
    </main>
    <footer>
      FlakFlak · Local-first development. Independent of WordPress.
    </footer>
  </div>
</template>
