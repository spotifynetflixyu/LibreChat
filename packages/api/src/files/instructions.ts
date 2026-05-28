export interface FileInstructionConfig {
  fileAnalysis?: {
    instructions?: string | null;
  } | null;
}

export interface FileInstructionTarget {
  filename?: string | null;
  mediaType?: string | null;
  type?: string | null;
}

export function hasFileInstructionTarget(files: Iterable<FileInstructionTarget>): boolean {
  for (const file of files) {
    const mediaType = (file.mediaType ?? file.type ?? '').trim().toLowerCase();
    if (mediaType.startsWith('image/') || mediaType === 'application/pdf') {
      return true;
    }
    if ((file.filename ?? '').trim().toLowerCase().endsWith('.pdf')) {
      return true;
    }
  }

  return false;
}

export function buildFileInstructions({
  config,
  files,
}: {
  config?: FileInstructionConfig | null;
  files: Iterable<FileInstructionTarget>;
}): string | undefined {
  const instructions = config?.fileAnalysis?.instructions?.trim();
  if (!instructions || !hasFileInstructionTarget(files)) {
    return undefined;
  }

  return instructions;
}

export function prefixFileInstructions(content: string, instructions?: string | null): string {
  const trimmedInstructions = instructions?.trim();
  if (!trimmedInstructions) {
    return content;
  }

  if (content.startsWith(trimmedInstructions)) {
    return content;
  }

  return `${trimmedInstructions}\n\n${content}`;
}

export function applyFileInstructionsToMessages<
  T extends {
    role: string;
    content: string;
    files?: FileInstructionTarget[];
  },
>(messages: T[], config?: FileInstructionConfig | null): T[] {
  const instructions = config?.fileAnalysis?.instructions?.trim();
  if (!instructions) {
    return messages;
  }

  let changed = false;
  const nextMessages = messages.map((message) => {
    if (
      message.role !== 'user' ||
      !message.files?.length ||
      !hasFileInstructionTarget(message.files)
    ) {
      return message;
    }

    const content = prefixFileInstructions(message.content, instructions);
    if (content === message.content) {
      return message;
    }

    changed = true;
    return {
      ...message,
      content,
    };
  });

  return changed ? nextMessages : messages;
}
