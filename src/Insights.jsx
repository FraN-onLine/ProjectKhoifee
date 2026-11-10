import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  BarChart3,
  Download,
  Eye,
  FileText,
  LoaderCircle,
  Play,
  RefreshCw,
  ShieldCheck,
  Star,
} from "lucide-react";
import { api, dateLabel } from "./api";

const number = new Intl.NumberFormat("en");
const chartMetrics = [
  { key: "gameViews", label: "Game views" },
  { key: "playStarts", label: "Play starts" },
  { key: "downloadClicks", label: "Download clicks" },
  { key: "postViews", label: "Post opens" },
];

export default function Insights() {
  const [days, setDays] = useState(30);
  const [revision, setRevision] = useState(0);
  const [metric, setMetric] = useState("gameViews");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api(`/admin/analytics?days=${days}`, { signal: controller.signal })
      .then((result) => {
        setData(result);
        setUpdatedAt(
          new Date().toLocaleTimeString("en", {
            hour: "numeric",
            minute: "2-digit",
          }),
        );
      })
      .catch((err) => {
        if (!controller.signal.aborted) setError(err.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [days, revision]);

  const selectedMetric = chartMetrics.find((item) => item.key === metric);
  const maximum = data
    ? Math.max(1, ...data.daily.map((day) => day[metric]))
    : 1;
  const cards = data
    ? [
        {
          key: "gameViews",
          label: "Game page views",
          value: number.format(data.totals.gameViews),
          Icon: Eye,
          detail: "Repeat views are deduplicated",
        },
        {
          key: "playStarts",
          label: "Play starts",
          value: number.format(data.totals.playStarts),
          Icon: Play,
          detail: "Browser play buttons clicked",
        },
        {
          key: "downloadClicks",
          label: "Download clicks",
          value: number.format(data.totals.downloadClicks),
          Icon: Download,
          detail: "Not completed file transfers",
        },
        {
          key: "rating",
          label: "Average rating",
          value: data.ratings.count
            ? Number(data.ratings.average).toFixed(1)
            : "—",
          Icon: Star,
          detail: `${number.format(data.ratings.count)} approved ratings · all time`,
        },
      ]
    : [];

  return (
    <section className="insights" aria-label="Private engagement insights">
      <div className="editor-heading">
        <div>
          <span className="eyebrow">A LITTLE PERSPECTIVE ON YOUR IMPACT</span>
          <h2>See your worlds grow.</h2>
          <p>
            Real visits, player interest, and feedback. Only you can see these
            numbers.
          </p>
        </div>
        <div className="insight-actions">
          <label className="insight-range">
            Date range
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
            >
              <option value={7}>Last 7 days</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
            </select>
          </label>
          <button
            type="button"
            className="icon-button"
            aria-label="Refresh insights"
            disabled={loading}
            onClick={() => setRevision((value) => value + 1)}
          >
            <RefreshCw size={17} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>
      {error && (
        <div className="error-message" role="alert">
          {error}
          <button
            className="text-link"
            onClick={() => setRevision((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      )}
      {loading ? (
        <div className="insights-loading" role="status">
          <LoaderCircle size={24} className="spin" />
          <p>Gathering your little moments…</p>
        </div>
      ) : (
        data && (
          <>
            <div className="insight-summary">
              <span>
                {dateLabel(data.startDate)} — {dateLabel(data.endDate)} · UTC
              </span>
              <span>Updated {updatedAt}</span>
            </div>
            <div className="insight-cards">
              {cards.map(({ key, label, value, Icon, detail }) => (
                <article className="insight-stat" key={key}>
                  <div>
                    <span>{label}</span>
                    <Icon size={18} />
                  </div>
                  <strong>{value}</strong>
                  <small>{detail}</small>
                </article>
              ))}
            </div>
            <div className="insight-secondary">
              <span>
                <Eye size={15} />
                <strong>{number.format(data.totals.siteViews)}</strong> homepage
                views
              </span>
              <span>
                <FileText size={15} />
                <strong>{number.format(data.totals.postViews)}</strong> post
                opens
              </span>
              <span>
                <Star size={15} />
                <strong>{number.format(data.ratings.pending)}</strong> reviews
                awaiting approval
              </span>
            </div>
            <section
              className="editor-panel activity-panel"
              aria-label="Activity over time"
            >
              <div className="panel-title-row">
                <h3>
                  <BarChart3 size={19} /> A little momentum
                </h3>
                <span className="muted">{days} days</span>
              </div>
              <div
                className="filters chart-filters"
                aria-label="Activity chart metric"
              >
                {chartMetrics.map((item) => (
                  <button
                    key={item.key}
                    className={metric === item.key ? "selected" : ""}
                    aria-pressed={metric === item.key}
                    onClick={() => setMetric(item.key)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="activity-chart">
                <svg
                  viewBox="0 0 840 170"
                  role="img"
                  aria-label={`${selectedMetric.label} over the last ${days} days: ${data.totals[metric]} total. Daily values are available in the table below.`}
                  preserveAspectRatio="none"
                >
                  <path
                    d="M0 150H840M0 80H840M0 10H840"
                    stroke="#e2e8d9"
                    strokeWidth="1"
                    strokeDasharray="4 5"
                  />
                  {data.daily.map((day, index) => {
                    const height = Math.max(2, (day[metric] / maximum) * 140);
                    const slot = 840 / data.daily.length;
                    return (
                      <rect
                        key={day.date}
                        x={index * slot + 2}
                        y={150 - height}
                        width={Math.max(2, slot - 4)}
                        height={height}
                        rx={2}
                        fill={day[metric] ? "#698650" : "#dce5d1"}
                      >
                        <title>
                          {dateLabel(day.date)}: {day[metric]}{" "}
                          {selectedMetric.label.toLowerCase()}
                        </title>
                      </rect>
                    );
                  })}
                </svg>
                <div className="chart-axis">
                  <span>{dateLabel(data.startDate)}</span>
                  <span>{dateLabel(data.endDate)}</span>
                </div>
              </div>
              {!data.totals[metric] && (
                <p className="chart-empty">
                  No {selectedMetric.label.toLowerCase()} in this period yet.
                  Counts start when visitors interact with your site.
                </p>
              )}
              <details className="daily-counts">
                <summary>View daily counts</summary>
                <div
                  className="insight-table-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label="Scrollable daily activity"
                >
                  <table className="insight-table">
                    <thead>
                      <tr>
                        <th scope="col">Date (UTC)</th>
                        <th scope="col">Home views</th>
                        <th scope="col">Game views</th>
                        <th scope="col">Play starts</th>
                        <th scope="col">Downloads</th>
                        <th scope="col">Post opens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.daily.map((day) => (
                        <tr key={day.date}>
                          <th scope="row">{dateLabel(day.date)}</th>
                          <td>{day.siteViews}</td>
                          <td>{day.gameViews}</td>
                          <td>{day.playStarts}</td>
                          <td>{day.downloadClicks}</td>
                          <td>{day.postViews}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </section>
            <section className="editor-panel" aria-label="Per-game performance">
              <div className="panel-title-row">
                <h3>
                  <Play size={18} /> Every world has a story
                </h3>
                <span className="muted">Per-game performance</span>
              </div>
              <div
                className="insight-table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Scrollable game performance"
              >
                <table className="insight-table">
                  <thead>
                    <tr>
                      <th scope="col">Game</th>
                      <th scope="col">Views</th>
                      <th scope="col">Play starts</th>
                      <th scope="col">Download clicks</th>
                      <th scope="col">Rating · all time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.games.map((game) => (
                      <tr key={game.id}>
                        <th scope="row">
                          {game.visible ? (
                            <a
                              href={`/games/${game.id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {game.title}
                              <ArrowUpRight size={13} />
                            </a>
                          ) : (
                            <span>
                              {game.title}
                              <small>Hidden draft</small>
                            </span>
                          )}
                        </th>
                        <td>{number.format(game.views)}</td>
                        <td>{number.format(game.playStarts)}</td>
                        <td>{number.format(game.downloadClicks)}</td>
                        <td>
                          {game.ratingCount
                            ? `${Number(game.rating).toFixed(1)} / 5`
                            : "No ratings"}
                          <small>
                            {game.ratingCount
                              ? `${game.ratingCount} approved`
                              : ""}
                            {game.pendingReviews
                              ? ` · ${game.pendingReviews} pending`
                              : ""}
                          </small>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.games.length && (
                <p className="empty-inline">
                  Add a game to start following its story.
                </p>
              )}
            </section>
            <section className="editor-panel" aria-label="Post engagement">
              <div className="panel-title-row">
                <h3>
                  <FileText size={18} /> Stories beyond the games
                </h3>
                <span className="muted">Standard posts & updates</span>
              </div>
              <div
                className="insight-table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Scrollable post performance"
              >
                <table className="insight-table">
                  <thead>
                    <tr>
                      <th scope="col">Post</th>
                      <th scope="col">Visibility</th>
                      <th scope="col">Opens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.posts.map((post) => (
                      <tr key={post.id}>
                        <th scope="row">{post.title}</th>
                        <td>{post.visible ? "Public" : "Draft"}</td>
                        <td>{number.format(post.views)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!data.posts.length && (
                <p className="empty-inline">
                  Write a standalone post in Journal. It doesn’t need to belong
                  to a game.
                </p>
              )}
            </section>
            <div className="info-box analytics-explainer">
              <ShieldCheck size={22} />
              <div>
                <strong>Useful counts. Not a surveillance system.</strong>
                <p>
                  Views and post opens count once per browser tab, per page, per
                  UTC day. Repeated play and download clicks in the same minute
                  are deduplicated. These are engagement signals, not unique
                  people, completed play sessions, or successful file transfers.
                </p>
                <p>
                  Signed-in creator activity and browsers requesting Do Not
                  Track or Global Privacy Control are excluded. No IP addresses,
                  raw visitor identifiers, or browsing histories are saved to
                  analytics. Temporary hashed deduplication keys expire within
                  48 hours; aggregate daily counts remain. Ratings always
                  reflect approved reviews across all time, regardless of the
                  date range. Counts begin after this feature is enabled and can
                  undercount when tracking is blocked.
                </p>
              </div>
            </div>
          </>
        )
      )}
    </section>
  );
}
