// Sample blog posts — in-memory data for the Express webserver showcase.

export interface Post {
    id: number;
    slug: string;
    title: string;
    author: string;
    date: string;
    excerpt: string;
    content: string;
}

export const posts: Post[] = [
    {
        id: 1,
        slug: 'hello-gjs',
        title: 'Hello, GJS!',
        author: 'Pascal',
        date: '2026-04-01',
        excerpt: 'Running Express.js natively on Linux via GJS — no Node.js required.',
        content: `This blog is served by a real Express.js application — the same code you would
write for Node.js. The difference: it's running inside GJS, the GNOME JavaScript
runtime, backed by GLib, Gio and Soup. No Node binary, no V8 — just SpiderMonkey
and native Linux libraries.

With \`@gjsify/node-globals\` and the \`@gjsify/*\` package set, the full Node.js
API surface is available: \`fs\`, \`net\`, \`http\`, \`crypto\`, \`stream\`, \`events\`,
and many more. That means your existing npm ecosystem works out of the box.`,
    },
    {
        id: 2,
        slug: 'why-gjsify',
        title: 'Why GJSify?',
        author: 'Pascal',
        date: '2026-04-03',
        excerpt: 'Bringing the full TypeScript ecosystem to the GNOME JavaScript runtime.',
        content: `GJS is fantastic for writing GNOME applications, but historically you had to
choose between the GObject world and the rich npm ecosystem. GJSify bridges
that gap by implementing the Node.js and Web APIs on top of native GNOME
libraries — so a package like Express, Koa or Hono Just Works, and you can
still reach into GTK, Cairo or WebKit whenever you need to.

The trade-off is no longer "Node.js or GNOME" — you can have both in the
same application.`,
    },
    {
        id: 3,
        slug: 'express-on-soup',
        title: 'Express on Soup 3.0',
        author: 'Pascal',
        date: '2026-04-05',
        excerpt: 'How Express listens on a port when there is no V8 event loop.',
        content: `The magic trick is \`@gjsify/http\`: it implements Node's \`http\` module on top
of \`Soup.Server\`. When Express calls \`app.listen(3000)\`, GJSify starts a
GLib MainLoop under the hood and wires Soup's request signals into Node-style
\`IncomingMessage\` / \`ServerResponse\` objects.

The result: Express middleware, routing, template engines and the rest of the
ecosystem simply work — on the GNOME stack.`,
    },
];
