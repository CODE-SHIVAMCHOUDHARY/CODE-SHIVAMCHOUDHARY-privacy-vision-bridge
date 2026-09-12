import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// The workspace package exposes this generated hook at runtime; its project reference
// can lag behind the generated source declaration during a fresh workspace install.
// @ts-ignore
import { useProcessVisualContext } from '@workspace/api-client-react';
import {
  Activity,
  Check,
  CheckCircle2,
  ChevronRight,
  Clipboard,
  Code2,
  FolderOpen,
  Gauge,
  ImagePlus,
  Keyboard,
  LockKeyhole,
  Menu,
  MousePointer2,
  RotateCcw,
  ScanSearch,
  ShieldCheck,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter, useLocation } from 'wouter';

const queryClient = new QueryClient();

type ViewState = 'empty' | 'loading' | 'success' | 'failure';
type VisualCommand = {
  action: string;
  target?: string | null;
  x?: number | null;
  y?: number | null;
  text?: string | null;
  direction?: string | null;
  amount?: number | null;
  key?: string | null;
  value?: string | null;
  milliseconds?: number | null;
  url?: string | null;
  confidence: number;
};
type VisualContextResult = {
  success: boolean;
  commands: VisualCommand[];
  model: string;
  error: string | null;
};

const actionIcons: Record<string, typeof MousePointer2> = {
  click: MousePointer2,
  type: Keyboard,
  scroll: ChevronRight,
  keypress: Keyboard,
  select: Check,
  wait: Activity,
  navigate: ChevronRight,
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The image could not be read.'));
    reader.readAsDataURL(file);
  });
}

function commandDetail(command: VisualCommand): string {
  if (command.action === 'click') return command.target || `point (${command.x ?? '—'}, ${command.y ?? '—'})`;
  if (command.action === 'type') return command.text ? `“${command.text}”${command.target ? ` into ${command.target}` : ''}` : 'text input';
  if (command.action === 'scroll') return `${command.direction || 'down'} ${command.amount ? `${command.amount}px` : 'until target is visible'}`;
  if (command.action === 'keypress') return command.key || 'keyboard input';
  if (command.action === 'select') return command.value || command.target || 'option';
  if (command.action === 'wait') return `${command.milliseconds || 500}ms`;
  if (command.action === 'navigate') return command.url || 'destination';
  return command.target || 'validated browser command';
}

function getErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'The perception service could not complete this run. Check the image and try again.';
}

function Workbench() {
  const [imageBase64, setImageBase64] = useState('');
  const [imageName, setImageName] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [result, setResult] = useState<VisualContextResult | null>(null);
  const [runError, setRunError] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedResult, setCopiedResult] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processVisualContext = useProcessVisualContext();

  const viewState: ViewState = processVisualContext.isPending
    ? 'loading'
    : runError || (result && !result.success) ? 'failure'
    : result?.success ? 'success'
    : 'empty';

  const payload = useMemo(() => ({
    image_base64: imageBase64,
    task_prompt: taskPrompt,
  }), [imageBase64, taskPrompt]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.files || []).find((item) => item.type.startsWith('image/'));
      if (file) void loadFile(file);
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  });

  const loadFile = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setImageBase64(dataUrl);
      setImageName(file.name || 'pasted-image');
      setResult(null);
      setRunError('');
    } catch (error) {
      setRunError(getErrorMessage(error));
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void loadFile(file);
    event.target.value = '';
  };

  const runPerception = () => {
    if (!imageBase64 || !taskPrompt.trim() || processVisualContext.isPending) return;
    setRunError('');
    setResult(null);
    processVisualContext.mutate({ data: payload }, {
      onSuccess: (response: VisualContextResult) => {
        setResult(response);
        if (!response.success) setRunError(response.error || 'The model did not return a safe command plan.');
      },
      onError: (error: unknown) => setRunError(getErrorMessage(error)),
    });
  };

  const resetWorkbench = () => {
    setImageBase64('');
    setImageName('');
    setTaskPrompt('');
    setResult(null);
    setRunError('');
    setCopied(false);
    setCopiedResult(false);
  };

  const copyPayload = async () => {
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const copyResult = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    setCopiedResult(true);
    window.setTimeout(() => setCopiedResult(false), 1800);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void loadFile(file);
  };

  return (
    <div className="app-shell">
      <aside className="side-rail">
        <div className="brand-row">
          <div className="brand-mark">v/</div>
          <div>
            <div className="brand-name">veilwork</div>
            <div className="brand-subtitle">visual control room</div>
          </div>
          <button className="mobile-rail-toggle" onClick={() => setMobileMenuOpen((open) => !open)} aria-label="Toggle navigation" data-testid="button-toggle-navigation">
            <Menu size={18} />
          </button>
        </div>
        <div className={`rail-nav ${mobileMenuOpen ? 'mobile-visible' : ''}`}>
          <div className="rail-rule" />
          <div className="rail-kicker">Workspace</div>
          <button className="rail-nav-item active" data-testid="button-nav-workbench"><ScanSearch size={15} /> Perception workbench</button>
          <button className="rail-nav-item" onClick={resetWorkbench} data-testid="button-nav-new-run"><RotateCcw size={15} /> New run</button>
          <button className="rail-nav-item" onClick={() => setTaskPrompt('Inspect the page and identify the safest click target for the primary action.')} data-testid="button-nav-example"><Code2 size={15} /> Prompt example</button>
        </div>
        <div className="rail-footer">
          <div className="privacy-chip"><ShieldCheck size={15} /><span>Pre-redacted inputs only.<br />Commands are inspected, never executed.</span></div>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="crumb"><span className="status-dot" /> <strong>LOCAL WORKSPACE</strong> <ChevronRight size={12} /> RUN 001</div>
          <div className="topbar-meta"><span><LockKeyhole size={12} style={{ verticalAlign: 'middle', marginRight: 5 }} /> no image retention</span><span>v0.1.0</span></div>
        </header>

        <main className="main-content">
          <section className="intro">
            <div>
              <div className="eyebrow">/ visual context processor</div>
              <h1 className="page-title">Turn a screenshot into a<br /><em>safe next move.</em></h1>
            </div>
            <p className="intro-copy">A focused inspection surface for browser agents. Bring a redacted screen, state the intent, and get a command plan you can actually audit.</p>
          </section>

          <div className="workbench-grid">
            <section className="panel input-panel">
              <div className="panel-head">
                <div><h2 className="panel-title">Input context</h2><p className="panel-note">Supply only what the processor needs.</p></div>
                <span className="step-tag">01 / 02</span>
              </div>
              <div className="panel-body">
                <div
                  className={`drop-zone ${isDragging ? 'dragging' : ''} ${imageBase64 ? 'has-image' : ''}`}
                  onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  data-testid="dropzone-image"
                >
                  {imageBase64 ? (
                    <>
                      <img className="preview-image" src={imageBase64} alt="Redacted screenshot preview" data-testid="img-redacted-preview" />
                      <div className="image-meta"><span>{imageName || 'redacted-image'}</span><button onClick={() => { setImageBase64(''); setImageName(''); }} data-testid="button-remove-image"><X size={13} /> remove</button></div>
                    </>
                  ) : (
                    <div className="drop-content">
                      <div className="upload-icon"><ImagePlus size={21} /></div>
                      <p className="drop-title">Drop a redacted screenshot</p>
                      <p className="drop-detail">PNG, JPEG, WEBP or GIF · paste also works<br /><code>nothing leaves your controlled environment</code></p>
                      <div className="drop-actions">
                        <button className="button button-quiet button-small" onClick={() => fileInputRef.current?.click()} data-testid="button-browse-image"><FolderOpen size={14} /> Browse files</button>
                        <input ref={fileInputRef} className="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onFileChange} data-testid="input-image-file" />
                      </div>
                    </div>
                  )}
                </div>

                <div className="field-block">
                  <label className="field-label" htmlFor="task-prompt"><span>Task prompt</span><span className="field-limit">{taskPrompt.length} / 2000</span></label>
                  <textarea id="task-prompt" className="task-input" maxLength={2000} value={taskPrompt} onChange={(event) => { setTaskPrompt(event.target.value); setResult(null); setRunError(''); }} placeholder="Describe the browser action you want to validate…" data-testid="input-task-prompt" />
                  <p className="field-help">Be specific about the outcome. The processor returns intent only — it will not operate the browser.</p>
                </div>

                <div className="button-row">
                  <button className="button button-quiet" onClick={resetWorkbench} disabled={!imageBase64 && !taskPrompt && !result} data-testid="button-reset-workbench"><RotateCcw size={14} /> Reset</button>
                  <button className="button button-primary" onClick={runPerception} disabled={!imageBase64 || !taskPrompt.trim() || processVisualContext.isPending} data-testid="button-run-perception">
                    {processVisualContext.isPending ? <><Activity size={15} /> Processing context…</> : <><UploadCloud size={15} /> Run perception</>}
                  </button>
                </div>
              </div>
            </section>

            <div className="result-stack">
              <section className="panel result-panel">
                {viewState === 'empty' && (
                  <div className="empty-result" data-testid="state-empty">
                    <div>
                      <div className="empty-orbit"><Gauge size={25} strokeWidth={1.5} /></div>
                      <h2 className="empty-title">Awaiting visual context</h2>
                      <p className="empty-copy">Your inspected command sequence will appear here with confidence scores and the model trace.</p>
                    </div>
                  </div>
                )}
                {viewState === 'loading' && (
                  <div className="loading-view" data-testid="state-loading">
                    <div className="skeleton skeleton-line short" /><div className="skeleton skeleton-line wide" /><div className="skeleton skeleton-box" /><div className="skeleton skeleton-line wide" style={{ marginTop: 24 }} /><div className="skeleton skeleton-line" style={{ width: '60%' }} /><p className="loading-label">Inspecting redacted context · validating action path</p>
                  </div>
                )}
                {viewState === 'failure' && (
                  <div data-testid="state-failure">
                    <div className="result-summary">
                      <div className="result-status failure"><XCircle size={18} /> Perception needs another pass</div>
                      <div className="summary-meta"><span>MODEL <strong>{result?.model || 'service response'}</strong></span><span>STATUS <strong>not executable</strong></span></div>
                      <p className="failure-copy">{runError || result?.error || 'No safe command sequence was returned.'}</p>
                    </div>
                    <div className="empty-result" style={{ minHeight: 205 }}><div><div className="empty-orbit"><RotateCcw size={23} /></div><p className="empty-copy">Try clarifying the target or provide a sharper redacted screenshot.</p></div></div>
                  </div>
                )}
                {viewState === 'success' && result && (
                  <div data-testid="state-success">
                    <div className="result-summary">
                      <div className="result-status success"><CheckCircle2 size={18} /> Safe command path found</div>
                      <div className="summary-meta"><span>MODEL <strong>{result.model}</strong></span><span>STEPS <strong>{result.commands.length}</strong></span><span>STATUS <strong>inspectable</strong></span></div>
                    </div>
                    <div className="command-list">
                      <div className="list-heading"><span>Validated sequence</span><span>Confidence</span></div>
                      {result.commands.map((command, index) => {
                        const Icon = actionIcons[command.action] || Activity;
                        return <div className="command-row" key={`${command.action}-${index}`} data-testid={`row-command-${index}`}>
                          <span className="command-number">{String(index + 1).padStart(2, '0')}</span>
                          <div><div className="command-action"><Icon size={12} style={{ verticalAlign: 'middle', marginRight: 5 }} /> {command.action}</div><div className="command-detail">{commandDetail(command)}</div></div>
                          <div className="confidence"><span className="confidence-value">{Math.round(command.confidence * 100)}%</span><div className="confidence-track"><div className="confidence-fill" style={{ width: `${Math.max(0, Math.min(100, command.confidence * 100))}%` }} /></div></div>
                        </div>;
                      })}
                    </div>
                  </div>
                )}
              </section>

              <section className="panel json-panel">
                <div className="panel-head">
          <div><h2 className="panel-title">{result ? 'Command payload' : 'Request payload'}</h2><p className="panel-note">{result ? 'The validated response returned by the perception service.' : 'The exact body sent to the perception service.'}</p></div>
          <button className="button button-quiet button-small" onClick={result ? copyResult : copyPayload} disabled={result ? !result : (!imageBase64 && !taskPrompt)} data-testid="button-copy-payload">{(result ? copiedResult : copied) ? <><Check size={13} /> Copied</> : <><Clipboard size={13} /> Copy JSON</>}</button>
                </div>
                <div className="json-body">
          <pre className="json-code" data-testid="text-json-payload">{JSON.stringify(result ?? payload, null, 2)}</pre>
          <div className="privacy-note"><LockKeyhole size={13} /> {result ? 'Commands are returned for inspection only — nothing is executed.' : 'Base64 stays visible so every request is inspectable before send.'}</div>
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function Router() {
  return (
    <ErrorBoundary resetKey={useLocation()[0]}>
      <Switch>
        <Route path="/" component={Workbench} />
        <Route component={NotFound} />
      </Switch>
    </ErrorBoundary>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;