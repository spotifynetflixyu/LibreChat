const MANIFEST = Object.freeze([
  {
    name: 'app-load',
    file: 'app-load.spec.ts',
    titles: ['authenticated user lands on a rendered chat view without runtime errors'],
  },
  {
    name: 'auth-session',
    file: 'auth.spec.ts',
    titles: [
      'session persists across a full page reload',
      'logout ends the session and protects authenticated routes',
    ],
  },
  {
    name: 'chat',
    file: 'chat.spec.ts',
    titles: [
      'streams a response, saves the conversation, and persists across reload',
      'keeps send disabled until the composer has message text',
      'renders assistant markdown and syntax-highlighted code blocks',
      'can switch back to the previous branch after regenerating an earlier response',
      'supports attaching, removing, and sending provider files from the composer',
    ],
  },
  {
    name: 'conversation-management',
    file: 'conversation-management.spec.ts',
    titles: [
      'loads a past sidebar conversation with its message history',
      'renames a conversation from the sidebar',
      'deletes a conversation, clears its messages, and blocks direct URL access',
    ],
  },
  {
    name: 'streaming',
    file: 'streaming.spec.ts',
    titles: ['renders and persists every LLM chunk exactly once and in order'],
  },
  {
    name: 'model-switching',
    file: 'model-switching.spec.ts',
    titles: [
      '"Mock Provider A" returns a streamed response',
      '"Mock Provider B" returns a streamed response',
    ],
  },
  {
    name: 'unified-upload',
    file: 'unified-upload.spec.ts',
    titles: [
      'single attach button routes a csv to llmDeliveryPath "none"',
      'single attach button still delivers a provider-routed upload and shows it in chat',
      'single attach button routes a json upload to llmDeliveryPath "text"',
    ],
  },
  {
    name: 'steel-ui-review',
    file: 'steel-ui-review.spec.ts',
    titles: [
      'bind popup keeps an unlinked row until real Save and reload reconciles membership',
      'Add row classification and trimmed notes derive processing source, order, and cascade',
    ],
  },
  {
    name: 'steel-catalog-review',
    file: 'steel-catalog-review.spec.ts',
    titles: [
      'description matches only product names and keeps selection in the draft',
      'a complete material candidate stays a draft until Save and preserves its processing row',
      'retains one row option batch and verifies a newly added material candidate on Save',
    ],
  },
  {
    name: 'steel-processing-catalog',
    file: 'steel-processing-catalog.spec.ts',
    titles: [
      'filters processing options and retains query, measurement and notes grouping through keyboard correction and Save',
      'queries the unsaved new material scope and saves a single missing-tier processing candidate with blank incomplete totals',
    ],
  },
  {
    name: 'steel-ocr-review',
    file: 'steel-review.spec.ts',
    titles: [
      'normal new AI publication retains the saved historical OCR sidecar and opens it read-only after reload',
      'saved human OCR admission remains fixed after another Save and reload shows its actual quotation source',
      'manual OCR Save changes only the clicked message and chat reload shows clean saved values',
      'dirty OCR Escape offers continue and discard without saving the chat',
      'deleting a previously saved manual OCR row changes one row without inventing an AI comparison',
      'OCR row CRUD is local and adding then deleting before Save is a net-zero no-op',
    ],
  },
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exactTitleGrep(titles) {
  return new RegExp(`(?:${titles.map(escapeRegExp).join('|')})$`);
}

function createProjects(baseProject) {
  if (!baseProject) {
    throw new Error('The base Playwright config does not define a Chromium project');
  }

  return MANIFEST.map((flow) => ({
    ...baseProject,
    name: flow.name,
    testMatch: [`mock/${flow.file}`],
    grep: exactTitleGrep(flow.titles),
  }));
}

function readProjectFilters(args) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--project' && args[index + 1] != null) {
      values.push(args[index + 1]);
      index += 1;
    } else if (arg.startsWith('--project=')) {
      values.push(arg.slice('--project='.length));
    }
  }
  return values;
}

function applyCliSelection(args) {
  let selected = MANIFEST.flatMap((flow) => flow.titles.map((title) => ({ flow, title })));

  const projectFilters = readProjectFilters(args);
  if (projectFilters.length > 0) {
    const knownProjects = new Set(MANIFEST.map((flow) => flow.name));
    const unknown = projectFilters.filter((project) => !knownProjects.has(project));
    if (unknown.length > 0) {
      throw new Error(`Unknown normal E2E project filter: ${unknown.join(', ')}`);
    }
    selected = selected.filter(({ flow }) => projectFilters.includes(flow.name));
  }

  return selected;
}

function flattenSpecs(suites, projectName, result = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        result.push({
          file: spec.file,
          project: test.projectName ?? projectName,
          title: spec.title,
        });
      }
    }
    flattenSpecs(suite.suites, projectName, result);
  }
  return result;
}

function validateList(payload, args) {
  const listed = flattenSpecs(payload?.suites);
  const expected = applyCliSelection(args).map(({ flow, title }) => ({
    file: flow.file,
    project: flow.name,
    title,
  }));

  if (expected.length === 0) {
    throw new Error('The normal E2E selection is empty after applying CLI filters');
  }
  if (listed.length === 0) {
    throw new Error('Playwright listed no normal E2E tests');
  }

  const key = (entry) => `${entry.project}\u0000${entry.file}\u0000${entry.title}`;
  const expectedCounts = new Map();
  const listedCounts = new Map();
  for (const entry of expected) {
    expectedCounts.set(key(entry), (expectedCounts.get(key(entry)) ?? 0) + 1);
  }
  for (const entry of listed) {
    listedCounts.set(key(entry), (listedCounts.get(key(entry)) ?? 0) + 1);
  }

  const missing = [];
  const extras = [];
  for (const [entryKey, count] of expectedCounts) {
    const listedCount = listedCounts.get(entryKey) ?? 0;
    if (listedCount !== count) {
      missing.push(`${entryKey} (expected ${count}, listed ${listedCount})`);
    }
  }
  for (const [entryKey, count] of listedCounts) {
    const expectedCount = expectedCounts.get(entryKey) ?? 0;
    if (expectedCount !== count) {
      extras.push(`${entryKey} (expected ${expectedCount}, listed ${count})`);
    }
  }
  if (missing.length > 0 || extras.length > 0) {
    throw new Error(
      [
        'Normal E2E list validation failed.',
        missing.length > 0 ? `Missing: ${missing.join('; ')}` : '',
        extras.length > 0 ? `Extras: ${extras.join('; ')}` : '',
      ]
        .filter(Boolean)
        .join(' '),
    );
  }

  return listed;
}

module.exports = {
  MANIFEST,
  createProjects,
  validateList,
};
