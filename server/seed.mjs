export const seedSite = {
  name: "KhoifeeDev",
  tagline: "Independent games. Shared adventures.",
  heroTitle: "Small worlds.\nLasting stories.",
  heroDescription:
    "I’m Khoifee — a game developer creating little escapes, meaningful moments, and things worth playing together.",
  available: true,
  about:
    "I’m a game creator drawn to small worlds, thoughtful details, and shared adventures. This is a place to collect my experiments, share the process, and make room for what comes next. The projects below are sample concepts, ready to be replaced with my own work.",
  email: "",
  socials: { itch: "", youtube: "", instagram: "", facebook: "" },
  community: {
    name: "Gawain Game Dev Guild",
    description:
      "Good games start with good company. A community of creators learning, building, and growing together.",
    url: "",
  },
  highlight: {
    eyebrow: "ON THE WORKBENCH",
    title: "A little world to get lost in.",
    description:
      "A sample concept for a quiet, curious adventure. Replace this highlight and its project in the studio with something you’re making.",
    type: "game",
    url: "",
    videoUrl: "",
    image: "/art/greenhouse.svg",
    gameId: "little-green-world",
  },
};

export const seedGames = [
  {
    id: "little-green-world",
    title: "Little Green World",
    summary: "A small garden. A slower kind of adventure.",
    description:
      "Sample concept — not a released or playable game. Imagine tending a little greenhouse, meeting its curious visitors, and finding stories among the leaves. Replace this entry in the studio with your own project, screenshots, builds, and development notes.",
    cover: "/art/greenhouse.svg",
    genre: "Cozy exploration",
    tags: ["Sample concept", "Cozy", "Exploration"],
    status: "Sample concept",
    year: "Concept",
    featured: true,
    visible: true,
    sample: true,
    controls: [],
    versions: [],
    rating: 0,
    count: 0,
  },
  {
    id: "after-the-rain",
    title: "After the Rain",
    summary: "Find a little wonder in the spaces between storms.",
    description:
      "Sample concept — not a released or playable game. This placeholder imagines a reflective walk through a rain-washed town, where ordinary places hold small surprises. Edit or remove it in the studio when you’re ready to share your own work.",
    cover: "/art/rain.svg",
    genre: "Narrative adventure",
    tags: ["Sample concept", "Atmospheric", "Story"],
    status: "Sample concept",
    year: "Concept",
    featured: false,
    visible: true,
    sample: true,
    controls: [],
    versions: [],
    rating: 0,
    count: 0,
  },
  {
    id: "one-more-day",
    title: "One More Day",
    summary: "An ordinary day with room for something unexpected.",
    description:
      "Sample concept — not a released or playable game. A placeholder for a gentle, day-by-day adventure about noticing what matters. There are no builds or downloads yet; add your own project and versions through the studio.",
    cover: "/art/sunset.svg",
    genre: "Slice of life",
    tags: ["Sample concept", "Relaxed", "Adventure"],
    status: "Sample concept",
    year: "Concept",
    featured: false,
    visible: true,
    sample: true,
    controls: [],
    versions: [],
    rating: 0,
    count: 0,
  },
];

// Undated, unpublished drafts avoid inventing a development history.
export const seedPosts = [
  {
    id: "a-place-to-begin",
    title: "A place to begin",
    excerpt:
      "Sample journal draft: introduce what you’re making, what interests you, and what you hope to share here.",
    date: "",
    category: "Sample draft",
    url: "",
    visible: false,
  },
  {
    id: "notes-from-the-workbench",
    title: "Notes from the workbench",
    excerpt:
      "Sample journal draft: share a real experiment, a design question, or a small lesson from your process.",
    date: "",
    category: "Sample draft",
    url: "",
    visible: false,
  },
  {
    id: "making-things-together",
    title: "Making things together",
    excerpt:
      "Sample journal draft: write about the communities, conversations, and collaborations that help you create.",
    date: "",
    category: "Sample draft",
    url: "",
    visible: false,
  },
];
