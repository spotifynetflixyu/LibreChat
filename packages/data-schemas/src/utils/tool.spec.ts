import { compactMessageToolResults } from './tool';

const messageWithOutput = (output: string, backgroundTask?: { taskId: string }) => ({
  content: [{ type: 'tool_call', tool_call: { output, ...(backgroundTask && { backgroundTask }) } }],
});

describe('background tool persistence during output compaction', () => {
  it('retains a running handle across repeated saves for executor-loss recovery', () => {
    const output = JSON.stringify({ background_task_id: 'task-1', tool: 'slow_tool', status: 'running' });
    const message = messageWithOutput(output);
    expect(compactMessageToolResults(compactMessageToolResults(message))).toEqual(message);
  });

  it('retains terminal background evidence across repeated saves', () => {
    const message = messageWithOutput('full result required by the continuation', { taskId: 'task-1' });
    expect(compactMessageToolResults(compactMessageToolResults(message))).toEqual(message);
  });

  it.each([
    'ordinary foreground result',
    JSON.stringify({ background_task_id: 'task-1' }),
    JSON.stringify({ background_task_id: 'task-1', tool: 'slow_tool', status: 'completed' }),
  ])('still compacts foreground and non-running results: %s', (output) => {
    expect(compactMessageToolResults(messageWithOutput(output))).toEqual(
      messageWithOutput(JSON.stringify({ status: 'ok', dataSizeBytes: Buffer.byteLength(output) })),
    );
  });
});
