// SPDX-License-Identifier: MIT
// A purpose-built libintl for the Android GI payload: reads GNU .mo catalogs and
// exports the g_libintl_* symbols GLib's meson build links against (the same surface
// proxy-libintl stubs, which never reads a file — so every dgettext answered its msgid).
//
// WHAT IT DOES: .mo revision 0/1 in either byte order, binary search over the sorted
// original table, msgctxt ("ctx\004msgid"), plural entries with the Plural-Forms
// expression evaluated by a small C-subset interpreter, per-language fallback
// (ll_CC@mod → ll_CC → ll@mod → ll), catalogs mmap'd once and kept for the process.
//
// WHAT IT DELIBERATELY DOES DIFFERENTLY FROM GNU libintl:
//   * The language comes from the ENVIRONMENT ONLY — `LANGUAGE`, else LC_ALL,
//     LC_MESSAGES, LANG — and `setlocale()` is never consulted. Bionic's setlocale
//     accepts only "C" and "C.UTF-8", and GNU libintl answers the msgid for a "C"
//     locale whatever LANGUAGE says; on Android that made translation unreachable.
//     The host sets LANGUAGE from the platform locale (host.nativescript.js) and
//     re-sets it on a per-app locale change; this file re-reads the variable on
//     every lookup, so no cache has to be invalidated.
//   * Catalogs are assumed UTF-8 (gettext's de-facto charset). bind_textdomain_codeset
//     records the name and converts nothing: bionic has no iconv.
//   * The `category` argument is ignored; every lookup is a message lookup.

#include <pthread.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

#define EXPORT __attribute__((visibility("default")))

#define DEFAULT_DOMAIN "messages"
#define DEFAULT_DIR "/usr/share/locale"
#define MO_MAGIC 0x950412deU

// ---- the Plural-Forms expression --------------------------------------------------

enum { E_NUM, E_VAR, E_COND, E_OR, E_AND, E_EQ, E_NE, E_LT, E_GT, E_LE, E_GE,
       E_ADD, E_SUB, E_MUL, E_DIV, E_MOD, E_NOT };

typedef struct Expr {
    int op;
    unsigned long val;
    struct Expr *a, *b, *c;
} Expr;

typedef struct { const char *p; int ok; } Parser;

static Expr *parse_cond(Parser *s);

static void skip_ws(Parser *s) {
    while (*s->p == ' ' || *s->p == '\t') s->p++;
}

static Expr *node(int op, Expr *a, Expr *b, Expr *c) {
    Expr *e = calloc(1, sizeof *e);
    if (e == NULL) return NULL;
    e->op = op;
    e->a = a;
    e->b = b;
    e->c = c;
    return e;
}

static void expr_free(Expr *e) {
    if (e == NULL) return;
    expr_free(e->a);
    expr_free(e->b);
    expr_free(e->c);
    free(e);
}

static Expr *parse_primary(Parser *s) {
    skip_ws(s);
    if (*s->p == '(') {
        s->p++;
        Expr *e = parse_cond(s);
        skip_ws(s);
        if (*s->p != ')') { s->ok = 0; return e; }
        s->p++;
        return e;
    }
    if (*s->p == 'n') {
        s->p++;
        return node(E_VAR, NULL, NULL, NULL);
    }
    if (*s->p >= '0' && *s->p <= '9') {
        char *end;
        Expr *e = node(E_NUM, NULL, NULL, NULL);
        if (e != NULL) e->val = strtoul(s->p, &end, 10); else end = (char *)s->p + 1;
        s->p = end;
        return e;
    }
    s->ok = 0;
    return NULL;
}

static Expr *parse_unary(Parser *s) {
    skip_ws(s);
    if (*s->p == '!' && s->p[1] != '=') {
        s->p++;
        return node(E_NOT, parse_unary(s), NULL, NULL);
    }
    return parse_primary(s);
}

// One level of left-associative binary operators. `ops` lists "token:op" pairs, longest
// token first so "<=" is tried before "<".
typedef struct { const char *tok; int op; } BinOp;

static Expr *parse_level(Parser *s, int level);

static const BinOp LEVEL_OPS[][4] = {
    { {"||", E_OR} },
    { {"&&", E_AND} },
    { {"==", E_EQ}, {"!=", E_NE} },
    { {"<=", E_LE}, {">=", E_GE}, {"<", E_LT}, {">", E_GT} },
    { {"+", E_ADD}, {"-", E_SUB} },
    { {"*", E_MUL}, {"/", E_DIV}, {"%", E_MOD} },
};
#define LEVELS ((int)(sizeof LEVEL_OPS / sizeof LEVEL_OPS[0]))

static Expr *parse_level(Parser *s, int level) {
    if (level == LEVELS) return parse_unary(s);
    Expr *left = parse_level(s, level + 1);
    for (;;) {
        skip_ws(s);
        const BinOp *hit = NULL;
        for (int i = 0; i < 4 && LEVEL_OPS[level][i].tok != NULL; i++) {
            size_t n = strlen(LEVEL_OPS[level][i].tok);
            if (strncmp(s->p, LEVEL_OPS[level][i].tok, n) == 0) { hit = &LEVEL_OPS[level][i]; break; }
        }
        if (hit == NULL) return left;
        s->p += strlen(hit->tok);
        left = node(hit->op, left, parse_level(s, level + 1), NULL);
    }
}

static Expr *parse_cond(Parser *s) {
    Expr *c = parse_level(s, 0);
    skip_ws(s);
    if (*s->p != '?') return c;
    s->p++;
    Expr *a = parse_cond(s);
    skip_ws(s);
    if (*s->p != ':') { s->ok = 0; return c; }
    s->p++;
    Expr *b = parse_cond(s);
    return node(E_COND, c, a, b);
}

static unsigned long expr_eval(const Expr *e, unsigned long n) {
    if (e == NULL) return 0;
    switch (e->op) {
        case E_NUM: return e->val;
        case E_VAR: return n;
        case E_COND: return expr_eval(e->a, n) ? expr_eval(e->b, n) : expr_eval(e->c, n);
        case E_OR: return expr_eval(e->a, n) || expr_eval(e->b, n);
        case E_AND: return expr_eval(e->a, n) && expr_eval(e->b, n);
        case E_EQ: return expr_eval(e->a, n) == expr_eval(e->b, n);
        case E_NE: return expr_eval(e->a, n) != expr_eval(e->b, n);
        case E_LT: return expr_eval(e->a, n) < expr_eval(e->b, n);
        case E_GT: return expr_eval(e->a, n) > expr_eval(e->b, n);
        case E_LE: return expr_eval(e->a, n) <= expr_eval(e->b, n);
        case E_GE: return expr_eval(e->a, n) >= expr_eval(e->b, n);
        case E_ADD: return expr_eval(e->a, n) + expr_eval(e->b, n);
        case E_SUB: return expr_eval(e->a, n) - expr_eval(e->b, n);
        case E_MUL: return expr_eval(e->a, n) * expr_eval(e->b, n);
        case E_DIV: { unsigned long d = expr_eval(e->b, n); return d ? expr_eval(e->a, n) / d : 0; }
        case E_MOD: { unsigned long d = expr_eval(e->b, n); return d ? expr_eval(e->a, n) % d : 0; }
        case E_NOT: return !expr_eval(e->a, n);
    }
    return 0;
}

// ---- catalogs ----------------------------------------------------------------------

typedef struct Catalog {
    struct Catalog *next;
    char *path;
    unsigned gen;  // bind generation a MISS was recorded under; unused for a hit
    const uint8_t *data;
    size_t size;
    int swap;
    uint32_t count, orig_off, trans_off;
    unsigned long nplurals;
    Expr *plural;  // NULL: the Germanic default, n != 1
} Catalog;

static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static Catalog *catalogs;
static unsigned bind_gen = 1;

static uint32_t rd32(const Catalog *c, uint32_t off) {
    uint32_t v;
    memcpy(&v, c->data + off, 4);
    return c->swap ? __builtin_bswap32(v) : v;
}

// Entry `i` of the table at `table_off`: its string and length, or NULL if the table
// points outside the file or the string is not NUL-terminated there.
static const char *mo_entry(const Catalog *c, uint32_t table_off, uint32_t i, uint32_t *len) {
    uint32_t off = table_off + 8 * i;
    uint32_t l = rd32(c, off), s = rd32(c, off + 4);
    if ((uint64_t)s + l + 1 > c->size || c->data[s + l] != 0) return NULL;
    *len = l;
    return (const char *)c->data + s;
}

// Binary search over the original-strings table. strcmp stops at the NUL that separates
// msgid from msgid_plural, so a plural entry is found by its singular alone.
static const char *mo_find(const Catalog *c, const char *key, uint32_t *tlen) {
    uint32_t lo = 0, hi = c->count;
    while (lo < hi) {
        uint32_t mid = lo + (hi - lo) / 2, olen;
        const char *orig = mo_entry(c, c->orig_off, mid, &olen);
        if (orig == NULL) return NULL;
        int cmp = strcmp(key, orig);
        if (cmp == 0) return mo_entry(c, c->trans_off, mid, tlen);
        if (cmp < 0) hi = mid; else lo = mid + 1;
    }
    return NULL;
}

static void parse_header(Catalog *c) {
    c->nplurals = 2;
    uint32_t len;
    const char *h = mo_find(c, "", &len);
    if (h == NULL) return;
    const char *np = strstr(h, "nplurals=");
    if (np != NULL) {
        unsigned long v = strtoul(np + 9, NULL, 10);
        if (v >= 1 && v <= 16) c->nplurals = v;
    }
    const char *pl = strstr(h, "plural=");
    if (pl != NULL) {
        Parser s = { pl + 7, 1 };
        Expr *e = parse_cond(&s);
        if (s.ok && e != NULL) c->plural = e; else expr_free(e);
    }
}

static Catalog *catalog_open(const char *path) {
    Catalog *c = calloc(1, sizeof *c);
    if (c == NULL) return NULL;
    c->path = strdup(path);
    c->gen = bind_gen;
    int fd = open(path, O_RDONLY | O_CLOEXEC);
    if (fd < 0) return c;
    struct stat st;
    if (fstat(fd, &st) == 0 && st.st_size >= 28) {
        void *m = mmap(NULL, (size_t)st.st_size, PROT_READ, MAP_PRIVATE, fd, 0);
        if (m != MAP_FAILED) {
            c->data = m;
            c->size = (size_t)st.st_size;
            uint32_t magic;
            memcpy(&magic, c->data, 4);
            if (magic == MO_MAGIC) c->swap = 0;
            else if (magic == __builtin_bswap32(MO_MAGIC)) c->swap = 1;
            else c->data = NULL;
        }
    }
    close(fd);
    if (c->data != NULL) {
        uint32_t rev = rd32(c, 4);
        c->count = rd32(c, 8);
        c->orig_off = rd32(c, 12);
        c->trans_off = rd32(c, 16);
        uint64_t end = (uint64_t)(c->orig_off > c->trans_off ? c->orig_off : c->trans_off) + 8ULL * c->count;
        if ((rev >> 16) > 1 || end > c->size) {
            munmap((void *)c->data, c->size);
            c->data = NULL;
        } else {
            parse_header(c);
        }
    }
    return c;
}

// A hit is permanent; a miss is remembered only until the next bindtextdomain, because
// a catalog extracted after the first lookup must not stay invisible.
static Catalog *catalog_get(const char *path) {
    for (Catalog *c = catalogs; c != NULL; c = c->next) {
        if (strcmp(c->path, path) != 0) continue;
        if (c->data != NULL || c->gen == bind_gen) return c->data != NULL ? c : NULL;
        Catalog *fresh = catalog_open(path);
        if (fresh == NULL) return NULL;
        if (fresh->data == NULL) { c->gen = bind_gen; free(fresh->path); free(fresh); return NULL; }
        fresh->next = catalogs;  // the stale miss stays in the list, shadowed by the hit
        catalogs = fresh;
        return fresh;
    }
    Catalog *c = catalog_open(path);
    if (c == NULL) return NULL;
    c->next = catalogs;
    catalogs = c;
    return c->data != NULL ? c : NULL;
}

// ---- domain bindings ---------------------------------------------------------------

typedef struct Binding {
    struct Binding *next;
    char *domain, *dir, *codeset;
} Binding;

static Binding *bindings;
static char *current_domain;  // NULL: DEFAULT_DOMAIN

static Binding *binding_get(const char *domain, int create) {
    for (Binding *b = bindings; b != NULL; b = b->next)
        if (strcmp(b->domain, domain) == 0) return b;
    if (!create) return NULL;
    Binding *b = calloc(1, sizeof *b);
    if (b == NULL) return NULL;
    b->domain = strdup(domain);
    b->next = bindings;
    bindings = b;
    return b;
}

// ---- language resolution -----------------------------------------------------------

static const char *first_set(const char *const *names) {
    for (; *names != NULL; names++) {
        const char *v = getenv(*names);
        if (v != NULL && v[0] != '\0') return v;
    }
    return NULL;
}

// The colon-separated language list: LANGUAGE wins outright (even over a C locale, the
// point of this file), else the first of LC_ALL, LC_MESSAGES, LANG.
static const char *language_list(void) {
    static const char *const lang[] = { "LANGUAGE", NULL };
    static const char *const loc[] = { "LC_ALL", "LC_MESSAGES", "LANG", NULL };
    const char *v = first_set(lang);
    return v != NULL ? v : first_set(loc);
}

// Expand one entry ("de_DE.UTF-8@euro", "de-DE") into directory names, most specific
// first. Returns the count; `out` holds up to 4 malloc'd strings.
static int expand_language(const char *entry, size_t n, char *out[4]) {
    char buf[128];
    if (n == 0 || n >= sizeof buf) return 0;
    for (size_t i = 0; i < n; i++) buf[i] = entry[i] == '-' ? '_' : entry[i];
    buf[n] = '\0';
    char *mod = strchr(buf, '@');
    char modbuf[64] = "";
    if (mod != NULL) { snprintf(modbuf, sizeof modbuf, "%s", mod); *mod = '\0'; }
    char *cs = strchr(buf, '.');
    if (cs != NULL) *cs = '\0';
    char *terr = strchr(buf, '_');
    char lang[64];
    snprintf(lang, sizeof lang, "%.*s", terr != NULL ? (int)(terr - buf) : (int)strlen(buf), buf);

    char cand[4][192];
    int k = 0;
    if (terr != NULL) {
        if (modbuf[0]) snprintf(cand[k++], sizeof cand[0], "%s%s", buf, modbuf);
        snprintf(cand[k++], sizeof cand[0], "%s", buf);
    }
    if (modbuf[0]) snprintf(cand[k++], sizeof cand[0], "%s%s", lang, modbuf);
    snprintf(cand[k++], sizeof cand[0], "%s", lang);
    for (int i = 0; i < k; i++) out[i] = strdup(cand[i]);
    return k;
}

// ---- lookup -------------------------------------------------------------------------

// Returns the translation of `msgid` (selecting plural form `n` when `plural`), or NULL.
static const char *lookup(const char *domain, const char *msgid, int plural, unsigned long n) {
    const char *list = language_list();
    if (list == NULL || msgid == NULL) return NULL;

    pthread_mutex_lock(&lock);
    if (domain == NULL) domain = current_domain != NULL ? current_domain : DEFAULT_DOMAIN;
    Binding *b = binding_get(domain, 0);
    const char *dir = b != NULL && b->dir != NULL ? b->dir : DEFAULT_DIR;
    const char *result = NULL;

    for (const char *p = list; *p != '\0' && result == NULL;) {
        size_t len = strcspn(p, ":");
        if ((len == 1 && p[0] == 'C') || (len == 5 && strncmp(p, "POSIX", 5) == 0)) break;
        char *dirs[4];
        int count = expand_language(p, len, dirs);
        for (int i = 0; i < count; i++) {
            if (result == NULL) {
                char path[1024];
                snprintf(path, sizeof path, "%s/%s/LC_MESSAGES/%s.mo", dir, dirs[i], domain);
                Catalog *c = catalog_get(path);
                uint32_t tlen;
                const char *t = c != NULL ? mo_find(c, msgid, &tlen) : NULL;
                if (t != NULL) {
                    unsigned long idx = 0;
                    if (plural) {
                        idx = c->plural != NULL ? expr_eval(c->plural, n) : (n != 1);
                        if (idx >= c->nplurals) idx = 0;
                    }
                    const char *end = t + tlen;
                    while (idx > 0 && t < end) { t += strlen(t) + 1; idx--; }
                    if (t < end && t[0] != '\0') result = t;
                }
            }
            free(dirs[i]);
        }
        p += len;
        if (*p == ':') p++;
    }
    pthread_mutex_unlock(&lock);
    return result;
}

// ---- the exported surface -----------------------------------------------------------

EXPORT char *g_libintl_dcgettext(const char *domain, const char *msgid, int category) {
    (void)category;
    const char *t = lookup(domain, msgid, 0, 0);
    return (char *)(t != NULL ? t : msgid);
}

EXPORT char *g_libintl_dgettext(const char *domain, const char *msgid) {
    return g_libintl_dcgettext(domain, msgid, 0);
}

EXPORT char *g_libintl_gettext(const char *msgid) {
    return g_libintl_dcgettext(NULL, msgid, 0);
}

EXPORT char *g_libintl_dcngettext(const char *domain, const char *msgid1, const char *msgid2,
                                  unsigned long n, int category) {
    (void)category;
    const char *t = lookup(domain, msgid1, 1, n);
    if (t != NULL) return (char *)t;
    return (char *)(n == 1 ? msgid1 : msgid2);
}

EXPORT char *g_libintl_dngettext(const char *domain, const char *msgid1, const char *msgid2,
                                 unsigned long n) {
    return g_libintl_dcngettext(domain, msgid1, msgid2, n, 0);
}

EXPORT char *g_libintl_ngettext(const char *msgid1, const char *msgid2, unsigned long n) {
    return g_libintl_dcngettext(NULL, msgid1, msgid2, n, 0);
}

EXPORT char *g_libintl_textdomain(const char *domain) {
    pthread_mutex_lock(&lock);
    if (domain != NULL) {
        // The previous string is leaked on purpose: earlier callers hold the pointer.
        current_domain = strdup(domain[0] != '\0' ? domain : DEFAULT_DOMAIN);
    }
    char *r = current_domain != NULL ? current_domain : (char *)DEFAULT_DOMAIN;
    pthread_mutex_unlock(&lock);
    return r;
}

EXPORT char *g_libintl_bindtextdomain(const char *domain, const char *dir) {
    if (domain == NULL || domain[0] == '\0') return NULL;
    pthread_mutex_lock(&lock);
    Binding *b = binding_get(domain, dir != NULL);
    char *r = (char *)DEFAULT_DIR;
    if (dir != NULL && b != NULL) {
        b->dir = strdup(dir);  // the previous string is leaked, as above
        bind_gen++;
    }
    if (b != NULL && b->dir != NULL) r = b->dir;
    pthread_mutex_unlock(&lock);
    return r;
}

EXPORT char *g_libintl_bind_textdomain_codeset(const char *domain, const char *codeset) {
    if (domain == NULL || domain[0] == '\0') return NULL;
    pthread_mutex_lock(&lock);
    Binding *b = binding_get(domain, codeset != NULL);
    if (codeset != NULL && b != NULL) b->codeset = strdup(codeset);
    char *r = b != NULL ? b->codeset : NULL;
    pthread_mutex_unlock(&lock);
    return r;
}

// proxy-libintl's teardown hook; GLib's atexit path may still resolve it by name.
EXPORT void _proxy_libintl_deinit(void) {}
