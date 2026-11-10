import { useEffect, useState } from "react";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  ArrowUpRight,
  Check,
  ChevronRight,
  Coffee,
  FileText,
  Gamepad2,
  ImagePlus,
  LayoutDashboard,
  BarChart3,
  Leaf,
  LoaderCircle,
  LogOut,
  MessageSquare,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
  Star,
} from "lucide-react";
import { api, dateLabel, safeLink } from "./api";
import Insights from "./Insights";

function Field({ label, value, onChange, area = false, hint, ...props }) {
  const Tag = area ? "textarea" : "input";
  return (
    <label className="studio-field">
      {label}
      <Tag
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
        {...(area ? { rows: 4 } : {})}
        {...props}
      />
      {hint && <small>{hint}</small>}
    </label>
  );
}
function Toggle({ label, checked, onChange, description }) {
  return (
    <label className="toggle-field">
      <input
        type="checkbox"
        checked={!!checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        {description && <small>{description}</small>}
      </span>
    </label>
  );
}
function UploadField({ kind, onUploaded, label = "Upload file" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 250 * 1024 * 1024) {
      setError("Please choose a file smaller than 250 MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await api(`/admin/uploads?kind=${kind}`, {
        method: "POST",
        body,
      });
      onUploaded(result.url, file.name);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }
  return (
    <div className="upload-control">
      <label
        className={`button button-light button-small upload-label ${busy ? "disabled" : ""}`}
      >
        {busy ? (
          <LoaderCircle className="spin" size={16} />
        ) : (
          <Upload size={16} />
        )}
        {busy ? "Uploading…" : label}
        <input
          type="file"
          disabled={busy}
          accept={
            kind === "image"
              ? "image/png,image/jpeg,image/webp,image/gif"
              : kind === "build"
                ? ".zip"
                : ".zip,.exe,.apk,.dmg,.pck,.7z,.tar,.gz,.appimage,.msi"
          }
          onChange={upload}
        />
      </label>
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
function SaveButton({ saving, children = "Save changes" }) {
  return (
    <button className="button" disabled={saving} type="submit">
      {saving ? (
        <LoaderCircle className="spin" size={16} />
      ) : (
        <Save size={16} />
      )}
      {saving ? "Saving…" : children}
    </button>
  );
}

function SiteEditor({ site, onSave, saving, spotlight = false, games }) {
  const [draft, setDraft] = useState(site);
  const update = (key, value) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const updateHighlight = (key, value) =>
    setDraft((previous) => ({
      ...previous,
      highlight: { ...previous.highlight, [key]: value },
    }));
  return (
    <form
      className="editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <div className="editor-heading">
        <div>
          <span className="eyebrow">
            {spotlight ? "MAKE AN ENTRANCE" : "YOUR CORNER OF THE INTERNET"}
          </span>
          <h2>
            {spotlight ? "The spotlight is yours." : "Make yourself at home."}
          </h2>
          <p>
            {spotlight
              ? "Feature a game, a video, a post, or anything worth sharing."
              : "Your story, your links, and the people you create with."}
          </p>
        </div>
        <SaveButton saving={saving} />
      </div>
      {spotlight ? (
        <div className="editor-panel">
          <div className="form-grid">
            <label className="studio-field">
              Highlight type
              <select
                value={draft.highlight.type}
                onChange={(event) =>
                  updateHighlight("type", event.target.value)
                }
              >
                <option value="game">Game</option>
                <option value="video">Video</option>
                <option value="post">Post</option>
                <option value="link">Link</option>
              </select>
            </label>
            <Field
              label="Small label"
              value={draft.highlight.eyebrow}
              onChange={(value) => updateHighlight("eyebrow", value)}
              maxLength={80}
            />
          </div>
          <Field
            label="Title"
            value={draft.highlight.title}
            onChange={(value) => updateHighlight("title", value)}
            required
            maxLength={140}
          />
          <Field
            label="Description"
            value={draft.highlight.description}
            onChange={(value) => updateHighlight("description", value)}
            area
            maxLength={1000}
          />
          {draft.highlight.type === "game" ? (
            <label className="studio-field">
              Featured game
              <select
                value={draft.highlight.gameId}
                onChange={(event) =>
                  updateHighlight("gameId", event.target.value)
                }
              >
                <option value="">Choose a game</option>
                {games.map((game) => (
                  <option key={game.id} value={game.id}>
                    {game.title}
                    {!game.visible ? " (hidden)" : ""}
                  </option>
                ))}
              </select>
              <small>Choose a public game so visitors can open it.</small>
            </label>
          ) : (
            <Field
              label={
                draft.highlight.type === "video"
                  ? "Video URL"
                  : "Destination URL"
              }
              value={
                draft.highlight.type === "video"
                  ? draft.highlight.videoUrl
                  : draft.highlight.url
              }
              onChange={(value) =>
                updateHighlight(
                  draft.highlight.type === "video" ? "videoUrl" : "url",
                  value,
                )
              }
              type="url"
              placeholder="https://…"
              hint="Videos open at their source, without tracking embeds."
            />
          )}
          <Field
            label="Feature image"
            value={draft.highlight.image}
            onChange={(value) => updateHighlight("image", value)}
          />
          <UploadField
            kind="image"
            label="Upload feature image"
            onUploaded={(url) => updateHighlight("image", url)}
          />
          <img
            className="editor-image-preview"
            src={draft.highlight.image || "/art/greenhouse.svg"}
            alt="Highlight preview"
          />
        </div>
      ) : (
        <>
          <section className="editor-panel">
            <h3>
              <Leaf size={19} /> First impressions
            </h3>
            <div className="form-grid">
              <Field
                label="Site name"
                value={draft.name}
                onChange={(value) => update("name", value)}
                required
              />
              <Field
                label="Tagline"
                value={draft.tagline}
                onChange={(value) => update("tagline", value)}
              />
            </div>
            <Field
              label="Hero headline"
              value={draft.heroTitle}
              onChange={(value) => update("heroTitle", value)}
              area
              rows={2}
              required
              hint="Use a new line before the italic part of your headline."
            />
            <Field
              label="Introduction"
              value={draft.heroDescription}
              onChange={(value) => update("heroDescription", value)}
              area
              required
            />
            <Field
              label="About you"
              value={draft.about}
              onChange={(value) => update("about", value)}
              area
              rows={5}
              required
            />
            <Toggle
              label="Open to conversations"
              checked={draft.available}
              onChange={(value) => update("available", value)}
              description="Show your availability in the contact section."
            />
          </section>
          <section className="editor-panel">
            <h3>
              <ArrowUpRight size={19} /> Make it easy to find you
            </h3>
            <Field
              label="Contact email"
              value={draft.email}
              onChange={(value) => update("email", value)}
              type="email"
              placeholder="Your public contact email"
              hint="This is public. The contact button opens a visitor’s email app."
            />
            <div className="form-grid">
              {Object.keys(draft.socials).map((key) => (
                <Field
                  key={key}
                  label={
                    key === "itch"
                      ? "itch.io"
                      : key.charAt(0).toUpperCase() + key.slice(1)
                  }
                  value={draft.socials[key]}
                  onChange={(value) =>
                    update("socials", { ...draft.socials, [key]: value })
                  }
                  type="url"
                  placeholder="https://…"
                />
              ))}
            </div>
            <p className="form-note">
              Leave links blank until you’re ready. They’ll show as coming soon,
              not broken links.
            </p>
          </section>
          <section className="editor-panel">
            <h3>
              <Coffee size={19} /> Your community
            </h3>
            <Field
              label="Community name"
              value={draft.community.name}
              onChange={(value) =>
                update("community", { ...draft.community, name: value })
              }
              required
            />
            <Field
              label="Description"
              value={draft.community.description}
              onChange={(value) =>
                update("community", { ...draft.community, description: value })
              }
              area
            />
            <Field
              label="Community URL"
              value={draft.community.url}
              onChange={(value) =>
                update("community", { ...draft.community, url: value })
              }
              type="url"
              placeholder="https://…"
            />
          </section>
        </>
      )}
      <div className="editor-save-bottom">
        <SaveButton saving={saving} />
        <span>Changes appear publicly after saving.</span>
      </div>
    </form>
  );
}

const newVersion = () => ({
  id: crypto.randomUUID(),
  label: "v0.1.0",
  date: new Date().toISOString().slice(0, 10),
  notes: "",
  webUrl: "",
  visible: true,
  downloads: [],
});
function GameEditor({ game, onSave, saving, onBack }) {
  const [draft, setDraft] = useState(game);
  const [tagsText, setTagsText] = useState(game.tags.join(", "));
  const [controlsText, setControlsText] = useState(
    game.controls.map((item) => `${item.key}: ${item.action}`).join("\n"),
  );
  const [dirty, setDirty] = useState(false);
  const update = (key, value) => {
    setDraft((previous) => ({ ...previous, [key]: value }));
    setDirty(true);
  };
  useEffect(() => {
    const guard = (event) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [dirty]);
  const updateVersion = (id, changes) => {
    setDraft((previous) => ({
      ...previous,
      versions: previous.versions.map((version) =>
        version.id === id
          ? {
              ...version,
              ...(typeof changes === "function" ? changes(version) : changes),
            }
          : version,
      ),
    }));
    setDirty(true);
  };
  function moveVersion(index, direction) {
    const versions = [...draft.versions];
    [versions[index], versions[index + direction]] = [
      versions[index + direction],
      versions[index],
    ];
    update("versions", versions);
  }
  function back() {
    if (!dirty || window.confirm("Leave without saving your changes?"))
      onBack();
  }
  return (
    <form
      className="editor-form"
      onChange={() => setDirty(true)}
      onSubmit={async (event) => {
        event.preventDefault();
        const saved = await onSave({
          ...draft,
          tags: tagsText
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
          controls: controlsText
            .split("\n")
            .filter((value) => value.trim())
            .map((value) => {
              const index = value.indexOf(":");
              return {
                key: index < 0 ? value.trim() : value.slice(0, index).trim(),
                action: index < 0 ? "" : value.slice(index + 1).trim(),
              };
            }),
        });
        if (saved) setDirty(false);
      }}
    >
      <button className="back-link" type="button" onClick={back}>
        <ArrowLeft size={15} />
        All games
      </button>
      <div className="editor-heading">
        <div>
          <span className="eyebrow">BUILD YOUR LITTLE WORLD</span>
          <h2>{draft.title || "A new adventure."}</h2>
        </div>
        <SaveButton saving={saving} />
      </div>
      <section className="editor-panel">
        <h3>Game details</h3>
        <Field
          label="Game title"
          value={draft.title}
          onChange={(value) => update("title", value)}
          required
          maxLength={120}
        />
        <Field
          label="Executive summary"
          value={draft.summary}
          onChange={(value) => update("summary", value)}
          area
          rows={2}
          required
          maxLength={500}
          hint="The short pitch that appears on the game card."
        />
        <Field
          label="Full description"
          value={draft.description}
          onChange={(value) => update("description", value)}
          area
          rows={7}
          required
        />
        <div className="form-grid">
          <Field
            label="Genre"
            value={draft.genre}
            onChange={(value) => update("genre", value)}
            required
          />
          <Field
            label="Year"
            value={draft.year}
            onChange={(value) => update("year", value)}
            maxLength={4}
          />
          <label className="studio-field">
            Status
            <select
              value={draft.status}
              onChange={(event) => update("status", event.target.value)}
            >
              <option>In development</option>
              <option>Released</option>
              <option>On hold</option>
              <option>Prototype</option>
              <option>Sample concept</option>
            </select>
          </label>
          <Field
            label="Tags"
            value={tagsText}
            onChange={setTagsText}
            placeholder="Cozy, Exploration, Single-player"
            hint="Separate tags with commas."
          />
        </div>
        <Field
          label="Cover image"
          value={draft.cover}
          onChange={(value) => update("cover", value)}
        />
        <UploadField
          kind="image"
          label="Upload game artwork"
          onUploaded={(url) => update("cover", url)}
        />
        <img
          className="editor-image-preview"
          src={draft.cover || "/art/greenhouse.svg"}
          alt="Cover preview"
        />
        <div className="toggle-row">
          <Toggle
            label="Publicly visible"
            checked={draft.visible}
            onChange={(value) => update("visible", value)}
          />
          <Toggle
            label="Sample concept"
            checked={draft.sample}
            onChange={(value) => update("sample", value)}
            description="Turn this off when you add your real game."
          />
        </div>
      </section>
      <section className="editor-panel">
        <h3>
          <Gamepad2 size={19} /> Controls
        </h3>
        <Field
          label="One control per line"
          value={controlsText}
          onChange={setControlsText}
          area
          placeholder={"WASD: Move\nSpace: Jump\nE: Interact"}
          hint="Format: key or button, a colon, then the action."
        />
      </section>
      <section className="editor-panel">
        <div className="panel-title-row">
          <h3>Builds & version history</h3>
          <button
            className="button button-small button-light"
            type="button"
            onClick={() =>
              update("versions", [newVersion(), ...draft.versions])
            }
          >
            <Plus size={16} />
            Add version
          </button>
        </div>
        <div className="info-box">
          <ShieldCheck size={21} />
          <div>
            <strong>From Godot to the browser</strong>
            <p>
              Export your game for Web in Godot, ZIP the entire export folder
              with index.html, then upload it below. Keep the .wasm, .pck, and
              .js files together. Single-threaded exports work on the widest
              range of devices. Only upload builds you trust.
            </p>
            <p>
              Put the newest release first. Hiding a version removes it from the
              page, but existing file links still work. Files are stored on this
              server; back up the data folder before moving hosts.
            </p>
          </div>
        </div>
        {!draft.versions.length && (
          <p className="empty-inline">
            No versions yet. Add your first release when you’re ready.
          </p>
        )}
        {draft.versions.map((version, index) => (
          <div className="version-editor" key={version.id}>
            <div className="panel-title-row">
              <span className="eyebrow">
                {index === 0 ? "LATEST VERSION" : `OLDER VERSION ${index}`}
              </span>
              <div className="version-order">
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Move ${version.label} earlier`}
                  disabled={index === 0}
                  onClick={() => moveVersion(index, -1)}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  className="icon-button"
                  type="button"
                  aria-label={`Move ${version.label} later`}
                  disabled={index === draft.versions.length - 1}
                  onClick={() => moveVersion(index, 1)}
                >
                  <ArrowDown size={16} />
                </button>
              </div>
              <button
                type="button"
                className="icon-button danger"
                aria-label={`Remove version ${version.label}`}
                onClick={() => {
                  if (
                    window.confirm(
                      "Remove this version from the page? Save to apply. Uploaded files will not be deleted.",
                    )
                  )
                    update(
                      "versions",
                      draft.versions.filter((item) => item.id !== version.id),
                    );
                }}
              >
                <Trash2 size={17} />
              </button>
            </div>
            <div className="form-grid">
              <Field
                label="Version name"
                value={version.label}
                onChange={(value) =>
                  updateVersion(version.id, { label: value })
                }
                required
                placeholder="v1.0.0"
              />
              <Field
                label="Release date"
                value={version.date}
                onChange={(value) => updateVersion(version.id, { date: value })}
                type="date"
                required
              />
            </div>
            <Field
              label="Release notes"
              value={version.notes}
              onChange={(value) => updateVersion(version.id, { notes: value })}
              area
              rows={3}
            />
            <Toggle
              label="Show this version publicly"
              checked={version.visible !== false}
              onChange={(value) =>
                updateVersion(version.id, { visible: value })
              }
            />
            <Field
              label="Web build URL"
              value={version.webUrl}
              onChange={(value) => updateVersion(version.id, { webUrl: value })}
              placeholder="Upload a ZIP below, or paste an HTTPS embed URL"
            />
            <UploadField
              kind="build"
              label="Upload Godot web export (.zip)"
              onUploaded={(url) => updateVersion(version.id, { webUrl: url })}
            />
            {safeLink(version.webUrl) && (
              <a
                className="text-link build-preview-link"
                href={safeLink(version.webUrl)}
                target="_blank"
                rel="noreferrer"
              >
                Preview web build <ArrowUpRight size={15} />
              </a>
            )}
            <h4>Downloadable copies</h4>
            {version.downloads.map((file) => (
              <div className="download-editor" key={file.id}>
                <Field
                  label="Download label"
                  value={file.label}
                  onChange={(value) =>
                    updateVersion(version.id, {
                      downloads: version.downloads.map((item) =>
                        item.id === file.id ? { ...item, label: value } : item,
                      ),
                    })
                  }
                  required
                />
                <Field
                  label="File URL"
                  value={file.url}
                  onChange={(value) =>
                    updateVersion(version.id, {
                      downloads: version.downloads.map((item) =>
                        item.id === file.id ? { ...item, url: value } : item,
                      ),
                    })
                  }
                  required
                />
                <button
                  type="button"
                  className="icon-button danger"
                  aria-label={`Remove ${file.label}`}
                  onClick={() =>
                    updateVersion(version.id, {
                      downloads: version.downloads.filter(
                        (item) => item.id !== file.id,
                      ),
                    })
                  }
                >
                  <X size={17} />
                </button>
              </div>
            ))}
            <div className="version-actions">
              <UploadField
                kind="download"
                label="Upload downloadable build"
                onUploaded={(url, name) =>
                  updateVersion(version.id, (current) => ({
                    downloads: [
                      ...current.downloads,
                      { id: crypto.randomUUID(), label: name, url },
                    ],
                  }))
                }
              />
              <button
                type="button"
                className="text-link"
                onClick={() =>
                  updateVersion(version.id, {
                    downloads: [
                      ...version.downloads,
                      { id: crypto.randomUUID(), label: "", url: "" },
                    ],
                  })
                }
              >
                <Plus size={15} />
                Add download link
              </button>
            </div>
            <p className="form-note">
              Maximum 250 MB per upload. Uploading stores the file; save this
              page to publish it.
            </p>
          </div>
        ))}
      </section>
      <div className="editor-save-bottom">
        <SaveButton saving={saving} />
        {dirty && <span>Unsaved changes</span>}
      </div>
    </form>
  );
}

function PostEditor({ post, onSave, saving, onBack }) {
  const [draft, setDraft] = useState(post);
  const update = (key, value) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  return (
    <form
      className="editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(draft);
      }}
    >
      <button type="button" className="back-link" onClick={onBack}>
        <ArrowLeft size={15} />
        All notes
      </button>
      <div className="editor-heading">
        <div>
          <span className="eyebrow">NOTES FROM THE WORKBENCH</span>
          <h2>A story worth sharing.</h2>
        </div>
        <SaveButton saving={saving} />
      </div>
      <section className="editor-panel">
        <Field
          label="Title"
          value={draft.title}
          onChange={(value) => update("title", value)}
          required
        />
        <div className="form-grid">
          <Field
            label="Category"
            value={draft.category}
            onChange={(value) => update("category", value)}
            required
          />
          <Field
            label="Date"
            value={draft.date}
            onChange={(value) => update("date", value)}
            type="date"
            required
          />
        </div>
        <Field
          label="Your note"
          value={draft.excerpt}
          onChange={(value) => update("excerpt", value)}
          area
          rows={10}
          required
          hint="Shown as a preview on the home page, and in full when opened."
        />
        <Field
          label="Read more URL (optional)"
          value={draft.url}
          onChange={(value) => update("url", value)}
          type="url"
          placeholder="https://…"
        />
        <Toggle
          label="Publicly visible"
          checked={draft.visible}
          onChange={(value) => update("visible", value)}
        />
      </section>
    </form>
  );
}

function Login({ setup, onLoggedIn }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      await api(setup ? "/auth/setup" : "/auth/login", {
        method: "POST",
        body: setup
          ? { token: form.get("token"), password: form.get("password") }
          : { password: form.get("password") },
      });
      onLoggedIn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <a className="back-link" href="/">
        <ArrowLeft size={16} />
        Back to the site
      </a>
      <form className="login-card" onSubmit={submit}>
        <img src="/favicon.svg" width="48" height="48" alt="" />
        <span className="eyebrow">KHOIFEEDEV / CREATOR STUDIO</span>
        <h1>
          {setup ? "Your next chapter starts here." : "Welcome back, creator."}
        </h1>
        <p>
          {setup
            ? "Set up your private studio to make this space your own."
            : "A little coffee. A fresh idea. Let’s make something good."}
        </p>
        {setup && (
          <label className="studio-field">
            Setup token
            <input name="token" required autoComplete="off" />
            <small>
              Find the one-time token in the terminal running your server. It is
              never shown to visitors.
            </small>
          </label>
        )}
        <label className="studio-field">
          {setup ? "Create a password" : "Password"}
          <input
            type="password"
            name="password"
            autoComplete={setup ? "new-password" : "current-password"}
            required
            minLength={setup ? 12 : 1}
            maxLength={256}
          />
          {setup && (
            <small>Use at least 12 characters. Keep it somewhere safe.</small>
          )}
        </label>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <button className="button wide" disabled={busy}>
          {busy
            ? "Just a moment…"
            : setup
              ? "Create my studio"
              : "Enter the studio"}
          <ArrowUpRight size={17} />
        </button>
        <span className="login-security">
          <ShieldCheck size={14} />
          Private, password-protected, and yours.
        </span>
      </form>
    </main>
  );
}

export default function Studio() {
  const [session, setSession] = useState(null);
  const [content, setContent] = useState(null);
  const [tab, setTab] = useState("Website");
  const [selectedGame, setSelectedGame] = useState(null);
  const [selectedPost, setSelectedPost] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  async function refresh() {
    const auth = await api("/auth/session");
    setSession(auth);
    if (auth.authenticated) {
      const [data, feedback] = await Promise.all([
        api("/admin/content"),
        api("/admin/reviews"),
      ]);
      setContent(data);
      setReviews(feedback);
    }
  }
  useEffect(() => {
    document.title = "Creator studio — KhoifeeDev";
    refresh().catch((err) => setError(err.message));
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  async function save(path, body) {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await api(path, { method: "PUT", body });
      await refresh();
      setNotice("Saved. Your little corner of the internet is up to date.");
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function remove(kind, item) {
    if (
      !window.confirm(
        `Delete “${item.title}”? This permanently removes ${kind === "games" ? "the game and its reviews" : "the note"}. Uploaded files are kept.`,
      )
    )
      return;
    try {
      await api(`/admin/${kind}/${item.id}`, { method: "DELETE" });
      await refresh();
      setNotice("Removed from your site.");
    } catch (err) {
      setError(err.message);
    }
  }
  async function moderate(id, status) {
    if (
      status === "delete" &&
      !window.confirm("Permanently delete this review?")
    )
      return;
    try {
      await api(`/admin/reviews/${id}`, {
        method: status === "delete" ? "DELETE" : "PATCH",
        ...(status === "delete" ? {} : { body: { status } }),
      });
      await refresh();
      setNotice(
        status === "approved"
          ? "Review approved and published."
          : status === "pending"
            ? "Review hidden from the public page."
            : "Review deleted.",
      );
    } catch (err) {
      setError(err.message);
    }
  }
  const tabs = [
    ["Website", LayoutDashboard],
    ["Spotlight", Sparkles],
    ["Games", Gamepad2],
    ["Journal", FileText],
    ["Feedback", MessageSquare],
    ["Insights", BarChart3],
  ];
  if (!session)
    return (
      <main className="loading-state">
        <Leaf size={35} />
        <p>{error || "Opening the studio…"}</p>
        {error && (
          <button className="button" onClick={() => window.location.reload()}>
            Try again
          </button>
        )}
      </main>
    );
  if (!session.authenticated)
    return (
      <Login
        setup={session.setupRequired}
        onLoggedIn={() => refresh().catch((err) => setError(err.message))}
      />
    );
  if (!content)
    return (
      <main className="loading-state">
        <p>{error || "Loading your content…"}</p>
      </main>
    );
  return (
    <div className="studio-layout">
      <aside className="studio-sidebar">
        <a className="brand" href="/">
          <img src="/favicon.svg" alt="" />
          <span>
            Khoifee<span className="brand-light">Dev</span>.
          </span>
        </a>
        <span className="studio-label">CREATOR STUDIO</span>
        <nav aria-label="Studio navigation">
          {tabs.map(([name, Icon]) => (
            <button
              key={name}
              className={tab === name ? "selected" : ""}
              onClick={() => {
                setTab(name);
                setSelectedGame(null);
                setSelectedPost(null);
                setError("");
              }}
            >
              <Icon size={18} />
              {name}
              {name === "Feedback" &&
                reviews.some((review) => review.status === "pending") && (
                  <span className="pending-count">
                    {
                      reviews.filter((review) => review.status === "pending")
                        .length
                    }
                  </span>
                )}
            </button>
          ))}
        </nav>
        <div className="studio-sidebar-bottom">
          <div className="studio-tip">
            <SproutIcon />
            <p>
              Good things grow
              <br />
              one update at a time.
            </p>
          </div>
          <a href="/" target="_blank" rel="noreferrer">
            <ArrowUpRight size={17} />
            View your site
          </a>
          <button
            onClick={async () => {
              try {
                await api("/auth/logout", { method: "POST" });
                setContent(null);
                await refresh();
              } catch (err) {
                setError(err.message);
              }
            }}
          >
            <LogOut size={17} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="studio-main">
        <header className="studio-topbar">
          <span>
            Your studio <ChevronRight size={14} />
            {tab}
          </span>
          <span>
            <span className="live-dot" /> YOUR NEXT IDEA STARTS HERE
          </span>
        </header>
        {notice && (
          <div className="studio-notice" role="status">
            <Check size={18} />
            {notice}
            <button
              className="icon-button"
              onClick={() => setNotice("")}
              aria-label="Dismiss notification"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {error && (
          <div className="error-message studio-error" role="alert">
            {error}
            <button
              className="icon-button"
              onClick={() => setError("")}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="studio-body">
          {tab === "Insights" && <Insights />}
          {(tab === "Website" || tab === "Spotlight") && (
            <SiteEditor
              key={tab}
              site={content.site}
              games={content.games}
              spotlight={tab === "Spotlight"}
              saving={saving}
              onSave={(draft) => save("/admin/site", draft)}
            />
          )}
          {tab === "Games" &&
            (selectedGame ? (
              <GameEditor
                key={selectedGame.id}
                game={selectedGame}
                onBack={() => setSelectedGame(null)}
                saving={saving}
                onSave={(draft) => save(`/admin/games/${draft.id}`, draft)}
              />
            ) : (
              <>
                <div className="editor-heading">
                  <div>
                    <span className="eyebrow">YOUR IDEAS, MADE PLAYABLE</span>
                    <h2>Little worlds. All yours.</h2>
                    <p>
                      Manage game pages, releases, web builds, and downloads.
                    </p>
                  </div>
                  <button
                    className="button"
                    onClick={() =>
                      setSelectedGame({
                        id: `game-${crypto.randomUUID().slice(0, 8)}`,
                        title: "",
                        summary: "",
                        description: "",
                        genre: "Adventure",
                        year: String(new Date().getFullYear()),
                        tags: [],
                        status: "In development",
                        featured: false,
                        visible: false,
                        sample: false,
                        cover: "/art/greenhouse.svg",
                        controls: [],
                        versions: [],
                      })
                    }
                  >
                    <Plus size={17} />
                    New game
                  </button>
                </div>
                <div className="admin-game-list">
                  {content.games.map((game) => (
                    <article key={game.id} className="admin-game-card">
                      <img src={game.cover} alt="" />
                      <div>
                        <h3>{game.title}</h3>
                        <span>
                          {game.status} · {game.versions.length} versions
                        </span>
                        <div className="tags">
                          <span>{game.visible ? "Public" : "Hidden"}</span>
                          {game.sample && <span>Sample concept</span>}
                        </div>
                      </div>
                      <button
                        className="button button-light button-small"
                        onClick={() => setSelectedGame(game)}
                      >
                        Edit game <ArrowUpRight size={15} />
                      </button>
                      <button
                        className="icon-button danger"
                        aria-label={`Delete ${game.title}`}
                        onClick={() => remove("games", game)}
                      >
                        <Trash2 size={17} />
                      </button>
                    </article>
                  ))}
                </div>
              </>
            ))}
          {tab === "Journal" &&
            (selectedPost ? (
              <PostEditor
                key={selectedPost.id}
                post={selectedPost}
                onBack={() => setSelectedPost(null)}
                saving={saving}
                onSave={(draft) => save(`/admin/posts/${draft.id}`, draft)}
              />
            ) : (
              <>
                <div className="editor-heading">
                  <div>
                    <span className="eyebrow">SHOW THE PROCESS</span>
                    <h2>From your workbench.</h2>
                    <p>
                      Publish standalone posts, announcements, community news,
                      or your latest video. No game required.
                    </p>
                  </div>
                  <button
                    className="button"
                    onClick={() =>
                      setSelectedPost({
                        id: crypto.randomUUID(),
                        title: "",
                        excerpt: "",
                        date: new Date().toISOString().slice(0, 10),
                        category: "Dev diary",
                        url: "",
                        visible: false,
                      })
                    }
                  >
                    <Plus size={17} />
                    New note
                  </button>
                </div>
                {content.posts.map((post) => (
                  <article key={post.id} className="admin-post-card">
                    <FileText size={22} />
                    <div>
                      <span className="eyebrow">
                        {post.category} · {post.visible ? "PUBLIC" : "DRAFT"}
                      </span>
                      <h3>{post.title}</h3>
                      <small>{dateLabel(post.date)}</small>
                    </div>
                    <button
                      className="button button-small button-light"
                      onClick={() => setSelectedPost(post)}
                    >
                      Edit <ArrowUpRight size={15} />
                    </button>
                    <button
                      className="icon-button danger"
                      aria-label={`Delete ${post.title}`}
                      onClick={() => remove("posts", post)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </article>
                ))}
              </>
            ))}
          {tab === "Feedback" && (
            <>
              <div className="editor-heading">
                <div>
                  <span className="eyebrow">KEEP YOUR CORNER KIND</span>
                  <h2>A little player perspective.</h2>
                  <p>
                    Approve comments to publish them. Only approved ratings
                    count toward game scores.
                  </p>
                </div>
                <span className="badge">
                  {
                    reviews.filter((review) => review.status === "pending")
                      .length
                  }{" "}
                  PENDING
                </span>
              </div>
              {!reviews.length && (
                <div className="empty-state">
                  <MessageSquare size={35} />
                  <h3>The conversation starts here.</h3>
                  <p>Player reviews will appear here for your approval.</p>
                </div>
              )}
              {reviews.map((review) => (
                <article className="moderation-card" key={review.id}>
                  <div className="panel-title-row">
                    <div>
                      <strong>{review.name}</strong>
                      <span
                        className={`badge ${review.status === "pending" ? "badge-pending" : ""}`}
                      >
                        {review.status}
                      </span>
                    </div>
                    <span className="rating-small">
                      <Star size={14} fill="currentColor" />
                      {review.rating} / 5
                    </span>
                  </div>
                  <span className="muted">
                    {review.gameTitle} · {dateLabel(review.date)}
                  </span>
                  <p className="preserve-lines">{review.body}</p>
                  <div className="version-actions">
                    <button
                      className="button button-small button-light"
                      onClick={() =>
                        moderate(
                          review.id,
                          review.status === "pending" ? "approved" : "pending",
                        )
                      }
                    >
                      {review.status === "pending" ? (
                        <>
                          <Check size={16} />
                          Approve & publish
                        </>
                      ) : (
                        "Hide review"
                      )}
                    </button>
                    <button
                      className="text-link danger"
                      onClick={() => moderate(review.id, "delete")}
                    >
                      <Trash2 size={15} />
                      Delete
                    </button>
                  </div>
                </article>
              ))}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
function SproutIcon() {
  return <Leaf size={29} strokeWidth={1.4} />;
}
