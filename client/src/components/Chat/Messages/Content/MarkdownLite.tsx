import { memo } from 'react';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import supersub from 'remark-supersub';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import type { PluggableList } from 'unified';
import { CodeBlockProvider, ArtifactProvider, MarkdownTableProvider } from '~/Providers';
import { code, codeNoExecution, a, p, img, table } from './MarkdownComponents';
import MarkdownErrorBoundary from './MarkdownErrorBoundary';
import { langSubset, remarkApproxTilde } from '~/utils';
import MarkdownCell from './table/Cell';

const MarkdownLite = memo(
  ({ content = '', codeExecution = true }: { content?: string; codeExecution?: boolean }) => {
    const rehypePlugins: PluggableList = [
      [rehypeKatex],
      [
        rehypeHighlight,
        {
          detect: true,
          ignoreMissing: true,
          subset: langSubset,
        },
      ],
    ];

    return (
      <MarkdownErrorBoundary content={content} codeExecution={codeExecution}>
        <MarkdownTableProvider>
          <ArtifactProvider>
            <CodeBlockProvider>
              <ReactMarkdown
                remarkPlugins={[
                  remarkApproxTilde,
                  /** @ts-ignore */
                  supersub,
                  remarkGfm,
                  [remarkMath, { singleDollarTextMath: false }],
                ]}
                /** @ts-ignore */
                rehypePlugins={rehypePlugins}
                components={
                  {
                    code: codeExecution ? code : codeNoExecution,
                    a,
                    p,
                    img,
                    table,
                    td: MarkdownCell,
                  } as {
                    [nodeType: string]: React.ElementType;
                  }
                }
              >
                {content}
              </ReactMarkdown>
            </CodeBlockProvider>
          </ArtifactProvider>
        </MarkdownTableProvider>
      </MarkdownErrorBoundary>
    );
  },
);

export default MarkdownLite;
