const statusLine = document.getElementById("status-line");
const overviewEl = document.getElementById("overview");
const storiesEl = document.getElementById("stories");
const appEl = document.getElementById("app");
const emptyEl = document.getElementById("empty");
const dateSelect = document.getElementById("date-select");
const refreshBtn = document.getElementById("refresh-btn");
const runBtn = document.getElementById("run-btn");

function tokenFromCookie() {
  const m = document.cookie.match(/(?:^|;\s*)daily_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  const token = tokenFromCookie();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

function formatWhen(iso) {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function renderDigest(digest) {
  if (!digest) {
    appEl.hidden = true;
    emptyEl.hidden = false;
    statusLine.textContent = "No digest yet — run one or wait for 09:00.";
    return;
  }

  emptyEl.hidden = true;
  appEl.hidden = false;
  overviewEl.textContent = digest.overview || "No overview.";
  statusLine.textContent = `${digest.dateLocal} · ${digest.status}${
    digest.completedAt ? ` · ${formatWhen(digest.completedAt)}` : ""
  }`;

  storiesEl.innerHTML = "";
  for (const [i, story] of (digest.articles || []).entries()) {
    const li = document.createElement("li");
    li.className = "story";

    if (story.imageUrl) {
      const img = document.createElement("img");
      img.className = "story-image";
      img.src = story.imageUrl;
      img.alt = story.title;
      img.loading = "lazy";
      li.appendChild(img);
    }

    const top = document.createElement("div");
    top.className = "story-top";
    top.innerHTML = `<span>#${story.rank}</span><span>${story.source}</span><span>score ${Math.round(
      story.importanceScore,
    )}</span>`;

    const h3 = document.createElement("h3");
    const a = document.createElement("a");
    a.href = story.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = story.title;
    h3.appendChild(a);

    const summary = document.createElement("p");
    summary.textContent = story.summary || "";

    const reason = document.createElement("p");
    reason.className = "reason";
    reason.textContent = story.importanceReason || "";

    li.append(top, h3, summary, reason);
    storiesEl.appendChild(li);
  }
}

async function loadDates(selected) {
  try {
    const { dates } = await api("/api/digests");
    dateSelect.innerHTML = "";
    const opts = dates?.length ? dates : selected ? [selected] : [];
    if (!opts.length) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = "No archives";
      dateSelect.appendChild(o);
      return;
    }
    for (const d of opts) {
      const o = document.createElement("option");
      o.value = d;
      o.textContent = d;
      if (d === selected) o.selected = true;
      dateSelect.appendChild(o);
    }
  } catch {
    // ignore archive failures for first paint
  }
}

async function loadLatest() {
  statusLine.textContent = "Loading digest…";
  const { digest } = await api("/api/digest/latest");
  renderDigest(digest);
  await loadDates(digest?.dateLocal);
}

async function loadDate(date) {
  if (!date) return;
  statusLine.textContent = `Loading ${date}…`;
  const { digest } = await api(`/api/digest?date=${encodeURIComponent(date)}`);
  renderDigest(digest);
}

async function runNow() {
  runBtn.disabled = true;
  refreshBtn.disabled = true;
  statusLine.textContent = "Running digest pipeline… this can take a minute.";
  try {
    const result = await api("/api/run", { method: "POST" });
    if (result.status === "ready") {
      await loadLatest();
      statusLine.textContent = `Ready · ${result.articleCount} stories for ${result.dateLocal}`;
    } else {
      statusLine.textContent = `Run failed: ${result.error || "unknown error"}`;
    }
  } catch (err) {
    statusLine.textContent = err.message || "Run failed";
  } finally {
    runBtn.disabled = false;
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener("click", () => {
  document.getElementById("app")?.scrollIntoView({ behavior: "smooth" });
  loadLatest().catch((err) => {
    statusLine.textContent = err.message;
  });
});

runBtn.addEventListener("click", () => {
  runNow();
});

dateSelect.addEventListener("change", () => {
  loadDate(dateSelect.value).catch((err) => {
    statusLine.textContent = err.message;
  });
});

loadLatest().catch((err) => {
  statusLine.textContent = err.message || "Could not load digest";
  emptyEl.hidden = false;
});
