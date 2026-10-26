import { readFile } from 'node:fs/promises';

export interface ResumeProfile {
    network: string;
    username?: string;
    url?: string;
}
export interface ResumeBasics {
    name: string;
    label?: string;
    image?: string;
    email?: string;
    url?: string;
    summary?: string;
    location?: {
        city?: string;
        region?: string;
        countryCode?: string;
    };
    profiles: ResumeProfile[];
}
export interface ResumeWork {
    name: string;
    position?: string;
    url?: string;
    startDate?: string;
    endDate?: string;
    summary?: string;
    highlights: string[];
    location?: string;
}
export interface ResumeEducation {
    institution: string;
    area?: string;
    studyType?: string;
    url?: string;
    startDate?: string;
    endDate?: string;
}
export interface ResumeSkill {
    name: string;
    keywords: string[];
}
export interface ResumeLanguage {
    language: string;
    fluency?: string;
}
export interface ResumeProject {
    name: string;
    description?: string;
    url?: string;
    startDate?: string;
    endDate?: string;
    highlights: string[];
    keywords: string[];
}
export interface Resume {
    basics: ResumeBasics;
    work: ResumeWork[];
    education: ResumeEducation[];
    skills: ResumeSkill[];
    languages: ResumeLanguage[];
    projects: ResumeProject[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
};

function validateDateString(value: unknown, file: string, path: string): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw new Error(`${file}: ${path} must be a string`);
    }
    // Empty strings for optional fields are treated as absent
    if (value === '') {
        return undefined;
    }
    // JSON-Resume form (YYYY, YYYY-MM or YYYY-MM-DD)
    if (/^\d{4}$/.test(value) || /^\d{4}-\d{2}$/.test(value) || /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value;
    }
    throw new Error(`${file}: ${path} "${value}" is not YYYY, YYYY-MM or YYYY-MM-DD`);
}

function validateString(value: unknown, file: string, path: string): string {
    if (typeof value !== 'string') {
        throw new Error(`${file}: ${path} must be a string`);
    }
    return value;
}

function validateOptionalString(value: unknown, file: string, path: string): string | undefined {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw new Error(`${file}: ${path} must be a string`);
    }
    if (value === '') {
        return undefined;
    }
    return value;
}

export function parseResume(raw: unknown, file: string): Resume {
    if (!isRecord(raw)) {
        throw new Error(`${file}: invalid resume`);
    }

    if (!isRecord(raw.basics)) {
        throw new Error(`${file}: basics must be an object`);
    }
    const basicsRaw = raw.basics;
    const basicsName = validateString(basicsRaw.name, file, 'basics.name');
    const basics: ResumeBasics = {
        name: basicsName,
        label: validateOptionalString(basicsRaw.label, file, 'basics.label'),
        image: validateOptionalString(basicsRaw.image, file, 'basics.image'),
        email: validateOptionalString(basicsRaw.email, file, 'basics.email'),
        url: validateOptionalString(basicsRaw.url, file, 'basics.url'),
        summary: validateOptionalString(basicsRaw.summary, file, 'basics.summary'),
        location: undefined,
        profiles: [],
    };
    if (basicsRaw.location !== undefined && basicsRaw.location !== null) {
        if (!isRecord(basicsRaw.location)) {
            throw new Error(`${file}: basics.location must be an object`);
        }
        const loc = basicsRaw.location;
        basics.location = {
            city: validateOptionalString(loc.city, file, 'basics.location.city'),
            region: validateOptionalString(loc.region, file, 'basics.location.region'),
            countryCode: validateOptionalString(loc.countryCode, file, 'basics.location.countryCode'),
        };
    }
    if (basicsRaw.profiles !== undefined && basicsRaw.profiles !== null) {
        if (!Array.isArray(basicsRaw.profiles)) {
            throw new Error(`${file}: basics.profiles must be an array`);
        }
        for (let i = 0; i < basicsRaw.profiles.length; i++) {
            const p = basicsRaw.profiles[i];
            if (!isRecord(p)) {
                throw new Error(`${file}: basics.profiles[${i}] must be an object`);
            }
            if (typeof p.network !== 'string') {
                throw new Error(`${file}: basics.profiles[${i}].network must be a string`);
            }
            basics.profiles.push({
                network: p.network,
                username: validateOptionalString(p.username, file, `basics.profiles[${i}].username`),
                url: validateOptionalString(p.url, file, `basics.profiles[${i}].url`),
            });
        }
    } else {
        basics.profiles = [];
    }

    const work: ResumeWork[] = [];
    if (raw.work !== undefined && raw.work !== null) {
        if (!Array.isArray(raw.work)) {
            throw new Error(`${file}: work must be an array`);
        }
        for (let i = 0; i < raw.work.length; i++) {
            const w = raw.work[i];
            if (!isRecord(w)) {
                throw new Error(`${file}: work[${i}] must be an object`);
            }
            if (typeof w.name !== 'string') {
                throw new Error(`${file}: work[${i}].name must be a string`);
            }
            const highlights: string[] = [];
            if (w.highlights !== undefined && w.highlights !== null) {
                if (!Array.isArray(w.highlights)) {
                    throw new Error(`${file}: work[${i}].highlights must be an array`);
                }
                for (const h of w.highlights) {
                    if (typeof h !== 'string') {
                        throw new Error(`${file}: work[${i}].highlights must contain strings`);
                    }
                    highlights.push(h);
                }
            }
            work.push({
                name: w.name,
                position: validateOptionalString(w.position, file, `work[${i}].position`),
                url: validateOptionalString(w.url, file, `work[${i}].url`),
                startDate: validateDateString(w.startDate, file, `work[${i}].startDate`),
                endDate: validateDateString(w.endDate, file, `work[${i}].endDate`),
                summary: validateOptionalString(w.summary, file, `work[${i}].summary`),
                highlights,
                location: validateOptionalString(w.location, file, `work[${i}].location`),
            });
        }
    }

    const education: ResumeEducation[] = [];
    if (raw.education !== undefined && raw.education !== null) {
        if (!Array.isArray(raw.education)) {
            throw new Error(`${file}: education must be an array`);
        }
        for (let i = 0; i < raw.education.length; i++) {
            const e = raw.education[i];
            if (!isRecord(e)) {
                throw new Error(`${file}: education[${i}] must be an object`);
            }
            if (typeof e.institution !== 'string') {
                throw new Error(`${file}: education[${i}].institution must be a string`);
            }
            education.push({
                institution: e.institution,
                area: validateOptionalString(e.area, file, `education[${i}].area`),
                studyType: validateOptionalString(e.studyType, file, `education[${i}].studyType`),
                url: validateOptionalString(e.url, file, `education[${i}].url`),
                startDate: validateDateString(e.startDate, file, `education[${i}].startDate`),
                endDate: validateDateString(e.endDate, file, `education[${i}].endDate`),
            });
        }
    }

    const skills: ResumeSkill[] = [];
    if (raw.skills !== undefined && raw.skills !== null) {
        if (!Array.isArray(raw.skills)) {
            throw new Error(`${file}: skills must be an array`);
        }
        for (let i = 0; i < raw.skills.length; i++) {
            const s = raw.skills[i];
            if (!isRecord(s)) {
                throw new Error(`${file}: skills[${i}] must be an object`);
            }
            if (typeof s.name !== 'string') {
                throw new Error(`${file}: skills[${i}].name must be a string`);
            }
            const keywords: string[] = [];
            if (s.keywords !== undefined && s.keywords !== null) {
                if (!Array.isArray(s.keywords)) {
                    throw new Error(`${file}: skills[${i}].keywords must be an array`);
                }
                for (const k of s.keywords) {
                    if (typeof k !== 'string') {
                        throw new Error(`${file}: skills[${i}].keywords must contain strings`);
                    }
                    keywords.push(k);
                }
            }
            skills.push({
                name: s.name,
                keywords,
            });
        }
    }

    const languages: ResumeLanguage[] = [];
    if (raw.languages !== undefined && raw.languages !== null) {
        if (!Array.isArray(raw.languages)) {
            throw new Error(`${file}: languages must be an array`);
        }
        for (let i = 0; i < raw.languages.length; i++) {
            const l = raw.languages[i];
            if (!isRecord(l)) {
                throw new Error(`${file}: languages[${i}] must be an object`);
            }
            if (typeof l.language !== 'string') {
                throw new Error(`${file}: languages[${i}].language must be a string`);
            }
            languages.push({
                language: l.language,
                fluency: validateOptionalString(l.fluency, file, `languages[${i}].fluency`),
            });
        }
    }

    const projects: ResumeProject[] = [];
    if (raw.projects !== undefined && raw.projects !== null) {
        if (!Array.isArray(raw.projects)) {
            throw new Error(`${file}: projects must be an array`);
        }
        for (let i = 0; i < raw.projects.length; i++) {
            const pr = raw.projects[i];
            if (!isRecord(pr)) {
                throw new Error(`${file}: projects[${i}] must be an object`);
            }
            if (typeof pr.name !== 'string') {
                throw new Error(`${file}: projects[${i}].name must be a string`);
            }
            const highlights: string[] = [];
            if (pr.highlights !== undefined && pr.highlights !== null) {
                if (!Array.isArray(pr.highlights)) {
                    throw new Error(`${file}: projects[${i}].highlights must be an array`);
                }
                for (const h of pr.highlights) {
                    if (typeof h !== 'string') {
                        throw new Error(`${file}: projects[${i}].highlights must contain strings`);
                    }
                    highlights.push(h);
                }
            }
            const keywords: string[] = [];
            if (pr.keywords !== undefined && pr.keywords !== null) {
                if (!Array.isArray(pr.keywords)) {
                    throw new Error(`${file}: projects[${i}].keywords must be an array`);
                }
                for (const k of pr.keywords) {
                    if (typeof k !== 'string') {
                        throw new Error(`${file}: projects[${i}].keywords must contain strings`);
                    }
                    keywords.push(k);
                }
            }
            projects.push({
                name: pr.name,
                description: validateOptionalString(pr.description, file, `projects[${i}].description`),
                url: validateOptionalString(pr.url, file, `projects[${i}].url`),
                startDate: validateDateString(pr.startDate, file, `projects[${i}].startDate`),
                endDate: validateDateString(pr.endDate, file, `projects[${i}].endDate`),
                highlights,
                keywords,
            });
        }
    }

    return {
        basics,
        work,
        education,
        skills,
        languages,
        projects,
    };
}

export async function loadResume(path: string): Promise<Resume> {
    try {
        const content = await readFile(path, 'utf-8');
        let raw: unknown;
        try {
            raw = JSON.parse(content);
        } catch (e) {
            throw new Error(`${path}: ${String(e)}`);
        }
        return parseResume(raw, path);
    } catch (e) {
        if (e instanceof Error) {
            throw e;
        }
        throw new Error(`${path}: ${String(e)}`);
    }
}
