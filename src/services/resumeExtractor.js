/**
 * @file src/services/resumeExtractor.js
 * @description Client-side and server-compatible Resume Document Extractor & Attachment Utility.
 * Supports PDF, DOCX, and TXT parsing, memory schema extraction, and DataTransfer file injection.
 */

/**
 * Converts a File or Blob into a Base64 Data URL.
 * @param {Blob|File} file 
 * @returns {Promise<string>}
 */
function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
        if (typeof FileReader !== 'undefined') {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Failed to read file as Data URL'));
            reader.readAsDataURL(file);
        } else if (file && typeof file.arrayBuffer === 'function') {
            file.arrayBuffer().then(buf => {
                const b64 = Buffer.from(buf).toString('base64');
                const mime = file.type || 'application/octet-stream';
                resolve(`data:${mime};base64,${b64}`);
            }).catch(reject);
        } else {
            reject(new Error('FileReader and arrayBuffer not available'));
        }
    });
}

/**
 * Creates a standard File object from a Base64 Data URL.
 * @param {string} dataUrl 
 * @param {string} [fileName='Resume.pdf'] 
 * @param {string} [mimeType='application/pdf'] 
 * @returns {File}
 */
function createFileFromDataUrl(dataUrl, fileName = 'Resume.pdf', mimeType = 'application/pdf') {
    if (!dataUrl || typeof dataUrl !== 'string') {
        throw new Error('Invalid Data URL provided');
    }

    const parts = dataUrl.split(',');
    const header = parts[0] || '';
    const base64Data = parts[1] || '';

    const detectedMime = (header.match(/:(.*?);/) || [])[1] || mimeType;

    let byteArray;
    if (typeof atob !== 'undefined') {
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        byteArray = new Uint8Array(byteNumbers);
    } else if (typeof Buffer !== 'undefined') {
        byteArray = Buffer.from(base64Data, 'base64');
    } else {
        throw new Error('Neither atob nor Buffer available in this environment');
    }

    if (typeof File !== 'undefined') {
        return new File([byteArray], fileName, { type: detectedMime, lastModified: Date.now() });
    } else if (typeof Blob !== 'undefined') {
        const blob = new Blob([byteArray], { type: detectedMime });
        blob.name = fileName;
        blob.lastModified = Date.now();
        return blob;
    }
    return { name: fileName, size: byteArray.length, type: detectedMime };
}

/**
 * Injects a stored resume into an HTML <input type="file"> using the DataTransfer API.
 * Dispatches native synthetic events to trigger React, Vue, Angular, and form handlers.
 * @param {HTMLInputElement} fileInput 
 * @param {Object} storedResume 
 * @returns {boolean}
 */
function attachResumeToFileInput(fileInput, storedResume) {
    if (!fileInput || !storedResume || !storedResume.dataUrl) return false;
    try {
        const file = createFileFromDataUrl(
            storedResume.dataUrl,
            storedResume.fileName || 'Resume.pdf',
            storedResume.fileType || 'application/pdf'
        );

        if (typeof DataTransfer !== 'undefined') {
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);
            fileInput.files = dataTransfer.files;
        }

        // Trigger native synthetic events for modern UI framework listeners
        try { fileInput.focus(); } catch (_) {}
        fileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        return true;
    } catch (err) {
        console.warn('[AutoForm] Failed to attach resume to file input:', err);
        return false;
    }
}

/**
 * Extracts plain text from an ArrayBuffer of a PDF document using pure JS stream decoding.
 * Decodes uncompressed text and FlateDecode streams.
 * @param {ArrayBuffer} buffer 
 * @returns {Promise<string>}
 */
async function extractTextFromPdfBuffer(buffer) {
    const uint8 = new Uint8Array(buffer);
    const latin1 = new TextDecoder('latin1').decode(uint8);
    const extractedChunks = [];

    // Helper: extracts text enclosed in parenthesis or hex inside PDF content streams
    const parseStreamText = (streamStr) => {
        const textParts = [];
        // Match string literals: (Text) Tj or (Text) ' or (Text) "
        const tjMatches = streamStr.matchAll(/\(([^)]*)\)\s*(?:Tj|'|")/g);
        for (const m of tjMatches) {
            textParts.push(m[1]);
        }
        // Match string arrays: [(Text) -12 (More)] TJ
        const tjArrayMatches = streamStr.matchAll(/\[([\s\S]*?)\]\s*TJ/g);
        for (const m of tjArrayMatches) {
            const inner = m[1];
            const innerParts = inner.matchAll(/\(([^)]*)\)/g);
            for (const ip of innerParts) {
                textParts.push(ip[1]);
            }
        }
        return textParts.join(' ');
    };

    // 1. Scan for FlateDecode streams
    const streamRegex = /<<[\s\S]*?\/Filter\s*\/FlateDecode[\s\S]*?>>\s*stream[\r\n]+([\s\S]*?)[\r\n]+endstream/gi;
    let streamMatch;

    // Browser Web Streams DecompressionStream if available
    const hasDecompressor = typeof DecompressionStream !== 'undefined';

    while ((streamMatch = streamRegex.exec(latin1)) !== null) {
        const rawStreamBytes = streamMatch[1];
        if (!rawStreamBytes || rawStreamBytes.length === 0) continue;

        if (hasDecompressor) {
            try {
                // Convert latin1 slice to raw bytes
                const streamUint8 = new Uint8Array(rawStreamBytes.length);
                for (let i = 0; i < rawStreamBytes.length; i++) {
                    streamUint8[i] = rawStreamBytes.charCodeAt(i);
                }
                const ds = new DecompressionStream('deflate');
                const writer = ds.writable.getWriter();
                writer.write(streamUint8);
                writer.close();
                const response = new Response(ds.readable);
                const decompressedText = await response.text();
                const text = parseStreamText(decompressedText);
                if (text && text.trim().length > 3) {
                    extractedChunks.push(text);
                }
            } catch (_) {
                // Ignore compression errors and continue
            }
        }
    }

    // 2. Scan uncompressed text objects (BT ... ET)
    const btRegex = /BT[\s\S]*?ET/g;
    let btMatch;
    while ((btMatch = btRegex.exec(latin1)) !== null) {
        const text = parseStreamText(btMatch[0]);
        if (text && text.trim().length > 3) {
            extractedChunks.push(text);
        }
    }

    // 3. Fallback: If minimal text was extracted, scan for printable string literals
    if (extractedChunks.join(' ').trim().length < 50) {
        const stringLiteralRegex = /\(([\w\s.,@:/\-+()]{3,80})\)/g;
        let litMatch;
        while ((litMatch = stringLiteralRegex.exec(latin1)) !== null) {
            const clean = litMatch[1].trim();
            if (clean && !clean.startsWith('/') && !clean.includes('PDF') && clean.length > 3) {
                extractedChunks.push(clean);
            }
        }
    }

    return cleanExtractedText(extractedChunks.join('\n'));
}

/**
 * Extracts text from a Word DOCX document ArrayBuffer (extracts word/document.xml).
 * @param {ArrayBuffer} buffer 
 * @returns {Promise<string>}
 */
async function extractTextFromDocxBuffer(buffer) {
    const uint8 = new Uint8Array(buffer);
    const latin1 = new TextDecoder('latin1').decode(uint8);

    // Look for word/document.xml in ZIP archive
    const docXmlIndex = latin1.indexOf('word/document.xml');
    if (docXmlIndex === -1) {
        // Fallback: search for any XML text tags <w:t> in readable streams
        const tagMatches = latin1.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
        const words = tagMatches.map(t => t.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
        return cleanExtractedText(words.join(' '));
    }

    // Scan for uncompressed or readable <w:t> tags
    const wTags = latin1.match(/<w:t(?:[\s\S]*?)>([\s\S]*?)<\/w:t>/g) || [];
    if (wTags.length > 0) {
        const text = wTags.map(w => w.replace(/<[^>]+>/g, '')).join(' ');
        return cleanExtractedText(text);
    }

    return '';
}

/**
 * Cleans and normalizes extracted text.
 * @param {string} text 
 * @returns {string}
 */
function cleanExtractedText(text = '') {
    if (!text) return '';
    return text
        .replace(/\\([()\\])/g, '$1') // unescape PDF parens
        .split(/\r?\n/)
        .map(line => line.replace(/[ \t]+/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
}

/**
 * Universal text extractor for user-uploaded resume files.
 * @param {File|Blob} file 
 * @returns {Promise<{ text: string, fileName: string, fileType: string, fileSize: number }>}
 */
async function extractTextFromFile(file) {
    if (!file) throw new Error('No file provided');

    const fileName = file.name || 'resume.pdf';
    const fileType = file.type || '';
    const fileSize = file.size || 0;
    const lowerName = fileName.toLowerCase();

    // 1. Plain Text or Markdown
    if (fileType.includes('text') || lowerName.endsWith('.txt') || lowerName.endsWith('.md') || lowerName.endsWith('.rtf')) {
        let text = '';
        if (typeof file.text === 'function') {
            text = await file.text();
        } else {
            const buf = await file.arrayBuffer();
            text = new TextDecoder().decode(buf);
        }
        return { text: cleanExtractedText(text), fileName, fileType, fileSize };
    }

    // 2. PDF Document
    if (fileType.includes('pdf') || lowerName.endsWith('.pdf')) {
        const buffer = await file.arrayBuffer();
        const text = await extractTextFromPdfBuffer(buffer);
        return { text, fileName, fileType: 'application/pdf', fileSize };
    }

    // 3. Word Document (.docx)
    if (lowerName.endsWith('.docx')) {
        const buffer = await file.arrayBuffer();
        const text = await extractTextFromDocxBuffer(buffer);
        return { text, fileName, fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', fileSize };
    }

    // Fallback: read as generic text
    try {
        const buffer = await file.arrayBuffer();
        const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
        return { text: cleanExtractedText(text), fileName, fileType, fileSize };
    } catch (_) {
        return { text: '', fileName, fileType, fileSize };
    }
}

/**
 * Client-Side Heuristic Resume Parser.
 * Converts raw resume text into structured AutoForm AI memory schema.
 * @param {string} text 
 * @param {string} [fileName=''] 
 * @returns {Object} Structured profile with identity, links, education, and snippets
 */
function parseResumeStructure(text = '', fileName = '') {
    const profile = {
        identity: {
            fullName: '',
            email: '',
            phone: '',
            whatsapp: '',
            location: ''
        },
        links: {
            github: '',
            linkedin: '',
            portfolio: '',
            twitter: ''
        },
        education: {
            university: '',
            degree: '',
            major: '',
            graduationYear: '',
            gpa: '',
            currentYear: '',
            rollNumber: ''
        },
        snippets: []
    };

    if (!text || typeof text !== 'string') return profile;

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    // 1. Email Extraction
    const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
    if (emailMatch) {
        profile.identity.email = emailMatch[0];
    }

    // 2. Phone Extraction
    const phoneMatches = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,9}/g) || [];
    const validPhones = phoneMatches.filter(p => {
        const digits = p.replace(/\D/g, '');
        return digits.length >= 8 && digits.length <= 15;
    });
    if (validPhones.length > 0) {
        profile.identity.phone = validPhones[0].trim();
    }

    // 3. Links Extraction
    const urlMatches = text.match(/(?:https?:\/\/|www\.)[^\s<>"{}|\\^`\[\]]+|(?:github\.com|linkedin\.com\/(?:in|company))\S+/gi) || [];
    urlMatches.forEach(url => {
        const clean = url.replace(/^[<("'{\[]+|[>)"'}\],.]+$/g, '');
        const fullUrl = clean.startsWith('http') ? clean : `https://${clean}`;
        const lower = clean.toLowerCase();

        if (lower.includes('github.com')) {
            if (!profile.links.github) profile.links.github = fullUrl;
        } else if (lower.includes('linkedin.com')) {
            if (!profile.links.linkedin) profile.links.linkedin = fullUrl;
        } else if (lower.includes('twitter.com') || lower.includes('x.com')) {
            if (!profile.links.twitter) profile.links.twitter = fullUrl;
        } else if (!profile.links.portfolio && !lower.includes('google.com') && !lower.includes('facebook.com')) {
            profile.links.portfolio = fullUrl;
        }
    });

    // 4. Candidate Name Extraction (Top lines heuristic)
    for (const line of lines.slice(0, 6)) {
        const clean = line.replace(/^[#*\-•\s]+/, '').trim();
        if (clean.includes('@') || clean.includes('http') || clean.includes('www.') || clean.length > 35) continue;
        if (/^(?:resume|curriculum|cv|profile|contact|education|experience|summary|skills)/i.test(clean)) continue;

        const words = clean.split(/\s+/);
        if (words.length >= 2 && words.length <= 4 && words.every(w => /^[A-Z][a-zA-Z.'-]*$/.test(w))) {
            profile.identity.fullName = clean;
            break;
        }
    }

    // 5. Location Extraction
    for (const line of lines.slice(0, 15)) {
        if (/university|college|institute|bachelor|master|phd|school/i.test(line)) continue;

        const locMatch = line.match(/(?:based in|located in|living in|lives in)\s+([^.,;\n]+)/i);
        if (locMatch && locMatch[1].trim().length < 40) {
            profile.identity.location = locMatch[1].trim();
            break;
        }

        // Split line by delimiters (pipes, bullets, tabs) to isolate location chunks
        const chunks = line.split(/[|•·\t]/).map(c => c.trim()).filter(Boolean);
        for (const chunk of chunks) {
            if (chunk.includes('@') || chunk.includes('http') || chunk.includes('www.')) continue;
            const cityStateMatch = chunk.match(/\b([A-Z][a-zA-Z\s]{2,20}),\s*([A-Z]{2}|[A-Z][a-zA-Z\s]{2,20})\b/);
            if (cityStateMatch && !profile.identity.location) {
                profile.identity.location = cityStateMatch[0].trim();
                break;
            }
        }
        if (profile.identity.location) break;
    }

    // 6. Education Extraction
    for (const line of lines) {
        const lower = line.toLowerCase();

        // University / College
        if (!profile.education.university && (lower.includes('university') || lower.includes('institute') || lower.includes('college') || lower.includes('academy') || lower.includes('polytechnic'))) {
            profile.education.university = line.replace(/^[#*\-•\s]+/, '').trim();
        }

        // Degree
        if (!profile.education.degree && (lower.includes('bachelor') || lower.includes('master') || lower.includes('b.tech') || lower.includes('b.e') || lower.includes('b.sc') || lower.includes('m.sc') || lower.includes('phd') || lower.includes('associate'))) {
            profile.education.degree = line.replace(/^[#*\-•\s]+/, '').trim();
        }

        // Major / Field of Study
        if (!profile.education.major) {
            const majorMatch = line.match(/(?:major in|majoring in|degree in|department of|in)\s+([A-Za-z\s&]{4,40})/i);
            if (majorMatch && (lower.includes('engineering') || lower.includes('science') || lower.includes('technology') || lower.includes('arts') || lower.includes('business'))) {
                profile.education.major = majorMatch[1].trim();
            }
        }

        // Graduation Year (YYYY)
        if (!profile.education.graduationYear) {
            const yrMatch = line.match(/\b(201\d|202\d|2030)\b/);
            if (yrMatch && (lower.includes('graduat') || lower.includes('class of') || lower.includes('passing') || lower.includes('passout') || lower.includes('expected') || lower.includes('batch'))) {
                profile.education.graduationYear = yrMatch[1];
            }
        }

        // GPA
        if (!profile.education.gpa) {
            const gpaMatch = line.match(/\b(?:gpa|cgpa)\s*[:\-]?\s*([0-4]\.\d{1,2}|[0-9]\.\d{1,2}(?:\s*\/\s*10)?|[1-9]\d(?:\.\d+)?%)/i);
            if (gpaMatch) {
                profile.education.gpa = gpaMatch[1].trim();
            }
        }
    }

    // 7. Sections & Snippet Generation (Experience, Projects, Skills)
    let currentSection = null;
    let sectionBuffer = [];

    const flushSection = () => {
        if (!currentSection || sectionBuffer.length === 0) return;
        const sectionText = sectionBuffer.join('\n').trim();
        if (sectionText.length < 20) return;

        let category = 'other';
        let title = 'Professional Background';
        let tags = [];

        if (currentSection === 'EXPERIENCE') {
            category = 'experience';
            title = 'Work Experience';
            tags = ['experience', 'work', 'career'];
        } else if (currentSection === 'PROJECTS') {
            category = 'project';
            title = 'Key Projects';
            tags = ['project', 'development'];
        } else if (currentSection === 'SKILLS') {
            category = 'skill';
            title = 'Technical Skills';
            tags = ['skills', 'tools'];
        } else if (currentSection === 'EDUCATION') {
            category = 'other';
            title = 'Education History';
            tags = ['education', 'academic'];
        }

        profile.snippets.push({
            id: 'snippet-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
            category,
            title,
            content: sectionText.slice(0, 1000),
            tags,
            createdAt: new Date().toISOString()
        });

        sectionBuffer = [];
    };

    for (const line of lines) {
        const clean = line.replace(/^[#*\-•\s]+/, '').trim();
        const lower = clean.toLowerCase();

        if (/^(?:work\s+experience|professional\s+experience|employment\s+history|experience)$/i.test(clean)) {
            flushSection();
            currentSection = 'EXPERIENCE';
            continue;
        }
        if (/^(?:projects|technical\s+projects|academic\s+projects|key\s+projects)$/i.test(clean)) {
            flushSection();
            currentSection = 'PROJECTS';
            continue;
        }
        if (/^(?:skills|technical\s+skills|core\s+competencies|technologies)$/i.test(clean)) {
            flushSection();
            currentSection = 'SKILLS';
            continue;
        }
        if (/^(?:education|academic\s+background)$/i.test(clean)) {
            flushSection();
            currentSection = 'EDUCATION';
            continue;
        }

        if (currentSection) {
            sectionBuffer.push(line);
        }
    }
    flushSection();

    return profile;
}

// ---------------------------------------------------------------------------
// Universal Exports (Browser + Node.js)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        fileToDataUrl,
        createFileFromDataUrl,
        attachResumeToFileInput,
        extractTextFromPdfBuffer,
        extractTextFromDocxBuffer,
        cleanExtractedText,
        extractTextFromFile,
        parseResumeStructure
    };
}

if (typeof globalThis !== 'undefined') {
    globalThis.ResumeExtractor = {
        fileToDataUrl,
        createFileFromDataUrl,
        attachResumeToFileInput,
        extractTextFromPdfBuffer,
        extractTextFromDocxBuffer,
        cleanExtractedText,
        extractTextFromFile,
        parseResumeStructure
    };
    globalThis.attachResumeToFileInput = attachResumeToFileInput;
}
