/**
 * In-process fake LLM for credential-free e2e tests. Loaded by `@librechat/api`'s
 * `createRun` via the `LIBRECHAT_TEST_RUN_HOOK` env var (set by the mock
 * Playwright config and the `--profile=mock` recorder), it swaps the run's model
 * for the agents package's own `FakeChatModel` through
 * `run.Graph.overrideTestModel(...)`.
 *
 * This exercises the real `Run.create` -> graph -> tool-node pipeline end to end
 * without a live provider or a standalone HTTP mock server: responses are decided
 * from the conversation and the agents' advertised tools.
 */
const { FakeChatModel } = require('@librechat/agents');
const { ChatGenerationChunk } = require('@langchain/core/outputs');
const { AIMessageChunk } = require('@langchain/core/messages');

const MOCK_REPLY = process.env.MOCK_LLM_REPLY || 'E2E mock reply: pong';
const CHUNK_DELAY_MS = Number(process.env.MOCK_LLM_CHUNK_DELAY_MS) || 10;

const CREATE_SKILL_MARKER = 'E2E_CREATE_SKILL:';
const EDIT_SKILL_MARKER = 'E2E_EDIT_SKILL:';
const ASSERT_MODEL_SPEC_SKILLS_MARKER = 'E2E_ASSERT_MODEL_SPEC_SKILLS';
const ASSERT_PROVIDER_FILE_MARKER = 'E2E_ASSERT_PROVIDER_FILE:';
const ASSERT_QUOTE_MARKER = 'E2E_ASSERT_QUOTE:';
const ASSERT_STEEL_NATIVE_MARKER = 'E2E_ASSERT_STEEL_NATIVE';
const ASSERT_STEEL_NATIVE_FILE_MARKER = 'E2E_ASSERT_STEEL_NATIVE_FILE:';
const ASSERT_STEEL_NATIVE_PL_OCR_MARKER = 'E2E_ASSERT_STEEL_NATIVE_PL_OCR:';
const ASSERT_STEEL_NATIVE_PL_QUOTE_MARKER = 'E2E_ASSERT_STEEL_NATIVE_PL_QUOTE:';
const REPLY_MARKER = 'E2E_REPLY:';
const COUNTED_REPLY_MARKER = 'E2E_COUNTED_REPLY:';
const SLOW_REPLY_MARKER = 'E2E_SLOW_REPLY:';
const SLOW_COUNTED_REPLY_MARKER = 'E2E_SLOW_COUNTED_REPLY:';
const RESUME_ICON_REPLY_MARKER = 'E2E_RESUME_ICON_REPLY:';
const FORCED_ERROR_MARKER = 'E2E_FORCED_ERROR:';
const MARKDOWN_REPLY_MARKER = 'E2E_MARKDOWN_REPLY';
const CREATE_FILE_AUTHORING_FINAL_TEXT = 'E2E file authoring complete';
const EDIT_FILE_AUTHORING_FINAL_TEXT = 'E2E file edit complete';
const MODEL_SPEC_SKILL_ASSERTION_FINAL_TEXT = 'E2E model spec skill assertion passed';
const PROVIDER_FILE_ASSERTION_FINAL_TEXT = 'E2E provider file assertion passed';
const QUOTE_ASSERTION_FINAL_TEXT = 'E2E quote assertion passed';
const STEEL_NATIVE_ASSERTION_FINAL_TEXT = 'E2E Steel native assertion passed';
const STEEL_NATIVE_FILE_ASSERTION_FINAL_TEXT = 'E2E Steel native file assertion passed';
const STEEL_NATIVE_PL_OCR_FINAL_TEXT = 'E2E Steel native PL OCR confirmation passed';
const STEEL_NATIVE_PL_QUOTE_FINAL_TEXT = 'E2E Steel native PL quote passed';
const SLOW_CHUNK_DELAY_MS = Number(process.env.MOCK_LLM_SLOW_CHUNK_DELAY_MS) || 35;
const SLOW_REPLY_CHUNKS = 160;
const RESUME_ICON_CHUNK_DELAY_MS = Number(process.env.MOCK_LLM_RESUME_ICON_CHUNK_DELAY_MS) || 60;
const RESUME_ICON_REPLY_CHUNKS = 240;
const CREATE_FILE_TOOL_NAME = 'create_file';
const EDIT_FILE_TOOL_NAME = 'edit_file';
const BASH_TOOL_NAME = 'bash_tool';
const SKILL_TOOL_NAME = 'skill';
const CREATE_SKILL_TOOL_CALL_ID = 'call_e2e_create_skill';
const EDIT_SKILL_TOOL_CALL_ID = 'call_e2e_edit_skill';
const MODEL_SPEC_ACCESSIBLE_SKILL = 'e2e-model-spec-allowed';
const MODEL_SPEC_MISSING_SKILL = 'e2e-model-spec-missing';
const MODEL_SPEC_INACCESSIBLE_SKILL = 'e2e-model-spec-inaccessible';
const ALWAYS_APPLY_BODY_MARKER = 'E2E_ALWAYS_APPLY_BODY_MARKER';
const STEEL_NATIVE_REQUIRED_TOOL_NAMES = ['search_price_candidates', 'read_markdown'];
const STEEL_NATIVE_CONTEXT_MARKERS = [
  'Steel Native Context Metadata',
  'Steel Runtime Context',
  'Steel Tool Policy',
  '10、20、30',
];
const SKILL_DESCRIPTION =
  'Use this skill to verify LibreChat skill file authoring in mock end-to-end tests.';
const EDITED_SKILL_DESCRIPTION =
  'Use this edited skill to verify LibreChat skill file authoring in mock end-to-end tests.';
const countedReplies = new Map();
const slowCountedReplies = new Map();

function messageType(message) {
  if (typeof message.getType === 'function') {
    return message.getType();
  }
  if (typeof message._getType === 'function') {
    return message._getType();
  }
  return message.role || message.type || '';
}

function getContentText(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (!Array.isArray(content)) {
    return '';
  }
  return content
    .map((part) => {
      if (typeof part === 'string') {
        return part;
      }
      if (part && typeof part === 'object' && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .join('\n');
}

function getLatestUserText(messages) {
  const message = getLatestUserMessage(messages);
  return message ? getContentText(message.content) : '';
}

function getLatestUserMessage(messages) {
  if (!Array.isArray(messages)) {
    return null;
  }
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (!message) {
      continue;
    }
    const type = messageType(message);
    if (type === 'human' || type === 'user') {
      return message;
    }
  }
  return null;
}

function getRequestedSkillName(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) {
    return '';
  }
  const afterMarker = text.slice(markerIndex + marker.length);
  return afterMarker.match(/[a-z0-9][a-z0-9-]*/)?.[0] ?? '';
}

function getMarkerValue(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) {
    return '';
  }
  return (
    text
      .slice(markerIndex + marker.length)
      .trim()
      .split(/\s+/, 1)[0] ?? ''
  );
}

function collectToolNames(agents) {
  const names = new Set();
  const add = (name) => {
    if (typeof name === 'string' && name) {
      names.add(name);
    }
  };
  for (const agent of agents ?? []) {
    if (!agent) {
      continue;
    }
    for (const tool of agent.tools ?? []) {
      add(tool?.name);
    }
    for (const def of agent.toolDefinitions ?? []) {
      add(def?.name);
    }
    if (agent.toolRegistry && typeof agent.toolRegistry.keys === 'function') {
      for (const name of agent.toolRegistry.keys()) {
        add(name);
      }
    }
  }
  return names;
}

function collectAdditionalInstructions(agents) {
  return (agents ?? [])
    .map((agent) =>
      typeof agent?.additional_instructions === 'string' ? agent.additional_instructions : '',
    )
    .filter(Boolean)
    .join('\n');
}

function collectAgentVisibleInstructions(agents) {
  return (agents ?? [])
    .flatMap((agent) => [
      typeof agent?.instructions === 'string' ? agent.instructions : '',
      typeof agent?.additional_instructions === 'string' ? agent.additional_instructions : '',
    ])
    .filter(Boolean)
    .join('\n');
}

function collectMessageText(messages) {
  return (messages ?? []).map((message) => getContentText(message?.content)).join('\n');
}

function collectSkillPrimeMessages(messages) {
  return (messages ?? [])
    .filter((message) => message?.additional_kwargs?.source === 'skill')
    .map((message) => ({
      name: message.additional_kwargs.skillName,
      trigger: message.additional_kwargs.trigger,
      content: getContentText(message.content),
    }));
}

function collectProviderFileNames(value, names = new Set()) {
  if (value == null) {
    return names;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectProviderFileNames(item, names);
    }
    return names;
  }

  if (typeof value !== 'object') {
    return names;
  }

  if (value.type === 'input_file' && typeof value.filename === 'string') {
    names.add(value.filename);
  }

  if (value.type === 'file' && typeof value.file?.filename === 'string') {
    names.add(value.file.filename);
  }

  if (value.type === 'document' && typeof value.context === 'string') {
    const match = value.context.match(/File:\s*"([^"]+)"/);
    if (match?.[1]) {
      names.add(match[1]);
    }
  }

  for (const child of Object.values(value)) {
    collectProviderFileNames(child, names);
  }

  return names;
}

function providerFileAssertionResponses({ messages, text }) {
  const filename = getMarkerValue(text, ASSERT_PROVIDER_FILE_MARKER);
  if (!filename) {
    return null;
  }

  const latestUserMessage = getLatestUserMessage(messages);
  const providerFileNames = collectProviderFileNames(latestUserMessage?.content);
  if (providerFileNames.has(filename)) {
    return {
      responses: [`${PROVIDER_FILE_ASSERTION_FINAL_TEXT}: ${filename}`],
    };
  }

  return {
    responses: [
      `E2E provider file assertion failed: expected ${filename}; saw ${
        Array.from(providerFileNames).join(', ') || 'no provider files'
      }`,
    ],
  };
}

/**
 * Verifies the quote feature end to end: scans every user message in the prompt
 * the model actually received for a Markdown blockquote line containing the
 * expected token. Passing proves the excerpt was merged into the model-facing
 * turn — covering both the current turn and durable re-merge of a prior quoted
 * turn from history (the merge runs in `AgentClient.buildMessages`).
 */
function quoteAssertionResponses({ messages, text }) {
  const expected = getMarkerValue(text, ASSERT_QUOTE_MARKER);
  if (!expected) {
    return null;
  }

  const found = (messages ?? []).some((message) => {
    const type = messageType(message);
    if (type !== 'human' && type !== 'user') {
      return false;
    }
    return getContentText(message.content)
      .split('\n')
      .some((line) => line.startsWith('> ') && line.includes(expected));
  });

  if (found) {
    return { responses: [`${QUOTE_ASSERTION_FINAL_TEXT}: ${expected}`] };
  }
  return {
    responses: [`E2E quote assertion failed: no blockquote containing "${expected}" in the prompt`],
  };
}

function collectSteelNativeAssertionFailures({ agents, messages, toolNames }) {
  const failures = [];
  const visibleText = [collectAgentVisibleInstructions(agents), collectMessageText(messages)]
    .filter(Boolean)
    .join('\n');

  for (const toolName of STEEL_NATIVE_REQUIRED_TOOL_NAMES) {
    if (!toolNames.has(toolName)) {
      failures.push(`${toolName} tool was not advertised`);
    }
  }

  for (const marker of STEEL_NATIVE_CONTEXT_MARKERS) {
    if (!visibleText.includes(marker)) {
      failures.push(`${marker} was not model-visible`);
    }
  }

  return failures;
}

const STEEL_NATIVE_SYSTEM_ORDER_HEADER =
  '| 型號 | 品名規格 | 材質編號 | 單位 | 數量 | 單重 | 總數 | 單價 | 計價基準 | 公式編號 | 厚度 | 寬度 | 長度 | 肚 | 類別 | 備註 |';
const STEEL_NATIVE_SYSTEM_ORDER_SEPARATOR =
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |';

function buildSteelNativeSystemOrderMarkdown(finalText) {
  return [
    finalText,
    '',
    STEEL_NATIVE_SYSTEM_ORDER_HEADER,
    STEEL_NATIVE_SYSTEM_ORDER_SEPARATOR,
    '| CCG075 | 錏輕型鋼 75x45x15x2.3 |  | 支 | 2 | 4 | 8 | 26.8 | 2 | F1 | 2.3 | 75 | 6000 |  | C型鋼 | E2E native smoke |',
  ].join('\n');
}

function steelNativeAssertionResponses({ agents, messages, toolNames }) {
  const failures = collectSteelNativeAssertionFailures({ agents, messages, toolNames });

  if (failures.length > 0) {
    return {
      responses: [`E2E Steel native assertion failed: ${failures.join('; ')}`],
    };
  }

  return {
    responses: [buildSteelNativeSystemOrderMarkdown(STEEL_NATIVE_ASSERTION_FINAL_TEXT)],
  };
}

function steelNativeFileAssertionResponses({ agents, messages, text, toolNames }) {
  const filename = getMarkerValue(text, ASSERT_STEEL_NATIVE_FILE_MARKER);
  if (!filename) {
    return null;
  }

  const failures = collectSteelNativeAssertionFailures({ agents, messages, toolNames });
  const latestUserMessage = getLatestUserMessage(messages);
  const providerFileNames = collectProviderFileNames(latestUserMessage?.content);
  if (!providerFileNames.has(filename)) {
    failures.push(
      `expected provider file ${filename}; saw ${
        Array.from(providerFileNames).join(', ') || 'no provider files'
      }`,
    );
  }

  if (failures.length > 0) {
    return {
      responses: [`E2E Steel native file assertion failed: ${failures.join('; ')}`],
    };
  }

  return {
    responses: [
      buildSteelNativeSystemOrderMarkdown(`${STEEL_NATIVE_FILE_ASSERTION_FINAL_TEXT}: ${filename}`),
    ],
  };
}

function buildSteelNativePlOcrMarkdown(filename) {
  return [
    `${STEEL_NATIVE_PL_OCR_FINAL_TEXT}: ${filename}`,
    '',
    '## OCR 結果確認',
    '',
    '| 來源 | 件號 | 規格 | 材質 | 數量 | 孔數 / 件 | 總孔數 | 低信心 / 人工複核 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    `| ${filename} | PL1 | PL6*80*1000 | 黑鐵 | 2 | 4 | 8 | mock OCR confirmation row |`,
    `| ${filename} | PL2 | PL15*500*800 | 黑鐵 | 1 | 6 | 6 | mock OCR confirmation row |`,
  ].join('\n');
}

function buildSteelNativePlQuoteMarkdown(filename) {
  return [
    `${STEEL_NATIVE_PL_QUOTE_FINAL_TEXT}: ${filename}`,
    '',
    STEEL_NATIVE_SYSTEM_ORDER_HEADER,
    STEEL_NATIVE_SYSTEM_ORDER_SEPARATOR,
    `| 01 | 10 | A | DNB006 | PL6*80*1000 黑鐵板 |  |  | 片 | 2 | 3.77 | 7.54 | 28 | 2 | PL | 6 | 80 | 1000 |  | 鐵板/鋼板 |  | from confirmed OCR ${filename} PL1 |`,
    `| 01 | 11 | A | KZZ001 | 鐵板鑽孔 |  |  | 孔 | 8 |  | 8 | 10 | 2 |  |  |  |  |  | 孔 |  | confirmed OCR total holes PL1 |`,
    `| 01 | 20 | A | DNB015 | PL15*500*800 黑鐵板 |  |  | 片 | 1 | 47.1 | 47.1 | 28 | 2 | PL | 15 | 500 | 800 |  | 鐵板/鋼板 |  | from confirmed OCR ${filename} PL2 |`,
    `| 01 | 21 | A | KZZ001 | 鐵板鑽孔 |  |  | 孔 | 6 |  | 6 | 10 | 2 |  |  |  |  |  | 孔 |  | confirmed OCR total holes PL2 |`,
  ].join('\n');
}

function latestProviderFileFailures({ messages, filename }) {
  const latestUserMessage = getLatestUserMessage(messages);
  const providerFileNames = collectProviderFileNames(latestUserMessage?.content);
  if (providerFileNames.has(filename)) {
    return [];
  }

  return [
    `expected provider file ${filename}; saw ${
      Array.from(providerFileNames).join(', ') || 'no provider files'
    }`,
  ];
}

function hasPriorPlOcrConfirmation({ messages, filename }) {
  return (messages ?? []).some((message) => {
    const type = messageType(message);
    if (type !== 'ai' && type !== 'assistant') {
      return false;
    }
    const content = getContentText(message.content);
    return (
      content.includes(STEEL_NATIVE_PL_OCR_FINAL_TEXT) &&
      content.includes(filename) &&
      content.includes('OCR 結果確認') &&
      content.includes('孔數 / 件') &&
      content.includes('總孔數')
    );
  });
}

function steelNativePlOcrAssertionResponses({ agents, messages, text, toolNames }) {
  const filename = getMarkerValue(text, ASSERT_STEEL_NATIVE_PL_OCR_MARKER);
  if (!filename) {
    return null;
  }

  const failures = [
    ...collectSteelNativeAssertionFailures({ agents, messages, toolNames }),
    ...latestProviderFileFailures({ messages, filename }),
  ];

  if (failures.length > 0) {
    return {
      responses: [`E2E Steel native PL OCR assertion failed: ${failures.join('; ')}`],
    };
  }

  return {
    responses: [buildSteelNativePlOcrMarkdown(filename)],
  };
}

function steelNativePlQuoteAssertionResponses({ agents, messages, text, toolNames }) {
  const filename = getMarkerValue(text, ASSERT_STEEL_NATIVE_PL_QUOTE_MARKER);
  if (!filename) {
    return null;
  }

  const failures = collectSteelNativeAssertionFailures({ agents, messages, toolNames });
  if (!hasPriorPlOcrConfirmation({ messages, filename })) {
    failures.push(`previous assistant OCR confirmation for ${filename} was not reconstructed`);
  }

  if (failures.length > 0) {
    return {
      responses: [`E2E Steel native PL quote assertion failed: ${failures.join('; ')}`],
    };
  }

  return {
    responses: [buildSteelNativePlQuoteMarkdown(filename)],
  };
}

function replyResponses(text) {
  if (text.includes(MARKDOWN_REPLY_MARKER)) {
    return {
      responses: [
        [
          '## E2E markdown heading',
          '',
          '**E2E bold text**',
          '',
          '- E2E list item',
          '',
          '```javascript',
          'const e2eSyntaxHighlight = "ok";',
          '```',
        ].join('\n'),
      ],
    };
  }

  const errorName = getMarkerValue(text, FORCED_ERROR_MARKER);
  if (errorName) {
    return {
      responses: [`E2E forced error prelude ${errorName}`],
      thrownError: `E2E forced stream error ${errorName}`,
    };
  }

  const replyName = getMarkerValue(text, REPLY_MARKER);
  if (replyName) {
    return {
      responses: [`E2E reply ${replyName}`],
    };
  }

  const countedName = getMarkerValue(text, COUNTED_REPLY_MARKER);
  if (countedName) {
    const count = (countedReplies.get(countedName) ?? 0) + 1;
    countedReplies.set(countedName, count);
    return {
      responses: [`E2E counted reply ${countedName} #${count}`],
    };
  }

  const slowName = getMarkerValue(text, SLOW_REPLY_MARKER);
  if (slowName) {
    const chunks = Array.from(
      { length: SLOW_REPLY_CHUNKS },
      (_, index) => `chunk-${String(index).padStart(3, '0')}`,
    ).join(' ');
    return {
      responses: [`E2E slow reply ${slowName} ${chunks}`],
      sleep: SLOW_CHUNK_DELAY_MS,
    };
  }

  const slowCountedName = getMarkerValue(text, SLOW_COUNTED_REPLY_MARKER);
  if (slowCountedName) {
    const count = (slowCountedReplies.get(slowCountedName) ?? 0) + 1;
    slowCountedReplies.set(slowCountedName, count);
    const chunks = Array.from(
      { length: SLOW_REPLY_CHUNKS },
      (_, index) => `chunk-${String(index).padStart(3, '0')}`,
    ).join(' ');
    return {
      responses: [`E2E slow counted reply ${slowCountedName} #${count} ${chunks}`],
      sleep: SLOW_CHUNK_DELAY_MS,
    };
  }

  const resumeIconName = getMarkerValue(text, RESUME_ICON_REPLY_MARKER);
  if (resumeIconName) {
    const chunks = Array.from(
      { length: RESUME_ICON_REPLY_CHUNKS },
      (_, index) => `chunk-${String(index).padStart(3, '0')}`,
    ).join(' ');
    return {
      responses: [`E2E resume icon reply ${resumeIconName} ${chunks}`],
      sleep: RESUME_ICON_CHUNK_DELAY_MS,
    };
  }

  return null;
}

/**
 * Attaches synthetic usage_metadata on a final empty chunk (the OpenAI
 * streaming pattern) so token-usage SSE events flow end to end in mock runs.
 */
class UsageEmittingFakeChatModel extends FakeChatModel {
  async *_streamResponseChunks(messages, options, runManager) {
    let outputChars = 0;
    for await (const chunk of super._streamResponseChunks(messages, options, runManager)) {
      outputChars += typeof chunk.text === 'string' ? chunk.text.length : 0;
      yield chunk;
    }
    const inputChars = (messages ?? []).reduce(
      (sum, message) => sum + getContentText(message?.content).length,
      0,
    );
    const input_tokens = Math.max(1, Math.ceil(inputChars / 4));
    const output_tokens = Math.max(1, Math.ceil(outputChars / 4));
    yield new ChatGenerationChunk({
      text: '',
      message: new AIMessageChunk({
        content: '',
        usage_metadata: { input_tokens, output_tokens, total_tokens: input_tokens + output_tokens },
      }),
    });
  }
}

function overrideModel({ graph, responses, sleep, toolCalls, thrownError }) {
  if (!thrownError) {
    graph.overrideModel = new UsageEmittingFakeChatModel({
      responses,
      sleep: sleep ?? CHUNK_DELAY_MS,
      emitCustomEvent: true,
      toolCalls,
    });
    return;
  }

  class ThrowingFakeChatModel extends FakeChatModel {
    async *_streamResponseChunks(messages, options, runManager) {
      yield* super._streamResponseChunks(
        messages,
        { ...options, thrownErrorString: thrownError },
        runManager,
      );
    }
  }

  graph.overrideModel = new ThrowingFakeChatModel({
    responses,
    sleep: sleep ?? CHUNK_DELAY_MS,
    emitCustomEvent: true,
    toolCalls,
  });
}

function modelSpecSkillAssertionResponses({ agents, messages, toolNames }) {
  const failures = [];
  const additionalInstructions = collectAdditionalInstructions(agents);
  const skillPrimeMessages = collectSkillPrimeMessages(messages);
  const alwaysApplyPrime = skillPrimeMessages.find(
    (message) => message.name === MODEL_SPEC_ACCESSIBLE_SKILL && message.trigger === 'always-apply',
  );

  if (!toolNames.has(SKILL_TOOL_NAME)) {
    failures.push(`${SKILL_TOOL_NAME} tool was not advertised`);
  }
  if (!additionalInstructions.includes(MODEL_SPEC_ACCESSIBLE_SKILL)) {
    failures.push(`${MODEL_SPEC_ACCESSIBLE_SKILL} was not present in the model-visible catalog`);
  }
  if (additionalInstructions.includes(MODEL_SPEC_MISSING_SKILL)) {
    failures.push(`${MODEL_SPEC_MISSING_SKILL} leaked into the model-visible catalog`);
  }
  if (additionalInstructions.includes(MODEL_SPEC_INACCESSIBLE_SKILL)) {
    failures.push(`${MODEL_SPEC_INACCESSIBLE_SKILL} leaked into the model-visible catalog`);
  }
  if (!alwaysApplyPrime) {
    failures.push(`${MODEL_SPEC_ACCESSIBLE_SKILL} was not always-apply primed`);
  } else if (!alwaysApplyPrime.content.includes(ALWAYS_APPLY_BODY_MARKER)) {
    failures.push(`${MODEL_SPEC_ACCESSIBLE_SKILL} always-apply body was missing its marker`);
  }
  if (skillPrimeMessages.some((message) => message.name === MODEL_SPEC_MISSING_SKILL)) {
    failures.push(`${MODEL_SPEC_MISSING_SKILL} was unexpectedly primed`);
  }
  if (skillPrimeMessages.some((message) => message.name === MODEL_SPEC_INACCESSIBLE_SKILL)) {
    failures.push(`${MODEL_SPEC_INACCESSIBLE_SKILL} was unexpectedly primed`);
  }

  if (failures.length > 0) {
    return {
      responses: [`E2E model spec skill assertion failed: ${failures.join('; ')}`],
    };
  }
  return {
    responses: [`${MODEL_SPEC_SKILL_ASSERTION_FINAL_TEXT}: ${MODEL_SPEC_ACCESSIBLE_SKILL}`],
  };
}

function buildSkillBody(skillName) {
  return `---
name: ${skillName}
description: ${SKILL_DESCRIPTION}
---

# ${skillName}

Created by the Playwright mock e2e suite to verify host file authoring without code execution.`;
}

function buildCreateSkillArgs(skillName) {
  return {
    path: `skills/${skillName}/SKILL.md`,
    content: buildSkillBody(skillName),
    overwrite: false,
  };
}

function buildEditSkillArgs(skillName) {
  return {
    path: `skills/${skillName}/SKILL.md`,
    old_text: `description: ${SKILL_DESCRIPTION}`,
    new_text: `description: ${EDITED_SKILL_DESCRIPTION}`,
  };
}

/**
 * Pick the fake-model script for a skill file-authoring turn. The graph runs two
 * model turns: turn 1 streams the (empty) preamble and emits the tool call, the
 * tool node writes the SKILL.md, then turn 2 streams the final text. The guards
 * assert the feature advertised the host file-authoring tool and did NOT enable
 * code execution.
 */
function fileAuthoringResponses(operation, toolNames) {
  if (!toolNames.has(operation.toolName)) {
    return {
      responses: [`E2E file authoring unavailable: ${operation.toolName} was not advertised.`],
    };
  }
  if (toolNames.has(BASH_TOOL_NAME)) {
    return {
      responses: [`E2E file authoring unavailable: ${BASH_TOOL_NAME} was unexpectedly advertised.`],
    };
  }
  return {
    responses: ['', `${operation.finalText}: ${operation.skillName}`],
    toolCalls: [
      {
        id: operation.toolCallId,
        name: operation.toolName,
        args: operation.args,
        type: 'tool_call',
      },
    ],
  };
}

function resolveResponses({ agents, messages, text, toolNames }) {
  const reply = replyResponses(text);
  if (reply) {
    return reply;
  }

  const providerFileAssertion = providerFileAssertionResponses({ messages, text });
  if (providerFileAssertion) {
    return providerFileAssertion;
  }

  const quoteAssertion = quoteAssertionResponses({ messages, text });
  if (quoteAssertion) {
    return quoteAssertion;
  }

  if (text.includes(ASSERT_MODEL_SPEC_SKILLS_MARKER)) {
    return modelSpecSkillAssertionResponses({ agents, messages, toolNames });
  }

  const steelNativePlOcrAssertion = steelNativePlOcrAssertionResponses({
    agents,
    messages,
    text,
    toolNames,
  });
  if (steelNativePlOcrAssertion) {
    return steelNativePlOcrAssertion;
  }

  const steelNativePlQuoteAssertion = steelNativePlQuoteAssertionResponses({
    agents,
    messages,
    text,
    toolNames,
  });
  if (steelNativePlQuoteAssertion) {
    return steelNativePlQuoteAssertion;
  }

  const steelNativeFileAssertion = steelNativeFileAssertionResponses({
    agents,
    messages,
    text,
    toolNames,
  });
  if (steelNativeFileAssertion) {
    return steelNativeFileAssertion;
  }

  if (text.includes(ASSERT_STEEL_NATIVE_MARKER)) {
    return steelNativeAssertionResponses({ agents, messages, toolNames });
  }

  const createSkillName = getRequestedSkillName(text, CREATE_SKILL_MARKER);
  if (createSkillName) {
    return fileAuthoringResponses(
      {
        skillName: createSkillName,
        toolName: CREATE_FILE_TOOL_NAME,
        toolCallId: CREATE_SKILL_TOOL_CALL_ID,
        finalText: CREATE_FILE_AUTHORING_FINAL_TEXT,
        args: buildCreateSkillArgs(createSkillName),
      },
      toolNames,
    );
  }

  const editSkillName = getRequestedSkillName(text, EDIT_SKILL_MARKER);
  if (editSkillName) {
    return fileAuthoringResponses(
      {
        skillName: editSkillName,
        toolName: EDIT_FILE_TOOL_NAME,
        toolCallId: EDIT_SKILL_TOOL_CALL_ID,
        finalText: EDIT_FILE_AUTHORING_FINAL_TEXT,
        args: buildEditSkillArgs(editSkillName),
      },
      toolNames,
    );
  }

  return { responses: [MOCK_REPLY] };
}

/** @type {import('@librechat/api').TestRunHook} */
module.exports = function fakeModelHook(run, context) {
  const graph = run?.Graph;
  if (!graph || typeof graph.overrideTestModel !== 'function') {
    console.warn('[e2e] fake-model hook: run.Graph.overrideTestModel unavailable');
    return;
  }

  const text = getLatestUserText(context?.messages);
  const toolNames = collectToolNames(context?.agents);
  const { responses, sleep, toolCalls, thrownError } = resolveResponses({
    agents: context?.agents,
    messages: context?.messages,
    text,
    toolNames,
  });
  overrideModel({ graph, responses, sleep, toolCalls, thrownError });
};
