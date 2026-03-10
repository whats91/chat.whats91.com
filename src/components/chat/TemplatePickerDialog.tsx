'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { fetchConversationTemplates, sendMessage as sendConversationMessage, uploadMedia } from '@/lib/api/client';
import type { ConversationTemplatesResponse, SendMessageRequest, WhatsAppTemplateDefinition } from '@/lib/types/chat';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { ArrowLeft, ArrowRight, Check, ChevronsUpDown, Paperclip, Upload } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface TemplatePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  onSent?: () => Promise<void> | void;
}

type TemplateStep = 1 | 2 | 3;

const TEMPLATE_STEPS: Array<{ id: TemplateStep; label: string }> = [
  { id: 1, label: 'Select' },
  { id: 2, label: 'Fill' },
  { id: 3, label: 'Preview' },
];

function getTemplateMediaAccept(template: WhatsAppTemplateDefinition | null): string {
  if (!template) {
    return 'image/*,video/*,application/pdf';
  }

  switch (template.header.type) {
    case 'IMAGE':
      return 'image/*';
    case 'VIDEO':
      return 'video/*';
    case 'DOCUMENT':
      return 'application/pdf,.pdf,.doc,.docx';
    default:
      return 'image/*,video/*,application/pdf';
  }
}

function isTemplateMediaHeader(template: WhatsAppTemplateDefinition | null): boolean {
  return Boolean(template && template.header.type !== 'NONE' && template.header.type !== 'TEXT');
}

function buildTemplateParameterPayload(
  template: WhatsAppTemplateDefinition,
  values: Record<string, string>
): SendMessageRequest['templateParameters'] {
  if (template.parameterFormat === 'POSITIONAL') {
    return template.parameters.map((parameter) => values[parameter.key]?.trim() || '');
  }

  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, value.trim()])
  );
}

function renderTemplatePreviewText(
  text: string | null | undefined,
  values: Record<string, string>
): string {
  if (!text) {
    return '';
  }

  return text.replace(/{{\s*([^}]+?)\s*}}/g, (_match, rawKey: string) => {
    const key = rawKey.trim();
    const replacement = values[key]?.trim();
    return replacement || `{{${key}}}`;
  });
}

function buildInitialTemplateParameterValues(
  template: WhatsAppTemplateDefinition | null
): Record<string, string> {
  if (!template) {
    return {};
  }

  return template.parameters.reduce<Record<string, string>>((accumulator, parameter) => {
    if (parameter.example?.trim()) {
      accumulator[parameter.key] = parameter.example.trim();
    }
    return accumulator;
  }, {});
}

export function TemplatePickerDialog({
  open,
  onOpenChange,
  conversationId,
  onSent,
}: TemplatePickerDialogProps) {
  const [templates, setTemplates] = useState<WhatsAppTemplateDefinition[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMediaFile, setSelectedMediaFile] = useState<File | null>(null);
  const [currentStep, setCurrentStep] = useState<TemplateStep>(1);
  const [isTemplateSearchOpen, setIsTemplateSearchOpen] = useState(false);
  const [selectedMediaPreviewUrl, setSelectedMediaPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || null,
    [selectedTemplateId, templates]
  );

  const missingParameter = useMemo(
    () =>
      selectedTemplate?.parameters.find(
        (parameter) => !parameterValues[parameter.key]?.trim()
      ) || null,
    [parameterValues, selectedTemplate]
  );

  const isMissingRequiredMedia =
    isTemplateMediaHeader(selectedTemplate) &&
    !selectedMediaFile &&
    !selectedTemplate?.header.mediaUrl;

  const previewBodyText = useMemo(
    () => renderTemplatePreviewText(selectedTemplate?.bodyText, parameterValues),
    [parameterValues, selectedTemplate]
  );

  const previewHeaderText = useMemo(
    () => renderTemplatePreviewText(selectedTemplate?.header.text, parameterValues),
    [parameterValues, selectedTemplate]
  );
  const previewMediaUrl = selectedMediaPreviewUrl || selectedTemplate?.header.mediaUrl || null;

  useEffect(() => {
    if (!open) {
      setCurrentStep(1);
      setIsTemplateSearchOpen(false);
      setParameterValues({});
      setSelectedMediaFile(null);
      return;
    }

    let cancelled = false;

    const loadTemplates = async () => {
      try {
        setIsLoading(true);
        setError(null);

        const response: ConversationTemplatesResponse = await fetchConversationTemplates(conversationId);
        if (cancelled) {
          return;
        }

        if (!response.success || !response.data) {
          setTemplates([]);
          setSelectedTemplateId(null);
          setError(response.message || 'Unable to load templates');
          return;
        }

        setTemplates(response.data.templates || []);
        setSelectedTemplateId((current) =>
          current && response.data?.templates.some((template) => template.id === current)
            ? current
            : response.data?.templates[0]?.id || null
        );
      } catch (loadError) {
        if (!cancelled) {
          setTemplates([]);
          setSelectedTemplateId(null);
          setError(loadError instanceof Error ? loadError.message : 'Unable to load templates');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadTemplates();

    return () => {
      cancelled = true;
    };
  }, [conversationId, open]);

  useEffect(() => {
    setParameterValues(buildInitialTemplateParameterValues(selectedTemplate));
    setSelectedMediaFile(null);
    setCurrentStep(1);
  }, [selectedTemplate]);

  useEffect(() => {
    if (!selectedMediaFile) {
      setSelectedMediaPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(selectedMediaFile);
    setSelectedMediaPreviewUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [selectedMediaFile]);

  const handleSendTemplate = async () => {
    if (!selectedTemplate) {
      return;
    }

    try {
      setIsSending(true);

      if (missingParameter) {
        throw new Error(`Please fill ${missingParameter.label} before sending.`);
      }

      if (isMissingRequiredMedia) {
        throw new Error(
          `This template requires ${selectedTemplate.header.type.toLowerCase()} header media before sending.`
        );
      }

      let mediaUploadToken: string | undefined;

      if (selectedMediaFile) {
        const uploadResponse = await uploadMedia(conversationId, selectedMediaFile);
        const uploadEntry = uploadResponse.data?.[0];

        if (!uploadResponse.success || !uploadEntry?.uploadToken) {
          throw new Error(uploadResponse.message || 'Unable to upload template media');
        }

        mediaUploadToken = uploadEntry.uploadToken;
      }

      const response = await sendConversationMessage(conversationId, {
        messageType: 'template',
        templateRecordId: selectedTemplate.id,
        templateName: selectedTemplate.templateName,
        templateCategory: selectedTemplate.category,
        templateLanguage: selectedTemplate.language,
        templateParameterFormat: selectedTemplate.parameterFormat,
        templateParameters: buildTemplateParameterPayload(selectedTemplate, parameterValues),
        mediaUploadToken,
      });

      if (!response.success) {
        throw new Error(response.message || 'Unable to send template');
      }

      toast({
        title: 'Template sent',
        description: `${selectedTemplate.templateName} was sent successfully.`,
      });

      if (onSent) {
        await onSent();
      }

      onOpenChange(false);
    } catch (sendError) {
      toast({
        title: 'Template send failed',
        description: sendError instanceof Error ? sendError.message : 'Unable to send template',
        variant: 'destructive',
      });
    } finally {
      setIsSending(false);
    }
  };

  const renderSelectStep = () => (
    <ScrollArea className="h-full pr-4">
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="text-sm font-medium">Choose template</div>
          <Popover open={isTemplateSearchOpen} onOpenChange={setIsTemplateSearchOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={isTemplateSearchOpen}
                className="h-auto w-full justify-between px-3 py-3 text-left"
                disabled={isLoading || templates.length === 0}
              >
                <div className="min-w-0">
                  {selectedTemplate ? (
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{selectedTemplate.templateName}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {selectedTemplate.category} · {selectedTemplate.language} · v{selectedTemplate.version}
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Search and select a template</span>
                  )}
                </div>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-60" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[min(32rem,calc(100vw-2rem))] p-0" align="start">
              <Command>
                <CommandInput placeholder="Search templates..." />
                <CommandList>
                  <CommandEmpty>No templates found.</CommandEmpty>
                  <CommandGroup>
                    {templates.map((template) => (
                      <CommandItem
                        key={template.id}
                        value={template.templateName}
                        onSelect={() => {
                          setSelectedTemplateId(template.id);
                          setIsTemplateSearchOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            'mr-2 h-4 w-4',
                            selectedTemplateId === template.id ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{template.templateName}</div>
                          <div className="text-xs text-muted-foreground">
                            {template.category} · {template.language} · {template.header.type}
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {isLoading ? (
          <div className="rounded-xl border border-border/70 bg-card/40 px-4 py-10 text-center text-sm text-muted-foreground">
            Loading templates...
          </div>
        ) : null}

        {!isLoading && error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {!isLoading && !error && templates.length === 0 ? (
          <div className="rounded-xl border border-border/70 bg-card/40 px-4 py-10 text-center text-sm text-muted-foreground">
            No approved templates are available for this WhatsApp number.
          </div>
        ) : null}

        {selectedTemplate ? (
          <div className="rounded-xl border border-border/70 bg-card/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{selectedTemplate.templateName}</h3>
              <Badge variant="secondary">{selectedTemplate.category}</Badge>
              <Badge variant="outline">{selectedTemplate.language}</Badge>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Header</div>
                <div className="mt-1 text-sm font-medium">{selectedTemplate.header.type}</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Parameters</div>
                <div className="mt-1 text-sm font-medium">{selectedTemplate.parameters.length}</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Buttons</div>
                <div className="mt-1 text-sm font-medium">{selectedTemplate.buttons.length}</div>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Format</div>
                <div className="mt-1 text-sm font-medium">{selectedTemplate.parameterFormat}</div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );

  const renderFillStep = () => (
    (() => {
      if (!selectedTemplate) {
        return null;
      }

      const template = selectedTemplate;

      return (
        <div className="h-full overflow-y-auto pr-2">
          <div className="space-y-4 pb-2">
            <div className="rounded-xl border border-border/70 bg-card/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold">{template.templateName}</h3>
                <Badge variant="secondary">{template.category}</Badge>
                <Badge variant="outline">{template.language}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                Fill any required variables and upload header media if this template needs it.
              </p>
            </div>

            {template.header.type === 'TEXT' ? (
              <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                <div className="mb-2 text-sm font-medium">Header text</div>
                <p className="text-sm text-muted-foreground">
                  {template.header.text || 'This template uses a text header.'}
                </p>
              </div>
            ) : null}

            {isTemplateMediaHeader(template) ? (
              <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                <div className="mb-2 text-sm font-medium">
                  Header {template.header.type.toLowerCase()}
                </div>
                {template.header.mediaUrl ? (
                  <p className="mb-2 text-xs text-muted-foreground">
                    Stored template media is available. Upload a new file only if you want to override it for this send.
                  </p>
                ) : (
                  <p className="mb-2 text-xs text-muted-foreground">
                    This template requires a {template.header.type.toLowerCase()} file before sending.
                  </p>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={getTemplateMediaAccept(template)}
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    event.target.value = '';
                    setSelectedMediaFile(file);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip className="mr-2 h-4 w-4" />
                  {selectedMediaFile ? 'Replace media' : 'Upload media'}
                </Button>
                {selectedMediaFile ? (
                  <div className="mt-2 text-xs text-muted-foreground">
                    Selected: {selectedMediaFile.name}
                  </div>
                ) : null}
                {isMissingRequiredMedia ? (
                  <div className="mt-2 text-xs text-destructive">
                    Upload is required for this template header.
                  </div>
                ) : null}
              </div>
            ) : null}

            {template.parameters.length ? (
              <div className="space-y-3">
                <div className="text-sm font-medium">Template values</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {template.parameters.map((parameter) => (
                    <div key={`${parameter.location}-${parameter.key}`} className="space-y-1">
                      <label className="text-xs font-medium text-muted-foreground">
                        {parameter.label}
                        <span className="ml-1 uppercase tracking-[0.12em]">
                          {parameter.location}
                        </span>
                      </label>
                      <Input
                        value={parameterValues[parameter.key] || ''}
                        placeholder={`Enter ${parameter.label.toLowerCase()}`}
                        onChange={(event) =>
                          setParameterValues((current) => ({
                            ...current,
                            [parameter.key]: event.target.value,
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
                {missingParameter ? (
                  <div className="text-xs text-destructive">
                    {missingParameter.label} is required before you can review the message.
                  </div>
                ) : null}
              </div>
            ) : null}

            {template.buttons.length ? (
              <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                <div className="mb-2 text-sm font-medium">Buttons</div>
                <div className="space-y-2">
                  {template.buttons.map((button) => (
                    <div key={`${button.type}-${button.index}`} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{button.text}</span>
                      {' '}· {button.type}
                      {button.dynamicParameterKeys.length > 0 ? (
                        <span> · dynamic values: {button.dynamicParameterKeys.join(', ')}</span>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      );
    })()
  );

  const renderPreviewStep = () => (
    <ScrollArea className="h-full pr-4">
      <div className="space-y-4">
        {selectedTemplate ? (
          <div className="rounded-xl border border-border/70 bg-card/40 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{selectedTemplate.templateName}</h3>
              <Badge variant="secondary">{selectedTemplate.category}</Badge>
              <Badge variant="outline">{selectedTemplate.language}</Badge>
            </div>

            <div className="rounded-2xl border border-border/70 bg-background p-4 shadow-sm">
              {selectedTemplate.header.type === 'TEXT' && previewHeaderText ? (
                <div className="mb-3 text-sm font-semibold text-foreground">{previewHeaderText}</div>
              ) : null}

              {isTemplateMediaHeader(selectedTemplate) ? (
                <div className="mb-3">
                  {selectedTemplate.header.type === 'IMAGE' && previewMediaUrl ? (
                    <div className="overflow-hidden rounded-xl bg-black/5 dark:bg-white/5">
                      <AspectRatio ratio={4 / 3}>
                        <img
                          src={previewMediaUrl}
                          alt={selectedMediaFile?.name || `${selectedTemplate.templateName} header`}
                          className="h-full w-full object-cover"
                        />
                      </AspectRatio>
                    </div>
                  ) : null}

                  {selectedTemplate.header.type === 'VIDEO' && previewMediaUrl ? (
                    <video
                      src={previewMediaUrl}
                      controls
                      preload="metadata"
                      className="max-h-[320px] w-full rounded-xl bg-black"
                    />
                  ) : null}

                  {selectedTemplate.header.type === 'DOCUMENT' ? (
                    <div className="rounded-xl border border-border/70 bg-muted/20 px-3 py-3 text-sm">
                      <div className="font-medium text-foreground">
                        {selectedMediaFile?.name || 'Template document'}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {previewMediaUrl ? 'Document header ready for send' : 'Document header missing'}
                      </div>
                    </div>
                  ) : null}

                  {!previewMediaUrl ? (
                    <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                      Header {selectedTemplate.header.type.toLowerCase()}: missing media
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {selectedMediaFile
                        ? `Using uploaded ${selectedTemplate.header.type.toLowerCase()}: ${selectedMediaFile.name}`
                        : `Using stored template ${selectedTemplate.header.type.toLowerCase()}`}
                    </div>
                  )}
                </div>
              ) : null}

              {previewBodyText ? (
                <div className="whitespace-pre-wrap text-sm text-foreground">
                  {previewBodyText}
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">This template has no body text.</div>
              )}

              {selectedTemplate.footerText ? (
                <div className="mt-3 border-t border-border/70 pt-3 text-xs text-muted-foreground">
                  {selectedTemplate.footerText}
                </div>
              ) : null}

              {selectedTemplate.buttons.length > 0 ? (
                <div className="mt-3 space-y-2 border-t border-border/70 pt-3">
                  {selectedTemplate.buttons.map((button) => (
                    <div
                      key={`${button.type}-${button.index}`}
                      className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2 text-sm"
                    >
                      <div className="font-medium text-foreground">{button.text}</div>
                      <div className="text-xs text-muted-foreground">{button.type}</div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[min(42rem,calc(100vw-2rem))] max-w-none flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 px-6 pt-6">
          <DialogTitle>Send Template Message</DialogTitle>
          <DialogDescription>
            Select a template, fill the required values, then review the final WhatsApp message before sending.
          </DialogDescription>
        </DialogHeader>

        <div className="shrink-0 px-6 pt-4">
          <div className="grid grid-cols-3 gap-2">
            {TEMPLATE_STEPS.map((step) => (
              <div
                key={step.id}
                className={cn(
                  'rounded-lg border px-3 py-2 text-center text-sm font-medium',
                  currentStep === step.id
                    ? 'border-primary bg-primary/10 text-primary'
                    : currentStep > step.id
                      ? 'border-border bg-muted/30 text-foreground'
                      : 'border-border/70 bg-card/30 text-muted-foreground'
                )}
              >
                {step.label}
              </div>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden px-6 py-4">
          {currentStep === 1 ? renderSelectStep() : null}
          {currentStep === 2 ? renderFillStep() : null}
          {currentStep === 3 ? renderPreviewStep() : null}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/70 px-6 py-4">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>

          <div className="flex items-center gap-2">
            {currentStep > 1 ? (
              <Button type="button" variant="outline" onClick={() => setCurrentStep((current) => (current - 1) as TemplateStep)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Back
              </Button>
            ) : null}

            {currentStep === 1 ? (
              <Button
                type="button"
                onClick={() => setCurrentStep(2)}
                disabled={!selectedTemplate || isLoading || Boolean(error)}
              >
                Next
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : null}

            {currentStep === 2 ? (
              <Button
                type="button"
                onClick={() => setCurrentStep(3)}
                disabled={!selectedTemplate || Boolean(missingParameter) || isMissingRequiredMedia}
              >
                Review
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : null}

            {currentStep === 3 ? (
              <Button type="button" onClick={() => void handleSendTemplate()} disabled={isSending}>
                {isSending ? (
                  <>
                    <Upload className="mr-2 h-4 w-4 animate-pulse" />
                    Sending...
                  </>
                ) : (
                  'Send template'
                )}
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
