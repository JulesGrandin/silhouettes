const TERRITORIES = new Set(["world", "france", "us"]);
const LENGTHS = new Set([5, 10]);
const PACES = new Set([15000]);
const DIFFICULTIES = new Set(["easy", "hard", "hyper"]);
const ROUND_CENTIS = 1500;
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} '\u2019.-]{0,18}[\p{L}\p{N}.]$/u;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });
}

function nameKey(name) {
  return name.normalize("NFKC").replace(/\s+/g, " ").trim().toLocaleLowerCase("fr");
}

function readMode(source) {
  const territory = source.territory;
  const length = Number(source.length);
  const pace = Number(source.pace);
  const difficulty = source.difficulty;
  if (!TERRITORIES.has(territory) || !LENGTHS.has(length) || !PACES.has(pace) || !DIFFICULTIES.has(difficulty)) {
    return null;
  }
  return { territory, length, pace, difficulty };
}

function maxScore(mode) {
  const wrongs = mode.difficulty === "easy" ? 3 : 0;
  return mode.length * ROUND_CENTIS * (1 + wrongs);
}

function cleanName(value) {
  const name = String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!NAME.test(name)) return null;
  return name;
}

async function standings(db, mode, youKey) {
  const rows = await db.prepare(
    `SELECT name, name_key, score
     FROM scores
     WHERE territory = ? AND length = ? AND pace = ? AND difficulty = ?
     ORDER BY score ASC, updated_at ASC, name_key ASC`
  ).bind(mode.territory, mode.length, mode.pace, mode.difficulty).all();
  const entries = (rows.results || []).map((row, index) => ({
    rank: index + 1,
    name: row.name,
    score: row.score,
    yours: youKey != null && row.name_key === youKey,
  }));
  const yours = entries.find((entry) => entry.yours) || null;
  let visible = entries.slice(0, 15);
  if (yours && !visible.some((entry) => entry.yours)) visible = visible.concat(yours);
  return {
    total: entries.length,
    rank: yours ? yours.rank : null,
    best: yours ? yours.score : null,
    entries: visible,
  };
}

async function saveScore(db, mode, name, score) {
  const key = nameKey(name);
  const existing = await db.prepare(
    `SELECT score FROM scores
     WHERE name_key = ? AND territory = ? AND length = ? AND pace = ? AND difficulty = ?`
  ).bind(key, mode.territory, mode.length, mode.pace, mode.difficulty).first();

  let status = "created";
  if (!existing) {
    await db.prepare(
      `INSERT INTO scores (name, name_key, score, territory, length, pace, difficulty)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(name, key, score, mode.territory, mode.length, mode.pace, mode.difficulty).run();
  } else if (score < existing.score) {
    await db.prepare(
      `UPDATE scores
       SET name = ?, score = ?, updated_at = datetime('now')
       WHERE name_key = ? AND territory = ? AND length = ? AND pace = ? AND difficulty = ?`
    ).bind(name, score, key, mode.territory, mode.length, mode.pace, mode.difficulty).run();
    status = "improved";
  } else {
    status = "kept";
  }

  const board = await standings(db, mode, key);
  return { status, ...board };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "content-type",
          "access-control-max-age": "86400",
        },
      });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/scores") return json({ error: "introuvable" }, 404);

    if (request.method === "GET") {
      const mode = readMode({
        territory: url.searchParams.get("territory"),
        length: url.searchParams.get("length"),
        pace: url.searchParams.get("pace"),
        difficulty: url.searchParams.get("difficulty"),
      });
      if (!mode) return json({ error: "mode" }, 400);
      const name = cleanName(url.searchParams.get("name") || "");
      const board = await standings(env.DB, mode, name ? nameKey(name) : null);
      return json(board);
    }

    if (request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "score" }, 400);
      }
      const mode = readMode(body);
      const name = cleanName(body.name);
      const score = Number(body.score);
      if (!mode) return json({ error: "mode" }, 400);
      if (!name) return json({ error: "pseudo" }, 400);
      if (!Number.isInteger(score) || score < 0 || score > maxScore(mode)) return json({ error: "score" }, 400);
      const board = await saveScore(env.DB, mode, name, score);
      return json(board);
    }

    return json({ error: "introuvable" }, 404);
  },
};
