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
      <img src="/favicon.svg" alt="" />
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
            Home
          </a>
          <a href="/#games" onClick={() => setOpen(false)}>
            Games
          </a>
          <a href="/#about" onClick={() => setOpen(false)}>
            About
          </a>
          <a href="/#community" onClick={() => setOpen(false)}>
            Community
          </a>
        </nav>
        <a className="button button-small nav-contact" href="/#contact">
          Let’s talk <ArrowUpRight size={16} />
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
  return (
    <footer className="site-footer container">
      <div className="footer-top">
        <Brand name={site.name} />
        <span>{site.tagline}</span>
        <Socials socials={site.socials} />
      </div>
      <div className="footer-bottom">
        <span>
          © {new Date().getFullYear()} {site.name}. Made with care & a little
          caffeine.
        </span>
        <a href="/studio">
          Creator studio <ArrowUpRight size={12} />
        </a>
        <a href="#top">Back to top ↑</a>
      </div>
      <details className="privacy-details">
        <summary>Privacy & activity counts</summary>
        <p>
          This site counts page views, post opens, play starts, and download
          clicks. A random ID in this tab’s session storage helps avoid repeat
          counts; only temporary hashed keys and daily totals are stored in
          analytics, not IP addresses or browsing histories. Hashed keys expire
          within 48 hours. Signed-in creator visits and browsers requesting Do
          Not Track or Global Privacy Control are excluded. Submitted reviews
          are published only after approval; use a display name you are
          comfortable sharing publicly.
        </p>
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

function Highlight({ highlight, games }) {
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
        />
        <span className="art-caption">
          <span className="live-dot" />
          {game?.sample
            ? "A LITTLE CONCEPT, A LOT OF POSSIBILITY"
            : highlight.eyebrow || "A LITTLE LOOK AT WHAT’S NEXT"}
        </span>
      </div>
      <div className="round-stamp">
        <Sprout size={28} strokeWidth={1.6} />
        <span>
          GROW SOMETHING
          <br />
          GOOD.
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
            aria-label={`Explore ${highlight.title}`}
            {...(href.startsWith("https:")
              ? { target: "_blank", rel: "noreferrer" }
              : {})}
          >
            <ArrowUpRight size={22} />
          </a>
        )}
      </div>
    </div>
  );
}

function GameCard({ game }) {
  const playable = game.versions.some((version) => version.webUrl);
  return (
    <a className="game-card" href={`/games/${game.id}`}>
      <div className="game-card-art">
        <Image src={game.cover} alt={`${game.title} artwork`} loading="lazy" />
        <span
          className={`game-status ${game.status === "Released" ? "released" : ""}`}
        >
          <span />
          {game.status}
        </span>
        {playable && (
          <span className="quick-play">
            <Play size={16} fill="currentColor" /> Play
          </span>
        )}
        <span className="card-arrow">
          <ArrowUpRight size={20} />
        </span>
      </div>
      <div className="game-card-content">
        <div className="game-meta">
          <span>{game.genre}</span>
          <span>{game.sample ? "SAMPLE CONCEPT" : game.year}</span>
        </div>
        <h3>{game.title}</h3>
        <p>{game.summary}</p>
        <div className="game-card-bottom">
          <div className="tags">
            {game.tags.slice(0, 2).map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </div>
          {game.count > 0 ? (
            <span className="rating-small">
              <Star size={13} fill="currentColor" />
              {Number(game.rating).toFixed(1)} <small>({game.count})</small>
            </span>
          ) : (
            <span className="made-in">
              <Gamepad2 size={14} /> Godot
            </span>
          )}
        </div>
      </div>
    </a>
  );
}

function Home({ content }) {
  const { site, games, posts } = content;
  const [filter, setFilter] = useState("All games");
  const [post, setPost] = useState(null);
  const postTrigger = useRef(null);
  const filtered = games.filter(
    (game) =>
      filter === "All games" ||
      (filter === "Play in browser"
        ? game.versions.some((version) => version.webUrl)
        : game.status === filter),
  );
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
              <span className="live-dot" /> INDEPENDENT DEVELOPER. ENDLESS
              CURIOSITY.
            </div>
            <h1>
              {title[0]}
              <br />
              <em>{title.slice(1).join(" ") || "Made with heart."}</em>
            </h1>
            <p className="hero-description">{site.heroDescription}</p>
            <div className="hero-actions">
              <a className="button" href="#games">
                Explore my games <ArrowUpRight size={18} />
              </a>
              <a className="text-link" href="#about">
                A little about me <ArrowRight size={17} />
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
                Made with curiosity.
                <br />
                <strong>Better when shared.</strong>
              </p>
            </div>
          </div>
          <Highlight highlight={site.highlight} games={games} />
        </section>
        <div className="values-strip">
          <div className="container">
            <span>
              <Gamepad2 size={18} /> Small, thoughtful games
            </span>
            <i />
            <span>
              <Sprout size={18} /> Always learning, always making
            </span>
            <i />
            <span>
              <Users size={18} /> Community at the heart
            </span>
            <i />
            <span>
              <Coffee size={18} /> A little caffeine-powered
            </span>
          </div>
        </div>
        <section className="section container games-section" id="games">
          <div className="section-top">
            <div>
              <span className="eyebrow">
                <span className="section-number">01 /</span> THE PLAYABLE SIDE
                OF ME
              </span>
              <h2>
                Find your next little escape<span className="green-dot">.</span>
              </h2>
            </div>
            <span className="section-note">
              Crafted with care.
              <br />
              Yours to explore.
            </span>
          </div>
          <div className="filter-row">
            <div className="filters" aria-label="Filter games">
              {[
                "All games",
                "Play in browser",
                "In development",
                "Released",
              ].map((item) => (
                <button
                  key={item}
                  className={filter === item ? "selected" : ""}
                  onClick={() => setFilter(item)}
                >
                  {item === "Play in browser" && <Play size={13} />}
                  {item}
                  {item === "All games" && (
                    <span>{games.length.toString().padStart(2, "0")}</span>
                  )}
                </button>
              ))}
            </div>
            <span className="filter-caption">
              <Monitor size={14} /> A world beyond the screen
            </span>
          </div>
          <div className="game-grid">
            {filtered.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
          {!filtered.length && (
            <div className="empty-state">
              <Sprout size={30} />
              <h3>Something good is growing.</h3>
              <p>
                No {filter.toLowerCase()} games just yet. Explore the other
                projects in the meantime.
              </p>
              <button
                className="button button-light"
                onClick={() => setFilter("All games")}
              >
                See all games <ArrowRight size={16} />
              </button>
            </div>
          )}
          <div className="games-note">
            <span>
              <Heart size={15} /> Play a little. Leave a thought. Help a game
              grow.
            </span>
            <span>Browser play · Downloads · Version history</span>
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
                      hello, world<span className="blink">_</span>
                    </span>
                  </div>
                </div>
                <div className="coffee-sticker">
                  <Coffee size={37} strokeWidth={1.4} />
                  <span>one more idea.</span>
                </div>
                <span className="sparkle-one">✳</span>
                <span className="sparkle-two">+</span>
              </div>
              <span className="art-handwritten">
                the person behind the pixels ↗
              </span>
            </div>
            <div className="about-copy">
              <span className="eyebrow">
                <span className="section-number">02 /</span> A HUMAN, NOT JUST A
                HANDLE
              </span>
              <h2>
                Hey, I’m Khoifee<span className="green-dot">.</span>
                <br />I make things you can feel.
              </h2>
              <p className="preserve-lines">{site.about}</p>
              <div className="about-pills">
                <span>
                  <Gamepad2 size={15} /> Game developer
                </span>
                <span>
                  <Sparkles size={15} /> Curious creator
                </span>
                <span>
                  <Users size={15} /> Community member
                </span>
              </div>
              <a className="text-link" href="#contact">
                Let’s make something good together <ArrowUpRight size={18} />
              </a>
            </div>
          </div>
        </section>
        <section className="section container community-section" id="community">
          <div className="community-panel">
            <div className="community-symbol" aria-hidden="true">
              <div>
                <Sprout size={47} strokeWidth={1.3} />
                <span>G A W A I N</span>
                <small>GAME DEV GUILD</small>
              </div>
              <i />
              <i />
            </div>
            <div className="community-copy">
              <span className="eyebrow">GREAT THINGS AREN’T MADE ALONE</span>
              <h2>
                Good people.
                <br />
                Even better possibilities.
              </h2>
              <p>
                Proud to be part of <strong>{site.community.name}</strong>.
              </p>
              <p>{site.community.description}</p>
              {safeLink(site.community.url) ? (
                <a
                  className="button button-dark"
                  href={safeLink(site.community.url)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Meet the guild <ArrowUpRight size={16} />
                </a>
              ) : (
                <span className="community-coming">
                  <Users size={16} /> Guild link coming soon
                </span>
              )}
            </div>
            <span className="community-side">CREATE. CONNECT. GROW.</span>
          </div>
        </section>
        <section className="journal-section container" id="journal">
          <div className="section-top">
            <div>
              <span className="eyebrow">
                <span className="section-number">03 /</span> NOTES FROM THE
                WORKBENCH
              </span>
              <h2>
                A little behind the scenes<span className="green-dot">.</span>
              </h2>
            </div>
            <span className="section-note">
              The process is part
              <br />
              of the story.
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
                <h3>Every game starts with a first note.</h3>
                <p>
                  Dev diaries, small discoveries, and community stories will
                  land here.
                </p>
              </div>
              <span className="eyebrow">GOOD THINGS TAKE A LITTLE TIME</span>
            </div>
          )}
        </section>
        <section className="contact-section container" id="contact">
          <div>
            <span className="eyebrow">
              GOT AN IDEA, A QUESTION, OR JUST A HELLO?
            </span>
            <h2>
              Let’s make a little
              <br />
              <em>something happen.</em>
            </h2>
            <p>
              Collaborations, conversations, and cool ideas are always welcome.
            </p>
            {site.email ? (
              <a className="button" href={`mailto:${site.email}`}>
                Say hello <Mail size={17} />
              </a>
            ) : (
              <div className="contact-pending">
                <Mail size={17} />
                <span>Contact details are on their way. Check back soon.</span>
              </div>
            )}
          </div>
          <div className="contact-right">
            <span
              className={`availability ${site.available ? "" : "unavailable"}`}
            >
              <span className="live-dot" />
              {site.available
                ? "OPEN TO GOOD CONVERSATIONS"
                : "CURRENTLY HEADS-DOWN CREATING"}
            </span>
            <span className="contact-doodle" aria-hidden="true">
              <Coffee size={110} strokeWidth={1} />
              <Heart size={24} />
            </span>
            <span className="eyebrow">FIND ME AROUND THE INTERNET</span>
            <Socials socials={site.socials} full />
            {!Object.values(site.socials).some(Boolean) && (
              <small className="muted">Social links coming soon.</small>
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
                Read the full story <ArrowUpRight size={17} />
              </a>
            )}
          </section>
        </div>
      )}
    </>
  );
}

function GamePage({ id, site }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [versionId, setVersionId] = useState("");
  const [playing, setPlaying] = useState(false);
  const [tab, setTab] = useState("Overview");
  const [rating, setRating] = useState(0);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [reviewError, setReviewError] = useState("");
  useEffect(() => {
    api(`/games/${encodeURIComponent(id)}`)
      .then((value) => {
        setData(value);
        setVersionId(value.game.versions[0]?.id || "");
        document.title = `${value.game.title} — KhoifeeDev`;
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
      setReviewError("Choose a star rating first.");
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
          <ArrowLeft size={15} /> Back to all games
        </a>
        {error ? (
          <div className="empty-state">
            <h1>That little world isn’t here.</h1>
            <p>{error}</p>
            <a className="button" href="/#games">
              Explore the games
            </a>
          </div>
        ) : !game ? (
          <Loading />
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
                  <small>{game.count} ratings</small>
                </div>
              )}
            </div>
            {game.sample && (
              <div className="sample-banner">
                <Sprout size={18} />
                <span>
                  <strong>A concept, for now.</strong> This is sample content
                  showing what a game page can look like. No playable build has
                  been published.
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
                      <Image src={game.cover} alt={`${game.title} artwork`} />
                      <div className="player-overlay">
                        {version?.webUrl ? (
                          <button
                            className="button"
                            onClick={() => startPlaying()}
                          >
                            <Play size={19} fill="currentColor" /> Play in
                            browser
                          </button>
                        ) : (
                          <span className="player-pending">
                            <Gamepad2 size={22} /> A little world in the making
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
                      ? "Click inside the game to focus controls"
                      : "Browser play, right here when it’s ready"}
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
                      <Maximize size={15} /> Fullscreen
                    </button>
                  )}
                </div>
                <div className="detail-tabs" role="tablist">
                  {["Overview", "Version history", "Comments"].map((item) => (
                    <button
                      key={item}
                      role="tab"
                      aria-selected={tab === item}
                      className={tab === item ? "selected" : ""}
                      onClick={() => setTab(item)}
                    >
                      {item}
                      {item === "Comments" && (
                        <span>{data.reviews.length}</span>
                      )}
                    </button>
                  ))}
                </div>
                <section className="detail-content" role="tabpanel">
                  {tab === "Overview" && (
                    <>
                      <h2>A little about this world</h2>
                      <p className="preserve-lines">{game.description}</p>
                      <h3>The little details</h3>
                      <div className="tags">
                        {game.tags.map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    </>
                  )}
                  {tab === "Version history" && (
                    <>
                      <h2>Every version has a story.</h2>
                      <p className="muted">
                        Pick a release to play an earlier build or download a
                        copy.
                      </p>
                      {game.versions.length ? (
                        game.versions.map((item, index) => (
                          <article className="version-card" key={item.id}>
                            <div>
                              <h3>
                                {item.label}{" "}
                                {index === 0 && (
                                  <span className="badge">LATEST</span>
                                )}
                              </h3>
                              <span className="muted">
                                {dateLabel(item.date)}
                              </span>
                            </div>
                            <p className="preserve-lines">
                              {item.notes ||
                                "No release notes for this version."}
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
                                  <Play size={14} /> Play this version
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
                                  Builds haven’t been uploaded for this version.
                                </span>
                              )}
                            </div>
                          </article>
                        ))
                      ) : (
                        <p className="empty-inline">
                          The first chapter is still being written. No releases
                          yet.
                        </p>
                      )}
                    </>
                  )}
                  {tab === "Comments" && (
                    <>
                      <h2>A thought can go a long way.</h2>
                      <p className="muted">
                        Played it? Share a kind, honest review. Comments appear
                        after approval.
                      </p>
                      {sent ? (
                        <div className="success-box">
                          <Check size={24} />
                          <div>
                            <h3>Thanks for helping this game grow.</h3>
                            <p>Your review has been submitted for approval.</p>
                          </div>
                        </div>
                      ) : (
                        <form className="review-form" onSubmit={submitReview}>
                          <fieldset className="star-picker">
                            <legend>Your rating</legend>
                            {[1, 2, 3, 4, 5].map((value) => (
                              <button
                                type="button"
                                key={value}
                                aria-label={`Rate ${value} ${value === 1 ? "star" : "stars"}`}
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
                              {rating ? `${rating} / 5` : "Choose a rating"}
                            </span>
                          </fieldset>
                          <label>
                            Your name
                            <input
                              name="name"
                              minLength={2}
                              maxLength={60}
                              required
                              placeholder="What should we call you?"
                              autoComplete="nickname"
                            />
                          </label>
                          <label>
                            Your thoughts
                            <textarea
                              name="body"
                              minLength={5}
                              maxLength={2000}
                              required
                              rows={4}
                              placeholder="What stayed with you? What could be better?"
                            />
                          </label>
                          <p className="form-note">
                            Your name, rating, and comment will be public after
                            approval. Please don’t share personal information.
                          </p>
                          {reviewError && (
                            <p className="error-message" role="alert">
                              {reviewError}
                            </p>
                          )}
                          <button className="button" disabled={sending}>
                            {sending ? "Sending…" : "Leave a little feedback"}
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
                            No reviews yet. Yours could be the first.
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </section>
              </div>
              <aside className="game-sidebar">
                <div className="sidebar-card">
                  <span className="eyebrow">YOUR NEXT LITTLE ESCAPE</span>
                  <h3>Ready when you are.</h3>
                  {game.versions.length > 0 && (
                    <label>
                      Game version
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
                              {index === 0 ? " — latest" : ""}
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
                      Play in browser
                    </button>
                  ) : (
                    <div className="not-ready">
                      <Monitor size={19} />
                      Web build coming soon
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
                      ? "Desktop recommended. Check the controls below before you dive in."
                      : "Follow along as this game takes shape. Published builds will appear here."}
                  </p>
                  <div className="sidebar-divider" />
                  <h4>
                    <Gamepad2 size={17} /> How to play
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
                      Controls will be added with the first playable build.
                    </p>
                  )}
                </div>
                <div className="feedback-aside">
                  <Heart size={24} />
                  <h4>Small feedback. Big difference.</h4>
                  <p>
                    Your thoughts help make the next version a little better.
                  </p>
                  <button
                    className="text-link"
                    onClick={() => {
                      setTab("Comments");
                      document
                        .querySelector(".detail-tabs")
                        .scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    Leave a review <ArrowRight size={15} />
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

function Loading() {
  return (
    <div className="loading-state" role="status">
      <Sprout className="loading-leaf" size={36} />
      <p>Growing a little something…</p>
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
          <h1>A little off the path.</h1>
          <p>This page doesn’t exist, but there are other worlds to explore.</p>
          <a className="button" href="/">
            Take me home <ArrowRight size={17} />
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
