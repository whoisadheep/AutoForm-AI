/**
 * Pre-formatted prompt for extracting profile & memories from ChatGPT, Gemini, Claude, etc.
 * Specially formatted for neutral 3rd-person phrasing and direct AutoForm parsing.
 */
const MEMORY_EXPORT_PROMPT = `You are helping me export my profile and context to AutoForm AI, an intelligent form-filling assistant. Your job is to review our past conversations, stored memory, and user profile, and summarize everything you know about me into a structured format for forms, applications, and surveys.

Guidelines:
- In the output, avoid using first-person pronouns (I, my, me, mine) and second-person pronouns (you, your, yours). Refer to the subject neutrally as "the user" or use factual statements.
- Output ONLY the structured information below. Do not include any conversational filler, intro greetings, or sign-offs.
- If any contact detail or link is unknown or was never mentioned, leave it blank. Do not invent details.

Format your output exactly as follows:

--- IDENTITY & CONTACT ---
Full Name: 
Email: 
Phone: 
Location / Residence: 
GitHub: 
LinkedIn: 
Portfolio / Website: 
Twitter / X: 

--- EDUCATION & ACADEMICS ---
University / Institution: 
College / Campus: 
Degree: 
Major / Field of Study: 
Current Year of Study: 
Graduation Year: 
GPA: 
Roll / Register Number / USN: 

--- WORK EXPERIENCE & ROLES ---
(List each role or past position as a bullet point. Include company/organization, title, key responsibilities, and achievements.)
* Role at [Organization]: [Details of work, achievements, and impact]

--- PROJECTS & ACCOMPLISHMENTS ---
(List notable projects, open-source work, apps, or hackathons.)
* Project [Name]: [What was built, technologies used, and outcomes]

--- SKILLS & TOOLS ---
(List technical skills, programming languages, frameworks, domain expertise, and tools.)
* Technical Stack & Skills: [Languages, frameworks, tools, proficiencies]

--- PERSPECTIVES, PREFERENCES & VALUES ---
(Summarize core values, career goals, preferred work styles, problem-solving philosophies, and standard application viewpoints that help answer open-ended form questions like "Why you?", "Describe a challenge", etc.)
* Perspective: [Beliefs, work philosophy, career goals, or communication preferences]

--- ADDITIONAL BACKGROUND ---
(Any other sustained facts, hobbies, or unique context remembered about the user.)
* Background: [Additional relevant details]

Imported from: <ChatGPT / Gemini / Claude / etc.>`;

// Default schema
const defaultProfile = {
  identity: { fullName: "", email: "", phone: "", whatsapp: "", location: "" },
  links: { linkedin: "", github: "", portfolio: "", twitter: "" },
  education: { university: "", college: "", degree: "", major: "", currentYear: "", graduationYear: "", gpa: "", rollNumber: "" },
  snippets: [],
  rawImport: "",
  updatedAt: new Date().toISOString()
};

let memoryProfile = JSON.parse(JSON.stringify(defaultProfile));
let saveTimeout = null;

document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  setupEventListeners();
  renderSnippets();
  loadAccountStatus();
});

async function loadData() {
  const data = await chrome.storage.local.get('memoryProfile');
  if (data.memoryProfile) {
    memoryProfile = { ...defaultProfile, ...data.memoryProfile };
    // Deep merge to ensure all keys exist
    memoryProfile.identity = { ...defaultProfile.identity, ...(data.memoryProfile.identity || {}) };
    memoryProfile.links = { ...defaultProfile.links, ...(data.memoryProfile.links || {}) };
    memoryProfile.education = { ...defaultProfile.education, ...(data.memoryProfile.education || {}) };
    memoryProfile.snippets = data.memoryProfile.snippets || [];
  }
  
  // Populate form
  const inputs = document.querySelectorAll('input[data-group], textarea[data-group]');
  inputs.forEach(input => {
    const group = input.dataset.group;
    const field = input.dataset.field;
    if (memoryProfile[group] && memoryProfile[group][field] !== undefined) {
      input.value = memoryProfile[group][field];
    }
  });
  
    updateSnippetCount();
    loadStoredResume();
}

function setupEventListeners() {
  // Auto-save for all inputs
  const inputs = document.querySelectorAll('input[data-group], textarea[data-group]');
  inputs.forEach(input => {
    input.addEventListener('input', (e) => {
      const group = e.target.dataset.group;
      const field = e.target.dataset.field;
      memoryProfile[group][field] = e.target.value;
      debounceSave();
    });
  });

  // Resume Vault File Upload Listeners
  const dropzone = document.getElementById('resumeDropzone');
  const fileInput = document.getElementById('resumeFileInput');
  const btnBrowse = document.getElementById('btnBrowseResume');
  const btnReplace = document.getElementById('btnReplaceResume');
  const btnRemove = document.getElementById('btnRemoveResume');
  const btnDownload = document.getElementById('btnDownloadStoredResume');

  if (dropzone && fileInput) {
    if (btnBrowse) {
      btnBrowse.addEventListener('click', (e) => {
        e.stopPropagation();
        fileInput.click();
      });
    }

    dropzone.addEventListener('click', () => {
      fileInput.click();
    });

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleResumeFileUpload(e.dataTransfer.files[0]);
      }
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        handleResumeFileUpload(e.target.files[0]);
      }
    });
  }

  if (btnReplace && fileInput) {
    btnReplace.addEventListener('click', () => {
      fileInput.click();
    });
  }

  if (btnRemove) {
    btnRemove.addEventListener('click', async () => {
      if (confirm('Are you sure you want to remove your stored resume from AutoForm AI?')) {
        await chrome.storage.local.remove(['storedResume']);
        renderStoredResumeUI(null);
        showSaveStatus('Stored resume removed');
      }
    });
  }

  if (btnDownload) {
    btnDownload.addEventListener('click', () => {
      chrome.storage.local.get(['storedResume'], (data) => {
        if (data.storedResume && data.storedResume.dataUrl) {
          const a = document.createElement('a');
          a.href = data.storedResume.dataUrl;
          a.download = data.storedResume.fileName || 'Resume.pdf';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } else {
          showSaveStatus('No resume file stored to download');
        }
      });
    });
  }

  document.getElementById('btnImport').addEventListener('click', handleImport);
  document.getElementById('btnClearAll').addEventListener('click', handleClearAll);

  // Segmented Tab Navigation
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabPanels = document.querySelectorAll('.tab-panel');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.tab;
      tabBtns.forEach(b => b.classList.remove('active'));
      tabPanels.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const targetPanel = document.getElementById(targetId);
      if (targetPanel) targetPanel.classList.add('active');
    });
  });

  // Snippet Category Filter Pills
  const filterPills = document.querySelectorAll('.filter-pill');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      currentFilter = pill.dataset.category || 'all';
      renderSnippets();
    });
  });

  // Quick Prompt Export buttons
  const btnCopyPrompt = document.getElementById('btnCopyPrompt');
  if (btnCopyPrompt) btnCopyPrompt.addEventListener('click', copyPromptToClipboard);

  const btnTogglePreview = document.getElementById('btnTogglePromptPreview');
  if (btnTogglePreview) btnTogglePreview.addEventListener('click', togglePromptPreview);

  const btnCopyFromPreview = document.getElementById('btnCopyFromPreview');
  if (btnCopyFromPreview) btnCopyFromPreview.addEventListener('click', copyPromptToClipboard);
  
  document.getElementById('btnShowAddSnippet').addEventListener('click', () => {
    clearSnippetForm();
    document.getElementById('snippetFormContainer').classList.remove('hidden');
  });
  
  document.getElementById('btnCancelSnippet').addEventListener('click', () => {
    document.getElementById('snippetFormContainer').classList.add('hidden');
  });
  
  document.getElementById('btnSaveSnippet').addEventListener('click', handleSaveSnippet);
}

// ---------------------------------------------------------------------------
// Resume Vault & Smart Document Uploader
// ---------------------------------------------------------------------------

function loadStoredResume() {
  chrome.storage.local.get(['storedResume'], (data) => {
    renderStoredResumeUI(data.storedResume || null);
  });
}

function renderStoredResumeUI(storedResume) {
  const dropzone = document.getElementById('resumeDropzone');
  const card = document.getElementById('storedResumeCard');
  const nameEl = document.getElementById('storedResumeFileName');
  const sizeEl = document.getElementById('storedResumeFileSize');
  const dateEl = document.getElementById('storedResumeUploadedAt');
  const countEl = document.getElementById('storedResumeExtractedCount');

  if (!dropzone || !card) return;

  if (storedResume && storedResume.fileName) {
    dropzone.classList.add('hidden');
    card.classList.remove('hidden');

    if (nameEl) nameEl.textContent = storedResume.fileName;
    if (sizeEl) sizeEl.textContent = storedResume.fileSize ? `${Math.round(storedResume.fileSize / 1024)} KB` : '';
    if (dateEl && storedResume.uploadedAt) {
      const d = new Date(storedResume.uploadedAt);
      dateEl.textContent = d.toLocaleDateString();
    }
    if (countEl) {
      countEl.textContent = storedResume.fieldsExtracted ? `${storedResume.fieldsExtracted} fields extracted` : 'Profile synced';
    }
  } else {
    card.classList.add('hidden');
    dropzone.classList.remove('hidden');
  }
}

async function handleResumeFileUpload(file) {
  if (!file) return;

  const dropzoneContent = document.querySelector('.dropzone-content');
  const progressBox = document.getElementById('resumeUploadProgress');
  const statusText = document.getElementById('resumeUploadStatusText');

  if (dropzoneContent) dropzoneContent.classList.add('hidden');
  if (progressBox) progressBox.classList.remove('hidden');
  if (statusText) statusText.textContent = 'Extracting resume text...';

  try {
    // 1. Convert file to Base64 data URL for storage & auto-attaching
    const extractor = (typeof ResumeExtractor !== 'undefined' ? ResumeExtractor : (globalThis.ResumeExtractor || {}));
    let dataUrl = '';
    if (typeof extractor.fileToDataUrl === 'function') {
      dataUrl = await extractor.fileToDataUrl(file);
    } else {
      dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    // 2. Extract plain text from document
    let extractedText = '';
    if (typeof extractor.extractTextFromFile === 'function') {
      const res = await extractor.extractTextFromFile(file);
      extractedText = res.text || '';
    } else if (typeof file.text === 'function') {
      extractedText = await file.text();
    }

    if (statusText) statusText.textContent = 'Parsing profile with AI...';

    // 3. Parse resume with AI backend or local fallback
    let parsedProfile = null;
    let extractedCount = 0;

    const bgRes = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: "PARSE_RESUME",
        resumeText: extractedText,
        fileName: file.name
      }, res => {
        if (chrome.runtime.lastError || !res || !res.success) {
          resolve(null);
        } else {
          resolve(res.profile);
        }
      });
    });

    if (bgRes) {
      parsedProfile = bgRes;
    } else if (typeof extractor.parseResumeStructure === 'function') {
      parsedProfile = extractor.parseResumeStructure(extractedText, file.name);
    }

    // 4. Merge extracted data into user memoryProfile
    if (parsedProfile) {
      if (parsedProfile.identity) {
        Object.entries(parsedProfile.identity).forEach(([k, v]) => {
          if (v && (!memoryProfile.identity[k] || !memoryProfile.identity[k].trim())) {
            memoryProfile.identity[k] = v;
            extractedCount++;
          }
        });
      }
      if (parsedProfile.links) {
        Object.entries(parsedProfile.links).forEach(([k, v]) => {
          if (v && (!memoryProfile.links[k] || !memoryProfile.links[k].trim())) {
            memoryProfile.links[k] = v;
            extractedCount++;
          }
        });
      }
      if (parsedProfile.education) {
        Object.entries(parsedProfile.education).forEach(([k, v]) => {
          if (v && (!memoryProfile.education[k] || !memoryProfile.education[k].trim())) {
            memoryProfile.education[k] = v;
            extractedCount++;
          }
        });
      }
      if (Array.isArray(parsedProfile.snippets) && parsedProfile.snippets.length > 0) {
        parsedProfile.snippets.forEach(s => {
          if (s.content && !memoryProfile.snippets.some(exist => exist.title === s.title)) {
            memoryProfile.snippets.push({
              id: s.id || ('snippet-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6)),
              category: s.category || 'experience',
              title: s.title || 'Resume Milestone',
              content: s.content,
              tags: s.tags || [],
              createdAt: new Date().toISOString()
            });
            extractedCount++;
          }
        });
      }
    }

    // 5. Store resume file object in chrome.storage.local
    const storedResume = {
      id: 'resume-' + Date.now(),
      fileName: file.name,
      fileType: file.type || 'application/pdf',
      fileSize: file.size,
      lastModified: file.lastModified,
      dataUrl,
      rawText: extractedText.slice(0, 10000),
      fieldsExtracted: extractedCount,
      uploadedAt: new Date().toISOString()
    };

    await chrome.storage.local.set({ storedResume, memoryProfile });

    // 6. Refresh UI
    renderStoredResumeUI(storedResume);
    renderSnippets();
    updateSnippetCount();

    // Reload input values in Profile Details tab
    const inputs = document.querySelectorAll('input[data-group], textarea[data-group]');
    inputs.forEach(input => {
      const group = input.dataset.group;
      const field = input.dataset.field;
      if (memoryProfile[group] && memoryProfile[group][field] !== undefined) {
        input.value = memoryProfile[group][field];
      }
    });

    showSaveStatus(`Resume saved! ${extractedCount} profile fields extracted ✓`);

  } catch (err) {
    console.error('[AutoForm Resume Upload Error]:', err);
    showSaveStatus('Failed to parse resume: ' + err.message);
  } finally {
    if (dropzoneContent) dropzoneContent.classList.remove('hidden');
    if (progressBox) progressBox.classList.add('hidden');
  }
}

/**
 * Copies the AutoForm AI export prompt to clipboard with visual feedback.
 */
function copyPromptToClipboard() {
  const textEl = document.getElementById('copyPromptText');
  const origText = textEl ? textEl.textContent : 'Copy Export Prompt';

  const onCopied = () => {
    if (textEl) textEl.textContent = 'Copied! ✓';
    showSaveStatus('Prompt copied to clipboard! ✓');
    setTimeout(() => {
      if (textEl) textEl.textContent = origText;
    }, 2500);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(MEMORY_EXPORT_PROMPT).then(onCopied).catch(() => {
      fallbackCopyPrompt(onCopied);
    });
  } else {
    fallbackCopyPrompt(onCopied);
  }
}

function fallbackCopyPrompt(callback) {
  const ta = document.createElement('textarea');
  ta.value = MEMORY_EXPORT_PROMPT;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    if (callback) callback();
  } catch (_) {
    showSaveStatus('Could not copy automatically');
  }
  document.body.removeChild(ta);
}

/**
 * Toggles the export prompt preview box visibility.
 */
function togglePromptPreview() {
  const box = document.getElementById('promptPreviewBox');
  const toggleBtn = document.getElementById('togglePromptText');
  const preview = document.getElementById('promptPreviewContent');
  if (!box) return;

  if (box.classList.contains('hidden')) {
    if (preview) preview.textContent = MEMORY_EXPORT_PROMPT;
    box.classList.remove('hidden');
    if (toggleBtn) toggleBtn.textContent = 'Hide Prompt';
  } else {
    box.classList.add('hidden');
    if (toggleBtn) toggleBtn.textContent = 'View Prompt';
  }
}

function debounceSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(saveData, 500);
}

async function saveData() {
  memoryProfile.updatedAt = new Date().toISOString();
  await chrome.storage.local.set({ memoryProfile });
  showSaveStatus();
}

function showSaveStatus(customMsg = 'Saved ✓') {
  const status = document.getElementById('saveStatus');
  if (!status) return;
  status.textContent = customMsg;
  status.classList.add('visible');
  setTimeout(() => {
    status.classList.remove('visible');
    setTimeout(() => { status.textContent = 'Saved ✓'; }, 300);
  }, 2500);
}

function handleImport() {
  const rawText = document.getElementById('importText').value;
  if (!rawText.trim()) return;

  const previousCount = memoryProfile.snippets.length;
  parseImportedText(rawText);
  document.getElementById('importText').value = '';

  // Reload form UI
  const inputs = document.querySelectorAll('input[data-group], textarea[data-group]');
  inputs.forEach(input => {
    const group = input.dataset.group;
    const field = input.dataset.field;
    if (memoryProfile[group] && memoryProfile[group][field] !== undefined) {
      input.value = memoryProfile[group][field] || '';
    }
  });

  renderSnippets();
  saveData();

  const newSnippets = memoryProfile.snippets.length - previousCount;
  const msg = newSnippets > 0 
    ? `Imported ${newSnippets} snippet${newSnippets === 1 ? '' : 's'} ✓` 
    : 'Profile updated ✓';
  showSaveStatus(msg);
}

function parseImportedText(text) {
  memoryProfile.rawImport = text;
  const capturedLines = new Set();
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

  // Helper to normalize and assign URLs
  function assignUrl(rawUrl) {
    let url = rawUrl.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    const lower = url.toLowerCase();
    if (lower.includes('github.com') && !memoryProfile.links.github) {
      memoryProfile.links.github = url;
    } else if (lower.includes('linkedin.com') && !memoryProfile.links.linkedin) {
      memoryProfile.links.linkedin = url;
    } else if ((lower.includes('twitter.com') || lower.includes('x.com')) && !memoryProfile.links.twitter) {
      memoryProfile.links.twitter = url;
    } else if (!memoryProfile.links.portfolio) {
      memoryProfile.links.portfolio = url;
    }
  }

  // 1. Explicit Key: Value headers matching (Resumes, bio templates)
  lines.forEach(line => {
    const kvMatch = line.match(/^([\w\s/]+)[:=–—]\s*(.+)$/);
    if (!kvMatch) return;

    const key = kvMatch[1].trim().toLowerCase();
    const val = kvMatch[2].trim().replace(/^["']|["']$/g, '');
    if (!val) return;

    if ((key.includes('name') && !key.includes('project') && !key.includes('company') && !key.includes('role')) && !memoryProfile.identity.fullName) {
      memoryProfile.identity.fullName = val;
      capturedLines.add(line);
    } else if ((key.includes('whatsapp') || key.includes('wa number') || key === 'wa') && !memoryProfile.identity.whatsapp) {
      memoryProfile.identity.whatsapp = val;
      capturedLines.add(line);
    } else if ((key.includes('email') || key.includes('gmail') || key.includes('mail')) && !memoryProfile.identity.email) {
      memoryProfile.identity.email = val;
      capturedLines.add(line);
    } else if ((key.includes('phone') || key.includes('tel') || key.includes('mobile') || key.includes('cell') || key.includes('contact')) && !key.includes('whatsapp') && !memoryProfile.identity.phone) {
      memoryProfile.identity.phone = val;
      capturedLines.add(line);
    } else if ((key.includes('location') || key.includes('residence') || key.includes('address') || key.includes('city') || key.includes('country') || key.includes('based in') || key.includes('lives in')) && !memoryProfile.identity.location) {
      memoryProfile.identity.location = val;
      capturedLines.add(line);
    } else if ((key.includes('college') || key.includes('campus')) && !key.includes('university') && !memoryProfile.education.college) {
      memoryProfile.education.college = val;
      capturedLines.add(line);
    } else if ((key.includes('university') || key.includes('institution') || key.includes('college') || key.includes('school')) && !memoryProfile.education.university) {
      memoryProfile.education.university = val;
      capturedLines.add(line);
    } else if ((key.includes('degree') || key.includes('qualification')) && !memoryProfile.education.degree) {
      memoryProfile.education.degree = val;
      capturedLines.add(line);
    } else if ((key.includes('major') || key.includes('department') || key.includes('dept') || key.includes('branch') || key.includes('field of study') || key.includes('specialization')) && !memoryProfile.education.major) {
      memoryProfile.education.major = val;
      capturedLines.add(line);
    } else if ((key.includes('current year') || key.includes('year of study') || key.includes('academic year') || key.includes('studying year') || key === 'year') && !memoryProfile.education.currentYear) {
      memoryProfile.education.currentYear = val;
      capturedLines.add(line);
    } else if ((key.includes('graduation') || key.includes('grad year') || key.includes('class of')) && !memoryProfile.education.graduationYear) {
      memoryProfile.education.graduationYear = val;
      capturedLines.add(line);
    } else if (key.trim() === 'gpa' && !memoryProfile.education.gpa) {
      memoryProfile.education.gpa = val;
      capturedLines.add(line);
    } else if ((key.includes('roll') || key.includes('register number') || key.includes('registration number') || key.includes('reg no') || key.includes('usn') || key.includes('student id')) && !memoryProfile.education.rollNumber) {
      memoryProfile.education.rollNumber = val;
      capturedLines.add(line);
    } else if (key.includes('github')) {
      assignUrl(val);
      capturedLines.add(line);
    } else if (key.includes('linkedin')) {
      assignUrl(val);
      capturedLines.add(line);
    } else if (key.includes('portfolio') || key.includes('website') || key.includes('site')) {
      assignUrl(val);
      capturedLines.add(line);
    } else if (key.includes('twitter') || key === 'x') {
      assignUrl(val);
      capturedLines.add(line);
    }
  });

  // 2. Email extraction via regex fallback
  if (!memoryProfile.identity.email) {
    const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/);
    if (emailMatch) memoryProfile.identity.email = emailMatch[0];
  }

  // 3. Phone extraction via regex fallback
  if (!memoryProfile.identity.phone) {
    const phoneMatches = text.match(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,9}/g) || [];
    const validPhones = phoneMatches.filter(p => {
      const digits = p.replace(/\D/g, '');
      return digits.length >= 8 && digits.length <= 15;
    });
    if (validPhones.length > 0) {
      memoryProfile.identity.phone = validPhones[0].trim();
    }
  }

  // 4. URL extraction (both full URLs and bare domains)
  const urlRegex = /(?:https?:\/\/|www\.)[^\s<>"{}|\\^`\[\]]+|(?:github\.com|linkedin\.com\/(?:in|company))\S+/gi;
  const urls = text.match(urlRegex) || [];
  urls.forEach(u => assignUrl(u));

  // 5. ChatGPT Memory phrasing & bio phrases
  lines.forEach(line => {
    // "Lives in X" or "Based in X" or "Located in X"
    if (!memoryProfile.identity.location) {
      const locMatch = line.match(/(?:lives in|based in|located in|living in)\s+([^.,;\n]+)/i);
      if (locMatch && locMatch[1].trim().length < 50) {
        memoryProfile.identity.location = locMatch[1].trim();
      }
    }

    // "Name is X" or "I am X"
    if (!memoryProfile.identity.fullName) {
      const nameMatch = line.match(/(?:my name is|name is|user's name is)\s+([A-Za-z\s'-]{2,35})/i);
      if (nameMatch && nameMatch[1].trim().split(/\s+/).length <= 4) {
        memoryProfile.identity.fullName = nameMatch[1].trim();
      }
    }

    // "Studied at X" or "Attending X" or "Student at X"
    if (!memoryProfile.education.university) {
      const uniMatch = line.match(/(?:student at|studies at|studied at|attending|graduated from)\s+([^.,;\n]+(?:university|college|institute|polytechnic|academy))/i);
      if (uniMatch) {
        memoryProfile.education.university = uniMatch[1].trim();
      }
    }

    // "Current year" / "Fourth year student"
    if (!memoryProfile.education.currentYear) {
      const yrMatch = line.match(/\b(1st|2nd|3rd|4th|first|second|third|fourth|final)\s+year(?:\s+student)?\b/i);
      if (yrMatch) {
        memoryProfile.education.currentYear = yrMatch[0].trim();
      }
    }

    // "Majoring in X" or "Major in X" or "Degree in X" or "Department of X"
    if (!memoryProfile.education.major) {
      const majorMatch = line.match(/(?:majoring in|major in|degree in|department of|studying in)\s+([^.,;\n]+)/i);
      if (majorMatch && majorMatch[1].trim().length < 40) {
        memoryProfile.education.major = majorMatch[1].trim();
      }
    }
  });

  // 6. Name extraction heuristic from top lines if still empty
  if (!memoryProfile.identity.fullName) {
    for (const line of lines.slice(0, 5)) {
      if (capturedLines.has(line)) continue;
      const cleanLine = line.replace(/^[#*\-•\s]+/, '').trim();
      const words = cleanLine.split(/\s+/);
      if (words.length >= 2 && words.length <= 4 &&
          !cleanLine.match(/https?:\/\/|@|\.com|\.org|\b(?:resume|curriculum|cv|summary|profile|developer|engineer|designer)\b/i) &&
          words.every(w => /^[A-Z][a-z'-]+$/.test(w))) {
        memoryProfile.identity.fullName = cleanLine;
        capturedLines.add(line);
        break;
      }
    }
  }

  // 7. Education keywords fallback for general lines
  if (!memoryProfile.education.university || !memoryProfile.education.degree) {
    const eduKeywords = ["university", "college", "bachelor", "master", "b.tech", "b.sc", "m.sc", "phd", "degree"];
    for (const line of lines) {
      if (capturedLines.has(line)) continue;
      const lowerLine = line.toLowerCase();
      if (eduKeywords.some(kw => lowerLine.includes(kw))) {
        if (!memoryProfile.education.university && (lowerLine.includes('university') || lowerLine.includes('college'))) {
          memoryProfile.education.university = line.replace(/^[#*\-•\s]+/, '').trim();
          capturedLines.add(line);
        } else if (!memoryProfile.education.degree) {
          memoryProfile.education.degree = line.replace(/^[#*\-•\s]+/, '').trim();
          capturedLines.add(line);
        }
      }
    }
  }

  // 8. Snippet generation: split into discrete memory chunks
  // Matches paragraphs, bullet points (- or • or *), or numbered lists
  const rawChunks = text
    .split(/\n\s*\n|\n\s*[-*•]\s+|\n\s*\d+\.\s+/)
    .map(c => c.replace(/^[#*\-•\s]+/, '').trim())
    .filter(c => c.length > 18);

  const techKeywords = [
    'python', 'javascript', 'typescript', 'react', 'node', 'vue', 'angular',
    'next.js', 'html', 'css', 'tailwind', 'sql', 'postgres', 'mongodb',
    'docker', 'kubernetes', 'aws', 'gcp', 'git', 'linux', 'c++', 'java',
    'rust', 'go', 'graphql', 'machine learning', 'ai', 'llm', 'figma'
  ];

  rawChunks.forEach(chunk => {
    // Skip divider headers, prompt instructions, and import metadata
    if (chunk.startsWith('---') || chunk.startsWith('===') || chunk.startsWith('###') ||
        chunk.startsWith('(') ||
        chunk.toLowerCase().startsWith('imported from:') ||
        chunk.length < 15) {
      return;
    }

    // Skip if identical to captured simple fields
    if (chunk === memoryProfile.identity.fullName ||
        chunk === memoryProfile.identity.email ||
        chunk === memoryProfile.identity.phone ||
        chunk === memoryProfile.identity.location ||
        capturedLines.has(chunk)) {
      return;
    }

    // Skip if already in snippets (avoid duplicate imports)
    const isDuplicate = memoryProfile.snippets.some(s => s.content.trim() === chunk.trim());
    if (isDuplicate) return;

    const lowerChunk = chunk.toLowerCase();
    let category = "other";
    if (lowerChunk.match(/\b(?:role|work|worked|job|experience|led|managed|responsibilities|company|intern|engineer|developer)\b/)) {
      category = "experience";
    } else if (lowerChunk.match(/\b(?:project|build|built|develop|developed|created|designed|implemented|hackathon|app|tool|repository)\b/)) {
      category = "project";
    } else if (lowerChunk.match(/\b(?:technical stack|skills|skill|proficient|expertise|framework|tools|languages|stack|fluent)\b/)) {
      category = "skill";
    } else if (lowerChunk.match(/\b(?:perspective|believe|think|approach|philosophy|prefer|interested|goal|passion|values)\b/)) {
      category = "perspective";
    } else if (lowerChunk.match(/\b(?:university|degree|gpa|graduated|coursework|academic|bachelor|master|phd)\b/)) {
      category = "other";
    }

    const tags = techKeywords.filter(kw => lowerChunk.includes(kw));

    // Extract a clean readable title: check if there's a label before a colon (e.g. "Role at Google: ...")
    let title = '';
    const colonIdx = chunk.indexOf(':');
    if (colonIdx > 2 && colonIdx <= 45 && !chunk.slice(0, colonIdx).includes('\n')) {
      title = chunk.slice(0, colonIdx).replace(/^[#*\-•\s]+/, '').trim();
    } else {
      const firstSentence = chunk.split(/[.?!]\s+/)[0];
      title = firstSentence.length <= 45
        ? firstSentence
        : chunk.substring(0, 42).trim() + "...";
    }

    const snippet = {
      id: crypto.randomUUID ? crypto.randomUUID() : 'snip_' + Math.random().toString(36).substring(2, 11),
      category,
      title,
      content: chunk,
      tags,
      createdAt: new Date().toISOString()
    };

    memoryProfile.snippets.push(snippet);
  });
}

function handleSaveSnippet() {
  const id = document.getElementById('snippet-id').value || crypto.randomUUID();
  const category = document.getElementById('snippet-category').value;
  const title = document.getElementById('snippet-title').value;
  const content = document.getElementById('snippet-content').value;
  const tagsText = document.getElementById('snippet-tags').value;
  const tags = tagsText.split(',').map(t => t.trim()).filter(t => t.length > 0);
  
  if (!content.trim()) return;
  
  const snippet = {
    id,
    category,
    title: title || content.substring(0, 30) + "...",
    content,
    tags,
    createdAt: new Date().toISOString()
  };
  
  const index = memoryProfile.snippets.findIndex(s => s.id === id);
  if (index >= 0) {
    memoryProfile.snippets[index] = snippet;
  } else {
    memoryProfile.snippets.unshift(snippet);
  }
  
  document.getElementById('snippetFormContainer').classList.add('hidden');
  renderSnippets();
  saveData();
}

function clearSnippetForm() {
  document.getElementById('snippet-id').value = '';
  document.getElementById('snippet-category').value = 'other';
  document.getElementById('snippet-title').value = '';
  document.getElementById('snippet-content').value = '';
  document.getElementById('snippet-tags').value = '';
}

let currentFilter = 'all';

function renderSnippets() {
  const container = document.getElementById('snippetsList');
  if (!container) return;
  container.innerHTML = '';
  
  const allSnippets = memoryProfile.snippets || [];
  const filtered = currentFilter === 'all'
    ? allSnippets
    : allSnippets.filter(s => (s.category || 'other').toLowerCase() === currentFilter);

  const emptyState = document.getElementById('snippetsEmptyState');
  if (emptyState) {
    if (filtered.length === 0) emptyState.classList.remove('hidden');
    else emptyState.classList.add('hidden');
  }

  filtered.forEach(snippet => {
    const card = document.createElement('div');
    card.className = 'snippet-card';
    
    const header = document.createElement('div');
    header.className = 'snippet-header';
    
    const title = document.createElement('h3');
    title.className = 'snippet-title';
    title.textContent = snippet.title;
    
    const catName = (snippet.category || 'other').toLowerCase();
    const category = document.createElement('span');
    category.className = `snippet-category cat-${catName}`;
    category.textContent = snippet.category || 'other';
    
    header.appendChild(title);
    header.appendChild(category);
    
    const content = document.createElement('div');
    content.className = 'snippet-content';
    content.textContent = snippet.content;
    
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'snippet-tags';
    (snippet.tags || []).forEach(tagText => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = tagText;
      tagsContainer.appendChild(tag);
    });
    
    const actions = document.createElement('div');
    actions.className = 'snippet-actions';
    
    const btnEdit = document.createElement('button');
    btnEdit.className = 'btn btn-secondary btn-small';
    btnEdit.textContent = 'Edit';
    btnEdit.onclick = () => editSnippet(snippet.id);
    
    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn btn-danger btn-small';
    btnDelete.textContent = 'Delete';
    btnDelete.onclick = () => deleteSnippet(snippet.id);
    
    actions.appendChild(btnEdit);
    actions.appendChild(btnDelete);
    
    card.appendChild(header);
    card.appendChild(content);
    if (snippet.tags && snippet.tags.length > 0) {
      card.appendChild(tagsContainer);
    }
    card.appendChild(actions);
    
    container.appendChild(card);
  });
  
  updateSnippetCount();
}

function editSnippet(id) {
  const snippet = memoryProfile.snippets.find(s => s.id === id);
  if (!snippet) return;
  
  document.getElementById('snippet-id').value = snippet.id;
  document.getElementById('snippet-category').value = snippet.category;
  document.getElementById('snippet-title').value = snippet.title;
  document.getElementById('snippet-content').value = snippet.content;
  document.getElementById('snippet-tags').value = (snippet.tags || []).join(', ');
  
  document.getElementById('snippetFormContainer').classList.remove('hidden');
}

function deleteSnippet(id) {
  if (confirm('Are you sure you want to delete this snippet?')) {
    memoryProfile.snippets = memoryProfile.snippets.filter(s => s.id !== id);
    renderSnippets();
    saveData();
  }
}

function updateSnippetCount() {
  const count = (memoryProfile.snippets || []).length;
  const badge = document.getElementById('snippetCount');
  const tabBadge = document.getElementById('tabSnippetCount');
  if (badge) badge.textContent = String(count);
  if (tabBadge) tabBadge.textContent = String(count);
}

async function handleClearAll() {
  if (confirm('Are you sure you want to clear ALL memory and profile data? This cannot be undone.')) {
    memoryProfile = JSON.parse(JSON.stringify(defaultProfile));
    
    const inputs = document.querySelectorAll('input[data-group], textarea[data-group]');
    inputs.forEach(input => input.value = '');
    
    renderSnippets();
    await chrome.storage.local.set({ memoryProfile });
    showSaveStatus('Cleared all data');
  }
}

// ---------------------------------------------------------------------------
// Tab 4: Server & Connection Settings
// ---------------------------------------------------------------------------

/**
 * Loads current server connection status and displays it in the Server tab.
 */
function loadServerStatus() {
    const urlEl = document.getElementById('serverStatusUrl');
    const healthEl = document.getElementById('serverStatusHealth');
    const latencyEl = document.getElementById('serverStatusLatency');
    const providersEl = document.getElementById('serverStatusProviders');
    const configSourceEl = document.getElementById('serverConfigSource');
    const lastSyncEl = document.getElementById('serverLastSync');

    if (!urlEl) return; // Tab not in DOM

    // Get remote config status
    chrome.runtime.sendMessage({ action: "GET_REMOTE_CONFIG" }, (res) => {
        if (chrome.runtime.lastError || !res) return;

        if (res.serverUrl) {
            urlEl.textContent = res.serverUrl;
        }

        if (res.config) {
            const config = res.config;
            configSourceEl.textContent = config.activeServerUrl ? 'GitHub Remote Config' : 'Hardcoded Default';
            if (config.fetchedAt) {
                const ago = Math.round((Date.now() - config.fetchedAt) / 60000);
                lastSyncEl.textContent = ago < 1 ? 'Just now' : `${ago}m ago`;
            }
        } else {
            configSourceEl.textContent = 'Hardcoded Default';
            lastSyncEl.textContent = 'Never';
        }
    });

    // Test connection
    const startTime = Date.now();
    chrome.runtime.sendMessage({ action: "TEST_SERVER_CONNECTION" }, (res) => {
        if (chrome.runtime.lastError || !res) {
            healthEl.innerHTML = '<span class="status-dot status-dot-offline"></span> Unreachable';
            latencyEl.textContent = '—';
            providersEl.textContent = '—';
            return;
        }

        if (res.success) {
            healthEl.innerHTML = '<span class="status-dot status-dot-online"></span> Online';
            latencyEl.textContent = `${res.latencyMs}ms`;
            const providers = res.data?.activeProviders || [];
            providersEl.textContent = providers.length > 0
                ? providers.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')
                : 'None configured';
        } else {
            healthEl.innerHTML = '<span class="status-dot status-dot-offline"></span> Offline';
            latencyEl.textContent = res.latencyMs ? `${res.latencyMs}ms (timeout)` : '—';
            providersEl.textContent = '—';
        }
    });

    // Load custom server URL if set
    chrome.storage.local.get(['customServerUrl'], (stored) => {
        const input = document.getElementById('customServerUrl');
        if (input && stored.customServerUrl) {
            input.value = stored.customServerUrl;
        }
    });
}

// Server Settings Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Load server status when Server tab exists
    loadServerStatus();

    // Test Connection button
    const btnTest = document.getElementById('btnTestConnection');
    if (btnTest) {
        btnTest.addEventListener('click', () => {
            const btnText = document.getElementById('btnTestText');
            if (btnText) btnText.textContent = 'Testing...';
            btnTest.disabled = true;

            const customUrl = document.getElementById('customServerUrl')?.value?.trim();
            const msg = customUrl
                ? { action: "TEST_SERVER_CONNECTION", url: customUrl }
                : { action: "TEST_SERVER_CONNECTION" };

            chrome.runtime.sendMessage(msg, (res) => {
                btnTest.disabled = false;
                if (btnText) btnText.textContent = 'Test Connection';

                if (res && res.success) {
                    showSaveStatus(`✓ Connected (${res.latencyMs}ms)`);
                    loadServerStatus();
                } else {
                    showSaveStatus(`✕ Failed: ${res?.error || 'Unreachable'}`);
                }
            });
        });
    }

    // Refresh Config button
    const btnRefresh = document.getElementById('btnRefreshConfig');
    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            btnRefresh.disabled = true;
            chrome.runtime.sendMessage({ action: "FORCE_REFRESH_CONFIG" }, (res) => {
                btnRefresh.disabled = false;
                if (res && res.success) {
                    showSaveStatus('Config refreshed ✓');
                    loadServerStatus();
                } else {
                    showSaveStatus('Could not refresh config');
                }
            });
        });
    }

    // Save Custom Server URL button
    const btnSave = document.getElementById('btnSaveServerUrl');
    if (btnSave) {
        btnSave.addEventListener('click', () => {
            const url = document.getElementById('customServerUrl')?.value?.trim() || '';
            chrome.runtime.sendMessage({ action: "SET_CUSTOM_SERVER_URL", url }, (res) => {
                if (res && res.success) {
                    showSaveStatus(url ? `Server URL saved: ${res.serverUrl}` : 'Using cloud default ✓');
                    loadServerStatus();
                } else {
                    showSaveStatus('Failed to save URL');
                }
            });
        });
    }

    // Reset to Cloud Default button
    const btnReset = document.getElementById('btnResetServerUrl');
    if (btnReset) {
        btnReset.addEventListener('click', () => {
            const input = document.getElementById('customServerUrl');
            if (input) input.value = '';
            chrome.runtime.sendMessage({ action: "SET_CUSTOM_SERVER_URL", url: '' }, (res) => {
                if (res && res.success) {
                    showSaveStatus('Reset to cloud default ✓');
                    loadServerStatus();
                } else {
                    showSaveStatus('Failed to reset');
                }
            });
        });
    }

    // Form Detection & Excluded Domains Controls
    loadFormDetectionSettings();

    const visibilitySelect = document.getElementById('optionsFabVisibility');
    if (visibilitySelect) {
        visibilitySelect.addEventListener('change', () => {
            chrome.storage.local.set({ fabVisibility: visibilitySelect.value }, () => {
                showSaveStatus('Display mode updated ✓');
            });
        });
    }

    const btnAddDomain = document.getElementById('btnAddExcludedDomain');
    const inputDomain = document.getElementById('newExcludedDomain');
    if (btnAddDomain && inputDomain) {
        const handleAdd = () => {
            const raw = inputDomain.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
            if (!raw) return;
            chrome.storage.local.get(['excludedDomains'], (stored) => {
                const list = stored.excludedDomains || [];
                if (!list.includes(raw)) {
                    list.push(raw);
                    chrome.storage.local.set({ excludedDomains: list }, () => {
                        inputDomain.value = '';
                        renderExcludedDomains(list);
                        showSaveStatus(`Added ${raw} to excluded sites ✓`);
                    });
                } else {
                    showSaveStatus(`${raw} is already in the list`);
                }
            });
        };
        btnAddDomain.addEventListener('click', handleAdd);
        inputDomain.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
            }
        });
    }
});

// ---------------------------------------------------------------------------
// Form Detection & Excluded Domains Management
// ---------------------------------------------------------------------------

function loadFormDetectionSettings() {
    const visibilitySelect = document.getElementById('optionsFabVisibility');
    const domainsContainer = document.getElementById('excludedDomainsList');
    if (!visibilitySelect || !domainsContainer) return;

    chrome.storage.local.get(['fabVisibility', 'excludedDomains'], (data) => {
        if (data.fabVisibility) {
            visibilitySelect.value = data.fabVisibility;
        }
        renderExcludedDomains(data.excludedDomains || []);
    });
}

function renderExcludedDomains(domains) {
    const container = document.getElementById('excludedDomainsList');
    if (!container) return;
    container.innerHTML = '';

    if (!domains || domains.length === 0) {
        container.innerHTML = '<span style="font-size: 12px; color: var(--text-muted); font-style: italic;">No custom excluded domains (defaults like YouTube, ChatGPT, and Google Search are protected automatically).</span>';
        return;
    }

    domains.forEach(d => {
        const pill = document.createElement('span');
        pill.style.cssText = 'display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; background: var(--bg-surface); border: 1px solid var(--border-medium); border-radius: 6px; font-size: 12px; font-family: monospace; color: var(--text-primary);';
        
        const text = document.createElement('span');
        text.textContent = d;
        pill.appendChild(text);

        const removeBtn = document.createElement('span');
        removeBtn.textContent = '✕';
        removeBtn.style.cssText = 'cursor: pointer; opacity: 0.6; font-size: 11px; font-weight: bold; margin-left: 2px;';
        removeBtn.title = `Remove ${d} from excluded list`;
        removeBtn.onmouseover = () => removeBtn.style.opacity = '1';
        removeBtn.onmouseout = () => removeBtn.style.opacity = '0.6';
        removeBtn.onclick = () => {
            chrome.storage.local.get(['excludedDomains'], (stored) => {
                const updated = (stored.excludedDomains || []).filter(item => item !== d);
                chrome.storage.local.set({ excludedDomains: updated }, () => {
                    renderExcludedDomains(updated);
                    showSaveStatus(`Removed ${d}`);
                });
            });
        };
        pill.appendChild(removeBtn);
        container.appendChild(pill);
    });
}

// ---------------------------------------------------------------------------
// Tab 5: Account & Subscription Management
// ---------------------------------------------------------------------------

function loadAccountStatus() {
    const avatarEl = document.getElementById('optionsUserAvatar');
    const nameEl = document.getElementById('optionsUserName');
    const emailEl = document.getElementById('optionsUserEmail');
    const planBadgeEl = document.getElementById('optionsPlanBadge');
    const btnGoogle = document.getElementById('optionsBtnGoogleSignIn');
    const btnSignOut = document.getElementById('optionsBtnSignOut');
    const usageTextEl = document.getElementById('optionsQuotaUsageText');
    const progressBarEl = document.getElementById('optionsQuotaProgressBar');
    const resetDateEl = document.getElementById('optionsQuotaResetDate');
    const totalSolvedEl = document.getElementById('optionsTotalSolvedText');

    if (!avatarEl) return; // Tab not in DOM

    chrome.runtime.sendMessage({ action: "GET_AUTH_STATUS" }, (res) => {
        if (chrome.runtime.lastError || !res || !res.success) return;

        const user = res.user || {};
        const stats = res.stats || {};
        const quota = res.quota || {};
        const isPro = quota.isPro || (user.plan === 'pro');
        const isGuest = !user.id;

        // User profile
        if (isGuest) {
            nameEl.textContent = 'Guest User';
            emailEl.textContent = 'Anonymous Guest Mode (Local Storage Only)';
            avatarEl.style.backgroundImage = 'none';
            avatarEl.textContent = 'G';
            if (btnGoogle) btnGoogle.style.display = 'inline-flex';
            if (btnSignOut) btnSignOut.style.display = 'none';
        } else {
            nameEl.textContent = user.name || user.email || 'User';
            emailEl.textContent = user.email || '';
            if (user.picture) {
                avatarEl.textContent = '';
                avatarEl.style.backgroundImage = `url("${user.picture}")`;
            } else {
                avatarEl.style.backgroundImage = 'none';
                avatarEl.textContent = (user.name || user.email || 'U').charAt(0).toUpperCase();
            }
            if (btnGoogle) btnGoogle.style.display = 'none';
            if (btnSignOut) btnSignOut.style.display = 'inline-flex';
        }

        // Plan Badge
        if (planBadgeEl) {
            planBadgeEl.textContent = isPro ? 'PRO' : 'FREE';
            planBadgeEl.className = `plan-tag-badge ${isPro ? 'plan-badge-pro' : 'plan-badge-free'}`;
        }

        // Quota Progress Meter
        if (usageTextEl) {
            if (isPro) {
                usageTextEl.textContent = 'Unlimited (Pro Plan Active)';
            } else {
                const used = quota.used || 0;
                const limit = quota.limit || 25;
                usageTextEl.textContent = `${used} / ${limit} questions used this month`;
            }
        }

        if (progressBarEl) {
            if (isPro) {
                progressBarEl.style.width = '100%';
                progressBarEl.className = 'quota-meter-fill';
            } else {
                const used = quota.used || 0;
                const limit = quota.limit || 25;
                const pct = Math.min(100, Math.round((used / limit) * 100));
                progressBarEl.style.width = `${pct}%`;
                progressBarEl.className = pct >= 100 ? 'quota-meter-fill quota-full' : 'quota-meter-fill';
            }
        }

        if (resetDateEl) {
            if (isPro) {
                resetDateEl.textContent = 'Pro plan active • Unlimited questions';
            } else {
                resetDateEl.textContent = quota.resetDate 
                    ? `Monthly rollover cycle: ${quota.resetDate}` 
                    : 'Resets at the start of next month';
            }
        }

        if (totalSolvedEl) {
            const total = stats.questionsSolvedTotal || 0;
            const forms = stats.formsCompletedCount || 0;
            totalSolvedEl.textContent = `${total} question${total === 1 ? '' : 's'} solved (${forms} form${forms === 1 ? '' : 's'} completed)`;
        }
    });
}

// Tab 5 Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    const btnGoogle = document.getElementById('optionsBtnGoogleSignIn');
    if (btnGoogle) {
        btnGoogle.addEventListener('click', () => {
            btnGoogle.disabled = true;
            btnGoogle.style.opacity = '0.7';
            chrome.runtime.sendMessage({ action: "SIGN_IN_GOOGLE" }, (res) => {
                btnGoogle.disabled = false;
                btnGoogle.style.opacity = '1';
                if (chrome.runtime.lastError || !res || !res.success) {
                    showSaveStatus(`Sign-in failed: ${res?.error || 'Cancelled'}`);
                    return;
                }
                showSaveStatus(`Signed in as ${res.user?.name || res.user?.email} ✓`);
                loadAccountStatus();
            });
        });
    }

    const btnSignOut = document.getElementById('optionsBtnSignOut');
    if (btnSignOut) {
        btnSignOut.addEventListener('click', () => {
            chrome.runtime.sendMessage({ action: "SIGN_OUT" }, (res) => {
                if (chrome.runtime.lastError || !res || !res.success) return;
                showSaveStatus('Signed out successfully ✓');
                loadAccountStatus();
            });
        });
    }

    const btnTogglePro = document.getElementById('optionsBtnToggleDemoPro');
    if (btnTogglePro) {
        btnTogglePro.addEventListener('click', () => {
            btnTogglePro.disabled = true;
            chrome.runtime.sendMessage({
                action: "UPGRADE_TO_PRO",
                details: { plan: 'pro', stripeCustomerId: 'cus_demo_' + Date.now() }
            }, (res) => {
                btnTogglePro.disabled = false;
                if (chrome.runtime.lastError || !res || !res.success) {
                    showSaveStatus('Failed to activate Pro');
                    return;
                }
                showSaveStatus('AutoForm Pro activated! ⭐');
                loadAccountStatus();
            });
        });
    }

    const btnResetFree = document.getElementById('optionsBtnResetFree');
    if (btnResetFree) {
        btnResetFree.addEventListener('click', () => {
            chrome.storage.local.get(['authUser'], (data) => {
                const user = data.authUser || {};
                user.plan = 'free';
                chrome.storage.local.set({ authUser: user }, () => {
                    showSaveStatus('Reverted to Free tier ✓');
                    loadAccountStatus();
                });
            });
        });
    }
});

