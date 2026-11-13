import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  Play,
  Gamepad2,
  Sprout,
  Menu,
  X,
  Heart,
  ExternalLink,
  Download,
  Star,
  Mail,
  ChevronDown,
  Monitor,
  Users,
  Coffee,
  Youtube,
  Instagram,
  Facebook,
  Check,
  MessageCircle,
  Maximize,
  Leaf,
  Sparkles,
} from "lucide-react";
import { api, safeLink, dateLabel, trackEvent } from "./api";
import Studio from "./Studio";

export function Brand({ name = "KhoifeeDev" }) {
  return (
    <a className="brand" href="/" aria-label={`${name} home`}>
      <img src="/assets/KhoifeeLogo.jpg" alt="" />
      <span>
        {name === "KhoifeeDev" ? (
          <>
            Khoifee<span className="brand-light">Dev</span>
          </>
        ) : (
          name
        )}
        <span className="brand-dot">.</span>
      </span>
    </a>
  );
}

function Header({ site }) {
  const copy = site.copy;
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="container nav-inner">
        <Brand name={site.name} />
        <nav
          className={open ? "main-nav is-open" : "main-nav"}
          aria-label="Main navigation"
        >
          <a
            className={
              window.location.pathname === "/" && !window.location.hash
                ? "active"
                : ""
            }
            href="/"
            onClick={() => setOpen(false)}
          >
            {copy.navHome}
          </a>
          <a href="/#games" onClick={() => setOpen(false)}>
            {copy.navGames}
          </a>
          <a href="/#about" onClick={() => setOpen(false)}>
            {copy.navAbout}
          </a>
          <a href="/#community" onClick={() => setOpen(false)}>
            {copy.navCommunity}
          </a>
        </nav>
        <a className="button button-small nav-contact" href="/#contact">
          {copy.navContact} <ArrowUpRight size={16} />
        </a>
        <button
          className="icon-button menu-toggle"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
        >
          {open ? <X /> : <Menu />}
        </button>
      </div>
    </header>
  );
}

const socialIcons = {
  itch: Gamepad2,
  youtube: Youtube,
  instagram: Instagram,
  facebook: Facebook,
};
const socialNames = {
  itch: "itch.io",
  youtube: "YouTube",
  instagram: "Instagram",
  facebook: "Facebook",
};

function Socials({ socials, full = false }) {
  return (
    <div className={`socials ${full ? "socials-full" : ""}`}>
      {Object.entries(socialIcons).map(([key, Icon]) =>
        safeLink(socials?.[key]) ? (
          <a
            key={key}
            href={safeLink(socials[key])}
            target="_blank"
            rel="noreferrer"
            aria-label={socialNames[key]}
          >
            <Icon size={18} />
            {full && <span>{socialNames[key]}</span>}
            <span className="sr-only"> (opens in new tab)</span>
          </a>
        ) : (
          <span
            key={key}
            className="social-unavailable"
            title={`${socialNames[key]} link coming soon`}
          >
            <Icon size={18} />
            {full && <span>{socialNames[key]}</span>}
            <span className="sr-only">
              {!full && socialNames[key]} link coming soon
            </span>
          </span>
        ),
      )}
    </div>
  );
}

function Footer({ site }) {
  const copy = site.copy;
  return (
    <footer className="site-footer container">
      <div className="footer-top">
        <Brand name={site.name} />
        <span>{site.tagline}</span>
        <Socials socials={site.socials} />
      </div>
      <div className="footer-bottom">
        <span>
          © {new Date().getFullYear()} {site.name}. {copy.footerCopyright}
        </span>
        <a href="#top">{copy.footerBackToTop} ↑</a>
      </div>
      <details className="privacy-details">
        <summary>{copy.privacyTitle}</summary>
        <p>{copy.privacyDescription}</p>
      </details>
    </footer>
  );
}

function Image({ src, alt, ...props }) {
  return (
    <img
      src={safeLink(src) || "/art/greenhouse.svg"}
      alt={alt}
      {...props}
      onError={(event) => {
        event.currentTarget.onerror = null;
        event.currentTarget.src = "/art/greenhouse.svg";
      }}
    />
  );
}

function imagePositionStyle(position) {
  return {
    objectPosition: `${position?.x ?? 50}% ${position?.y ?? 50}%`,
  };
}

function Highlight({ highlight, games, copy }) {
  const game = games.find((item) => item.id === highlight.gameId);
  const href =
    highlight.type === "game" && game
      ? `/games/${game.id}`
      : safeLink(
          highlight.type === "video" ? highlight.videoUrl : highlight.url,
        );
  return (
    <div className="hero-art">
      <div className="art-frame">
        <Image
          src={highlight.image}
          alt={game ? `${game.title} concept illustration` : highlight.title}
          style={imagePositionStyle(highlight.imagePosition)}
        />
        <span className="art-caption">
          <span className="live-dot" />
          {game?.sample
            ? copy.highlightSampleCaption
            : highlight.eyebrow || copy.highlightDefaultCaption}
        </span>
      </div>
      <div className="round-stamp">
        <Sprout size={28} strokeWidth={1.6} />
        <span>
          {copy.highlightRoundStampFirst}
          <br />
          {copy.highlightRoundStampSecond}
        </span>
      </div>
      <div className="highlight-card">
        <div className="highlight-icon">
          {highlight.type === "video" ? (
            <Play size={22} />
          ) : (
            <Gamepad2 size={23} />
          )}
        </div>
        <div className="highlight-text">
          <span className="eyebrow">{highlight.eyebrow}</span>
          <h2>{highlight.title}</h2>
          <p>{highlight.description}</p>
        </div>
        {href && (
          <a
            href={href}
            className="icon-button highlight-link"
            aria-label={`${copy.highlightExplore} ${highlight.title}`}
            title={`${copy.highlightExplore} ${highlight.title}`}
            {...(href.startsWith("https:")
              ? { target: "_blank", rel: "noreferrer" }
              : {})}
          >
            <span>{copy.highlightExplore}</span>
            <ArrowUpRight size={22} />
          </a>
        )}
      </div>
    </div>
  );
}

function GameCard({ game, copy }) {
  const playable = game.versions.some((version) => version.webUrl);
  return (
    <a className="game-card" href={`/games/${game.id}`}>
      <div className="game-card-art">
        <Image
          src={game.cover}
          alt={`${game.title} artwork`}
          loading="lazy"
          style={imagePositionStyle(game.coverPosition)}
        />
        <span
          className={`game-status ${game.status === "Released" ? "released" : ""}`}
        >
          <span />
          {game.status}
        </span>
        {playable && (
          <span className="quick-play">
            <Play size={16} fill="currentColor" /> {copy.cardPlay}
          </span>
        )}
        <span className="card-arrow">
          <ArrowUpRight size={20} />
        </span>
      </div>
      <div className="game-card-content">
        <div className="game-meta">
          <span>{game.genre}</span>
          <span>          {game.sample ? copy.cardSample : game.year}</span>
        </div>
        <h3>{game.title}</h3>
        <p>{game.summary}</p>
        {(game.tags.length > 0 || game.count > 0) && (
          <div className="game-card-bottom">
            <div className="tags">
              {game.tags.slice(0, 2).map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
            {game.count > 0 && (
              <span className="rating-small">
                <Star size={13} fill="currentColor" />
                {Number(game.rating).toFixed(1)} <small>({game.count})</small>
              </span>
            )}
          </div>
        )}
        <div className="game-card-action">
          <span>
            {playable ? copy.cardPlayAction : copy.cardViewAction}
          </span>
          <ArrowUpRight size={15} />
        </div>
      </div>
    </a>
  );
}

function Home({ content }) {
  const { site, games, posts } = content;
  const copy = site.copy;
  const [filter, setFilter] = useState("all");
  const [post, setPost] = useState(null);
  const postTrigger = useRef(null);
  const filtered = games.filter(
    (game) =>
      filter === "all" ||
      (filter === "play"
        ? game.versions.some((version) => version.webUrl)
        : game.status === (filter === "development" ? "In development" : "Released")),
  );
  const filters = [
    ["all", copy.filterAll],
    ["play", copy.filterPlay],
    ["development", copy.filterDevelopment],
    ["released", copy.filterReleased],
  ];
  const emptyFilterName =
    filter === "all"
      ? copy.gamesNoun
      : `${filters.find(([value]) => value === filter)[1].toLowerCase()} ${copy.gamesNoun}`;
  const title = site.heroTitle.split("\n");
  useEffect(() => {
    trackEvent("site_view", "home");
  }, []);
  useEffect(() => {
    if (!post) return;
    trackEvent("post_view", post.id);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const keydown = (event) => {
      if (event.key === "Escape") setPost(null);
      if (event.key === "Tab") {
        const focusable = document
          .querySelector(".journal-modal")
          .querySelectorAll("a[href],button");
        const first = focusable[0],
          last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.body.style.overflow = previousOverflow;
      postTrigger.current?.focus();
    };
  }, [post]);
  return (
    <>
      <Header site={site} />
      <main>
        <section className="hero container">
          <div className="hero-copy">
            <div className="hero-eyebrow">
              <span className="live-dot" /> {copy.heroEyebrow}
            </div>
            <h1>
              {title[0]}
              <br />
              <em>{title.slice(1).join(" ") || "Made with heart."}</em>
            </h1>
            <p className="hero-description">{site.heroDescription}</p>
            <div className="hero-actions">
              <a className="button" href="#games">
                {copy.heroPrimary} <ArrowUpRight size={18} />
              </a>
              <a className="text-link" href="#about">
                {copy.heroSecondary} <ArrowRight size={17} />
              </a>
            </div>
            <div className="hero-footnote">
              <div className="little-avatars">
                <span>
                  <Coffee size={16} />
                </span>
                <span>
                  <Gamepad2 size={16} />
                </span>
                <span>
                  <Heart size={16} />
                </span>
              </div>
              <p>
                {copy.heroNoteFirst}
                <br />
                <strong>{copy.heroNoteSecond}</strong>
              </p>
            </div>
          </div>
          <Highlight
            highlight={site.highlight}
            games={games}
            copy={copy}
          />
        </section>
        <div className="values-strip">
          <div className="container">
            <span>
              <Gamepad2 size={18} /> {copy.valueOne}
            </span>
            <i />
            <span>
              <Sprout size={18} /> {copy.valueTwo}
            </span>
            <i />
            <span>
              <Users size={18} /> {copy.valueThree}
            </span>
            <i />
            <span>
              <Coffee size={18} /> {copy.valueFour}
            </span>
          </div>
        </div>
        <section className="section container games-section" id="games">
          <div className="section-top">
            <div>
              <span className="eyebrow">
                <span className="section-number">01 /</span> {copy.gamesEyebrow}
              </span>
              <h2>
                {copy.gamesTitle}<span className="green-dot">.</span>
              </h2>
            </div>
            <span className="section-note">
              {copy.gamesNoteFirst}
              <br />
              {copy.gamesNoteSecond}
            </span>
          </div>
          <div className="filter-row">
            <div className="filters" aria-label={copy.filterLabel}>
              {filters.map(([value, label]) => (
                <button
                  key={value}
                  className={filter === value ? "selected" : ""}
                  onClick={() => setFilter(value)}
                >
                  {value === "play" && <Play size={13} />}
                  {label}
                  {value === "all" && (
                    <span>{games.length.toString().padStart(2, "0")}</span>
                  )}
                </button>
              ))}
            </div>
            <span className="filter-caption">
              <Monitor size={14} /> {copy.filterCaption}
            </span>
          </div>
          <div className="game-grid">
            {filtered.map((game) => (
              <GameCard key={game.id} game={game} copy={copy} />
            ))}
          </div>
          {!filtered.length && (
            <div className="empty-state">
              <Sprout size={30} />
              <h3>{copy.gamesEmptyTitle}</h3>
              <p>
                {copy.gamesEmptyPrefix} {emptyFilterName}{" "}
                {copy.gamesEmptyDescription}
              </p>
              <button
                className="button button-light"
                onClick={() => setFilter("all")}
              >
                {copy.gamesEmptyButton} <ArrowRight size={16} />
              </button>
            </div>
          )}
          <div className="games-note">
            <span>
              <Heart size={15} /> {copy.gamesNotePrimary}
            </span>
            <span>{copy.gamesNoteSecondary}</span>
          </div>
        </section>
        <section className="about-section" id="about">
          <div className="container about-grid">
            <div className="about-art" aria-hidden="true">
              <div className="desk-circle">
                <div className="pixel-window">
                  <div className="window-dots">
                    <i />
                    <i />
                    <i />
                  </div>
                  <div className="window-content">
                    <span className="pixel-sprout">
                      <Sprout size={78} strokeWidth={1.2} />
                    </span>
                    <span>
                      {copy.aboutArtGreeting}<span className="blink">_</span>
                    </span>
                  </div>
                </div>
                <div className="coffee-sticker">
                  <Coffee size={37} strokeWidth={1.4} />
                  <span>{copy.aboutArtSticker}</span>
                </div>
                <span className="sparkle-one">✳</span>
                <span className="sparkle-two">+</span>
              </div>
              <span className="art-handwritten">
                {copy.aboutArtCaption} ↗
              </span>
            </div>
            <div className="about-copy">
              <span className="eyebrow">
                <span className="section-number">02 /</span> {copy.aboutEyebrow}
              </span>
              <h2>
                {copy.aboutTitle}
                <br />
                {copy.aboutSubtitle}
              </h2>
              <p className="preserve-lines">{site.about}</p>
              <div className="about-pills">
                <span>
                  <Gamepad2 size={15} /> {copy.aboutPillOne}
                </span>
                <span>
                  <Sparkles size={15} /> {copy.aboutPillTwo}
                </span>
                <span>
                  <Users size={15} /> {copy.aboutPillThree}
                </span>
              </div>
              <a className="text-link" href="#contact">
                {copy.aboutButton} <ArrowUpRight size={18} />
              </a>
            </div>
          </div>
        </section>
        <section className="section container community-section" id="community">
          <div className="community-panel">
            <div className="community-symbol">
              <img src="/assets/GawainGameDevLogo.jpg" alt="Gawain Game Dev Guild" />
              <i />
              <i />
            </div>
            <div className="community-copy">
              <span className="eyebrow">{copy.communityEyebrow}</span>
              <h2>
                {copy.communityTitleFirst}
                <br />
                {copy.communityTitleSecond}
              </h2>
              <p>
                {copy.communityIntro} <strong>{site.community.name}</strong>.
              </p>
              <p>{site.community.description}</p>
              {safeLink(site.community.url) ? (
                <a
                  className="button button-dark"
                  href={safeLink(site.community.url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {copy.communityButton} <ArrowUpRight size={16} />
                </a>
              ) : (
                <span className="community-coming">
                  <Users size={16} /> {copy.communityPending}
                </span>
              )}
            </div>
            <span className="community-side">{copy.communityTagline}</span>
          </div>
        </section>
        <section className="journal-section container" id="journal">
          <div className="section-top">
            <div>
              <span className="eyebrow">
                <span className="section-number">03 /</span> {copy.journalEyebrow}
              </span>
              <h2>
                {copy.journalTitle}<span className="green-dot">.</span>
              </h2>
            </div>
            <span className="section-note">
              {copy.journalNoteFirst}
              <br />
              {copy.journalNoteSecond}
            </span>
          </div>
          <div className="journal-grid">
            {posts.map((item, index) => (
              <button
                className="journal-card"
                key={item.id}
                onClick={(event) => {
                  postTrigger.current = event.currentTarget;
                  setPost(item);
                }}
              >
                <div className="journal-meta">
                  <span>{item.category}</span>
                  <span>{dateLabel(item.date)}</span>
                </div>
                <div className="journal-heading">
                  <h3>{item.title}</h3>
                  <ArrowUpRight size={20} />
                </div>
                <p>{item.excerpt}</p>
                <span className="journal-index">0{index + 1}</span>
              </button>
            ))}
          </div>
          {posts.length === 0 && (
            <div className="journal-empty">
              <span className="journal-empty-icon">
                <Sprout size={30} strokeWidth={1.4} />
              </span>
              <div>
                <h3>{copy.journalEmptyTitle}</h3>
                <p>
                  {copy.journalEmptyDescription}
                </p>
              </div>
              <span className="eyebrow">{copy.journalEmptyEyebrow}</span>
            </div>
          )}
        </section>
        <section className="contact-section container" id="contact">
          <div>
            <span className="eyebrow">
              {copy.contactEyebrow}
            </span>
            <h2>
              {copy.contactTitleFirst}
              <br />
              <em>{copy.contactTitleSecond}</em>
            </h2>
            <p>{copy.contactDescription}</p>
            {site.email ? (
              <a className="button" href={`mailto:${site.email}`}>
                {copy.contactButton} <Mail size={17} />
              </a>
            ) : (
              <div className="contact-pending">
                <Mail size={17} />
                <span>{copy.contactPending}</span>
              </div>
            )}
          </div>
          <div className="contact-right">
            <span
              className={`availability ${site.available ? "" : "unavailable"}`}
            >
              <span className="live-dot" />
              {site.available
                ? copy.availabilityOpen
                : copy.availabilityBusy}
            </span>
            <span className="contact-doodle" aria-hidden="true">
              <Coffee size={110} strokeWidth={1} />
              <Heart size={24} />
            </span>
            <span className="eyebrow">{copy.socialEyebrow}</span>
            <Socials socials={site.socials} full />
            {!Object.values(site.socials).some(Boolean) && (
              <small className="muted">{copy.socialEmpty}</small>
            )}
          </div>
        </section>
      </main>
      <Footer site={site} />
      {post && (
        <div className="modal-backdrop" onClick={() => setPost(null)}>
          <section
            className="modal journal-modal"
            role="dialog"
            aria-modal="true"
            aria-label={post.title}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              autoFocus
              className="icon-button modal-close"
              onClick={() => setPost(null)}
              aria-label="Close note"
            >
              <X />
            </button>
            <span className="eyebrow">
              {post.category} · {dateLabel(post.date)}
            </span>
            <h2>{post.title}</h2>
            <p className="preserve-lines">{post.excerpt}</p>
            {safeLink(post.url) && (
              <a
                className="button"
                href={safeLink(post.url)}
                target="_blank"
                rel="noreferrer"
              >
                {copy.readStory} <ArrowUpRight size={17} />
              </a>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function GamePage({ id, site }) {
  const copy = site.copy;
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [versionId, setVersionId] = useState("");
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState("overview");
  const [rating, setRating] = useState(0);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [reviewError, setReviewError] = useState("");
  useEffect(() => {
    api(`/games/${encodeURIComponent(id)}`)
      .then((value) => {
        setData(value);
        setVersionId(value.game.versions[0]?.id || "");
        document.title = `${value.game.title} — ${site.name}`;
        const description = document.querySelector('meta[name="description"]');
        if (description) description.content = value.game.summary;
        trackEvent("game_view", value.game.id);
      })
      .catch((err) => setError(err.message));
  }, [id]);
  const game = data?.game;
  const version = game?.versions.find((item) => item.id === versionId);
  function startPlaying(selectedVersion = version) {
    if (!selectedVersion?.webUrl) return;
    if (!playing || selectedVersion.id !== versionId) {
      trackEvent("play", id, { versionId: selectedVersion.id });
    }
    setVersionId(selectedVersion.id);
    setPlaying(true);
  }
  function trackDownload(selectedVersion, file) {
    trackEvent("download", id, {
      versionId: selectedVersion.id,
      downloadId: file.id,
    });
  }
  async function submitReview(event) {
    event.preventDefault();
    if (!rating) {
      setReviewError(copy.gameRatingError);
      return;
    }
    const values = new FormData(event.currentTarget);
    setSending(true);
    setReviewError("");
    try {
      await api(`/games/${id}/reviews`, {
        method: "POST",
        body: { name: values.get("name"), body: values.get("body"), rating },
      });
      setSent(true);
    } catch (err) {
      setReviewError(err.message);
    } finally {
      setSending(false);
    }
  }
  return (
    <>
      <Header site={site} />
      <main className="container game-page">
        <a className="back-link" href="/#games">
          <ArrowLeft size={15} /> {copy.gameBack}
        </a>
        {error ? (
          <div className="empty-state">
            <h1>{copy.gameMissingTitle}</h1>
            <p>{error}</p>
            <a className="button" href="/#games">
              {copy.gameMissingButton}
            </a>
          </div>
        ) : !game ? (
          <Loading text={copy.loadingText} />
        ) : (
          <>
            <div className="game-page-heading">
              <div>
                <span className="eyebrow">
                  {game.genre} · {game.status}
                </span>
                <h1>
                  {game.title}
                  <span className="green-dot">.</span>
                </h1>
                <p>{game.summary}</p>
              </div>
              {game.count > 0 && (
                <div className="game-rating">
                  <Star fill="currentColor" />
                  {Number(game.rating).toFixed(1)}
                  <small>
                    {game.count} {copy.gameRatingsUnit}
                  </small>
                </div>
              )}
            </div>
            {game.sample && (
              <div className="sample-banner">
                <Sprout size={18} />
                <span>
                  <strong>{copy.gameSampleTitle}</strong>{" "}
                  {copy.gameSampleDescription}
                </span>
              </div>
            )}
            <div className="game-detail-grid">
              <div>
                <div className={`game-player ${playing ? "is-playing" : ""}`}>
                  {playing && version?.webUrl ? (
                    <iframe
                      title={`Play ${game.title} ${version.label}`}
                      src={safeLink(version.webUrl)}
                      allow="autoplay; fullscreen; gamepad; cross-origin-isolated"
                      allowFullScreen
                    />
                  ) : (
                    <>
                      <Image
                        src={game.cover}
                        alt={`${game.title} artwork`}
                        style={imagePositionStyle(game.coverPosition)}
                      />
                      <div className="player-overlay">
                        {version?.webUrl ? (
                          <button
                            className="button"
                            onClick={() => startPlaying()}
                          >
                            <Play size={19} fill="currentColor" />
                            {copy.gamePlayButton}
                          </button>
                        ) : (
                          <span className="player-pending">
                            <Gamepad2 size={22} /> {copy.gameNotReady}
                          </span>
                        )}
                      </div>
                    </>
                  )}
                </div>
                <div className="player-toolbar">
                  <span>
                    <Monitor size={15} />
                    {playing
                      ? copy.gamePlayerFocus
                      : copy.gamePlayerHint}
                  </span>
                  {playing && (
                    <button
                      className="text-link"
                      onClick={() =>
                        document
                          .querySelector(".game-player")
                          .requestFullscreen?.()
                      }
                    >
                      <Maximize size={15} /> {copy.gameFullscreen}
                    </button>
                  )}
                </div>
                <div className="detail-tabs" role="tablist">
                  {[
                    ["overview", copy.gameOverviewTab],
                    ["versions", copy.gameVersionsTab],
                    ["comments", copy.gameCommentsTab],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      role="tab"
                      aria-selected={tab === value}
                      className={tab === value ? "selected" : ""}
                      onClick={() => setTab(value)}
                    >
                      {label}
                      {value === "comments" && (
                        <span>{data.reviews.length}</span>
                      )}
                    </button>
                  ))}
                </div>
                <section className="detail-content" role="tabpanel">
                  {tab === "overview" && (
                    <>
                      <h2>{copy.gameOverviewTitle}</h2>
                      <p className="preserve-lines">{game.description}</p>
                      <h3>{copy.gameDetailsTitle}</h3>
                      <div className="tags">
                        {game.tags.map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    </>
                  )}
                  {tab === "versions" && (
                    <>
                      <h2>{copy.gameVersionsTitle}</h2>
                      <p className="muted">
                        {copy.gameVersionsDescription}
                      </p>
                      {game.versions.length ? (
                        game.versions.map((item, index) => (
                          <article className="version-card" key={item.id}>
                            <div>
                              <h3>
                                {item.label}{" "}
                                {index === 0 && (
                                  <span className="badge">{copy.gameLatest}</span>
                                )}
                              </h3>
                              <span className="muted">
                                {dateLabel(item.date)}
                              </span>
                            </div>
                            <p className="preserve-lines">
                              {item.notes ||
                                copy.gameNoReleaseNotes}
                            </p>
                            <div className="version-actions">
                              {item.webUrl && (
                                <button
                                  className="button button-small"
                                  onClick={() => {
                                    startPlaying(item);
                                    window.scrollTo({
                                      top: 180,
                                      behavior: "smooth",
                                    });
                                  }}
                                >
                                  <Play size={14} /> {copy.gamePlayVersion}
                                </button>
                              )}
                              {item.downloads.map((file) => (
                                <a
                                  className="button button-small button-light"
                                  key={file.id}
                                  href={safeLink(file.url)}
                                  onClick={() => trackDownload(item, file)}
                                  download
                                >
                                  <Download size={14} /> {file.label}
                                </a>
                              ))}
                              {!item.webUrl && !item.downloads.length && (
                                <span className="muted">
                                  {copy.gameNoBuilds}
                                </span>
                              )}
                            </div>
                          </article>
                        ))
                      ) : (
                        <p className="empty-inline">
                          {copy.gameNoReleases}
                        </p>
                      )}
                    </>
                  )}
                  {tab === "comments" && (
                    <>
                      <h2>{copy.gameCommentsTitle}</h2>
                      <p className="muted">{copy.gameReviewIntro}</p>
                      {sent ? (
                        <div className="success-box">
                          <Check size={24} />
                          <div>
                            <h3>{copy.gameReviewSuccessTitle}</h3>
                            <p>{copy.gameReviewSuccessDescription}</p>
                          </div>
                        </div>
                      ) : (
                        <form className="review-form" onSubmit={submitReview}>
                          <fieldset className="star-picker">
                            <legend>{copy.gameRatingLabel}</legend>
                            {[1, 2, 3, 4, 5].map((value) => (
                              <button
                                type="button"
                                key={value}
                                aria-label={`Rate ${value} ${value === 1 ? copy.gameStarSingular : copy.gameStarPlural}`}
                                aria-pressed={rating === value}
                                onClick={() => setRating(value)}
                              >
                                <Star
                                  size={27}
                                  fill={
                                    value <= rating ? "currentColor" : "none"
                                  }
                                />
                              </button>
                            ))}
                            <span>
                              {rating ? `${rating} / 5` : copy.gameChooseRating}
                            </span>
                          </fieldset>
                          <label>
                            {copy.gameNameLabel}
                            <input
                              name="name"
                              minLength={2}
                              maxLength={60}
                              required
                              placeholder={copy.gameNamePlaceholder}
                              autoComplete="nickname"
                            />
                          </label>
                          <label>
                            {copy.gameThoughtsLabel}
                            <textarea
                              name="body"
                              minLength={5}
                              maxLength={2000}
                              required
                              rows={4}
                              placeholder={copy.gameThoughtsPlaceholder}
                            />
                          </label>
                          <p className="form-note">{copy.gameReviewPrivacy}</p>
                          {reviewError && (
                            <p className="error-message" role="alert">
                              {reviewError}
                            </p>
                          )}
                          <button className="button" disabled={sending}>
                            {sending
                              ? copy.gameReviewSending
                              : copy.gameReviewSubmit}
                            <MessageCircle size={16} />
                          </button>
                        </form>
                      )}
                      <div className="reviews-list">
                        {data.reviews.length ? (
                          data.reviews.map((review) => (
                            <article className="review" key={review.id}>
                              <div>
                                <strong>{review.name}</strong>
                                <span>
                                  {"★".repeat(review.rating)}
                                  <span className="empty-stars">
                                    {"★".repeat(5 - review.rating)}
                                  </span>
                                </span>
                                <small>{dateLabel(review.date)}</small>
                              </div>
                              <p className="preserve-lines">{review.body}</p>
                            </article>
                          ))
                        ) : (
                          <p className="empty-inline">
                            {copy.gameNoReviews}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </section>
              </div>
              <aside className="game-sidebar">
                <div className="sidebar-card">
                  <span className="eyebrow">{copy.gameSidebarEyebrow}</span>
                  <h3>{copy.gameReadyTitle}</h3>
                  {game.versions.length > 0 && (
                    <label>
                      {copy.gameVersionLabel}
                      <div className="select-wrap">
                        <select
                          value={versionId}
                          onChange={(event) => {
                            setVersionId(event.target.value);
                            setPlaying(false);
                          }}
                        >
                          {game.versions.map((item, index) => (
                            <option key={item.id} value={item.id}>
                              {item.label}
                              {index === 0
                                ? ` — ${copy.gameLatest.toLowerCase()}`
                                : ""}
                            </option>
                          ))}
                        </select>
                        <ChevronDown size={16} />
                      </div>
                    </label>
                  )}
                  {version?.webUrl ? (
                    <button
                      className="button wide"
                      onClick={() => {
                        startPlaying();
                        document.querySelector(".game-player").scrollIntoView({
                          behavior: "smooth",
                          block: "center",
                        });
                      }}
                    >
                      <Play size={16} fill="currentColor" />
                      {copy.filterPlay}
                    </button>
                  ) : (
                    <div className="not-ready">
                      <Monitor size={19} />
                      {copy.gameBuildPending}
                    </div>
                  )}
                  {version?.downloads.map((file) => (
                    <a
                      key={file.id}
                      className="button button-light wide"
                      href={safeLink(file.url)}
                      onClick={() => trackDownload(version, file)}
                      download
                    >
                      <Download size={16} />
                      {file.label}
                    </a>
                  ))}
                  <p className="form-note">
                    {version?.webUrl
                      ? copy.gameDesktopHint
                      : copy.gameComingAlongHint}
                  </p>
                  <div className="sidebar-divider" />
                  <h4>
                    <Gamepad2 size={17} /> {copy.gameInstructions}
                  </h4>
                  {game.controls.length ? (
                    <dl className="controls-list">
                      {game.controls.map((control, index) => (
                        <div key={index}>
                          <dt>
                            <kbd>{control.key}</kbd>
                          </dt>
                          <dd>{control.action}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : (
                    <p className="muted">
                      {copy.gameControlsPending}
                    </p>
                  )}
                </div>
                <div className="feedback-aside">
                  <Heart size={24} />
                  <h4>{copy.gameFeedbackTitle}</h4>
                  <p>{copy.gameFeedbackDescription}</p>
                  <button
                    className="text-link"
                    onClick={() => {
                      setTab("comments");
                      document
                        .querySelector(".detail-tabs")
                        .scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    {copy.gameLeaveReview} <ArrowRight size={15} />
                  </button>
                </div>
              </aside>
            </div>
          </>
        )}
      </main>
      <Footer site={site} />
    </>
  );
}

function Loading({ text = "Growing a little something…" }) {
  return (
    <div className="loading-state" role="status">
      <Sprout className="loading-leaf" size={36} />
      <p>{text}</p>
    </div>
  );
}

export default function App() {
  const [content, setContent] = useState(null);
  const [error, setError] = useState("");
  const isStudio =
    window.location.pathname === "/studio" ||
    window.location.pathname.startsWith("/studio/");
  useEffect(() => {
    if (isStudio) return;
    api("/site")
      .then(setContent)
      .catch((err) => setError(err.message));
  }, [isStudio]);
  useEffect(() => {
    if (!content || isStudio) return;
    document.title = `${content.site.name} — ${content.site.heroTitle.replace(/\s+/g, " ").trim()}`;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = content.site.heroDescription;
  }, [content, isStudio]);
  if (isStudio) return <Studio />;
  if (error)
    return (
      <main className="error-page">
        <Brand />
        <h1>A small pause in the adventure.</h1>
        <p>{error}</p>
        <button className="button" onClick={() => window.location.reload()}>
          Try again <ArrowRight size={17} />
        </button>
      </main>
    );
  if (!content) return <Loading />;
  const gameMatch = window.location.pathname.match(
    /^\/games\/([a-z0-9][a-z0-9_-]{0,79})\/?$/,
  );
  if (gameMatch)
    return (
      <div id="top">
        <GamePage id={gameMatch[1]} site={content.site} />
      </div>
    );
  if (window.location.pathname !== "/")
    return (
      <div id="top">
        <Header site={content.site} />
        <main className="container empty-state">
          <Sprout size={40} />
          <h1>{content.site.copy.notFoundTitle}</h1>
          <p>{content.site.copy.notFoundDescription}</p>
          <a className="button" href="/">
            {content.site.copy.notFoundButton} <ArrowRight size={17} />
          </a>
        </main>
        <Footer site={content.site} />
      </div>
    );
  return (
    <div id="top">
      <Home content={content} />
    </div>
  );
}
