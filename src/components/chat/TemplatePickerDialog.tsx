'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { cn } from '@/lib/utils';
import { Paperclip, Upload } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface TemplatePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  onSent?: () => Promise<void> | void;
}

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
  return Boolean(
    template &&
      template.header.type !== 'NONE' &&
      template.header.type !== 'TEXT'
  );
}

function buildTemplateParameterPayload(
  template: WhatsAppTemplateDefinition,
  values: Record<string, string>
): SendMessageRequest['templateParameters'] {
  if (template.parameterFormat === 'POSITIONAL') {
    return template.parameters.map((parameter) => values[parameter.key] || '');
  }

  return values;
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || null,
    [selectedTemplateId, templates]
  );

  useEffect(() => {
    if (!open) {
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
    setParameterValues({});
    setSelectedMediaFile(null);
  }, [selectedTemplateId]);

  const handleSendTemplate = async () => {
    if (!selectedTemplate) {
      return;
    }

    try {
      setIsSending(true);

      const missingParameter = selectedTemplate.parameters.find(
        (parameter) => !parameterValues[parameter.key]?.trim()
      );
      if (missingParameter) {
        throw new Error(`Please fill ${missingParameter.label} before sending.`);
      }

      if (
        isTemplateMediaHeader(selectedTemplate) &&
        !selectedMediaFile &&
        !selectedTemplate.header.mediaUrl
      ) {
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Send Template Message</DialogTitle>
          <DialogDescription>
            Select an approved WhatsApp template for this customer and fill any required values before sending.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
          <ScrollArea className="max-h-[60vh] rounded-xl border border-border/70">
            <div className="space-y-2 p-3">
              {isLoading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">Loading templates...</div>
              ) : null}

              {!isLoading && error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              ) : null}

              {!isLoading && !error && templates.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No approved templates are available for this WhatsApp number.
                </div>
              ) : null}

              {templates.map((template) => {
                const isSelected = template.id === selectedTemplateId;

                return (
                  <button
                    key={template.id}
                    type="button"
                    className={cn(
                      'w-full rounded-xl border px-3 py-3 text-left transition-colors',
                      isSelected
                        ? 'border-primary bg-primary/5'
                        : 'border-border/70 bg-card/40 hover:bg-accent/60'
                    )}
                    onClick={() => setSelectedTemplateId(template.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium">{template.templateName}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {template.language} · v{template.version}
                        </div>
                      </div>
                      <Badge variant="outline">{template.category}</Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>

          <div className="min-w-0 rounded-xl border border-border/70 bg-card/40 p-4">
            {selectedTemplate ? (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-semibold">{selectedTemplate.templateName}</h3>
                    <Badge variant="secondary">{selectedTemplate.category}</Badge>
                    <Badge variant="outline">{selectedTemplate.language}</Badge>
                  </div>
                  {selectedTemplate.bodyText ? (
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                      {selectedTemplate.bodyText}
                    </p>
                  ) : null}
                </div>

                {selectedTemplate.header.type === 'TEXT' ? (
                  <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                    <div className="mb-2 text-sm font-medium">Header text</div>
                    <p className="text-sm text-muted-foreground">
                      {selectedTemplate.header.text || 'This template uses a text header.'}
                    </p>
                  </div>
                ) : null}

                {isTemplateMediaHeader(selectedTemplate) ? (
                  <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                    <div className="mb-2 text-sm font-medium">
                      Header {selectedTemplate.header.type.toLowerCase()}
                    </div>
                    {selectedTemplate.header.mediaUrl ? (
                      <p className="mb-2 text-xs text-muted-foreground">
                        Existing template media is available. Upload a new file only if you want to override it for this send.
                      </p>
                    ) : (
                      <p className="mb-2 text-xs text-muted-foreground">
                        This template requires a {selectedTemplate.header.type.toLowerCase()} file before sending.
                      </p>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept={getTemplateMediaAccept(selectedTemplate)}
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
                  </div>
                ) : null}

                {selectedTemplate.parameters.length > 0 ? (
                  <div className="space-y-3">
                    <div className="text-sm font-medium">Template values</div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {selectedTemplate.parameters.map((parameter) => (
                        <div key={`${parameter.location}-${parameter.key}`} className="space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">
                            {parameter.label}
                            <span className="ml-1 uppercase tracking-[0.12em]">
                              {parameter.location}
                            </span>
                          </label>
                          <Input
                            value={parameterValues[parameter.key] || ''}
                            placeholder={parameter.example || `Enter ${parameter.label.toLowerCase()}`}
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
                  </div>
                ) : null}

                {selectedTemplate.buttons.length > 0 ? (
                  <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                    <div className="mb-2 text-sm font-medium">Buttons</div>
                    <div className="space-y-2">
                      {selectedTemplate.buttons.map((button) => (
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

                <div className="flex items-center justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
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
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[260px] items-center justify-center text-sm text-muted-foreground">
                Select a template to continue.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
