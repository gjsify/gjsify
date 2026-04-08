// Client-side script that fetches posts + runtime info from the Express API.
// Uses safe DOM APIs (textContent / createElement) — no innerHTML.

async function loadRuntime() {
    const el = document.getElementById('runtime');
    if (!el) return;
    try {
        const res = await fetch('/api/runtime');
        const data = await res.json();
        el.textContent = `Running on ${data.runtime}`;
    } catch {
        el.textContent = 'Runtime unknown';
    }
}

function createPostElement(post) {
    const article = document.createElement('article');
    article.className = 'post';

    const h2 = document.createElement('h2');
    const link = document.createElement('a');
    link.href = `/posts/${encodeURIComponent(post.slug)}`;
    link.textContent = post.title;
    h2.appendChild(link);
    article.appendChild(h2);

    const meta = document.createElement('p');
    meta.className = 'meta';
    const author = document.createElement('span');
    author.className = 'author';
    author.textContent = post.author;
    const date = document.createElement('span');
    date.className = 'date';
    date.textContent = post.date;
    meta.append(author, date);
    article.appendChild(meta);

    const excerpt = document.createElement('p');
    excerpt.className = 'excerpt';
    excerpt.textContent = post.excerpt;
    article.appendChild(excerpt);

    return article;
}

async function loadPosts() {
    const container = document.getElementById('posts');
    if (!container) return;
    try {
        const res = await fetch('/api/posts');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const posts = data.posts || [];
        container.replaceChildren();
        if (posts.length === 0) {
            const empty = document.createElement('p');
            empty.className = 'loading';
            empty.textContent = 'No posts yet.';
            container.appendChild(empty);
            return;
        }
        for (const post of posts) {
            container.appendChild(createPostElement(post));
        }
    } catch (err) {
        container.replaceChildren();
        const msg = document.createElement('p');
        msg.className = 'loading';
        msg.textContent = `Failed to load posts: ${err.message}`;
        container.appendChild(msg);
    }
}

loadRuntime();
loadPosts();
