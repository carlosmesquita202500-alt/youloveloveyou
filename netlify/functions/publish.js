export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const branch = process.env.GITHUB_BRANCH || "main";

  if (!token || !owner || !repo) {
    return new Response(
      JSON.stringify({ error: "Missing env vars" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  const body = await req.json().catch(() => null);
  const files = body?.files;
  const message = body?.message || `publish (${new Date().toISOString()})`;

  if (!Array.isArray(files) || files.length === 0) {
    return new Response(JSON.stringify({ error: "files[] required" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const apiBase = `https://api.github.com/repos/${owner}/${repo}/contents/`;

  async function getSha(path) {
    const res = await fetch(
      apiBase + encodeURIComponent(path).replaceAll("%2F", "/") + `?ref=${branch}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          Accept: "application/vnd.github+json",
        },
      }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET sha failed for ${path}: ${res.status}`);
    const j = await res.json();
    return j.sha || null;
  }

  async function putFile({ path, content_base64 }) {
    const sha = await getSha(path);

    const payload = {
      message,
      content: content_base64,
      branch,
      ...(sha ? { sha } : {}),
    };

    const res = await fetch(
      apiBase + encodeURIComponent(path).replaceAll("%2F", "/"),
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          Accept: "application/vnd.github+json",
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      }
    );

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`PUT failed for ${path}: ${res.status} ${txt}`);
    }
  }

  try {
    for (const f of files) {
      if (!f?.path || !f?.content_base64) throw new Error("Invalid file entry");
      await putFile(f);
    }

    return new Response(
      JSON.stringify({ ok: true, pushed: files.map((f) => f.path) }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
};
