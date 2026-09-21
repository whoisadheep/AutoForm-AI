/**
 * @file server/tests/memoryRetriever.test.js
 * @description Unit tests for MemoryRetriever Hybrid RAG engine.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// Require the universal memoryRetriever module
const {
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
  buildSmartMemoryContext,
  getUserAcademicYear,
  DEPARTMENT_ALIASES
} = require('../../src/services/memoryRetriever.js');

const mockProfile = {
  identity: {
    fullName: "Alex Rivera",
    email: "alex.rivera@example.com",
    phone: "+1 (555) 234-5678",
    location: "San Francisco, CA",
    headline: "Senior Software Engineer"
  },
  links: {
    github: "https://github.com/alexrivera",
    linkedin: "https://linkedin.com/in/alexrivera",
    portfolio: "https://alexrivera.dev",
    twitter: "https://x.com/alexrivera_dev"
  },
  education: {
    university: "UC Berkeley",
    degree: "Bachelor of Science",
    major: "Computer Science",
    graduationYear: "2026",
    gpa: "3.92"
  },
  snippets: [
    {
      id: "snip-1",
      category: "experience",
      title: "Role at Acme Corp",
      content: "Lead frontend engineer at Acme Corp. Architected real-time dashboard using React, TypeScript, and WebSockets.",
      tags: ["react", "typescript", "websockets"]
    },
    {
      id: "snip-2",
      category: "project",
      title: "Project AutoForm AI",
      content: "Created AutoForm AI, a browser extension that automates complex Google Forms with multi-provider LLMs and local RAG.",
      tags: ["python", "node", "ai", "chrome extension"]
    },
    {
      id: "snip-3",
      category: "skill",
      title: "Technical Stack & Tools",
      content: "Proficient in Python, JavaScript, TypeScript, Docker, PostgreSQL, and AWS cloud infrastructure.",
      tags: ["python", "javascript", "typescript", "docker", "sql", "aws"]
    },
    {
      id: "snip-4",
      category: "perspective",
      title: "Engineering Philosophy",
      content: "Believes in user-first design, ruthless elimination of unnecessary friction, and building robust, resilient distributed systems.",
      tags: ["philosophy", "user experience", "architecture"]
    }
  ]
};

describe('MemoryRetriever — Tokenizer & Intent Classification', () => {
  test('tokenizes question text removing stopwords and form boilerplate', () => {
    const tokens = tokenize('Please enter your primary email address for the application');
    assert.ok(tokens.includes('primary'));
    assert.ok(tokens.includes('email'));
    assert.ok(tokens.includes('address'));
    assert.ok(tokens.includes('application'));
    assert.strictEqual(tokens.includes('please'), false);
    assert.strictEqual(tokens.includes('enter'), false);
    assert.strictEqual(tokens.includes('your'), false);
    assert.strictEqual(tokens.includes('for'), false);
    assert.strictEqual(tokens.includes('the'), false);
  });

  test('classifies contact & links intent accurately', () => {
    const intents = classifyQuestionIntent('What is your LinkedIn profile URL?');
    assert.ok(intents.includes(QuestionIntent.CONTACT_LINK));
  });

  test('classifies education intent accurately', () => {
    const intents = classifyQuestionIntent('Please indicate your University and expected Graduation Year');
    assert.ok(intents.includes(QuestionIntent.EDUCATION));
  });

  test('classifies work experience intent accurately', () => {
    const intents = classifyQuestionIntent('Describe your past work experience and responsibilities at your previous company');
    assert.ok(intents.includes(QuestionIntent.WORK_EXPERIENCE));
  });

  test('classifies technical skills intent accurately', () => {
    const intents = classifyQuestionIntent('List the programming languages, frameworks and developer tools you master');
    assert.ok(intents.includes(QuestionIntent.SKILLS));
  });

  test('classifies behavioral / essay intent accurately', () => {
    const intents = classifyQuestionIntent('Why do you want to join our organization and what unique perspective do you bring?');
    assert.ok(intents.includes(QuestionIntent.BEHAVIORAL_ESSAY));
  });

  test('classifies roll number and student IDs into education intent', () => {
    const rollIntents = classifyQuestionIntent('Roll Number');
    assert.ok(rollIntents.includes(QuestionIntent.EDUCATION));

    const regIntents = classifyQuestionIntent('Registration Number / Roll No.');
    assert.ok(regIntents.includes(QuestionIntent.EDUCATION));

    const usnIntents = classifyQuestionIntent('Enter your USN or Student ID');
    assert.ok(usnIntents.includes(QuestionIntent.EDUCATION));
  });
});

describe('MemoryRetriever — Deterministic Direct Slot Matching', () => {
  test('directly matches Email field', () => {
    const match = resolveDirectSlot('What is your e-mail address?', mockProfile);
    assert.deepStrictEqual(match, { key: 'Email', value: 'alex.rivera@example.com' });
  });

  test('directly matches Phone field', () => {
    const match = resolveDirectSlot('Primary Phone Number', mockProfile);
    assert.deepStrictEqual(match, { key: 'Phone', value: '+1 (555) 234-5678' });
  });

  test('directly matches Full Name field', () => {
    const match = resolveDirectSlot('Applicant Full Name', mockProfile);
    assert.deepStrictEqual(match, { key: 'Full Name', value: 'Alex Rivera' });
  });

  test('directly matches First Name and Last Name separately', () => {
    const first = resolveDirectSlot('First Name / Given Name', mockProfile);
    assert.deepStrictEqual(first, { key: 'First Name', value: 'Alex' });

    const last = resolveDirectSlot('Last Name / Surname', mockProfile);
    assert.deepStrictEqual(last, { key: 'Last Name', value: 'Rivera' });
  });

  test('directly matches City and Country from location', () => {
    const city = resolveDirectSlot('Current City of Residence', mockProfile);
    assert.deepStrictEqual(city, { key: 'City', value: 'San Francisco' });
  });

  test('directly matches GitHub link', () => {
    const match = resolveDirectSlot('GitHub Profile Link', mockProfile);
    assert.deepStrictEqual(match, { key: 'GitHub', value: 'https://github.com/alexrivera' });
  });

  test('directly matches LinkedIn link', () => {
    const match = resolveDirectSlot('LinkedIn URL', mockProfile);
    assert.deepStrictEqual(match, { key: 'LinkedIn', value: 'https://linkedin.com/in/alexrivera' });
  });

  test('directly matches University and GPA', () => {
    const uni = resolveDirectSlot('Current University / College', mockProfile);
    assert.deepStrictEqual(uni, { key: 'University', value: 'UC Berkeley' });

    const gpa = resolveDirectSlot('Cumulative GPA', mockProfile);
    assert.deepStrictEqual(gpa, { key: 'GPA', value: '3.92' });
  });

  test('directly matches Major and Degree', () => {
    const major = resolveDirectSlot('Academic Major', mockProfile);
    assert.deepStrictEqual(major, { key: 'Major', value: 'Computer Science' });

    const deg = resolveDirectSlot('Degree Level', mockProfile);
    assert.deepStrictEqual(deg, { key: 'Degree', value: 'Bachelor of Science' });
  });
});

describe('MemoryRetriever — Deterministic Choice Matching (resolveDirectChoice)', () => {
  test('matches Graduation Year choice directly', () => {
    const choices = ['2024', '2025', '2026', '2027 or later'];
    const result = resolveDirectChoice('What is your expected graduation year?', choices, mockProfile);
    assert.deepStrictEqual(result, { key: 'Graduation Year', answer: '2026' });
  });

  test('matches Degree Level choice directly', () => {
    const choices = ['High School Diploma', "Bachelor's Degree", "Master's Degree", 'PhD'];
    const result = resolveDirectChoice('What is your highest degree level obtained?', choices, mockProfile);
    assert.deepStrictEqual(result, { key: 'Degree Level', answer: "Bachelor's Degree" });
  });

  test('matches University choice directly', () => {
    const choices = ['Stanford University', 'MIT', 'UC Berkeley', 'Harvard University'];
    const result = resolveDirectChoice('Select your institution', choices, mockProfile);
    assert.deepStrictEqual(result, { key: 'University', answer: 'UC Berkeley' });
  });
});

describe('MemoryRetriever — Choice Cross-Referencing', () => {
  test('cross-references academic degree choice', () => {
    const choices = ["High School", "Associate's", "Bachelor's Degree", "Master's Degree", "Doctorate"];
    const hints = crossReferenceChoices(choices, mockProfile, [QuestionIntent.EDUCATION]);
    assert.ok(hints.some(h => h.includes("Bachelor's Degree")));
  });

  test('cross-references graduation year and academic level', () => {
    const choices = ["Freshman", "Sophomore", "Junior", "Senior"];
    const hints = crossReferenceChoices(choices, mockProfile, [QuestionIntent.EDUCATION]);
    assert.ok(hints.length > 0);
  });

  test('cross-references technical skills choices', () => {
    const choices = ["Ruby", "Python", "Rust", "Swift", "C#"];
    const hints = crossReferenceChoices(choices, mockProfile, [QuestionIntent.SKILLS]);
    assert.ok(hints.some(h => h.includes("Python")));
  });
});

describe('MemoryRetriever — BM25 Snippet Scoring & Retrieval', () => {
  test('ranks work experience snippet highest for company/role queries', () => {
    const tokens = tokenize('frontend engineer role dashboard WebSockets');
    const intents = [QuestionIntent.WORK_EXPERIENCE];
    const retrieved = retrieveRelevantSnippets(mockProfile.snippets, tokens, intents, 1);
    assert.strictEqual(retrieved[0].id, 'snip-1');
  });

  test('ranks project snippet highest for project/extension queries', () => {
    const tokens = tokenize('browser extension automated forms');
    const intents = [QuestionIntent.PROJECTS];
    const retrieved = retrieveRelevantSnippets(mockProfile.snippets, tokens, intents, 1);
    assert.strictEqual(retrieved[0].id, 'snip-2');
  });

  test('ranks perspective snippet highest for values/philosophy queries', () => {
    const tokens = tokenize('what are your core values and engineering philosophy');
    const intents = [QuestionIntent.BEHAVIORAL_ESSAY];
    const retrieved = retrieveRelevantSnippets(mockProfile.snippets, tokens, intents, 1);
    assert.strictEqual(retrieved[0].id, 'snip-4');
  });
});

describe('MemoryRetriever — Full Smart Context Assembly', () => {
  test('builds direct match fact when applicable', () => {
    const context = buildSmartMemoryContext({
      question: 'Please provide your GitHub URL',
      type: 'text_input',
      memoryProfile: mockProfile
    });
    assert.ok(context.includes('[DIRECT MATCH FACT]'));
    assert.ok(context.includes('https://github.com/alexrivera'));
  });

  test('builds rich profile and relevant memory snippets for essay question', () => {
    const context = buildSmartMemoryContext({
      question: 'Describe a significant engineering project you built and the challenges faced',
      type: 'text_input',
      memoryProfile: mockProfile,
      customContext: 'Focus on automation and performance'
    });

    assert.ok(context.includes('[USER VERIFIED PROFILE]'));
    assert.ok(context.includes('[RELEVANT MEMORY & EXPERIENCES]'));
    assert.ok(context.includes('Project AutoForm AI'));
    assert.ok(context.includes('[ADDITIONAL USER PERSONA]'));
    assert.ok(context.includes('Focus on automation and performance'));
  });

  test('includes choice hints when options are supplied', () => {
    const context = buildSmartMemoryContext({
      question: 'Highest level of education completed or in progress',
      type: 'multiple_choice',
      choices: ["High School", "Associate", "Bachelor's Degree", "Master's Degree"],
      memoryProfile: mockProfile
    });

    assert.ok(context.includes('[CHOICE HINTS]'));
    assert.ok(context.includes("Bachelor's Degree"));
  });

  test('returns empty string when no profile and no customContext provided', () => {
    const context = buildSmartMemoryContext({
      question: 'What is your favorite color?',
      memoryProfile: null,
      customContext: ''
    });
    assert.strictEqual(context, '');
  });
});

describe('MemoryRetriever — Whole-Form Understanding & Digest', () => {
  test('classifies job application macro intent accurately', () => {
    const intent = classifyFormMacroIntent(
      'Software Engineer Internship 2026',
      'Please submit your candidate application and resume details',
      [{ question: 'Years of programming experience' }]
    );
    assert.strictEqual(intent, FormMacroIntent.JOB_APPLICATION);
  });

  test('classifies academic and grant macro intent accurately', () => {
    const intent = classifyFormMacroIntent(
      'Undergraduate Research Fellowship Application',
      'Submit your research proposal and university academic transcript',
      [{ question: 'Proposed research title' }]
    );
    assert.strictEqual(intent, FormMacroIntent.ACADEMIC_STUDENT);
  });

  test('classifies feedback survey macro intent accurately', () => {
    const intent = classifyFormMacroIntent(
      'Annual Customer Satisfaction Survey',
      'Tell us your opinion and rate our support performance',
      [{ question: 'How likely are you to recommend us?' }]
    );
    assert.strictEqual(intent, FormMacroIntent.FEEDBACK_SURVEY);
  });

  test('builds structured form digest with concise question outline', () => {
    const questions = [
      { question: 'Full Name', type: 'text_input' },
      { question: 'GitHub URL', type: 'text_input' },
      { question: 'Why do you want this role?', type: 'text_input' }
    ];
    const digest = buildFormDigest('Engineering Job Application', 'Submit your details', questions);
    assert.strictEqual(digest.title, 'Engineering Job Application');
    assert.strictEqual(digest.macroIntent, FormMacroIntent.JOB_APPLICATION);
    assert.strictEqual(digest.totalQuestions, 3);
    assert.strictEqual(digest.outline.length, 3);
    assert.ok(digest.outline[0].includes('Full Name'));
  });

  test('injects form macro context into prompt assembly', () => {
    const formDigest = buildFormDigest('Senior Cloud Architect Application', 'Production engineering role', [
      { question: 'What is your primary cloud platform?', type: 'text_input' }
    ]);
    const context = buildSmartMemoryContext({
      question: 'Describe your infrastructure scaling experience',
      type: 'text_input',
      memoryProfile: mockProfile,
      formDigest: formDigest
    });

    assert.ok(context.includes('[FORM MACRO CONTEXT & GOAL]'));
    assert.ok(context.includes('Senior Cloud Architect Application'));
    assert.ok(context.includes('Job Application'));
  });
});

describe('MemoryRetriever — Rolling Prior Answers & Cross-Question Consistency', () => {
  test('injects previous answers into context prompt with consistency rule', () => {
    const priorAnswers = [
      { question: 'What role are you applying for?', answer: 'Senior Backend Engineer', type: 'multiple_choice' },
      { question: 'What is your preferred programming language?', answer: 'Go and TypeScript', type: 'text_input' }
    ];

    const context = buildSmartMemoryContext({
      question: 'Why are you a great fit for this tech stack?',
      type: 'text_input',
      memoryProfile: mockProfile,
      priorAnswers: priorAnswers
    });

    assert.ok(context.includes('[PREVIOUS ANSWERS IN THIS FORM]'));
    assert.ok(context.includes('• Q: "What role are you applying for?" ➔ Answered: "Senior Backend Engineer"'));
    assert.ok(context.includes('• Q: "What is your preferred programming language?" ➔ Answered: "Go and TypeScript"'));
    assert.ok(context.includes('CRITICAL CONSISTENCY RULE: Maintain 100% logical consistency with these previous answers.'));
  });

  test('truncates overly long questions and answers in previous answer block', () => {
    const longQuestion = 'Can you describe in extensive and exhaustive detail every single programming language you have ever learned in your career?';
    const longAnswer = 'I started with QBasic in elementary school, then progressed through C, C++, Java, Python, Go, Rust, Ruby on Rails, Swift, Kotlin, and modern TypeScript across diverse distributed computing infrastructures.';
    
    const context = buildSmartMemoryContext({
      question: 'Next question',
      type: 'text_input',
      memoryProfile: mockProfile,
      priorAnswers: [{ question: longQuestion, answer: longAnswer, type: 'text_input' }]
    });

    assert.ok(context.includes('[PREVIOUS ANSWERS IN THIS FORM]'));
    // Should end with ellipsis for truncated question and answer
    assert.ok(context.includes('...'));
    assert.ok(!context.includes(longQuestion)); // full 120-char question is truncated to 60 chars
    assert.ok(!context.includes(longAnswer)); // full 200-char answer is truncated to 120 chars
  });

  test('assembles context successfully with prior answers even if memoryProfile is null', () => {
    const context = buildSmartMemoryContext({
      question: 'What framework do you prefer?',
      type: 'text_input',
      memoryProfile: null,
      customContext: '',
      priorAnswers: [{ question: 'Are you frontend or backend?', answer: 'Frontend Engineer', type: 'multiple_choice' }]
    });

    assert.ok(context.includes('[PREVIOUS ANSWERS IN THIS FORM]'));
    assert.ok(context.includes('Frontend Engineer'));
  });
});

describe('MemoryRetriever — Experience & Story Deduplication', () => {
  test('prioritizes unused snippets over previously used snippets for subsequent essay questions', () => {
    const tokens = tokenize('software engineering project dashboard automation');
    const intents = [QuestionIntent.WORK_EXPERIENCE, QuestionIntent.PROJECTS];

    // Initial retrieval with no used snippets:
    const firstRetrieval = retrieveRelevantSnippets(mockProfile.snippets, tokens, intents, 1, []);
    const firstId = firstRetrieval[0].id;

    // Second question on same form, passing usedSnippetIds containing the first selected snippet:
    const secondRetrieval = retrieveRelevantSnippets(mockProfile.snippets, tokens, intents, 1, [firstId]);
    // Should choose a distinct, unused snippet, never duplicating the first!
    assert.notStrictEqual(secondRetrieval[0].id, firstId);
    assert.ok(mockProfile.snippets.some(s => s.id === secondRetrieval[0].id));
  });

  test('falls back gracefully to used snippets when all available snippets have been used', () => {
    const tokens = tokenize('frontend engineering');
    const intents = [QuestionIntent.WORK_EXPERIENCE];

    // Mark all snippets as used
    const allUsedIds = mockProfile.snippets.map(s => s.id);
    const fallbackRetrieval = retrieveRelevantSnippets(mockProfile.snippets, tokens, intents, 1, allUsedIds);

    // Must still return a snippet to avoid context starvation
    assert.strictEqual(fallbackRetrieval.length, 1);
    assert.strictEqual(fallbackRetrieval[0].id, 'snip-1');
  });

  test('returns retrievedSnippetIds metadata and injects deduplication guidance', () => {
    const priorAnswers = [
      { question: 'Tell us about your background', answer: 'Worked at Acme Corp', type: 'text_input' }
    ];

    const result = buildSmartMemoryContext({
      question: 'Describe a project you built from scratch',
      type: 'text_input',
      memoryProfile: mockProfile,
      priorAnswers: priorAnswers,
      usedSnippetIds: ['snip-1'],
      returnMetadata: true
    });

    assert.ok(typeof result === 'object');
    assert.ok(Array.isArray(result.retrievedSnippetIds));
    assert.ok(result.retrievedSnippetIds.length > 0);
    // snip-1 was in usedSnippetIds, so result should not pick snip-1 as primary
    assert.ok(!result.retrievedSnippetIds.includes('snip-1') || result.retrievedSnippetIds[0] !== 'snip-1');
    assert.ok(result.context.includes('DEDUPLICATION GUIDANCE: Do not repeat stories'));
  });
});

describe('MemoryRetriever — Bug Fixes: Gmail, WhatsApp, Department & 4th Year', () => {
  const studentProfile = {
    identity: {
      fullName: "Adheep",
      email: "adheep.developer@gmail.com",
      phone: "+91 98765 43210",
      whatsapp: "+91 98765 00000",
      location: "Chennai, India"
    },
    links: {
      github: "https://github.com/whoisadheep",
      linkedin: "https://linkedin.com/in/adheep"
    },
    education: {
      university: "Anna University",
      degree: "B.Tech",
      major: "IT",
      currentYear: "4th Year",
      graduationYear: "2026"
    },
    snippets: [
      {
        id: "snip-card",
        category: "experience",
        title: "Academic Background",
        content: "Currently a fourth year student in the Information Technology branch building AI systems.",
        tags: ["ai", "python"]
      }
    ]
  };

  test('resolves Gmail / Email ID correctly without placeholder hallucination', () => {
    const q1 = resolveDirectSlot('Gmail ID', studentProfile);
    assert.deepStrictEqual(q1, { key: 'Email', value: 'adheep.developer@gmail.com' });

    const q2 = resolveDirectSlot('Enter your Gmail address', studentProfile);
    assert.deepStrictEqual(q2, { key: 'Email', value: 'adheep.developer@gmail.com' });

    const q3 = resolveDirectSlot('Email ID', studentProfile);
    assert.deepStrictEqual(q3, { key: 'Email', value: 'adheep.developer@gmail.com' });

    const q4 = resolveDirectSlot('Mail ID', studentProfile);
    assert.deepStrictEqual(q4, { key: 'Email', value: 'adheep.developer@gmail.com' });
  });

  test('resolves WhatsApp number accurately and falls back to phone if whatsapp is unset', () => {
    const waSlot = resolveDirectSlot('WhatsApp Number', studentProfile);
    assert.deepStrictEqual(waSlot, { key: 'WhatsApp', value: '+91 98765 00000' });

    const waSlot2 = resolveDirectSlot('Enter your WA number', studentProfile);
    assert.deepStrictEqual(waSlot2, { key: 'WhatsApp', value: '+91 98765 00000' });

    // When whatsapp is empty, fallback to phone
    const profileNoWa = {
      ...studentProfile,
      identity: { ...studentProfile.identity, whatsapp: '' }
    };
    const waFallback = resolveDirectSlot('WhatsApp Number', profileNoWa);
    assert.deepStrictEqual(waFallback, { key: 'WhatsApp', value: '+91 98765 43210' });
  });

  test('resolves Department slot with IT expansion', () => {
    const deptSlot = resolveDirectSlot('Department', studentProfile);
    assert.deepStrictEqual(deptSlot, { key: 'Department', value: 'Information Technology (IT)' });

    const branchSlot = resolveDirectSlot('Branch of study', studentProfile);
    assert.deepStrictEqual(branchSlot, { key: 'Department', value: 'Information Technology (IT)' });
  });

  test('resolves Department choice: selects Information Technology, NEVER Aerospace Engineering', () => {
    const choices = [
      'Aerospace Engineering',
      'Civil Engineering',
      'Information Technology',
      'Mechanical Engineering'
    ];
    const result = resolveDirectChoice('Select your department', choices, studentProfile);
    assert.deepStrictEqual(result, { key: 'Department / Major', answer: 'Information Technology' });
    assert.notStrictEqual(result.answer, 'Aerospace Engineering');
  });

  test('avoids false word-boundary substring matches for short acronyms like IT', () => {
    const choices = [
      'Automobile Engineering',
      'Credit Management',
      'Mechanical Engineering',
      'Other'
    ];
    // "Automobile" contains "obile", Credit contains "it", but neither is \bIT\b
    const result = resolveDirectChoice('Select your major', choices, studentProfile);
    assert.strictEqual(result, null);
  });

  test('resolves Current Year slot from profile education.currentYear', () => {
    const yearSlot = resolveDirectSlot('Current Year of study', studentProfile);
    assert.deepStrictEqual(yearSlot, { key: 'Current Year', value: '4th Year' });
  });

  test('resolves Current Year choice to 4th Year and strictly avoids Graduate', () => {
    const choices = [
      '1st Year',
      '2nd Year',
      '3rd Year',
      '4th Year',
      'Graduate'
    ];
    const result = resolveDirectChoice('Which year are you studying in?', choices, studentProfile);
    assert.deepStrictEqual(result, { key: 'Current Year', answer: '4th Year' });
    assert.notStrictEqual(result.answer, 'Graduate');
  });

  test('detects academic year from memory snippets when education.currentYear is empty', () => {
    const profileFromSnippetOnly = {
      identity: studentProfile.identity,
      links: studentProfile.links,
      education: {
        university: "Anna University",
        degree: "B.Tech",
        major: "IT",
        currentYear: "", // empty
        graduationYear: ""
      },
      snippets: [
        {
          id: "snip-yr",
          category: "experience",
          title: "My College",
          content: "I am currently in my fourth year pursuing my degree.",
          tags: ["college"]
        }
      ]
    };

    const acad = getUserAcademicYear(profileFromSnippetOnly);
    assert.ok(acad);
    assert.strictEqual(acad.yearNumber, 4);
    assert.strictEqual(acad.label, '4th Year');

    const choices = ['1st Year', '2nd Year', '3rd Year', '4th Year', 'Graduate / Alumni'];
    const choiceResult = resolveDirectChoice('Year of study', choices, profileFromSnippetOnly);
    assert.deepStrictEqual(choiceResult, { key: 'Current Year', answer: '4th Year' });
  });

  test('crossReferenceChoices includes Department and anti-Graduate hints', () => {
    const deptChoices = ['Aerospace Engineering', 'Information Technology', 'Mechanical Engineering'];
    const deptHints = crossReferenceChoices(deptChoices, studentProfile, [QuestionIntent.EDUCATION]);
    assert.ok(deptHints.some(h => h.includes('Information Technology')));

    const yearChoices = ['1st Year', '2nd Year', '3rd Year', '4th Year', 'Graduate'];
    const yearHints = crossReferenceChoices(yearChoices, studentProfile, [QuestionIntent.EDUCATION]);
    assert.ok(yearHints.some(h => h.includes('4th Year')));
    assert.ok(yearHints.some(h => h.includes('Do NOT select Graduate')));
  });
});

describe('MemoryRetriever — Job & Registration Form Slots (State, District, College, Degree, YOP, USN)', () => {
  const jobApplicantProfile = {
    identity: {
      fullName: "Adheep",
      email: "adheep@gmail.com",
      phone: "+91 98765 43210",
      location: "Bangalore, Karnataka, India"
    },
    education: {
      university: "VTU College of Engineering",
      college: "VTU College of Engineering",
      degree: "B.Tech",
      major: "Information Technology",
      currentYear: "4th Year",
      graduationYear: "2025",
      usn: "1VT21CS001"
    }
  };

  test('resolves State and District slots directly from location string', () => {
    const stateSlot = resolveDirectSlot('Select your State', jobApplicantProfile);
    assert.deepStrictEqual(stateSlot, { key: 'State', value: 'Karnataka' });

    const distSlot = resolveDirectSlot('Select District', jobApplicantProfile);
    assert.deepStrictEqual(distSlot, { key: 'District', value: 'Bangalore' });
  });

  test('resolves State slot from 2-part US location', () => {
    const usProfile = {
      identity: { location: "San Francisco, CA" }
    };
    const stateSlot = resolveDirectSlot('State / Province', usProfile);
    assert.deepStrictEqual(stateSlot, { key: 'State', value: 'CA' });
  });

  test('resolves College and University slots distinctly', () => {
    const collegeSlot = resolveDirectSlot('Select College', jobApplicantProfile);
    assert.deepStrictEqual(collegeSlot, { key: 'College', value: 'VTU College of Engineering' });

    const uniSlot = resolveDirectSlot('Select University', jobApplicantProfile);
    assert.deepStrictEqual(uniSlot, { key: 'University', value: 'VTU College of Engineering' });
  });

  test('resolves Year of Passout / YOP slot directly', () => {
    const yopSlot1 = resolveDirectSlot('Year of passout', jobApplicantProfile);
    assert.deepStrictEqual(yopSlot1, { key: 'Graduation Year', value: '2025' });

    const yopSlot2 = resolveDirectSlot('Select yop', jobApplicantProfile);
    assert.deepStrictEqual(yopSlot2, { key: 'Graduation Year', value: '2025' });
  });

  test('resolves University Register Number / USN slot directly', () => {
    const usnSlot = resolveDirectSlot('Enter University Register Number / Exam Roll No', jobApplicantProfile);
    assert.deepStrictEqual(usnSlot, { key: 'University Register Number', value: '1VT21CS001' });
  });

  test('resolves roll number directly from education.rollNumber, identity, and snippets', () => {
    const profileWithRoll = {
      education: { rollNumber: '21IT045' }
    };
    const roll1 = resolveDirectSlot('Roll Number', profileWithRoll);
    assert.deepStrictEqual(roll1, { key: 'University Register Number', value: '21IT045' });

    const roll2 = resolveDirectSlot('Roll No.', profileWithRoll);
    assert.deepStrictEqual(roll2, { key: 'University Register Number', value: '21IT045' });

    const roll3 = resolveDirectSlot('Class Roll No', profileWithRoll);
    assert.deepStrictEqual(roll3, { key: 'University Register Number', value: '21IT045' });

    // Fallback to identity
    const profileWithIdRoll = {
      identity: { rollNumber: 'CS2022-88' }
    };
    const idRoll = resolveDirectSlot('Student ID / Roll No', profileWithIdRoll);
    assert.deepStrictEqual(idRoll, { key: 'University Register Number', value: 'CS2022-88' });

    // Fallback to snippets
    const profileWithSnippet = {
      education: {},
      snippets: [
        {
          title: 'College Enrollment',
          content: 'Department of Information Technology\nRoll Number: 22IT109\nBatch: 2022-2026'
        }
      ]
    };
    const snipRoll = resolveDirectSlot('Enter your Roll Number', profileWithSnippet);
    assert.deepStrictEqual(snipRoll, { key: 'University Register Number', value: '22IT109' });
  });

  test('resolves State and District choices against location', () => {
    const stateChoices = ['Andhra Pradesh', 'Karnataka', 'Maharashtra', 'Tamil Nadu'];
    const stateChoice = resolveDirectChoice('Select your State', stateChoices, jobApplicantProfile);
    assert.deepStrictEqual(stateChoice, { key: 'State', answer: 'Karnataka' });

    const distChoices = ['Bangalore', 'Mysore', 'Hubli', 'Mangalore'];
    const distChoice = resolveDirectChoice('Select District', distChoices, jobApplicantProfile);
    assert.deepStrictEqual(distChoice, { key: 'District', answer: 'Bangalore' });
  });

  test('resolves Degree choice using aliases (e.g. B.Tech matches B.E / B.Tech)', () => {
    const degreeChoices = ['B.E / B.Tech', 'MCA', 'B.Sc', 'M.Tech'];
    const degreeChoice = resolveDirectChoice('Select Degree', degreeChoices, jobApplicantProfile);
    assert.deepStrictEqual(degreeChoice, { key: 'Degree Level', answer: 'B.E / B.Tech' });
  });

  test('resolves YOP choices directly to graduation year', () => {
    const yopChoices = ['2023', '2024', '2025', '2026'];
    const yopChoice = resolveDirectChoice('Select YOP', yopChoices, jobApplicantProfile);
    assert.deepStrictEqual(yopChoice, { key: 'Graduation Year', answer: '2025' });
  });
});




