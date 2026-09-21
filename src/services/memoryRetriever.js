/**
 * @file src/services/memoryRetriever.js
 * @description Intelligent Client-Side Context Routing & Hybrid RAG Retrieval Engine for AutoForm AI.
 * Classifies question intent, performs BM25/TF-IDF snippet ranking, cross-references choices,
 * and builds high-precision, token-budgeted memory context for AI prompts.
 */

// Universal stopwords + form questionnaire boilerplate
const STOPWORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
  'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below',
  'between', 'both', 'but', 'by', 'can', 'did', 'do', 'does', 'doing', 'don',
  'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has',
  'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself',
  'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just',
  'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off',
  'on', 'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over',
  'own', 's', 'same', 'she', 'should', 'so', 'some', 'such', 't', 'than',
  'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there',
  'these', 'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until',
  'up', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which', 'while',
  'who', 'whom', 'why', 'will', 'with', 'you', 'your', 'yours', 'yourself',
  'yourselves',
  // Form boilerplate
  'please', 'enter', 'provide', 'select', 'choose', 'specify', 'indicate',
  'write', 'fill', 'answer', 'question', 'field', 'required', 'optional',
  'following', 'below', 'above', 'form', 'check', 'all', 'apply', 'describe',
  'briefly', 'explain', 'give', 'list', 'submit', 'type'
]);

// Whitelist short keywords that are significant in tech/academics
const SHORT_KEYWORDS = new Set([
  'c', 'r', 'ai', 'ui', 'ux', 'ml', 'go', 'js', 'ts', 'db', 'os', 'ip',
  'gpa', 'cs', 'ee', 'it', 'qa', 'pm', 'hr', 'pr'
]);

/**
 * Tokenizes text into a normalized array of significant keywords.
 * @param {string} text 
 * @returns {string[]}
 */
function tokenize(text = '') {
  if (!text || typeof text !== 'string') return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s+#.-]/g, ' ')
    .split(/\s+/)
    .filter(token => {
      const clean = token.replace(/^[.-]+|[.-]+$/g, '');
      if (!clean) return false;
      if (SHORT_KEYWORDS.has(clean)) return true;
      if (clean.length < 3) return false;
      if (STOPWORDS.has(clean)) return false;
      return true;
    });
}

/**
 * Question intent classifications.
 */
const QuestionIntent = {
  CONTACT_LINK: 'CONTACT_LINK',
  EDUCATION: 'EDUCATION',
  WORK_EXPERIENCE: 'WORK_EXPERIENCE',
  PROJECTS: 'PROJECTS',
  SKILLS: 'SKILLS',
  BEHAVIORAL_ESSAY: 'BEHAVIORAL_ESSAY',
  GENERAL: 'GENERAL'
};

/**
 * Form macro-objective classifications.
 */
const FormMacroIntent = {
  JOB_APPLICATION: 'Job Application',
  ACADEMIC_STUDENT: 'Academic / Education',
  FEEDBACK_SURVEY: 'Feedback & Survey',
  EVENT_REGISTRATION: 'Event Registration / RSVP',
  QUIZ_EVALUATION: 'Quiz & Evaluation',
  GENERAL_FORM: 'General Form'
};

/**
 * Department & Major acronym bidirectional expansion dictionary.
 */
const DEPARTMENT_ALIASES = {
  'it': ['information technology', 'info tech', 'information tech', 'it', 'dept of it', 'department of information technology'],
  'information technology': ['information technology', 'info tech', 'information tech', 'it', 'dept of it', 'department of information technology'],
  'cse': ['computer science and engineering', 'computer science & engineering', 'computer science', 'cs', 'cse', 'dept of cse'],
  'cs': ['computer science and engineering', 'computer science & engineering', 'computer science', 'cs', 'cse'],
  'computer science': ['computer science and engineering', 'computer science & engineering', 'computer science', 'cs', 'cse'],
  'ece': ['electronics and communication engineering', 'electronics & communication engineering', 'electronics and communication', 'ece'],
  'eee': ['electrical and electronics engineering', 'electrical & electronics engineering', 'electrical and electronics', 'eee'],
  'me': ['mechanical engineering', 'mechanical', 'me', 'mech'],
  'mech': ['mechanical engineering', 'mechanical', 'me', 'mech'],
  'mechanical engineering': ['mechanical engineering', 'mechanical', 'me', 'mech'],
  'civil': ['civil engineering', 'civil', 'ce'],
  'ce': ['civil engineering', 'civil', 'ce'],
  'civil engineering': ['civil engineering', 'civil', 'ce'],
  'aero': ['aerospace engineering', 'aeronautical engineering', 'aerospace', 'aero'],
  'aerospace engineering': ['aerospace engineering', 'aeronautical engineering', 'aerospace', 'aero'],
  'ai': ['artificial intelligence', 'ai and data science', 'ai & ds', 'ai/ml', 'aiml'],
  'aiml': ['artificial intelligence and machine learning', 'ai and machine learning', 'ai & ml', 'aiml'],
  'ds': ['data science', 'ai and data science', 'ai & ds', 'data science & engineering'],
  'bt': ['biotechnology', 'biotech', 'biotechnology engineering', 'bt'],
  'bme': ['biomedical engineering', 'biomedical', 'bme'],
  'chem': ['chemical engineering', 'chemical', 'chem']
};

/**
 * Resolves the user's current academic year (1, 2, 3, 4) from education profile or memory cards.
 * @param {Object} memoryProfile
 * @returns {{ yearNumber: number, label: string }|null}
 */
function getUserAcademicYear(memoryProfile = {}) {
  if (!memoryProfile) return null;
  const edu = memoryProfile.education || {};
  const snippets = memoryProfile.snippets || [];

  // 1. Direct currentYear field if present
  if (edu.currentYear) {
    const cy = edu.currentYear.toLowerCase().trim();
    if (cy.includes('4') || cy.includes('four') || cy.includes('final') || cy.includes('senior')) {
      return { yearNumber: 4, label: '4th Year' };
    }
    if (cy.includes('3') || cy.includes('three') || cy.includes('third') || cy.includes('junior') || cy.includes('pre-final')) {
      return { yearNumber: 3, label: '3rd Year' };
    }
    if (cy.includes('2') || cy.includes('two') || cy.includes('second') || cy.includes('sophomore')) {
      return { yearNumber: 2, label: '2nd Year' };
    }
    if (cy.includes('1') || cy.includes('one') || cy.includes('first') || cy.includes('freshman')) {
      return { yearNumber: 1, label: '1st Year' };
    }
  }

  // 2. Inspect memory cards / snippets for explicit mentions of study year
  for (const s of snippets) {
    const text = `${s.title || ''} ${s.content || ''}`.toLowerCase();
    if (text.match(/\b(?:fourth\s*year|4th\s*year|final\s*year|senior\s*year|iv\s*year)\b/)) {
      return { yearNumber: 4, label: '4th Year' };
    }
    if (text.match(/\b(?:third\s*year|3rd\s*year|pre-?final\s*year|junior\s*year|iii\s*year)\b/)) {
      return { yearNumber: 3, label: '3rd Year' };
    }
    if (text.match(/\b(?:second\s*year|2nd\s*year|sophomore\s*year|ii\s*year)\b/)) {
      return { yearNumber: 2, label: '2nd Year' };
    }
    if (text.match(/\b(?:first\s*year|1st\s*year|freshman\s*year|i\s*year)\b/)) {
      return { yearNumber: 1, label: '1st Year' };
    }
  }

  // 3. Calculate from graduationYear if available
  if (edu.graduationYear) {
    const gradYear = parseInt(edu.graduationYear, 10);
    if (!isNaN(gradYear)) {
      const currentYear = new Date().getFullYear();
      const diff = gradYear - currentYear;
      if (diff <= 0) return { yearNumber: 4, label: '4th Year' };
      if (diff === 1) return { yearNumber: 3, label: '3rd Year' };
      if (diff === 2) return { yearNumber: 2, label: '2nd Year' };
      if (diff >= 3) return { yearNumber: 1, label: '1st Year' };
    }
  }

  return null;
}

/**
 * Classifies the overall macro-objective of a form using its title, description, and question list.
 * @param {string} title 
 * @param {string} description 
 * @param {Array<{ question: string }>} questions 
 * @returns {string} FormMacroIntent value
 */
function classifyFormMacroIntent(title = '', description = '', questions = []) {
  const text = `${title} ${description} ${questions.map(q => q.question || '').join(' ')}`.toLowerCase();

  if (text.match(/\b(?:job|intern(?:ship)?|career|employment|hiring|role|candidate|position|resume|curriculum\s*vitae|cv|applicant)\b/)) {
    return FormMacroIntent.JOB_APPLICATION;
  }
  if (text.match(/\b(?:scholarship|grant|fellowship|admissions?|course|coursework|university|college|homework|academic)\b/)) {
    return FormMacroIntent.ACADEMIC_STUDENT;
  }
  if (text.match(/\b(?:quiz|exam|test|assessment|trivia|score|knowledge\s*check)\b/)) {
    return FormMacroIntent.QUIZ_EVALUATION;
  }
  if (text.match(/\b(?:feedback|survey|nps|rating|satisfaction|opinion|review|poll)\b/)) {
    return FormMacroIntent.FEEDBACK_SURVEY;
  }
  if (text.match(/\b(?:register|registration|rsvp|attendee|ticket|conference|summit|hackathon|meetup)\b/)) {
    return FormMacroIntent.EVENT_REGISTRATION;
  }
  return FormMacroIntent.GENERAL_FORM;
}

/**
 * Builds a structured FormDigest providing whole-form macro context.
 * @param {string} title 
 * @param {string} description 
 * @param {Array<{ question: string, type?: string }>} questions 
 * @returns {Object} Structured form digest
 */
function buildFormDigest(title = '', description = '', questions = []) {
  const cleanTitle = (title || 'Google Form').trim();
  const cleanDesc = (description || '').trim();
  const macroIntent = classifyFormMacroIntent(cleanTitle, cleanDesc, questions);

  const outline = (questions || []).slice(0, 8).map((q, idx) => {
    const qText = (q.question || '').slice(0, 45);
    return `${idx + 1}. "${qText}" (${q.type || 'text'})`;
  });
  if ((questions || []).length > 8) {
    outline.push(`...and ${questions.length - 8} more questions`);
  }

  return {
    title: cleanTitle,
    description: cleanDesc,
    macroIntent,
    totalQuestions: (questions || []).length,
    outline
  };
}

/**
 * Analyzes question text to classify its underlying intent.
 * @param {string} questionText 
 * @param {string} [questionType]
 * @returns {string[]} Detected intents in order of confidence
 */
function classifyQuestionIntent(questionText = '', questionType = '') {
  const qLower = questionText.toLowerCase();
  const intents = [];

  // Contact / Social Links
  if (qLower.match(/\b(?:linkedin|github|portfolio|website|twitter|social|handle|profile\s*url|link\s*to|email|gmail|mail\s*id|phone|mobile|cell|whatsapp|wa|address|residence|location|city|country)\b/)) {
    intents.push(QuestionIntent.CONTACT_LINK);
  }

  // Education
  if (qLower.match(/\b(?:university|college|school|institution|degree|major|department|dept|branch|stream|discipline|field\s*of\s*study|gpa|cgpa|graduation|graduated|class\s*of|undergraduate|postgraduate|bachelor|master|phd|coursework|academic|year\s*of\s*study|current\s*year|which\s*year|fourth\s*year|4th\s*year|freshman|sophomore|junior|senior|roll\s*(?:no|number)?|register\s*(?:no|number)?|registration\s*(?:no|number)?|reg\s*no|usn|student\s*id|hall\s*ticket|enrollment\s*(?:no|number)?|exam\s*roll)\b/)) {
    intents.push(QuestionIntent.EDUCATION);
  }

  // Work Experience
  if (qLower.match(/\b(?:experience|worked|company|employer|job|role|title|responsibilities|employment|current\s*role|past\s*work|years\s*of\s*experience|intern|internship)\b/)) {
    intents.push(QuestionIntent.WORK_EXPERIENCE);
  }

  // Projects
  if (qLower.match(/\b(?:project|built|created|designed|developed|app|tool|hackathon|open\s*source|repository|repo|portfolio\s*piece)\b/)) {
    intents.push(QuestionIntent.PROJECTS);
  }

  // Skills & Tools
  if (qLower.match(/\b(?:skills?|technolog(?:y|ies)|programming\s*languages?|frameworks?|libraries?|tools?|proficien(?:t|cy)|stack|tech\s*stack|database)\b/)) {
    intents.push(QuestionIntent.SKILLS);
  }

  // Behavioral / Essay / Long-form answers
  if (qLower.match(/\b(?:why\b|tell\s*us|describe|motivation|challenge|accomplishment|strengths?|weakness(?:es)?|leadership|values?|goals?|passion|personal\s*statement|about\s*yourself|what\s*drives\s*you|philosoph(?:y|ies))\b/) ||
      (questionType === 'text_input' && qLower.length > 55)) {
    intents.push(QuestionIntent.BEHAVIORAL_ESSAY);
  }

  if (intents.length === 0) {
    intents.push(QuestionIntent.GENERAL);
  }

  return intents;
}

/**
 * Resolves direct slot values for common standard form questions.
 * @param {string} questionText 
 * @param {Object} memoryProfile 
 * @returns {{ key: string, value: string }|null}
 */
/**
 * Helper to split location string into city, state, country parts.
 * Handles "City, State", "City, State, Country", or single-token locations.
 * @param {string} locationStr 
 * @returns {{ city: string, state: string, country: string }}
 */
function extractLocationParts(locationStr = '') {
  if (!locationStr || typeof locationStr !== 'string') return { city: '', state: '', country: '' };
  const parts = locationStr.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return { city: '', state: '', country: '' };
  if (parts.length === 1) {
    return { city: parts[0], state: parts[0], country: '' };
  }
  if (parts.length === 2) {
    return { city: parts[0], state: parts[1], country: '' };
  }
  // 3 or more parts: e.g. "Bangalore, Karnataka, India"
  return { city: parts[0], state: parts[1], country: parts.slice(2).join(', ') };
}

/**
 * Standard degree aliases for educational degree normalization.
 */
const DEGREE_ALIASES = {
  'b.e': ['b.e', 'b.e.', 'be', 'bachelor of engineering', 'bachelor in engineering', 'b.tech', 'bachelor of technology'],
  'be': ['b.e', 'b.e.', 'be', 'bachelor of engineering', 'bachelor in engineering', 'b.tech', 'bachelor of technology'],
  'b.tech': ['b.tech', 'b.tech.', 'btech', 'bachelor of technology', 'b.e', 'bachelor of engineering'],
  'btech': ['b.tech', 'b.tech.', 'btech', 'bachelor of technology', 'b.e', 'bachelor of engineering'],
  'b.sc': ['b.sc', 'b.sc.', 'bsc', 'bachelor of science', 'bachelor in science'],
  'bsc': ['b.sc', 'b.sc.', 'bsc', 'bachelor of science', 'bachelor in science'],
  'bca': ['bca', 'b.c.a', 'bachelor of computer applications'],
  'mca': ['mca', 'm.c.a', 'master of computer applications'],
  'm.tech': ['m.tech', 'm.tech.', 'mtech', 'master of technology'],
  'mtech': ['m.tech', 'm.tech.', 'mtech', 'master of technology'],
  'm.sc': ['m.sc', 'm.sc.', 'msc', 'master of science'],
  'msc': ['m.sc', 'm.sc.', 'msc', 'master of science'],
  'mba': ['mba', 'm.b.a', 'master of business administration'],
  'diploma': ['diploma', 'polytechnic']
};

/**
 * Resolves direct slot values for common standard form questions.
 * @param {string} questionText 
 * @param {Object} memoryProfile 
 * @returns {{ key: string, value: string }|null}
 */
function resolveDirectSlot(questionText = '', memoryProfile = {}) {
  if (!memoryProfile) return null;
  const qLower = questionText.toLowerCase();

  const id = memoryProfile.identity || {};
  const links = memoryProfile.links || {};
  const edu = memoryProfile.education || {};

  // First Name
  if (qLower.match(/\b(?:first\s*name|given\s*name|forename|pr[eé]nom|nombre)\b/) && id.fullName) {
    const firstName = id.fullName.trim().split(/\s+/)[0];
    if (firstName) return { key: 'First Name', value: firstName };
  }

  // Last Name
  if (qLower.match(/\b(?:last\s*name|surname|family\s*name|nom\s*de\s*famille|apellido)\b/) && id.fullName) {
    const parts = id.fullName.trim().split(/\s+/);
    if (parts.length > 1) {
      return { key: 'Last Name', value: parts.slice(1).join(' ') };
    }
  }

  // Full Name
  if ((qLower.match(/\b(?:full\s*name|your\s*name|first\s*and\s*last\s*name|applicant\s*name)\b/) ||
       (qLower.match(/\bname\b/) && !qLower.includes('first') && !qLower.includes('last') && !qLower.includes('project') && !qLower.includes('company') && !qLower.includes('user') && !qLower.includes('file'))) &&
      id.fullName) {
    return { key: 'Full Name', value: id.fullName };
  }

  // WhatsApp Number (prioritize before general phone regex)
  if (qLower.match(/\b(?:whatsapp|wa)(?:\s*(?:number|no|num|phone|mobile|contact))?\b/) && (id.whatsapp || id.phone)) {
    return { key: 'WhatsApp', value: id.whatsapp || id.phone };
  }

  // Email / Gmail / College Email
  if ((qLower.match(/\b(?:e-?mail|gmail|mail(?:\s*id)?)(?:\s*(?:address|id|account))?\b/) ||
       qLower.includes('email') || qLower.includes('gmail') || qLower.includes('mail id') || qLower.includes('e-mail')) && 
      !qLower.includes('phone') && !qLower.includes('whatsapp') && !qLower.includes('wa') && id.email) {
    return { key: 'Email', value: id.email };
  }

  // Phone Number
  if (qLower.match(/\b(?:phone(?:\s*number)?|mobile(?:\s*number)?|cell|telephone|contact\s*number)\b/) && 
      !qLower.includes('whatsapp') && !qLower.includes('wa') && id.phone) {
    return { key: 'Phone', value: id.phone };
  }

  // GitHub
  if (qLower.includes('github') && links.github) {
    return { key: 'GitHub', value: links.github };
  }

  // LinkedIn
  if (qLower.includes('linkedin') && links.linkedin) {
    return { key: 'LinkedIn', value: links.linkedin };
  }

  // Portfolio / Personal Site
  if (qLower.match(/\b(?:portfolio|personal\s*website|website|personal\s*site)\b/) && links.portfolio) {
    return { key: 'Portfolio', value: links.portfolio };
  }

  // Twitter / X
  if (qLower.match(/\b(?:twitter|x(?:\s*profile|\s*handle)?)\b/) && links.twitter) {
    return { key: 'Twitter / X', value: links.twitter };
  }

  // State / Province / Region
  if (qLower.match(/\b(?:state|province|region)\b/) && !qLower.includes('statement') && !qLower.includes('status')) {
    if (id.state) return { key: 'State', value: id.state };
    if (id.province) return { key: 'State', value: id.province };
    if (id.location) {
      const loc = extractLocationParts(id.location);
      if (loc.state) return { key: 'State', value: loc.state };
    }
  }

  // District
  if (qLower.match(/\b(?:district|dist)\b/)) {
    if (id.district) return { key: 'District', value: id.district };
    if (id.city) return { key: 'District', value: id.city };
    if (id.location) {
      const loc = extractLocationParts(id.location);
      if (loc.city) return { key: 'District', value: loc.city };
    }
  }

  // City
  if (qLower.match(/\b(?:city|town)\b/)) {
    if (id.city) return { key: 'City', value: id.city };
    if (id.location) {
      const loc = extractLocationParts(id.location);
      if (loc.city) return { key: 'City', value: loc.city };
    }
  }

  // Country
  if (qLower.match(/\b(?:country|nation|nationality)\b/)) {
    if (id.country) return { key: 'Country', value: id.country };
    if (id.location) {
      const loc = extractLocationParts(id.location);
      if (loc.country) return { key: 'Country', value: loc.country };
    }
  }

  // Location / General Residence
  if (qLower.match(/\b(?:current\s*location|residence|where\s*are\s*you\s*(?:based|located)|address)\b/) && id.location) {
    return { key: 'Location', value: id.location };
  }

  // Current Role / Headline
  if (qLower.match(/\b(?:current\s*(?:role|title|position|job\s*title)|occupation|profession)\b/) && id.headline) {
    return { key: 'Current Role', value: id.headline };
  }

  // Current Year of Study (e.g. 4th Year / Senior)
  if (qLower.match(/\b(?:current\s*year|year\s*of\s*study|studying\s*in|which\s*year|academic\s*year|class\s*standing)\b/) && !qLower.includes('graduation')) {
    const acadYear = getUserAcademicYear(memoryProfile);
    if (acadYear) {
      return { key: 'Current Year', value: acadYear.label };
    }
  }

  // University / College / Institution
  if (qLower.match(/\b(?:university|college|school|institution|campus)\b/) && 
      !qLower.includes('gpa') && !qLower.includes('email') && !qLower.includes('number') && !qLower.includes('roll') && !qLower.includes('reg') && 
      (edu.university || edu.college)) {
    const isCollegeOnly = qLower.match(/\b(?:college|campus)\b/) && !qLower.includes('university');
    const key = isCollegeOnly ? 'College' : 'University';
    return { key, value: edu.university || edu.college };
  }

  // GPA
  if (qLower.match(/\b(?:gpa|cgpa|grade\s*point)\b/) && edu.gpa) {
    return { key: 'GPA', value: edu.gpa };
  }

  // Graduation Year / Year of Passout / YOP
  if (qLower.match(/\b(?:graduation\s*year|grad\s*year|year\s*of\s*graduation|class\s*of|year\s*of\s*pass(?:ing|out)|passout\s*year|passing\s*year|yop)\b/) && (edu.graduationYear || edu.currentYear)) {
    const raw = edu.graduationYear || edu.currentYear;
    const yearMatch = String(raw).match(/\b(20\d{2})\b/);
    return { key: 'Graduation Year', value: yearMatch ? yearMatch[1] : String(raw) };
  }

  // University Register Number / Roll Number / Student ID / USN
  if (qLower.match(/\b(?:register\s*(?:no|number)?|registration\s*(?:no|number)?|roll\s*(?:no|number)?|usn|student\s*id|reg(?:istration)?\s*no|exam\s*roll(?:\s*no|\s*number)?|enrollment\s*(?:no|number)?|hall\s*ticket(?:\s*no|\s*number)?|prn)\b/)) {
    const rollVal = edu.usn || edu.rollNumber || edu.rollNo || edu.registrationNumber || edu.regNo || edu.studentId || edu.enrollmentNumber ||
                    id.rollNumber || id.studentId || id.usn || id.registrationNumber;
    if (rollVal) {
      return { key: 'University Register Number', value: String(rollVal).trim() };
    }
    // Check snippets for roll number / USN if not directly set in education fields
    if (Array.isArray(memoryProfile.snippets)) {
      for (const snip of memoryProfile.snippets) {
        const text = `${snip.title || ''}\n${snip.content || ''}\n${(snip.tags || []).join(' ')}`;
        const match = text.match(/(?:roll\s*(?:no|number)?|usn|reg(?:istration)?\s*(?:no|number)?|student\s*id|enrollment\s*(?:no|number)?)\s*[:=–—\-]\s*([A-Za-z0-9_\-\/]+)/i);
        if (match && match[1]) {
          return { key: 'University Register Number', value: match[1].trim() };
        }
      }
    }
  }

  // Specific Degree
  if (qLower.match(/\b(?:degree(?:\s*level|\s*type)?|qualification)\b/) && !qLower.includes('major') && !qLower.includes('stream') && (edu.degree || edu.qualification)) {
    return { key: 'Degree', value: edu.degree || edu.qualification };
  }

  // Department / Major / Branch / Stream
  if (qLower.match(/\b(?:department|dept|major|branch|stream|discipline|field\s*of\s*study|specialization)\b/) && 
      !qLower.includes('degree') && (edu.major || edu.department || edu.stream || edu.branch)) {
    const m = (edu.major || edu.department || edu.stream || edu.branch).trim();
    const expanded = (m.toLowerCase() === 'it') ? 'Information Technology (IT)' : m;
    const key = qLower.match(/\bstream\b/) ? 'Stream' : (qLower.match(/\b(?:department|dept|branch)\b/) ? 'Department' : 'Major');
    return { key, value: expanded };
  }

  // Combined Degree / Major
  if (qLower.match(/\b(?:major|field\s*of\s*study|degree)\b/) && (edu.major || edu.degree)) {
    const val = [edu.degree, edu.major].filter(Boolean).join(' in ');
    return { key: 'Degree / Major', value: val };
  }

  return null;
}

/**
 * Direct deterministic matching for Multiple Choice and Dropdown choices against user profile facts.
 * @param {string} questionText 
 * @param {string[]} choices 
 * @param {Object} memoryProfile 
 * @returns {{ key: string, answer: string }|null}
 */
function resolveDirectChoice(questionText = '', choices = [], memoryProfile = {}) {
  if (!choices || choices.length === 0 || !memoryProfile) return null;
  const qLower = questionText.toLowerCase();
  const edu = memoryProfile.education || {};
  const id = memoryProfile.identity || {};

  // 1. Department / Major / Branch / Stream choice matching
  const userMajor = (edu.major || edu.department || edu.stream || edu.branch || '').trim();
  if (userMajor && qLower.match(/\b(?:department|dept|major|branch|stream|discipline|field\s*of\s*study|specialization|course)\b/)) {
    const mLower = userMajor.toLowerCase();
    const aliases = DEPARTMENT_ALIASES[mLower] || [mLower];

    // Priority 1: Exact match with choice or choice equals an alias
    for (const choice of choices) {
      const cLower = choice.toLowerCase().trim();
      if (cLower === mLower || aliases.includes(cLower)) {
        return { key: 'Department / Major', answer: choice };
      }
    }

    // Priority 2: Choice contains user major or an alias
    for (const choice of choices) {
      const cLower = choice.toLowerCase().trim();
      for (const alias of aliases) {
        if (alias.length <= 2) {
          const regex = new RegExp(`\\b${alias}\\b`, 'i');
          if (regex.test(cLower)) {
            return { key: 'Department / Major', answer: choice };
          }
        } else {
          if (cLower.includes(alias) || alias.includes(cLower)) {
            return { key: 'Department / Major', answer: choice };
          }
        }
      }
    }
  }

  // 2. Current Year of Study / Academic Standing match
  if (qLower.match(/\b(?:current\s*year|year\s*of\s*study|studying\s*in|which\s*year|academic\s*year|class\s*standing|standing|year)\b/) &&
      !qLower.includes('graduation') && !qLower.includes('grad\s*year') && !qLower.includes('passout') && !qLower.includes('passing')) {
    const acadYear = getUserAcademicYear(memoryProfile);
    if (acadYear) {
      const y = acadYear.yearNumber;
      let targetRegexes = [];
      if (y === 4) {
        targetRegexes = [
          /\b(?:4th|fourth|final|iv)\s*(?:year)?\b/i,
          /\bsenior\b/i,
          /\b4\b/
        ];
      } else if (y === 3) {
        targetRegexes = [
          /\b(?:3rd|third|pre-?final|iii)\s*(?:year)?\b/i,
          /\bjunior\b/i,
          /\b3\b/
        ];
      } else if (y === 2) {
        targetRegexes = [
          /\b(?:2nd|second|ii)\s*(?:year)?\b/i,
          /\bsophomore\b/i,
          /\b2\b/
        ];
      } else if (y === 1) {
        targetRegexes = [
          /\b(?:1st|first|i)\s*(?:year)?\b/i,
          /\bfreshman\b/i,
          /\b1\b/
        ];
      }

      for (const regex of targetRegexes) {
        const found = choices.find(c => {
          const cLow = c.toLowerCase();
          // Never select "graduate", "passed out", or "alumni" for an active undergraduate student
          if (cLow.includes('graduate') || cLow.includes('alumni') || cLow.includes('passed out')) return false;
          return regex.test(cLow);
        });
        if (found) return { key: 'Current Year', answer: found };
      }
    }
  }

  // 3. Graduation year / Year of Passout / YOP match
  const gradYearVal = edu.graduationYear || edu.currentYear;
  if (gradYearVal && qLower.match(/\b(?:graduation|grad\s*year|class\s*of|year\s*of\s*graduation|year\s*of\s*pass(?:ing|out)|passout\s*year|passing\s*year|yop)\b/)) {
    const grad = String(gradYearVal).trim();
    const yearMatch = grad.match(/\b(20\d{2})\b/);
    const targetYear = yearMatch ? yearMatch[1] : grad;
    const found = choices.find(c => {
      const cTrim = c.trim();
      return cTrim === targetYear || cTrim === grad || cTrim.includes(targetYear);
    });
    if (found) return { key: 'Graduation Year', answer: found };
  }

  // 4. Academic level / Degree match
  if ((edu.degree || edu.qualification) && qLower.match(/\b(?:degree|level\s*of\s*education|highest\s*level|education\s*level|qualification)\b/)) {
    const userDeg = (edu.degree || edu.qualification).trim();
    const dLower = userDeg.toLowerCase();
    const aliases = DEGREE_ALIASES[dLower] || [dLower];

    for (const choice of choices) {
      const cLower = choice.toLowerCase().trim();
      if (cLower === dLower || aliases.includes(cLower)) {
        return { key: 'Degree Level', answer: choice };
      }
      for (const alias of aliases) {
        if (alias.length <= 3) {
          const regex = new RegExp(`\\b${alias.replace('.', '\\.')}\\b`, 'i');
          if (regex.test(cLower)) return { key: 'Degree Level', answer: choice };
        } else if (cLower.includes(alias) || alias.includes(cLower)) {
          return { key: 'Degree Level', answer: choice };
        }
      }
    }

    for (const choice of choices) {
      const cLower = choice.toLowerCase();
      if ((dLower.includes('bachelor') && cLower.includes('bachelor')) ||
          (dLower.includes('master') && cLower.includes('master')) ||
          (dLower.includes('phd') && cLower.includes('phd')) ||
          (dLower.includes('doctor') && cLower.includes('doctor')) ||
          (dLower.includes('high school') && cLower.includes('high school'))) {
        return { key: 'Degree Level', answer: choice };
      }
    }
  }

  // 5. State / Province match
  if (qLower.match(/\b(?:state|province|region)\b/) && !qLower.includes('statement') && !qLower.includes('status')) {
    const userState = (id.state || id.province || extractLocationParts(id.location).state || '').toLowerCase().trim();
    if (userState) {
      const found = choices.find(c => {
        const cl = c.toLowerCase().trim();
        return cl === userState || cl.includes(userState) || userState.includes(cl);
      });
      if (found) return { key: 'State', answer: found };
    }
  }

  // 6. District / City match
  if (qLower.match(/\b(?:district|dist|city|town)\b/)) {
    const userDistrict = (id.district || id.city || extractLocationParts(id.location).city || '').toLowerCase().trim();
    if (userDistrict) {
      const found = choices.find(c => {
        const cl = c.toLowerCase().trim();
        return cl === userDistrict || cl.includes(userDistrict) || userDistrict.includes(cl);
      });
      if (found) return { key: 'District', answer: found };
    }
  }

  // 7. Academic standing fallback from graduation year
  if (edu.graduationYear && qLower.match(/\b(?:year\s*of\s*study|standing|class\s*standing|academic\s*year)\b/)) {
    const currentYear = new Date().getFullYear();
    const gradYear = parseInt(edu.graduationYear, 10);
    if (!isNaN(gradYear)) {
      const diff = gradYear - currentYear;
      let expected = '';
      if (diff <= 0) expected = 'senior';
      else if (diff === 1) expected = 'junior';
      else if (diff === 2) expected = 'sophomore';
      else if (diff >= 3) expected = 'freshman';
      if (expected) {
        const found = choices.find(c => c.toLowerCase().includes(expected));
        if (found) return { key: 'Academic Standing', answer: found };
      }
    }
  }

  // 8. University / College match
  if ((edu.university || edu.college) && qLower.match(/\b(?:university|college|school|institution|campus)\b/) && !qLower.includes('number') && !qLower.includes('roll')) {
    const uLower = (edu.university || edu.college).toLowerCase();
    const found = choices.find(c => {
      const cl = c.toLowerCase();
      return cl === uLower || cl.includes(uLower) || uLower.includes(cl);
    });
    if (found) return { key: 'University', answer: found };
  }

  return null;
}

/**
 * Cross-references question choices with user profile facts.
 * e.g., if choices have Bachelor's / Master's or graduation years or technical skills.
 * @param {string[]} choices 
 * @param {Object} memoryProfile 
 * @param {string[]} intents 
 * @returns {string[]} Choice hints
 */
function crossReferenceChoices(choices = [], memoryProfile = {}, intents = []) {
  if (!choices || choices.length === 0 || !memoryProfile) return [];

  const hints = [];
  const edu = memoryProfile.education || {};
  const id = memoryProfile.identity || {};
  const snippets = memoryProfile.snippets || [];
  const acadYear = getUserAcademicYear(memoryProfile);

  const allProfileSkills = new Set(
    snippets
      .filter(s => s.category === 'skill' || s.category === 'project')
      .flatMap(s => s.tags || [])
      .map(t => t.toLowerCase())
  );

  choices.forEach(choice => {
    const cLower = choice.toLowerCase().trim();

    // Check department / major alignment (e.g. IT -> Information Technology)
    if (edu.major || edu.department) {
      const userMajor = (edu.major || edu.department).toLowerCase().trim();
      const aliases = DEPARTMENT_ALIASES[userMajor] || [userMajor];
      const matchesMajor = aliases.some(a => {
        if (a.length <= 2) return new RegExp(`\\b${a}\\b`, 'i').test(cLower);
        return cLower === a || cLower.includes(a) || a.includes(cLower);
      });
      if (matchesMajor) {
        hints.push(`User major/department "${edu.major || edu.department}" aligns with choice "${choice}"`);
      }
    }

    // Check academic year of study alignment (e.g. 4th Year / Senior)
    if (acadYear) {
      const y = acadYear.yearNumber;
      const isYearMatch = (y === 4 && /\b(?:4th|fourth|final|senior|iv)\b/i.test(cLower)) ||
                          (y === 3 && /\b(?:3rd|third|pre-?final|junior|iii)\b/i.test(cLower)) ||
                          (y === 2 && /\b(?:2nd|second|sophomore|ii)\b/i.test(cLower)) ||
                          (y === 1 && /\b(?:1st|first|freshman|i)\b/i.test(cLower));
      if (isYearMatch && !cLower.includes('graduate') && !cLower.includes('alumni') && !cLower.includes('passed out')) {
        hints.push(`User is currently an undergraduate student in ${acadYear.label} (aligns with choice "${choice}"). Do NOT select Graduate.`);
      }
    }

    // Check academic degree alignment
    if (edu.degree) {
      const dLower = edu.degree.toLowerCase();
      if ((cLower.includes("bachelor") && dLower.includes("bachelor")) ||
          (cLower.includes("master") && dLower.includes("master")) ||
          (cLower.includes("phd") && dLower.includes("phd")) ||
          (cLower.includes("high school") && dLower.includes("high school"))) {
        hints.push(`User degree aligns with choice "${choice}" (${edu.degree})`);
      }
    }

    // Check graduation year alignment
    if (edu.graduationYear && cLower.includes(edu.graduationYear)) {
      hints.push(`Graduation year matches choice "${choice}" (${edu.graduationYear})`);
    }

    // Check university alignment
    if (edu.university && cLower.includes(edu.university.toLowerCase())) {
      hints.push(`Institution matches choice "${choice}" (${edu.university})`);
    }

    // Check skills alignment (especially for checkbox lists)
    if (allProfileSkills.has(cLower)) {
      hints.push(`User confirmed skill matches choice "${choice}"`);
    }
  });

  return hints.slice(0, 3);
}

/**
 * Scores memory snippets using BM25 / TF-IDF style term matching and intent boosts.
 * @param {Object} snippet 
 * @param {string[]} queryTokens 
 * @param {string[]} intents 
 * @returns {number} Relevance score
 */
function scoreSnippet(snippet, queryTokens = [], intents = []) {
  if (!snippet) return 0;

  const contentText = `${snippet.title || ''} ${snippet.content || ''}`.toLowerCase();
  const tagsText = (snippet.tags || []).join(' ').toLowerCase();

  let score = 0;

  // 1. Term frequency matching
  queryTokens.forEach(token => {
    // Check in tags (high value)
    if (tagsText.includes(token)) score += 3.5;
    // Check in title (high value)
    if ((snippet.title || '').toLowerCase().includes(token)) score += 2.5;
    // Check in content body
    if (contentText.includes(token)) score += 1.2;
  });

  // 2. Intent category multipliers
  const cat = snippet.category || 'other';

  if (intents.includes(QuestionIntent.WORK_EXPERIENCE) && cat === 'experience') {
    score = (score + 2.0) * 2.2;
  }
  if (intents.includes(QuestionIntent.PROJECTS) && cat === 'project') {
    score = (score + 2.0) * 2.2;
  }
  if (intents.includes(QuestionIntent.SKILLS) && cat === 'skill') {
    score = (score + 2.0) * 2.0;
  }
  if (intents.includes(QuestionIntent.BEHAVIORAL_ESSAY) && cat === 'perspective') {
    score = (score + 2.5) * 2.5;
  }

  return score;
}

/**
 * Retrieves the most relevant snippets for the query, capped to a specific count.
 * @param {Object[]} snippets 
 * @param {string[]} queryTokens 
 * @param {string[]} intents 
 * @param {number} [limit=3] 
 * @returns {Object[]}
 */
/**
 * Retrieves the most relevant snippets for the query, capped to a specific count.
 * Supports experience & story deduplication across multiple questions via usedSnippetIds.
 * @param {Object[]} snippets 
 * @param {string[]} queryTokens 
 * @param {string[]} intents 
 * @param {number} [limit=3] 
 * @param {string[]} [usedSnippetIds=[]] - IDs of snippets already used in prior form questions
 * @returns {Object[]}
 */
function retrieveRelevantSnippets(snippets = [], queryTokens = [], intents = [], limit = 3, usedSnippetIds = []) {
  if (!snippets || snippets.length === 0) return [];

  const usedSet = new Set(Array.isArray(usedSnippetIds) ? usedSnippetIds : []);

  const scored = snippets.map(snippet => ({
    snippet,
    score: scoreSnippet(snippet, queryTokens, intents),
    isUsed: usedSet.has(snippet.id)
  }));

  // Separate positive matches into unused and used
  const positiveMatches = scored.filter(item => item.score > 0);

  if (positiveMatches.length > 0) {
    const unused = positiveMatches.filter(item => !item.isUsed).sort((a, b) => b.score - a.score);
    const used = positiveMatches.filter(item => item.isUsed).sort((a, b) => b.score - a.score);

    // Prioritize unused matching snippets first to prevent repeating stories across questions
    const combined = [...unused, ...used].map(item => item.snippet);
    return combined.slice(0, limit);
  }

  // Fallback: If no explicit keyword hit, provide items aligning with intent (unused first)
  const filterByCat = (category) => {
    const catSnippets = snippets.filter(s => s.category === category);
    const unused = catSnippets.filter(s => !usedSet.has(s.id));
    const used = catSnippets.filter(s => usedSet.has(s.id));
    return [...unused, ...used].slice(0, limit);
  };

  if (intents.includes(QuestionIntent.WORK_EXPERIENCE)) {
    return filterByCat('experience');
  }
  if (intents.includes(QuestionIntent.PROJECTS)) {
    return filterByCat('project');
  }
  if (intents.includes(QuestionIntent.SKILLS)) {
    return filterByCat('skill');
  }
  if (intents.includes(QuestionIntent.BEHAVIORAL_ESSAY)) {
    return filterByCat('perspective');
  }

  const unusedGeneral = snippets.filter(s => !usedSet.has(s.id));
  const usedGeneral = snippets.filter(s => usedSet.has(s.id));
  return [...unusedGeneral, ...usedGeneral].slice(0, Math.min(limit, 2));
}

/**
 * Builds the complete, high-precision contextual memory string for a given question.
 * @param {Object} params
 * @param {string} params.question - The question title/text
 * @param {string} [params.type] - The question type (text_input, multiple_choice, etc.)
 * @param {string[]} [params.choices] - Available options
 * @param {Object} [params.memoryProfile] - Stored memoryProfile object
 * @param {string} [params.customContext] - Any manual custom context entered by user
 * @param {Object} [params.formDigest] - Synthesized macro form outline & objective
 * @param {Array<{ question: string, answer: string, type: string }>} [params.priorAnswers] - Rolling answers previously filled in this form
 * @param {string[]} [params.usedSnippetIds] - IDs of snippets previously injected into earlier questions
 * @param {boolean} [params.returnMetadata] - When true, returns { context, retrievedSnippetIds }
 * @returns {string|{ context: string, retrievedSnippetIds: string[] }} Clean context block or metadata object
 */
function buildSmartMemoryContext({
  question = '',
  type = '',
  choices = [],
  memoryProfile = null,
  customContext = '',
  formDigest = null,
  priorAnswers = [],
  usedSnippetIds = [],
  returnMetadata = false
}) {
  if (!memoryProfile && !customContext && !formDigest && (!priorAnswers || priorAnswers.length === 0)) {
    return returnMetadata ? { context: '', retrievedSnippetIds: [] } : '';
  }

  const sections = [];

  // 1. Whole-Form Macro Context & Objective
  if (formDigest && (formDigest.title || formDigest.macroIntent)) {
    const formLines = [];
    if (formDigest.title && formDigest.title !== 'Google Form') {
      formLines.push(`Form Title: "${formDigest.title}"`);
    }
    if (formDigest.macroIntent) {
      formLines.push(`Form Category: ${formDigest.macroIntent}`);
    }
    if (formDigest.description) {
      const shortDesc = formDigest.description.slice(0, 160);
      formLines.push(`Purpose/Instructions: "${shortDesc}${formDigest.description.length > 160 ? '...' : ''}"`);
    }
    if (formDigest.outline && formDigest.outline.length > 0) {
      formLines.push(`Form Structure: ${formDigest.totalQuestions} questions across form (${formDigest.outline.slice(0, 3).join(', ')}...)`);
    }
    sections.push(`[FORM MACRO CONTEXT & GOAL]\n${formLines.join('\n')}\nGuidance: Formulate your answer so it directly supports the objective and expectations of this ${formDigest.macroIntent || 'form'}.`);
  }

  // 2. Rolling Prior Answers in this Form (Cross-Question Consistency)
  if (priorAnswers && Array.isArray(priorAnswers) && priorAnswers.length > 0) {
    const priorLines = priorAnswers.map(pa => {
      const qShort = (pa.question || '').length > 60 ? `${(pa.question || '').slice(0, 60)}...` : pa.question;
      const aShort = (pa.answer || '').length > 120 ? `${(pa.answer || '').slice(0, 120)}...` : pa.answer;
      return `• Q: "${qShort}" ➔ Answered: "${aShort}"`;
    });
    sections.push(`[PREVIOUS ANSWERS IN THIS FORM]\n${priorLines.join('\n')}\nCRITICAL CONSISTENCY RULE: Maintain 100% logical consistency with these previous answers. Never contradict any choice, date, tool, role, or preference established above.`);
  }

  // 3. Check for deterministic direct match
  const directSlot = resolveDirectSlot(question, memoryProfile);
  if (directSlot) {
    sections.push(`[DIRECT MATCH FACT]\n${directSlot.key}: ${directSlot.value}`);
  }

  // 4. Classify intent & tokenize
  const intents = classifyQuestionIntent(question, type);
  const queryTokens = tokenize(question);

  // 5. Cross-reference choices if options are present
  if (choices && choices.length > 0) {
    const choiceHints = crossReferenceChoices(choices, memoryProfile, intents);
    if (choiceHints.length > 0) {
      sections.push(`[CHOICE HINTS]\n${choiceHints.map(h => `• ${h}`).join('\n')}`);
    }
  }

  // 6. Build Core Identity & Academics summary (concise)
  const id = memoryProfile?.identity || {};
  const edu = memoryProfile?.education || {};
  const links = memoryProfile?.links || {};

  const verifiedLines = [];
  if (id.fullName) verifiedLines.push(`Name: ${id.fullName}`);
  if (id.email) verifiedLines.push(`Email: ${id.email}`);
  if (id.phone) verifiedLines.push(`Phone: ${id.phone}`);
  if (id.whatsapp || id.phone) verifiedLines.push(`WhatsApp: ${id.whatsapp || id.phone}`);
  if (id.location) verifiedLines.push(`Location: ${id.location}`);

  const acadYear = getUserAcademicYear(memoryProfile);
  if (acadYear) verifiedLines.push(`Current Year of Study: ${acadYear.label} (Undergraduate)`);

  if (edu.university) verifiedLines.push(`University: ${edu.university}`);
  if (edu.degree) verifiedLines.push(`Degree: ${edu.degree}`);
  if (edu.major || edu.department) {
    const m = (edu.major || edu.department).trim();
    const expanded = (m.toLowerCase() === 'it') ? 'IT (Information Technology)' : m;
    verifiedLines.push(`Department / Major: ${expanded}`);
  }
  if (edu.graduationYear) verifiedLines.push(`Graduation Year: Class of ${edu.graduationYear}`);
  if (edu.gpa) verifiedLines.push(`GPA: ${edu.gpa}`);

  const linkItems = [];
  if (links.github) linkItems.push(`GitHub: ${links.github}`);
  if (links.linkedin) linkItems.push(`LinkedIn: ${links.linkedin}`);
  if (links.portfolio) linkItems.push(`Portfolio: ${links.portfolio}`);
  if (linkItems.length > 0) verifiedLines.push(linkItems.join(' | '));

  if (verifiedLines.length > 0 && !directSlot) {
    sections.push(`[USER VERIFIED PROFILE]\n${verifiedLines.join('\n')}`);
  }

  // 7. Retrieve ranked memory snippets with deduplication
  const snippets = memoryProfile?.snippets || [];
  let retrievedSnippets = [];
  if (snippets.length > 0) {
    retrievedSnippets = retrieveRelevantSnippets(snippets, queryTokens, intents, 3, usedSnippetIds);
    if (retrievedSnippets.length > 0) {
      const snippetLines = retrievedSnippets.map(s => {
        const title = s.title ? `[${s.title}] ` : '';
        const tags = s.tags && s.tags.length > 0 ? ` (Tags: ${s.tags.join(', ')})` : '';
        return `• ${title}${s.content}${tags}`;
      });
      let snippetBlock = `[RELEVANT MEMORY & EXPERIENCES]\n${snippetLines.join('\n')}`;
      if (priorAnswers && priorAnswers.length > 0) {
        snippetBlock += `\nDEDUPLICATION GUIDANCE: Do not repeat stories, anecdotes, or projects already detailed in previous answers. Highlight distinct experiences and perspectives for each response.`;
      }
      sections.push(snippetBlock);
    }
  }

  // 8. Include user manual context if provided
  if (customContext && customContext.trim()) {
    sections.push(`[ADDITIONAL USER PERSONA]\n${customContext.trim()}`);
  }

  // Budget output length to ~400 words to avoid prompt bloat
  const fullText = sections.join('\n\n');
  const words = fullText.split(/\s+/);
  let outputText = fullText;
  if (words.length > 420) {
    outputText = words.slice(0, 420).join(' ') + '...';
  }

  if (returnMetadata) {
    return {
      context: outputText,
      retrievedSnippetIds: retrievedSnippets.map(s => s.id).filter(Boolean)
    };
  }

  return outputText;
}

// Universal module export (Node.js for testing & browser/service worker)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STOPWORDS,
    SHORT_KEYWORDS,
    DEPARTMENT_ALIASES,
    DEGREE_ALIASES,
    extractLocationParts,
    getUserAcademicYear,
    tokenize,
    QuestionIntent,
    FormMacroIntent,
    classifyQuestionIntent,
    classifyFormMacroIntent,
    buildFormDigest,
    resolveDirectSlot,
    resolveDirectChoice,
    crossReferenceChoices,
    scoreSnippet,
    retrieveRelevantSnippets,
    buildSmartMemoryContext
  };
}

if (typeof globalThis !== 'undefined') {
  globalThis.MemoryRetriever = {
    STOPWORDS,
    SHORT_KEYWORDS,
    DEPARTMENT_ALIASES,
    DEGREE_ALIASES,
    extractLocationParts,
    getUserAcademicYear,
    tokenize,
    QuestionIntent,
    FormMacroIntent,
    classifyQuestionIntent,
    classifyFormMacroIntent,
    buildFormDigest,
    resolveDirectSlot,
    resolveDirectChoice,
    crossReferenceChoices,
    scoreSnippet,
    retrieveRelevantSnippets,
    buildSmartMemoryContext
  };
}
